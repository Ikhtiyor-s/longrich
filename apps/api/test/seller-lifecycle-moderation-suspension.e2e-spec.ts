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

const SUPER_ADMIN_PHONE = '+998900000001';
const SUPPORT_AGENT_PHONE = '+998900000002';
const MODERATOR_PHONE = '+998900000004';

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

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    legal_type: 'LLC',
    tax_id: '0012345678',
    legal_name: 'Test Trading LLC',
    display_name: 'Test Shop',
    contacts: { phone: '+998901234567', email: 'owner@example.com' },
    ...overrides,
  };
}

// Moderation and suspension are tested in one file (one NestJS app /
// Postgres connection pool), not two, deliberately: Jest runs e2e spec
// files in separate parallel worker processes by default, and splitting
// this ticket's tests across two files (each bootstrapping its own full
// AppModule + Prisma connection pool) measurably increased flaky
// resource-contention failures (transient Postgres "can't reach database
// server" / Redis 429s) when run alongside the rest of the e2e suite in
// parallel. A single file for one ticket's lifecycle also matches how the
// ticket itself frames moderation + suspension as one feature.
describe('Seller lifecycle: moderation + suspension (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let superAdminToken: string;
  let moderatorToken: string;
  let moderatorId: string;
  let supportAgentToken: string;
  let supportAgentId: string;
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

  function loginNewApplicant() {
    return login(uniquePhone());
  }

  async function createApplication(accessToken: string) {
    const res = await request(app.getHttpServer())
      .post('/v1/seller-applications')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validCreateBody())
      .expect(201);
    return res.body.data as Record<string, unknown>;
  }

  async function createSubmittedApplication(accessToken: string) {
    const created = await createApplication(accessToken);
    await prisma.sellerDocument.create({
      data: {
        sellerId: created.seller_id as string,
        type: 'REGISTRATION_CERTIFICATE',
        objectKey: `fixtures/${created.seller_id}/doc.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    });
    await request(app.getHttpServer())
      .post(`/v1/seller-applications/${created.id}/contract-acceptance`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/seller-applications/${created.id}/submit`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    return created;
  }

  // Builds an ACTIVE seller end-to-end through the real moderation endpoints
  // (submit -> approve -> activate) rather than writing status directly, so
  // the suspend/reinstate tests below exercise a seller that reached ACTIVE
  // the same way production traffic would.
  async function createActiveSeller(): Promise<{ sellerId: string; applicationId: string }> {
    const applicant = await loginNewApplicant();
    const created = await createSubmittedApplication(applicant.accessToken);

    await request(app.getHttpServer())
      .post(`/v1/seller-applications/${created.id}/approve`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/seller-applications/${created.id}/activate`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    return { sellerId: created.seller_id as string, applicationId: created.id as string };
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

    // Logged in once per seeded admin phone and reused across every test
    // below — OTP_RATE_LIMIT_PHONE_15MIN (default 5) is per-phone, and this
    // file exercises the same three seeded phones across many assertions.
    const superAdmin = await login(SUPER_ADMIN_PHONE);
    superAdminToken = superAdmin.accessToken;
    const moderator = await login(MODERATOR_PHONE);
    moderatorToken = moderator.accessToken;
    moderatorId = moderator.userId;
    const supportAgent = await login(SUPPORT_AGENT_PHONE);
    supportAgentToken = supportAgent.accessToken;
    supportAgentId = supportAgent.userId;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/seller-applications/:id/approve', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/seller-applications/3fa85f64-5717-4562-b3fc-2c963f66afa6/approve')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 403 FORBIDDEN for a SUPPORT_AGENT (no seller:moderate grant), and the denial is audit-logged', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/approve`)
        .set('Authorization', `Bearer ${supportAgentToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const denialLog = await prisma.auditLog.findFirst({
        where: {
          actorId: supportAgentId,
          action: 'authz.permission_denied',
          entityId: 'seller:moderate',
        },
        orderBy: { occurredAt: 'desc' },
      });
      expect(denialLog).not.toBeNull();
    });

    it('MODERATOR gets 200, SUBMITTED->APPROVED, mirrors seller.status, records reviewer_id, and emits seller_application.approved.v1', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);

      expect(res.body.data.status).toBe('APPROVED');
      expect(res.body.data.reviewer_id).toBe(moderatorId);

      const seller = await prisma.seller.findUniqueOrThrow({
        where: { id: application.seller_id as string },
      });
      expect(seller.status).toBe('APPROVED');

      const outboxEvent = await prisma.outboxEvent.findFirst({
        where: {
          aggregateType: 'seller_application',
          aggregateId: application.id as string,
          eventType: 'seller_application.approved.v1',
        },
      });
      expect(outboxEvent).not.toBeNull();
    });

    it('re-approving an already-APPROVED application returns 409 INVALID_STATE_TRANSITION, never a silent no-op', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);

      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('[Idempotency-Key] a repeat approve call with the same key replays the original response instead of 409', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);
      const idempotencyKey = `approve-${Math.random()}`;

      const first = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);
      const second = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);

      expect(second.body.data.status).toBe(first.body.data.status);
      const outboxEventCount = await prisma.outboxEvent.count({
        where: {
          aggregateType: 'seller_application',
          aggregateId: application.id as string,
          eventType: 'seller_application.approved.v1',
        },
      });
      expect(outboxEventCount).toBe(1);
    });

    it('returns 404 NOT_FOUND for a well-formed but non-existent application id', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/seller-applications/3fa85f64-5717-4562-b3fc-2c963f66afa6/approve')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    // G1 QA review major #2 regression guard: before the fix, both
    // decisions passed their precondition check (loaded.status still
    // SUBMITTED) and the SECOND commit silently overwrote the FIRST's
    // result with no 409 — a real TOCTOU race. Mirrors auth.e2e-spec.ts's
    // "[CONCURRENCY] two simultaneous rotations of the SAME refresh token"
    // idiom: fire both via Promise.all (not sequential), sort statuses,
    // assert exactly one winner + one loser, and that the DB ends up with
    // the winner's decision, not a silently clobbered mix.
    it('[CONCURRENCY] simultaneous approve + reject on the same SUBMITTED application: exactly one wins (200), the other gets 409, never a silent overwrite', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);

      const [approveRes, rejectRes] = await Promise.all([
        request(app.getHttpServer())
          .post(`/v1/seller-applications/${application.id}/approve`)
          .set('Authorization', `Bearer ${moderatorToken}`),
        request(app.getHttpServer())
          .post(`/v1/seller-applications/${application.id}/reject`)
          .set('Authorization', `Bearer ${moderatorToken}`)
          .send({ reason: 'Racing against the approve call.' }),
      ]);

      const statuses = [approveRes.status, rejectRes.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);
      const loser = approveRes.status === 200 ? rejectRes : approveRes;
      expect(loser.body.error.code).toBe('INVALID_STATE_TRANSITION');

      const finalApplication = await prisma.sellerApplication.findUniqueOrThrow({
        where: { id: application.id as string },
      });
      const finalSeller = await prisma.seller.findUniqueOrThrow({
        where: { id: application.seller_id as string },
      });
      // The winner's decision landed consistently on both mirrored rows —
      // not a mix of one decision's application status with the other
      // decision's seller status (the exact failure mode this fix closes).
      expect(finalApplication.status).toBe(finalSeller.status);
      expect(['APPROVED', 'REJECTED']).toContain(finalApplication.status);

      // Exactly one decision event (approved OR rejected), not both — the
      // loser's transaction rolled back before it ever reached
      // tx.outboxEvent.create(). Filtered to the decision event types only:
      // createSubmittedApplication's own submit() call already wrote an
      // unrelated seller_application.submitted.v1 row for this same
      // aggregate earlier in this test.
      const decisionOutboxEvents = await prisma.outboxEvent.count({
        where: {
          aggregateType: 'seller_application',
          aggregateId: application.id as string,
          eventType: { in: ['seller_application.approved.v1', 'seller_application.rejected.v1'] },
        },
      });
      expect(decisionOutboxEvents).toBe(1);
    });
  });

  describe('POST /v1/seller-applications/:id/reject', () => {
    it('returns 422 VALIDATION_ERROR when reason is missing or empty', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/reject`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ reason: '' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('with a reason: 200, SUBMITTED->REJECTED, mirrors seller.status, emits seller_application.rejected.v1, and the applicant can read the reason via GET', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/reject`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ reason: 'Tax ID does not match registry.' })
        .expect(200);
      expect(res.body.data.status).toBe('REJECTED');
      expect(res.body.data.reason).toBe('Tax ID does not match registry.');

      const seller = await prisma.seller.findUniqueOrThrow({
        where: { id: application.seller_id as string },
      });
      expect(seller.status).toBe('REJECTED');

      const outboxEvent = await prisma.outboxEvent.findFirst({
        where: {
          aggregateType: 'seller_application',
          aggregateId: application.id as string,
          eventType: 'seller_application.rejected.v1',
        },
      });
      expect(outboxEvent).not.toBeNull();

      const getRes = await request(app.getHttpServer())
        .get(`/v1/seller-applications/${application.id}`)
        .set('Authorization', `Bearer ${applicant.accessToken}`)
        .expect(200);
      expect(getRes.body.data.reason).toBe('Tax ID does not match registry.');
    });

    it('SUPPORT_AGENT (no seller:moderate grant) gets 403', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/reject`)
        .set('Authorization', `Bearer ${supportAgentToken}`)
        .send({ reason: 'Should not matter.' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /v1/seller-applications/:id/needs-changes', () => {
    it('returns 422 VALIDATION_ERROR when reason is missing', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/needs-changes`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({})
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('with a reason: 200, SUBMITTED->NEEDS_CHANGES, mirrors seller.status, emits seller_application.needs_changes.v1', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/needs-changes`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ reason: 'Please re-upload a clearer registration certificate.' })
        .expect(200);
      expect(res.body.data.status).toBe('NEEDS_CHANGES');
      expect(res.body.data.reason).toBe('Please re-upload a clearer registration certificate.');

      const seller = await prisma.seller.findUniqueOrThrow({
        where: { id: application.seller_id as string },
      });
      expect(seller.status).toBe('NEEDS_CHANGES');

      const outboxEvent = await prisma.outboxEvent.findFirst({
        where: {
          aggregateType: 'seller_application',
          aggregateId: application.id as string,
          eventType: 'seller_application.needs_changes.v1',
        },
      });
      expect(outboxEvent).not.toBeNull();
    });

    // G1 QA review major #1: this endpoint's scope string
    // (`seller-applications:${id}:needs-changes`) was 70 chars once a real
    // 36-char UUID is substituted — over commerce.idempotency_keys.scope's
    // VarChar(64) cap, so any client sending Idempotency-Key here got a
    // hard Postgres 500. This is the first test to actually send the
    // header on this route.
    it('[Idempotency-Key] a repeat needs-changes call with the same key replays the original response instead of a 500 from an over-length scope string', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);
      const idempotencyKey = `needs-changes-${Math.random()}`;
      const body = { reason: 'Please re-upload a clearer registration certificate.' };

      const first = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/needs-changes`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(200);
      const second = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/needs-changes`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(200);

      expect(second.body.data.status).toBe(first.body.data.status);
      const outboxEventCount = await prisma.outboxEvent.count({
        where: {
          aggregateType: 'seller_application',
          aggregateId: application.id as string,
          eventType: 'seller_application.needs_changes.v1',
        },
      });
      expect(outboxEventCount).toBe(1);
    });

    // G1 QA review major #3: before this fix, NEEDS_CHANGES was a dead end —
    // ApplicationsService.update/submit gated strictly on status === 'DRAFT',
    // so once a moderator sent an application back for changes there was NO
    // path back to DRAFT or any way to edit/resubmit. Proves the full cycle
    // end to end: SUBMITTED -> needs-changes (moderator) -> PATCH (applicant
    // edits) -> submit (applicant resubmits) -> a decision again — with an
    // explicit assertion the applicant was NOT stuck.
    it('the full NEEDS_CHANGES cycle: SUBMITTED -> needs-changes -> applicant PATCHes -> applicant resubmits -> UNDER_REVIEW-or-decision again (applicant is not stuck)', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);

      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/needs-changes`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ reason: 'Legal name does not match the registration certificate.' })
        .expect(200);

      // The applicant can now edit while NEEDS_CHANGES — this PATCH would
      // have returned 409 INVALID_STATE_TRANSITION before the fix (the gate
      // only accepted DRAFT).
      const patchRes = await request(app.getHttpServer())
        .patch(`/v1/seller-applications/${application.id}`)
        .set('Authorization', `Bearer ${applicant.accessToken}`)
        .send({ legal_name: 'Corrected Legal Name LLC' })
        .expect(200);
      expect(patchRes.body.data.legal_name).toBe('Corrected Legal Name LLC');
      expect(patchRes.body.data.status).toBe('NEEDS_CHANGES');

      // Resubmission: NEEDS_CHANGES -> SUBMITTED, distinguished from a first
      // submission by a distinct event name.
      const resubmitRes = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/submit`)
        .set('Authorization', `Bearer ${applicant.accessToken}`)
        .expect(200);
      expect(resubmitRes.body.data.status).toBe('SUBMITTED');

      const resubmitEvent = await prisma.outboxEvent.findFirst({
        where: {
          aggregateType: 'seller_application',
          aggregateId: application.id as string,
          eventType: 'seller_application.resubmitted.v1',
        },
      });
      expect(resubmitEvent).not.toBeNull();

      // Not stuck: the resubmitted application can reach a decision again,
      // the same as any first-time SUBMITTED application.
      const approveRes = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);
      expect(approveRes.body.data.status).toBe('APPROVED');

      const seller = await prisma.seller.findUniqueOrThrow({
        where: { id: application.seller_id as string },
      });
      expect(seller.status).toBe('APPROVED');
      expect(seller.legalName).toBe('Corrected Legal Name LLC');
    });
  });

  describe('POST /v1/seller-applications/:id/activate', () => {
    it('returns 409 INVALID_STATE_TRANSITION when the application is not yet APPROVED', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/activate`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('after approval: 200, flips sellers.status APPROVED->ACTIVE as its own separately-audited step, application stays APPROVED, emits seller.activated.v1', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);

      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/activate`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('ACTIVE');

      const seller = await prisma.seller.findUniqueOrThrow({
        where: { id: application.seller_id as string },
      });
      expect(seller.status).toBe('ACTIVE');

      const applicationRow = await prisma.sellerApplication.findUniqueOrThrow({
        where: { id: application.id as string },
      });
      expect(applicationRow.status).toBe('APPROVED');

      const activateEvent = await prisma.outboxEvent.findFirst({
        where: {
          aggregateType: 'seller',
          aggregateId: seller.id,
          eventType: 'seller.activated.v1',
        },
      });
      expect(activateEvent).not.toBeNull();

      const approveAudit = await prisma.auditLog.findFirst({
        where: {
          entityType: 'seller_application',
          entityId: application.id as string,
          action: 'seller_application.approved',
        },
      });
      const activateAudit = await prisma.auditLog.findFirst({
        where: { entityType: 'seller', entityId: seller.id, action: 'seller.activated' },
      });
      expect(approveAudit).not.toBeNull();
      expect(activateAudit).not.toBeNull();
      expect(activateAudit?.id).not.toBe(approveAudit?.id);
    });

    // G1 QA review major #1: this endpoint's scope string
    // (`seller-applications:${id}:activate`) was 65 chars once a real
    // 36-char UUID is substituted — one char over commerce.idempotency_keys
    // .scope's VarChar(64) cap, so any client sending Idempotency-Key here
    // got a hard Postgres 500. This is the first test to actually send the
    // header on this route.
    it('[Idempotency-Key] a repeat activate call with the same key replays the original response instead of a 500 from an over-length scope string', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);
      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);
      const idempotencyKey = `activate-${Math.random()}`;

      const first = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/activate`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);
      const second = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/activate`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);

      expect(second.body.data.status).toBe(first.body.data.status);
      const seller = await prisma.seller.findUniqueOrThrow({
        where: { id: application.seller_id as string },
      });
      const activateEventCount = await prisma.outboxEvent.count({
        where: {
          aggregateType: 'seller',
          aggregateId: seller.id,
          eventType: 'seller.activated.v1',
        },
      });
      expect(activateEventCount).toBe(1);
    });

    it('re-activating an already-ACTIVE seller returns 409 INVALID_STATE_TRANSITION', async () => {
      const applicant = await loginNewApplicant();
      const application = await createSubmittedApplication(applicant.accessToken);

      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/activate`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${application.id}/activate`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });
  });

  describe('POST /v1/sellers/:id/suspend', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/sellers/3fa85f64-5717-4562-b3fc-2c963f66afa6/suspend')
        .send({ reason: 'x' })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 403 FORBIDDEN for a MODERATOR (seller:suspend is SUPER_ADMIN-only), and the denial is audit-logged', async () => {
      const { sellerId } = await createActiveSeller();

      const res = await request(app.getHttpServer())
        .post(`/v1/sellers/${sellerId}/suspend`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ reason: 'Fraud report under review.' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const denialLog = await prisma.auditLog.findFirst({
        where: {
          actorId: moderatorId,
          action: 'authz.permission_denied',
          entityId: 'seller:suspend',
        },
        orderBy: { occurredAt: 'desc' },
      });
      expect(denialLog).not.toBeNull();
    });

    it('returns 422 VALIDATION_ERROR when reason is missing', async () => {
      const { sellerId } = await createActiveSeller();

      const res = await request(app.getHttpServer())
        .post(`/v1/sellers/${sellerId}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({})
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('SUPER_ADMIN gets 200, ACTIVE->SUSPENDED, emits seller.suspended.v1 with the reason in the payload', async () => {
      const { sellerId } = await createActiveSeller();

      const res = await request(app.getHttpServer())
        .post(`/v1/sellers/${sellerId}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Fraud report under review.' })
        .expect(200);
      expect(res.body.data.status).toBe('SUSPENDED');

      const seller = await prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
      expect(seller.status).toBe('SUSPENDED');

      const outboxEvent = await prisma.outboxEvent.findFirst({
        where: { aggregateType: 'seller', aggregateId: sellerId, eventType: 'seller.suspended.v1' },
      });
      expect(outboxEvent).not.toBeNull();
      expect((outboxEvent?.payload as Record<string, unknown>).reason).toBe(
        'Fraud report under review.',
      );
    });

    it('suspending a non-ACTIVE seller (e.g. DRAFT) returns 409 INVALID_STATE_TRANSITION, never a silent no-op', async () => {
      const applicant = await loginNewApplicant();
      const draft = await createApplication(applicant.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/v1/sellers/${draft.seller_id}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Should not apply.' })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');

      const seller = await prisma.seller.findUniqueOrThrow({
        where: { id: draft.seller_id as string },
      });
      expect(seller.status).toBe('DRAFT');
    });

    it('[Idempotency-Key] a repeat suspend call with the same key replays the original response instead of 409', async () => {
      const { sellerId } = await createActiveSeller();
      const idempotencyKey = `suspend-${Math.random()}`;
      const body = { reason: 'Fraud report under review.' };

      const first = await request(app.getHttpServer())
        .post(`/v1/sellers/${sellerId}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(200);
      const second = await request(app.getHttpServer())
        .post(`/v1/sellers/${sellerId}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(200);

      expect(second.body.data.status).toBe(first.body.data.status);
      const outboxEventCount = await prisma.outboxEvent.count({
        where: { aggregateType: 'seller', aggregateId: sellerId, eventType: 'seller.suspended.v1' },
      });
      expect(outboxEventCount).toBe(1);
    });
  });

  describe('POST /v1/sellers/:id/reinstate', () => {
    it('returns 403 FORBIDDEN for a MODERATOR', async () => {
      const { sellerId } = await createActiveSeller();
      await request(app.getHttpServer())
        .post(`/v1/sellers/${sellerId}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Fraud report under review.' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/v1/sellers/${sellerId}/reinstate`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({})
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('SUPER_ADMIN gets 200, SUSPENDED->ACTIVE, emits seller.reinstated.v1', async () => {
      const { sellerId } = await createActiveSeller();
      await request(app.getHttpServer())
        .post(`/v1/sellers/${sellerId}/suspend`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Fraud report under review.' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/v1/sellers/${sellerId}/reinstate`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Cleared after investigation.' })
        .expect(200);
      expect(res.body.data.status).toBe('ACTIVE');

      const seller = await prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
      expect(seller.status).toBe('ACTIVE');

      const outboxEvent = await prisma.outboxEvent.findFirst({
        where: {
          aggregateType: 'seller',
          aggregateId: sellerId,
          eventType: 'seller.reinstated.v1',
        },
      });
      expect(outboxEvent).not.toBeNull();
    });

    it('reinstating a non-SUSPENDED seller (e.g. ACTIVE) returns 409 INVALID_STATE_TRANSITION', async () => {
      const { sellerId } = await createActiveSeller();

      const res = await request(app.getHttpServer())
        .post(`/v1/sellers/${sellerId}/reinstate`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({})
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('returns 404 NOT_FOUND for a well-formed but non-existent seller id', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/sellers/3fa85f64-5717-4562-b3fc-2c963f66afa6/reinstate')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({})
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
