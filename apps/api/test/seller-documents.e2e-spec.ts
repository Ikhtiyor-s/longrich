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
import {
  MALWARE_SCAN_ADAPTER,
  type MalwareScanAdapter,
} from '../src/modules/sellers/documents/malware-scan.adapter';

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

function validDocumentBody(sellerId: string, overrides: Record<string, unknown> = {}) {
  return {
    seller_id: sellerId,
    type: 'REGISTRATION_CERTIFICATE',
    filename: 'cert.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1024,
    ...overrides,
  };
}

describe('Seller KYB document upload (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sentMessages = new Map<string, string>();

  const smsSender: SmsSenderAdapter = {
    send: jest.fn(async (phone: string, body: string) => {
      sentMessages.set(phone, body);
    }),
  };

  // Controllable per-test via mockResolvedValueOnce — lets individual tests
  // simulate an infected result without a real AV vendor (docs/open-questions.md #27).
  const scanAdapter: MalwareScanAdapter = {
    scan: jest.fn().mockResolvedValue({ clean: true, scannedAt: new Date() }),
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
      .overrideProvider(MALWARE_SCAN_ADAPTER)
      .useValue(scanAdapter)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(() => {
    (scanAdapter.scan as jest.Mock).mockResolvedValue({ clean: true, scannedAt: new Date() });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/seller/documents', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .send(validDocumentBody('00000000-0000-0000-0000-000000000000'))
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('issues a signed upload URL + object_key and creates a PENDING seller_documents row', async () => {
      const { accessToken } = await loginNewUser();
      const sellerId = await createSeller(accessToken);

      const res = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validDocumentBody(sellerId))
        .expect(201);

      expect(res.body.data.verification_status).toBe('PENDING');
      expect(res.body.data.seller_id).toBe(sellerId);
      expect(res.body.data.object_key).toContain(`seller-documents/${sellerId}/`);
      expect(typeof res.body.data.upload_url).toBe('string');
      expect(res.body.data.upload_url_expires_in_seconds).toBeGreaterThan(0);

      const document = await prisma.sellerDocument.findUniqueOrThrow({
        where: { id: res.body.data.id },
      });
      expect(document.verificationStatus).toBe('PENDING');
      expect(document.sellerId).toBe(sellerId);
    });

    it('rejects a disallowed mime_type with 422 VALIDATION_ERROR before any seller_documents row is created', async () => {
      const { accessToken } = await loginNewUser();
      const sellerId = await createSeller(accessToken);

      const res = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validDocumentBody(sellerId, { mime_type: 'application/x-msdownload' }))
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      const count = await prisma.sellerDocument.count({ where: { sellerId } });
      expect(count).toBe(0);
    });

    it('rejects an oversized file with 422 VALIDATION_ERROR before any seller_documents row is created', async () => {
      const { accessToken } = await loginNewUser();
      const sellerId = await createSeller(accessToken);

      const res = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validDocumentBody(sellerId, { size_bytes: 999_999_999 }))
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      const count = await prisma.sellerDocument.count({ where: { sellerId } });
      expect(count).toBe(0);
    });

    it("cross-seller: uploading against a seller_id the caller doesn't belong to returns 403 FORBIDDEN (user-supplied seller_id spoofing, TZ §34)", async () => {
      const ownerA = await loginNewUser();
      const ownerB = await loginNewUser();
      const sellerIdA = await createSeller(ownerA.accessToken);

      const res = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send(validDocumentBody(sellerIdA))
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const count = await prisma.sellerDocument.count({ where: { sellerId: sellerIdA } });
      expect(count).toBe(0);
    });

    it('re-uploading the same document type creates a new row rather than overwriting (historical versions kept, TZ §28)', async () => {
      const { accessToken } = await loginNewUser();
      const sellerId = await createSeller(accessToken);

      const first = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validDocumentBody(sellerId))
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validDocumentBody(sellerId))
        .expect(201);

      expect(second.body.data.id).not.toBe(first.body.data.id);

      const rows = await prisma.sellerDocument.findMany({ where: { sellerId } });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.id).sort()).toEqual(
        [first.body.data.id, second.body.data.id].sort(),
      );
    });

    it('[Idempotency-Key] a repeat call with the same key replays the original response and does not create a second row', async () => {
      const { accessToken } = await loginNewUser();
      const sellerId = await createSeller(accessToken);
      const idempotencyKey = `upload-${Math.random()}`;
      const body = validDocumentBody(sellerId);

      const first = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);

      expect(second.body.data.id).toBe(first.body.data.id);
      const count = await prisma.sellerDocument.count({ where: { sellerId } });
      expect(count).toBe(1);
    });
  });

  describe('GET /v1/seller/documents', () => {
    it('requires a seller_id query parameter (422 VALIDATION_ERROR when missing)', async () => {
      const { accessToken } = await loginNewUser();
      const res = await request(app.getHttpServer())
        .get('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('lists every historical version for the caller’s own seller', async () => {
      const { accessToken } = await loginNewUser();
      const sellerId = await createSeller(accessToken);
      await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validDocumentBody(sellerId))
        .expect(201);
      await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validDocumentBody(sellerId))
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/documents?seller_id=${sellerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body.data).toHaveLength(2);
    });

    it("cross-seller: listing another seller's documents returns 403 FORBIDDEN", async () => {
      const ownerA = await loginNewUser();
      const ownerB = await loginNewUser();
      const sellerIdA = await createSeller(ownerA.accessToken);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/documents?seller_id=${sellerIdA}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /v1/seller/documents/:id', () => {
    it("cross-seller: fetching another seller's document by id returns 403 FORBIDDEN", async () => {
      const ownerA = await loginNewUser();
      const ownerB = await loginNewUser();
      const sellerIdA = await createSeller(ownerA.accessToken);
      const created = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send(validDocumentBody(sellerIdA))
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/documents/${created.body.data.id}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 NOT_FOUND for a well-formed but non-existent id', async () => {
      const { accessToken } = await loginNewUser();
      const res = await request(app.getHttpServer())
        .get('/v1/seller/documents/3fa85f64-5717-4562-b3fc-2c963f66afa6')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /v1/seller/documents/:id/confirm', () => {
    it('a clean scan result moves the document to VERIFIED', async () => {
      (scanAdapter.scan as jest.Mock).mockResolvedValue({ clean: true, scannedAt: new Date() });
      const { accessToken } = await loginNewUser();
      const sellerId = await createSeller(accessToken);
      const created = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validDocumentBody(sellerId))
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller/documents/${created.body.data.id}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body.data.verification_status).toBe('VERIFIED');

      const document = await prisma.sellerDocument.findUniqueOrThrow({
        where: { id: created.body.data.id },
      });
      expect(document.verificationStatus).toBe('VERIFIED');
      expect(document.scannedAt).not.toBeNull();
    });

    it('an infected scan result (test double) flips the document to REJECTED, and that document alone cannot satisfy the submit-completeness gate (T-G1-2)', async () => {
      (scanAdapter.scan as jest.Mock).mockResolvedValue({ clean: false, scannedAt: new Date() });
      const { accessToken } = await loginNewUser();
      const sellerId = await createSeller(accessToken);
      const created = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validDocumentBody(sellerId))
        .expect(201);

      const confirmRes = await request(app.getHttpServer())
        .post(`/v1/seller/documents/${created.body.data.id}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(confirmRes.body.data.verification_status).toBe('REJECTED');

      const applications = await prisma.sellerApplication.findMany({ where: { sellerId } });
      const applicationId = applications[0]?.id as string;
      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${applicationId}/contract-acceptance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      const submitRes = await request(app.getHttpServer())
        .post(`/v1/seller-applications/${applicationId}/submit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(422);
      expect(submitRes.body.error.details.missing).toEqual(
        expect.arrayContaining(['documents']),
      );
    });

    it('a re-uploaded clean version after a rejected one DOES satisfy the submit-completeness gate', async () => {
      const { accessToken } = await loginNewUser();
      const sellerId = await createSeller(accessToken);

      (scanAdapter.scan as jest.Mock).mockResolvedValueOnce({ clean: false, scannedAt: new Date() });
      const rejected = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validDocumentBody(sellerId))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/v1/seller/documents/${rejected.body.data.id}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      (scanAdapter.scan as jest.Mock).mockResolvedValueOnce({ clean: true, scannedAt: new Date() });
      const verified = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validDocumentBody(sellerId))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/v1/seller/documents/${verified.body.data.id}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const applications = await prisma.sellerApplication.findMany({ where: { sellerId } });
      const applicationId = applications[0]?.id as string;
      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${applicationId}/contract-acceptance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(201);

      await request(app.getHttpServer())
        .post(`/v1/seller-applications/${applicationId}/submit`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it("cross-seller: confirming another seller's document returns 403 FORBIDDEN and does not change its verification_status", async () => {
      const ownerA = await loginNewUser();
      const ownerB = await loginNewUser();
      const sellerIdA = await createSeller(ownerA.accessToken);
      const created = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send(validDocumentBody(sellerIdA))
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller/documents/${created.body.data.id}/confirm`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const document = await prisma.sellerDocument.findUniqueOrThrow({
        where: { id: created.body.data.id },
      });
      expect(document.verificationStatus).toBe('PENDING');
    });

    it('is idempotent: confirming an already-VERIFIED document again returns 200 without re-scanning', async () => {
      const { accessToken } = await loginNewUser();
      const sellerId = await createSeller(accessToken);
      const created = await request(app.getHttpServer())
        .post('/v1/seller/documents')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(validDocumentBody(sellerId))
        .expect(201);

      await request(app.getHttpServer())
        .post(`/v1/seller/documents/${created.body.data.id}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      (scanAdapter.scan as jest.Mock).mockClear();
      const second = await request(app.getHttpServer())
        .post(`/v1/seller/documents/${created.body.data.id}/confirm`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(second.body.data.verification_status).toBe('VERIFIED');
      expect(scanAdapter.scan).not.toHaveBeenCalled();
    });
  });
});
