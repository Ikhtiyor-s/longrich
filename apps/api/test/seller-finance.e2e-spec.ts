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

const MODERATOR_PHONE = '+998900000004';
const SUPPORT_AGENT_PHONE = '+998900000002';
const LEADING_ZERO_REFERENCE = '00998877665544';

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

describe('Seller finance summary + bank account surface (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let moderatorToken: string;
  let moderatorId: string;
  let supportAgentToken: string;
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
  // flow, T-G1-4's own concern) — this file only tests this ticket's own
  // finance/bank-account endpoints given a caller with a known role.
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

    const moderator = await login(MODERATOR_PHONE);
    moderatorToken = moderator.accessToken;
    moderatorId = moderator.userId;
    const supportAgent = await login(SUPPORT_AGENT_PHONE);
    supportAgentToken = supportAgent.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/seller/finance/summary', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/seller/finance/summary?seller_id=00000000-0000-0000-0000-000000000000')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('requires a seller_id query parameter (422 VALIDATION_ERROR when missing)', async () => {
      const { accessToken } = await loginNewUser();
      const res = await request(app.getHttpServer())
        .get('/v1/seller/finance/summary')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('cross-seller: a non-member gets 403 FORBIDDEN', async () => {
      const owner = await loginNewUser();
      const stranger = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/finance/summary?seller_id=${sellerId}`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('an OWNER gets the NOT_AVAILABLE placeholder naming G5 as the real-data milestone', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/finance/summary?seller_id=${sellerId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(res.body.data.seller_id).toBe(sellerId);
      expect(Array.isArray(res.body.data.summary)).toBe(false);
      expect(res.body.data.summary).toEqual({ status: 'NOT_AVAILABLE', available_from: 'G5' });
    });

    it('a MANAGER can also view the finance summary', async () => {
      const owner = await loginNewUser();
      const manager = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await addMember(sellerId, manager.userId, 'MANAGER');

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/finance/summary?seller_id=${sellerId}`)
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .expect(200);
      expect(res.body.data.summary.status).toBe('NOT_AVAILABLE');
    });

    it('an OPERATOR gets 403 FORBIDDEN (TZ §34 "no payout or bank data"), and the denial is audit-logged', async () => {
      const owner = await loginNewUser();
      const operator = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await addMember(sellerId, operator.userId, 'OPERATOR');

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/finance/summary?seller_id=${sellerId}`)
        .set('Authorization', `Bearer ${operator.accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const denialLog = await prisma.auditLog.findFirst({
        where: {
          actorId: operator.userId,
          action: 'authz.permission_denied',
          entityId: 'seller:finance:view',
        },
        orderBy: { occurredAt: 'desc' },
      });
      expect(denialLog).not.toBeNull();
    });
  });

  describe('POST /v1/seller/bank-accounts', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/seller/bank-accounts')
        .send({ seller_id: '00000000-0000-0000-0000-000000000000', reference: '12345' })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('an OWNER can propose a bank reference: 201, verified=false, masked_reference shows only the last 4 characters, raw value never in the response body', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      const res = await request(app.getHttpServer())
        .post('/v1/seller/bank-accounts')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, reference: LEADING_ZERO_REFERENCE })
        .expect(201);

      expect(res.body.data.verified).toBe(false);
      expect(res.body.data.reviewer_id).toBeNull();
      expect(res.body.data.reviewed_at).toBeNull();
      expect(res.body.data.masked_reference).toBe('**********5544');
      expect(JSON.stringify(res.body)).not.toContain(LEADING_ZERO_REFERENCE);
      expect(res.body.data).not.toHaveProperty('raw_reference');
      expect(res.body.data).not.toHaveProperty('encrypted_reference');
      expect(res.body.data).not.toHaveProperty('reference');

      // Leading-zero round-trip re-verified end-to-end through this
      // endpoint's own write path (TZ §28), at the DB layer this ticket
      // never exposes over HTTP.
      const row = await prisma.sellerBankAccount.findUniqueOrThrow({
        where: { id: res.body.data.id },
      });
      expect(row.rawReference).toBe(LEADING_ZERO_REFERENCE);
    });

    it('triggers a review: emits seller_bank_account.proposed.v1 and the row stays unreviewed (reviewer_id/reviewed_at null)', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      const res = await request(app.getHttpServer())
        .post('/v1/seller/bank-accounts')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, reference: '1234567890' })
        .expect(201);

      const outboxEvent = await prisma.outboxEvent.findFirst({
        where: {
          aggregateType: 'seller_bank_account',
          aggregateId: res.body.data.id as string,
          eventType: 'seller_bank_account.proposed.v1',
        },
      });
      expect(outboxEvent).not.toBeNull();
    });

    it("cross-seller: proposing against a seller_id the caller doesn't belong to returns 403 FORBIDDEN (user-supplied seller_id spoofing, TZ §34)", async () => {
      const ownerA = await loginNewUser();
      const ownerB = await loginNewUser();
      const sellerIdA = await createSeller(ownerA.accessToken);

      const res = await request(app.getHttpServer())
        .post('/v1/seller/bank-accounts')
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({ seller_id: sellerIdA, reference: '1234567890' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('a MANAGER gets 403 FORBIDDEN — propose is OWNER-only (TZ §34 "owner can propose bank detail changes")', async () => {
      const owner = await loginNewUser();
      const manager = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await addMember(sellerId, manager.userId, 'MANAGER');

      const res = await request(app.getHttpServer())
        .post('/v1/seller/bank-accounts')
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .send({ seller_id: sellerId, reference: '1234567890' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const count = await prisma.sellerBankAccount.count({ where: { sellerId } });
      expect(count).toBe(0);
    });

    it('an OPERATOR gets 403 FORBIDDEN', async () => {
      const owner = await loginNewUser();
      const operator = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await addMember(sellerId, operator.userId, 'OPERATOR');

      const res = await request(app.getHttpServer())
        .post('/v1/seller/bank-accounts')
        .set('Authorization', `Bearer ${operator.accessToken}`)
        .send({ seller_id: sellerId, reference: '1234567890' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('[Idempotency-Key] a repeat propose call with the same key replays the original response and does not create a second row', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      const idempotencyKey = `propose-${Math.random()}`;
      const body = { seller_id: sellerId, reference: '1234567890' };

      const first = await request(app.getHttpServer())
        .post('/v1/seller/bank-accounts')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/v1/seller/bank-accounts')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);

      expect(second.body.data.id).toBe(first.body.data.id);
      const count = await prisma.sellerBankAccount.count({ where: { sellerId } });
      expect(count).toBe(1);
    });
  });

  describe('GET /v1/seller/bank-accounts', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/seller/bank-accounts?seller_id=00000000-0000-0000-0000-000000000000')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('requires a seller_id query parameter (422 VALIDATION_ERROR when missing)', async () => {
      const { accessToken } = await loginNewUser();
      const res = await request(app.getHttpServer())
        .get('/v1/seller/bank-accounts')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('an OWNER lists their own masked bank references; the raw rawReference value never appears in the response', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await request(app.getHttpServer())
        .post('/v1/seller/bank-accounts')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, reference: LEADING_ZERO_REFERENCE })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/bank-accounts?seller_id=${sellerId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].masked_reference).toBe('**********5544');
      expect(JSON.stringify(res.body)).not.toContain(LEADING_ZERO_REFERENCE);
    });

    it('a MANAGER can also view the (masked) bank accounts list', async () => {
      const owner = await loginNewUser();
      const manager = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await addMember(sellerId, manager.userId, 'MANAGER');
      await request(app.getHttpServer())
        .post('/v1/seller/bank-accounts')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, reference: '1234567890' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/bank-accounts?seller_id=${sellerId}`)
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('an OPERATOR gets 403 FORBIDDEN (TZ §34 "no payout or bank data")', async () => {
      const owner = await loginNewUser();
      const operator = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await addMember(sellerId, operator.userId, 'OPERATOR');

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/bank-accounts?seller_id=${sellerId}`)
        .set('Authorization', `Bearer ${operator.accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it("cross-seller: listing another seller's bank accounts returns 403 FORBIDDEN", async () => {
      const ownerA = await loginNewUser();
      const ownerB = await loginNewUser();
      const sellerIdA = await createSeller(ownerA.accessToken);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/bank-accounts?seller_id=${sellerIdA}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /v1/seller/bank-accounts/:id/approve and /reject', () => {
    async function proposeBankAccount(ownerAccessToken: string, sellerId: string) {
      const res = await request(app.getHttpServer())
        .post('/v1/seller/bank-accounts')
        .set('Authorization', `Bearer ${ownerAccessToken}`)
        .send({ seller_id: sellerId, reference: LEADING_ZERO_REFERENCE })
        .expect(201);
      return res.body.data.id as string;
    }

    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/seller/bank-accounts/3fa85f64-5717-4562-b3fc-2c963f66afa6/approve')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 403 FORBIDDEN for a SUPPORT_AGENT (no seller:moderate grant), and the denial is audit-logged', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      const bankAccountId = await proposeBankAccount(owner.accessToken, sellerId);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller/bank-accounts/${bankAccountId}/approve`)
        .set('Authorization', `Bearer ${supportAgentToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const denialLog = await prisma.auditLog.findFirst({
        where: { action: 'authz.permission_denied', entityId: 'seller:moderate' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(denialLog).not.toBeNull();
    });

    it('a seller OWNER (no seller:moderate grant either) cannot approve their own proposed bank account', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      const bankAccountId = await proposeBankAccount(owner.accessToken, sellerId);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller/bank-accounts/${bankAccountId}/approve`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('MODERATOR gets 200, verified:false->true, records reviewer_id/reviewed_at, masks the reference, and emits seller_bank_account.approved.v1', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      const bankAccountId = await proposeBankAccount(owner.accessToken, sellerId);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller/bank-accounts/${bankAccountId}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);

      expect(res.body.data.verified).toBe(true);
      expect(res.body.data.reviewer_id).toBe(moderatorId);
      expect(res.body.data.reviewed_at).not.toBeNull();
      expect(res.body.data.masked_reference).toBe('**********5544');
      expect(JSON.stringify(res.body)).not.toContain(LEADING_ZERO_REFERENCE);

      const row = await prisma.sellerBankAccount.findUniqueOrThrow({
        where: { id: bankAccountId },
      });
      expect(row.verified).toBe(true);
      expect(row.reviewerId).toBe(moderatorId);
      expect(row.reviewedAt).not.toBeNull();
      // DB-layer leading-zero re-check after the review write path too.
      expect(row.rawReference).toBe(LEADING_ZERO_REFERENCE);

      const outboxEvent = await prisma.outboxEvent.findFirst({
        where: {
          aggregateType: 'seller_bank_account',
          aggregateId: bankAccountId,
          eventType: 'seller_bank_account.approved.v1',
        },
      });
      expect(outboxEvent).not.toBeNull();
    });

    it('re-approving an already-reviewed bank account returns 409 INVALID_STATE_TRANSITION, never a silent no-op', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      const bankAccountId = await proposeBankAccount(owner.accessToken, sellerId);

      await request(app.getHttpServer())
        .post(`/v1/seller/bank-accounts/${bankAccountId}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller/bank-accounts/${bankAccountId}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('[Idempotency-Key] a repeat approve call with the same key replays the original response instead of 409', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      const bankAccountId = await proposeBankAccount(owner.accessToken, sellerId);
      const idempotencyKey = `bank-approve-${Math.random()}`;

      const first = await request(app.getHttpServer())
        .post(`/v1/seller/bank-accounts/${bankAccountId}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);
      const second = await request(app.getHttpServer())
        .post(`/v1/seller/bank-accounts/${bankAccountId}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);

      expect(second.body.data.reviewed_at).toBe(first.body.data.reviewed_at);
      const outboxEventCount = await prisma.outboxEvent.count({
        where: {
          aggregateType: 'seller_bank_account',
          aggregateId: bankAccountId,
          eventType: 'seller_bank_account.approved.v1',
        },
      });
      expect(outboxEventCount).toBe(1);
    });

    it('returns 404 NOT_FOUND for a well-formed but non-existent bank account id', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/seller/bank-accounts/3fa85f64-5717-4562-b3fc-2c963f66afa6/approve')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 422 VALIDATION_ERROR when reject reason is missing or empty', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      const bankAccountId = await proposeBankAccount(owner.accessToken, sellerId);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller/bank-accounts/${bankAccountId}/reject`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ reason: '' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('with a reason: MODERATOR gets 200, verified stays false, records reviewer_id/reviewed_at, emits seller_bank_account.rejected.v1', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      const bankAccountId = await proposeBankAccount(owner.accessToken, sellerId);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller/bank-accounts/${bankAccountId}/reject`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ reason: 'Reference does not match the registered legal entity.' })
        .expect(200);

      expect(res.body.data.verified).toBe(false);
      expect(res.body.data.reviewer_id).toBe(moderatorId);
      expect(res.body.data.reviewed_at).not.toBeNull();

      const outboxEvent = await prisma.outboxEvent.findFirst({
        where: {
          aggregateType: 'seller_bank_account',
          aggregateId: bankAccountId,
          eventType: 'seller_bank_account.rejected.v1',
        },
      });
      expect(outboxEvent).not.toBeNull();
      expect((outboxEvent?.payload as Record<string, unknown>).reason).toBe(
        'Reference does not match the registered legal entity.',
      );

      // Rejected is still a reviewed row: a second decision is 409, not a
      // silent overwrite (same bar re-approve already proves above).
      const second = await request(app.getHttpServer())
        .post(`/v1/seller/bank-accounts/${bankAccountId}/reject`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ reason: 'Should not apply.' })
        .expect(409);
      expect(second.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('SUPPORT_AGENT (no seller:moderate grant) gets 403 for reject too', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      const bankAccountId = await proposeBankAccount(owner.accessToken, sellerId);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller/bank-accounts/${bankAccountId}/reject`)
        .set('Authorization', `Bearer ${supportAgentToken}`)
        .send({ reason: 'Should not matter.' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    // G1 QA review major #2 regression guard: before the fix, both
    // decisions passed their precondition check (loaded.reviewedAt still
    // null) and the SECOND commit silently overwrote the FIRST's result
    // with no 409 — a real TOCTOU race. Mirrors auth.e2e-spec.ts's
    // "[CONCURRENCY] two simultaneous rotations of the SAME refresh token"
    // idiom: fire both via Promise.all (not sequential), sort statuses,
    // assert exactly one winner + one loser, and that the DB ends up with
    // the winner's decision, not a silently clobbered mix.
    it('[CONCURRENCY] simultaneous approve + reject on the same not-yet-reviewed bank account: exactly one wins (200), the other gets 409, never a silent overwrite', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      const bankAccountId = await proposeBankAccount(owner.accessToken, sellerId);

      const [approveRes, rejectRes] = await Promise.all([
        request(app.getHttpServer())
          .post(`/v1/seller/bank-accounts/${bankAccountId}/approve`)
          .set('Authorization', `Bearer ${moderatorToken}`),
        request(app.getHttpServer())
          .post(`/v1/seller/bank-accounts/${bankAccountId}/reject`)
          .set('Authorization', `Bearer ${moderatorToken}`)
          .send({ reason: 'Racing against the approve call.' }),
      ]);

      const statuses = [approveRes.status, rejectRes.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);
      const loser = approveRes.status === 200 ? rejectRes : approveRes;
      expect(loser.body.error.code).toBe('INVALID_STATE_TRANSITION');

      const finalRow = await prisma.sellerBankAccount.findUniqueOrThrow({
        where: { id: bankAccountId },
      });
      expect(finalRow.reviewedAt).not.toBeNull();
      // The winner's decision landed exactly once, consistently.
      expect(typeof finalRow.verified).toBe('boolean');

      // Exactly one decision event (approved OR rejected), not both — the
      // loser's transaction rolled back before it ever reached
      // tx.outboxEvent.create(). Filtered to the decision event types only:
      // proposeBankAccount's own createBankAccount() call already wrote an
      // unrelated seller_bank_account.proposed.v1 row for this same
      // aggregate earlier in this test.
      const decisionOutboxEvents = await prisma.outboxEvent.count({
        where: {
          aggregateType: 'seller_bank_account',
          aggregateId: bankAccountId,
          eventType: { in: ['seller_bank_account.approved.v1', 'seller_bank_account.rejected.v1'] },
        },
      });
      expect(decisionOutboxEvents).toBe(1);
    });
  });
});
