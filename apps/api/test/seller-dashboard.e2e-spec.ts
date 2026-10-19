import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import type { SellerMemberRole } from '@prisma/client';
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

describe('Seller operations dashboard shell (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sentMessages = new Map<string, string>();

  const smsSender: SmsSenderAdapter = {
    send: jest.fn(async (phone: string, body: string) => {
      sentMessages.set(phone, body);
    }),
  };

  async function login(phone: string): Promise<{ accessToken: string; userId: string }> {
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
    };
  }

  function loginNewUser() {
    return login(uniquePhone());
  }

  async function createSeller(accessToken: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/seller-applications')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validCreateApplicationBody())
      .expect(201);
    return res.body.data.seller_id as string;
  }

  // Adds a seller_members row directly (bypassing the invite-by-phone HTTP
  // flow, which is T-G1-4's own concern) — this file is only responsible for
  // proving GET /v1/seller/dashboard's own behavior given a caller with a
  // known role.
  function addMember(sellerId: string, userId: string, role: SellerMemberRole) {
    return prisma.sellerMember.create({ data: { sellerId, userId, role } });
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

  describe('GET /v1/seller/dashboard', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/seller/dashboard?seller_id=00000000-0000-0000-0000-000000000000')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('requires a seller_id query parameter (422 VALIDATION_ERROR when missing)', async () => {
      const { accessToken } = await loginNewUser();
      const res = await request(app.getHttpServer())
        .get('/v1/seller/dashboard')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('cross-seller: a non-member gets 403 FORBIDDEN', async () => {
      const ownerA = await loginNewUser();
      const strangerB = await loginNewUser();
      const sellerIdA = await createSeller(ownerA.accessToken);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/dashboard?seller_id=${sellerIdA}`)
        .set('Authorization', `Bearer ${strangerB.accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns seller_status and an explicit NOT_AVAILABLE placeholder (never a bare empty array/zero) for offers/inventory/orders, each naming its milestone', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/dashboard?seller_id=${sellerId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(res.body.data.seller_id).toBe(sellerId);
      expect(res.body.data.seller_status).toBe('DRAFT');

      const sections = res.body.data.sections;
      expect(Array.isArray(sections.offers)).toBe(false);
      expect(sections.offers).toEqual({ status: 'NOT_AVAILABLE', available_from: 'G2' });
      expect(sections.inventory).toEqual({ status: 'NOT_AVAILABLE', available_from: 'G3' });
      expect(sections.orders).toEqual({ status: 'NOT_AVAILABLE', available_from: 'G4/G6' });
    });

    it('an OPERATOR member can still view the dashboard shell (view is not permission-gated, same as the profile GET)', async () => {
      const owner = await loginNewUser();
      const operator = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await addMember(sellerId, operator.userId, 'OPERATOR');

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/dashboard?seller_id=${sellerId}`)
        .set('Authorization', `Bearer ${operator.accessToken}`)
        .expect(200);
      expect(res.body.data.sections.inventory.status).toBe('NOT_AVAILABLE');
    });

    it('a MANAGER member can also view the dashboard shell', async () => {
      const owner = await loginNewUser();
      const manager = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await addMember(sellerId, manager.userId, 'MANAGER');

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/dashboard?seller_id=${sellerId}`)
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .expect(200);
      expect(res.body.data.sections.orders.status).toBe('NOT_AVAILABLE');
    });
  });
});
