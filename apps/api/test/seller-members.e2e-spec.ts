import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import {
  SMS_SENDER_ADAPTER,
  type SmsSenderAdapter,
} from '../src/modules/identity/auth/sms-sender.adapter';

function uniquePhone(): string {
  const tail = Math.floor(100_000_000 + Math.random() * 800_000_000);
  return `+998${tail}`;
}

function extractOtpCode(smsBody: string): string {
  const match = smsBody.match(/\b(\d{6})\b/);
  if (!match || !match[1]) {
    throw new Error(`no 6-digit OTP code found in captured SMS body: ${smsBody}`);
  }
  return match[1];
}

function validCreateApplicationBody(overrides: Record<string, unknown> = {}) {
  return {
    legal_type: 'LLC',
    tax_id: '0012345678',
    legal_name: 'Test Trading LLC',
    display_name: 'Test Shop',
    contacts: { phone: '+998901234567', email: 'owner@example.com' },
    ...overrides,
  };
}

describe('Seller staff/team RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sentMessages = new Map<string, string>();

  const smsSender: SmsSenderAdapter = {
    send: jest.fn(async (phone: string, body: string) => {
      sentMessages.set(phone, body);
    }),
  };

  async function loginNewUser(): Promise<{ accessToken: string; userId: string; phone: string }> {
    const phone = uniquePhone();
    const otpRes = await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .send({ phone, purpose: 'LOGIN' })
      .expect(202);
    const challengeId = otpRes.body.data.challenge_id as string;
    const code = extractOtpCode(sentMessages.get(phone) as string);

    const verifyRes = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: challengeId, code })
      .expect(200);

    return {
      accessToken: verifyRes.body.data.access_token as string,
      userId: (verifyRes.body.data.user as Record<string, unknown>).id as string,
      phone,
    };
  }

  async function createSeller(accessToken: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/seller-applications')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validCreateApplicationBody())
      .expect(201);
    return res.body.data.seller_id as string;
  }

  beforeAll(async () => {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    const flusher = new Redis(redisUrl);
    await flusher.flushdb();
    await flusher.quit();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SMS_SENDER_ADAPTER)
      .useValue(smsSender)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('seller application creation', () => {
    it('automatically inserts the creating user as a seller_members OWNER row', async () => {
      const { accessToken, userId } = await loginNewUser();
      const sellerId = await createSeller(accessToken);

      const member = await prisma.sellerMember.findUnique({
        where: { sellerId_userId: { sellerId, userId } },
      });
      expect(member?.role).toBe('OWNER');
    });
  });

  describe('POST /v1/seller/members (invite)', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/seller/members')
        .send({
          seller_id: '00000000-0000-0000-0000-000000000000',
          phone: uniquePhone(),
          role: 'MANAGER',
        })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('an OWNER can invite an existing registered user as MANAGER', async () => {
      const owner = await loginNewUser();
      const staff = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      const res = await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, phone: staff.phone, role: 'MANAGER' })
        .expect(201);

      expect(res.body.data.role).toBe('MANAGER');
      expect(res.body.data.user_id).toBe(staff.userId);

      const member = await prisma.sellerMember.findUnique({
        where: { sellerId_userId: { sellerId, userId: staff.userId } },
      });
      expect(member?.role).toBe('MANAGER');
    });

    it('rejects with 422 VALIDATION_ERROR when the phone has no registered user', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      const res = await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, phone: uniquePhone(), role: 'MANAGER' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it("cross-seller: inviting against a seller_id the caller doesn't belong to returns 403 FORBIDDEN (user-supplied seller_id spoofing, TZ §34)", async () => {
      const ownerA = await loginNewUser();
      const ownerB = await loginNewUser();
      const staff = await loginNewUser();
      const sellerIdA = await createSeller(ownerA.accessToken);

      const res = await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({ seller_id: sellerIdA, phone: staff.phone, role: 'MANAGER' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('[Idempotency-Key] a repeat invite with the same key replays the original response and does not create a second row', async () => {
      const owner = await loginNewUser();
      const staff = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      const idempotencyKey = `invite-${Math.random()}`;
      const body = { seller_id: sellerId, phone: staff.phone, role: 'MANAGER' };

      const first = await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);

      expect(second.body.data.id).toBe(first.body.data.id);
      const count = await prisma.sellerMember.count({ where: { sellerId, userId: staff.userId } });
      expect(count).toBe(1);
    });

    // Explicit no-privilege-escalation case (TZ §34 "manage members with no
    // privilege escalation"): a MANAGER is a real, non-fabricated member of
    // this seller — the only thing being tested is whether their role is
    // enough, which is exactly the non-tautological bar this ticket requires.
    it('a MANAGER attempting to invite ANYONE (even as OPERATOR) gets 403 FORBIDDEN — invite is OWNER-only', async () => {
      const owner = await loginNewUser();
      const manager = await loginNewUser();
      const staff = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, phone: manager.phone, role: 'MANAGER' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .send({ seller_id: sellerId, phone: staff.phone, role: 'OPERATOR' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const count = await prisma.sellerMember.count({ where: { sellerId, userId: staff.userId } });
      expect(count).toBe(0);
    });

    it('a MANAGER attempting to grant OWNER to themselves gets 403 FORBIDDEN (privilege escalation blocked)', async () => {
      const owner = await loginNewUser();
      const manager = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, phone: manager.phone, role: 'MANAGER' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .send({ seller_id: sellerId, phone: manager.phone, role: 'OWNER' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const member = await prisma.sellerMember.findUnique({
        where: { sellerId_userId: { sellerId, userId: manager.userId } },
      });
      expect(member?.role).toBe('MANAGER');
    });
  });

  describe('GET /v1/seller/members', () => {
    it('requires a seller_id query parameter (422 VALIDATION_ERROR when missing)', async () => {
      const { accessToken } = await loginNewUser();
      const res = await request(app.getHttpServer())
        .get('/v1/seller/members')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it("lists only the caller's own seller's members", async () => {
      const owner = await loginNewUser();
      const staff = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, phone: staff.phone, role: 'OPERATOR' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/members?seller_id=${sellerId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.map((m: { role: string }) => m.role).sort()).toEqual([
        'OPERATOR',
        'OWNER',
      ]);
    });

    it("cross-seller: listing another seller's members returns 403 FORBIDDEN", async () => {
      const ownerA = await loginNewUser();
      const ownerB = await loginNewUser();
      const sellerIdA = await createSeller(ownerA.accessToken);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/members?seller_id=${sellerIdA}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('PATCH /v1/seller/members/:id (role change)', () => {
    it('an OWNER can promote an OPERATOR to MANAGER', async () => {
      const owner = await loginNewUser();
      const staff = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      const invited = await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, phone: staff.phone, role: 'OPERATOR' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/v1/seller/members/${invited.body.data.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ role: 'MANAGER' })
        .expect(200);
      expect(res.body.data.role).toBe('MANAGER');
    });

    it('returns 404 NOT_FOUND for a well-formed but non-existent id', async () => {
      const { accessToken } = await loginNewUser();
      const res = await request(app.getHttpServer())
        .patch('/v1/seller/members/3fa85f64-5717-4562-b3fc-2c963f66afa6')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ role: 'MANAGER' })
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it("cross-seller: changing another seller's member role returns 403 FORBIDDEN", async () => {
      const ownerA = await loginNewUser();
      const ownerB = await loginNewUser();
      const staff = await loginNewUser();
      const sellerIdA = await createSeller(ownerA.accessToken);
      const invited = await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({ seller_id: sellerIdA, phone: staff.phone, role: 'OPERATOR' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/v1/seller/members/${invited.body.data.id}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({ role: 'MANAGER' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    // The ticket's headline no-privilege-escalation scenario: a real MANAGER
    // attempts to demote a real OWNER via the real HTTP route + full guard
    // chain (MemberAccessGuard -> OwnershipGuard -> SellerPermissionGuard) —
    // and the OWNER's role in the DB is verified unchanged afterward, so this
    // is not a silent downgrade either.
    it('a MANAGER cannot demote an OWNER: 403 FORBIDDEN and the OWNER row is unchanged in the DB', async () => {
      const owner = await loginNewUser();
      const manager = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, phone: manager.phone, role: 'MANAGER' })
        .expect(201);

      const ownerMember = await prisma.sellerMember.findUniqueOrThrow({
        where: { sellerId_userId: { sellerId, userId: owner.userId } },
      });

      const res = await request(app.getHttpServer())
        .patch(`/v1/seller/members/${ownerMember.id}`)
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .send({ role: 'MANAGER' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const afterAttempt = await prisma.sellerMember.findUniqueOrThrow({
        where: { id: ownerMember.id },
      });
      expect(afterAttempt.role).toBe('OWNER');
    });

    it('a MANAGER cannot grant OWNER or MANAGER to anyone via role-change either: 403 FORBIDDEN', async () => {
      const owner = await loginNewUser();
      const manager = await loginNewUser();
      const operator = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, phone: manager.phone, role: 'MANAGER' })
        .expect(201);
      const operatorMember = await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, phone: operator.phone, role: 'OPERATOR' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/v1/seller/members/${operatorMember.body.data.id}`)
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .send({ role: 'OWNER' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const afterAttempt = await prisma.sellerMember.findUniqueOrThrow({
        where: { id: operatorMember.body.data.id },
      });
      expect(afterAttempt.role).toBe('OPERATOR');
    });

    // G1 QA review minor #1: no safeguard previously existed against a
    // seller ending up with zero OWNERs. The sole OWNER demoting themselves
    // is the realistic path (only OWNER holds seller:members:manage, so
    // self-demotion is the only way this can actually be reached).
    it('the sole OWNER demoting themselves returns 409 INVALID_STATE_TRANSITION, and the role is unchanged (seller must always have >=1 OWNER)', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      const ownerMember = await prisma.sellerMember.findUniqueOrThrow({
        where: { sellerId_userId: { sellerId, userId: owner.userId } },
      });

      const res = await request(app.getHttpServer())
        .patch(`/v1/seller/members/${ownerMember.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ role: 'MANAGER' })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');

      const afterAttempt = await prisma.sellerMember.findUniqueOrThrow({
        where: { id: ownerMember.id },
      });
      expect(afterAttempt.role).toBe('OWNER');
    });

    it('demoting an OWNER succeeds when at least one other OWNER remains for the same seller', async () => {
      const owner = await loginNewUser();
      const secondOwner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await request(app.getHttpServer())
        .post('/v1/seller/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, phone: secondOwner.phone, role: 'OWNER' })
        .expect(201);
      const ownerMember = await prisma.sellerMember.findUniqueOrThrow({
        where: { sellerId_userId: { sellerId, userId: owner.userId } },
      });

      const res = await request(app.getHttpServer())
        .patch(`/v1/seller/members/${ownerMember.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ role: 'MANAGER' })
        .expect(200);
      expect(res.body.data.role).toBe('MANAGER');
    });
  });
});
