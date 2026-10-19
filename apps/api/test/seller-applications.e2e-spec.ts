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

describe('Seller application intake (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sentMessages = new Map<string, string>();

  const smsSender: SmsSenderAdapter = {
    send: jest.fn(async (phone: string, body: string) => {
      sentMessages.set(phone, body);
    }),
  };

  async function loginNewUser(): Promise<{ accessToken: string; userId: string }> {
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
    };
  }

  async function createApplication(accessToken: string, overrides: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post('/v1/seller-applications')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validCreateBody(overrides))
      .expect(201);
    return res.body.data as Record<string, unknown>;
  }

  async function makeSubmittable(sellerId: string) {
    await prisma.sellerDocument.create({
      data: {
        sellerId,
        type: 'REGISTRATION_CERTIFICATE',
        objectKey: `fixtures/${sellerId}/doc.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    });
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

  describe('POST /v1/seller-applications', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/seller-applications')
        .send(validCreateBody())
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('atomically creates a sellers row (DRAFT) + a seller_applications row (DRAFT), returns 201, and records the creator as seller_members OWNER', async () => {
      const { accessToken, userId } = await loginNewUser();
      const res = await request(app.getHttpServer())
        .post('/v1/seller-applications')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validCreateBody())
        .expect(201);

      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.seller_id).toBeDefined();
      expect(res.body.meta.request_id).toBeDefined();

      const seller = await prisma.seller.findUniqueOrThrow({
        where: { id: res.body.data.seller_id },
      });
      expect(seller.status).toBe('DRAFT');

      const application = await prisma.sellerApplication.findUniqueOrThrow({
        where: { id: res.body.data.id },
      });
      expect(application.status).toBe('DRAFT');
      expect(application.sellerId).toBe(seller.id);

      const member = await prisma.sellerMember.findUnique({
        where: { sellerId_userId: { sellerId: seller.id, userId } },
      });
      expect(member?.role).toBe('OWNER');
    });

    it('a tax_id with a leading zero is stored and echoed back unchanged through the API layer (TZ §28)', async () => {
      const { accessToken } = await loginNewUser();
      const application = await createApplication(accessToken, { tax_id: '0098765432' });

      expect(application.tax_id).toBe('0098765432');

      const seller = await prisma.seller.findUniqueOrThrow({
        where: { id: application.seller_id as string },
      });
      expect(seller.taxId).toBe('0098765432');
    });

    it('rejects legal_name longer than 255 chars with 422 VALIDATION_ERROR', async () => {
      const { accessToken } = await loginNewUser();
      const res = await request(app.getHttpServer())
        .post('/v1/seller-applications')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validCreateBody({ legal_name: 'A'.repeat(256) }))
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects display_name longer than 120 chars with 422 VALIDATION_ERROR', async () => {
      const { accessToken } = await loginNewUser();
      const res = await request(app.getHttpServer())
        .post('/v1/seller-applications')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validCreateBody({ display_name: 'B'.repeat(121) }))
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('[Idempotency-Key] a repeat call with the same key and the same body replays the original response and does not create a second seller', async () => {
      const { accessToken } = await loginNewUser();
      const body = validCreateBody();
      const idempotencyKey = `create-${Math.random()}`;

      const first = await request(app.getHttpServer())
        .post('/v1/seller-applications')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/v1/seller-applications')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);

      expect(second.body.data.id).toBe(first.body.data.id);
      expect(second.body.data.seller_id).toBe(first.body.data.seller_id);

      const sellerCount = await prisma.seller.count({
        where: { id: first.body.data.seller_id },
      });
      expect(sellerCount).toBe(1);
    });

    it('[Idempotency-Key] reusing the same key with a different body returns 409 DUPLICATE_REQUEST', async () => {
      const { accessToken } = await loginNewUser();
      const idempotencyKey = `create-conflict-${Math.random()}`;

      await request(app.getHttpServer())
        .post('/v1/seller-applications')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(validCreateBody())
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/v1/seller-applications')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(validCreateBody({ legal_name: 'A Different Legal Name LLC' }))
        .expect(409);
      expect(res.body.error.code).toBe('DUPLICATE_REQUEST');
    });
  });

  describe('GET /v1/seller-applications/:id', () => {
    it('returns 404 NOT_FOUND for a well-formed but non-existent id', async () => {
      const { accessToken } = await loginNewUser();
      const res = await request(app.getHttpServer())
        .get('/v1/seller-applications/3fa85f64-5717-4562-b3fc-2c963f66afa6')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it("returns the caller's own application", async () => {
      const { accessToken } = await loginNewUser();
      const created = await createApplication(accessToken);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller-applications/${created.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(created.id);
    });

    it("cross-seller: a different applicant gets 403 FORBIDDEN trying to GET another applicant's application", async () => {
      const ownerA = await loginNewUser();
      const ownerB = await loginNewUser();
      const applicationA = await createApplication(ownerA.accessToken);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller-applications/${applicationA.id}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('PATCH /v1/seller-applications/:id', () => {
    it('edits succeed while DRAFT and are reflected on a subsequent GET', async () => {
      const { accessToken } = await loginNewUser();
      const created = await createApplication(accessToken);

      const patchRes = await request(app.getHttpServer())
        .patch(`/v1/seller-applications/${created.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ legal_name: 'Renamed Trading LLC' })
        .expect(200);
      expect(patchRes.body.data.legal_name).toBe('Renamed Trading LLC');

      const getRes = await request(app.getHttpServer())
        .get(`/v1/seller-applications/${created.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(getRes.body.data.legal_name).toBe('Renamed Trading LLC');
    });

    it("cross-seller: a different applicant cannot PATCH another applicant's application (403, not a silent no-op)", async () => {
      const ownerA = await loginNewUser();
      const ownerB = await loginNewUser();
      const applicationA = await createApplication(ownerA.accessToken);

      const res = await request(app.getHttpServer())
        .patch(`/v1/seller-applications/${applicationA.id}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({ legal_name: 'Hijacked LLC' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const seller = await prisma.seller.findUniqueOrThrow({
        where: { id: applicationA.seller_id as string },
      });
      expect(seller.legalName).not.toBe('Hijacked LLC');
    });

    it('attempting to PATCH after SUBMITTED returns 409 INVALID_STATE_TRANSITION, not a silent no-op', async () => {
      const { accessToken } = await loginNewUser();
      const created = await createApplication(accessToken);
      await makeSubmittable(created.seller_id as string);
      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/contract-acceptance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(201);
      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/submit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/v1/seller-applications/${created.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ legal_name: 'Should Not Apply LLC' })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');

      const seller = await prisma.seller.findUniqueOrThrow({
        where: { id: created.seller_id as string },
      });
      expect(seller.legalName).not.toBe('Should Not Apply LLC');
    });
  });

  describe('POST /v1/seller-applications/:id/contract-acceptance', () => {
    it('records a seller_contracts row (version, accepted_at) against the current contract version', async () => {
      const { accessToken } = await loginNewUser();
      const created = await createApplication(accessToken);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/contract-acceptance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      expect(res.body.data.version).toBe(1);
      expect(res.body.data.accepted_at).toBeDefined();

      const contract = await prisma.sellerContract.findUniqueOrThrow({
        where: {
          sellerId_version: { sellerId: created.seller_id as string, version: 1 },
        },
      });
      expect(contract.acceptedAt).toBeDefined();
    });

    it('historical contract versions are kept, never overwritten: accepting version 2 does not remove version 1', async () => {
      const { accessToken } = await loginNewUser();
      const created = await createApplication(accessToken);

      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/contract-acceptance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ contract_version: 1 })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/contract-acceptance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ contract_version: 2 })
        .expect(201);

      const contracts = await prisma.sellerContract.findMany({
        where: { sellerId: created.seller_id as string },
        orderBy: { version: 'asc' },
      });
      expect(contracts.map((c) => c.version)).toEqual([1, 2]);
    });

    it('accepting the same version twice is idempotent (no duplicate row, no error)', async () => {
      const { accessToken } = await loginNewUser();
      const created = await createApplication(accessToken);

      const first = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/contract-acceptance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/contract-acceptance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      expect(second.body.data.id).toBe(first.body.data.id);
      const count = await prisma.sellerContract.count({
        where: { sellerId: created.seller_id as string, version: 1 },
      });
      expect(count).toBe(1);
    });

    // G1 QA review major #1: this endpoint's scope string
    // (`seller-applications:${id}:contract-acceptance`) was 76 chars once a
    // real 36-char UUID is substituted — over commerce.idempotency_keys
    // .scope's VarChar(64) cap, so any client sending Idempotency-Key here
    // got a hard Postgres 500. This is the first test to actually send the
    // header on this route.
    it('[Idempotency-Key] a repeat call with the same key replays the original 201 response instead of a 500 from an over-length scope string', async () => {
      const { accessToken } = await loginNewUser();
      const created = await createApplication(accessToken);
      const idempotencyKey = `contract-acceptance-${Math.random()}`;

      const first = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/contract-acceptance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({})
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/contract-acceptance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({})
        .expect(201);

      expect(second.body.data.id).toBe(first.body.data.id);
      const count = await prisma.sellerContract.count({
        where: { sellerId: created.seller_id as string },
      });
      expect(count).toBe(1);
    });
  });

  describe('POST /v1/seller-applications/:id/submit', () => {
    it('returns 422 with an explicit reason when neither documents nor contract acceptance exist', async () => {
      const { accessToken } = await loginNewUser();
      const created = await createApplication(accessToken);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/submit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.missing).toEqual(
        expect.arrayContaining(['documents', 'contract_acceptance']),
      );
    });

    it('returns 422 when documents exist but contract acceptance is still missing', async () => {
      const { accessToken } = await loginNewUser();
      const created = await createApplication(accessToken);
      await makeSubmittable(created.seller_id as string);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/submit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(422);
      expect(res.body.error.details.missing).toEqual(['contract_acceptance']);
    });

    it('transitions DRAFT->SUBMITTED, flips seller.status, and emits a seller_application.submitted.v1 outbox event when documents + contract acceptance exist (fixture-inserted documents, no upload endpoint needed)', async () => {
      const { accessToken } = await loginNewUser();
      const created = await createApplication(accessToken);
      await makeSubmittable(created.seller_id as string);
      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/contract-acceptance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/submit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('SUBMITTED');

      const application = await prisma.sellerApplication.findUniqueOrThrow({
        where: { id: created.id as string },
      });
      expect(application.status).toBe('SUBMITTED');

      const seller = await prisma.seller.findUniqueOrThrow({
        where: { id: created.seller_id as string },
      });
      expect(seller.status).toBe('SUBMITTED');

      const outboxEvent = await prisma.outboxEvent.findFirst({
        where: { aggregateType: 'seller_application', aggregateId: created.id as string },
      });
      expect(outboxEvent).not.toBeNull();
      expect(outboxEvent?.eventType).toBe('seller_application.submitted.v1');
      expect(outboxEvent?.status).toBe('PENDING');
    });

    it('submitting twice returns 409 INVALID_STATE_TRANSITION on the second call', async () => {
      const { accessToken } = await loginNewUser();
      const created = await createApplication(accessToken);
      await makeSubmittable(created.seller_id as string);
      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/contract-acceptance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(201);
      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/submit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/submit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it("cross-seller: a different applicant cannot submit another applicant's application (403)", async () => {
      const ownerA = await loginNewUser();
      const ownerB = await loginNewUser();
      const applicationA = await createApplication(ownerA.accessToken);
      await makeSubmittable(applicationA.seller_id as string);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${applicationA.id}/submit`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const application = await prisma.sellerApplication.findUniqueOrThrow({
        where: { id: applicationA.id as string },
      });
      expect(application.status).toBe('DRAFT');
    });

    it('[Idempotency-Key] a repeat submit call with the same key replays the original 200 instead of failing with 409', async () => {
      const { accessToken } = await loginNewUser();
      const created = await createApplication(accessToken);
      await makeSubmittable(created.seller_id as string);
      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/contract-acceptance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      const idempotencyKey = `submit-${Math.random()}`;
      const first = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/submit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);
      expect(first.body.data.status).toBe('SUBMITTED');

      const second = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${created.id}/submit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);
      expect(second.body.data.status).toBe('SUBMITTED');

      const outboxEventCount = await prisma.outboxEvent.count({
        where: { aggregateType: 'seller_application', aggregateId: created.id as string },
      });
      expect(outboxEventCount).toBe(1);
    });
  });
});
