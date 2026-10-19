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
const MODERATOR_PHONE = '+998900000004';
const PHONES_CATEGORY_SLUG = 'electronics-phones';

const CSV_HEADER =
  'identifier_type,identifier_value,classification_version,seller_sku,price_minor,currency,fulfillment_mode,category_id,title';

function extractOtpCode(smsBody: string): string {
  const match = smsBody.match(/\b(\d{6})\b/);
  if (!match || !match[1]) {
    throw new Error(`no 6-digit OTP code found in captured SMS body: ${smsBody}`);
  }
  return match[1];
}

function uniquePhone(): string {
  const tail = Math.floor(100_000_000 + Math.random() * 800_000_000);
  return `+998${tail}`;
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function validSellerApplicationBody(overrides: Record<string, unknown> = {}) {
  return {
    legal_type: 'LLC',
    tax_id: '0012345678',
    legal_name: 'Import Test Trading LLC',
    display_name: 'Import Test Shop',
    contacts: { phone: '+998901234567', email: 'owner@example.com' },
    ...overrides,
  };
}

// Same GS1 mod-10 generator catalog-identifiers.e2e-spec.ts already uses —
// each row in this file needs its own fresh valid barcode so unrelated rows
// never collide with this ticket's own cross-variant conflict-detection
// mechanism (T-G2-4), copied here rather than shared across spec files per
// this codebase's own "each test file owns its fixtures" precedent.
function gs1CheckDigit(payload: string): number {
  const digits = payload.split('').map(Number);
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    sum += (digits[i] as number) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}
let gtinCounter = 0;
function uniqueValidGtin(): string {
  gtinCounter += 1;
  const payload = `${Date.now()}${String(gtinCounter).padStart(3, '0')}`.slice(-13).padStart(13, '0');
  return `${payload}${gs1CheckDigit(payload)}`;
}

interface CsvRowInput {
  identifier_type?: string;
  identifier_value?: string;
  classification_version?: string;
  seller_sku?: string;
  price_minor?: string;
  currency?: string;
  fulfillment_mode?: string;
  category_id?: string;
  title?: string;
}

function buildCsv(rows: CsvRowInput[]): string {
  const lines = rows.map((r) =>
    [
      r.identifier_type ?? '',
      r.identifier_value ?? '',
      r.classification_version ?? '',
      r.seller_sku ?? '',
      r.price_minor ?? '',
      r.currency ?? '',
      r.fulfillment_mode ?? '',
      r.category_id ?? '',
      r.title ?? '',
    ].join(','),
  );
  return [CSV_HEADER, ...lines].join('\n') + '\n';
}

async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  { timeoutMs = 10_000, intervalMs = 200 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await fn();
    if (predicate(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);
  throw new Error(`pollUntil timed out; last value: ${JSON.stringify(last)}`);
}

describe('CSV bulk catalog import (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let superAdminToken: string;
  let moderatorToken: string;
  let phonesCategoryId: string;
  const sentMessages = new Map<string, string>();

  const smsSender: SmsSenderAdapter = {
    send: jest.fn(async (phone: string, body: string) => {
      sentMessages.set(phone, body);
    }),
  };

  async function login(phone: string): Promise<{ accessToken: string; userId: string; phone: string }> {
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

  function loginNewApplicant() {
    return login(uniquePhone());
  }

  // Same real application->approve->activate flow seller-offers.e2e-spec.ts
  // already established as this codebase's precedent for reaching an ACTIVE
  // seller in a test.
  async function createActiveSeller(): Promise<{ sellerId: string; ownerToken: string; ownerId: string }> {
    const applicant = await loginNewApplicant();
    const appRes = await request(app.getHttpServer())
      .post('/v1/seller-applications')
      .set('Authorization', `Bearer ${applicant.accessToken}`)
      .send(validSellerApplicationBody())
      .expect(201);
    const created = appRes.body.data as Record<string, unknown>;

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
      .set('Authorization', `Bearer ${applicant.accessToken}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/seller-applications/${created.id}/submit`)
      .set('Authorization', `Bearer ${applicant.accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/seller-applications/${created.id}/approve`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/seller-applications/${created.id}/activate`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    return {
      sellerId: created.seller_id as string,
      ownerToken: applicant.accessToken,
      ownerId: applicant.userId,
    };
  }

  async function inviteOperator(ownerToken: string, sellerId: string): Promise<{ accessToken: string }> {
    const staff = await loginNewApplicant();
    await request(app.getHttpServer())
      .post('/v1/seller/members')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ seller_id: sellerId, phone: staff.phone, role: 'OPERATOR' })
      .expect(201);
    return { accessToken: staff.accessToken };
  }

  // Creates a PUBLISHED product/variant pair (direct DB status flip, same
  // "moderation decisions are T-G2-7, out of this ticket's own scope"
  // fixture precedent catalog-products.e2e-spec.ts/seller-offers.e2e-spec.ts
  // already use) and attaches a GTIN to it via the real T-G2-4 endpoint, so
  // a CSV row matching this GTIN exercises the real
  // IdentifiersService.findByTypeValue lookup end-to-end.
  async function createPublishedVariantWithGtin(gtin: string): Promise<string> {
    const productRes = await request(app.getHttpServer())
      .post('/v1/catalog/products')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ category_id: phonesCategoryId, title: `Import Test Product ${uniqueToken('p')}` })
      .expect(201);
    const product = productRes.body.data as Record<string, unknown>;

    const variantRes = await request(app.getHttpServer())
      .post(`/v1/catalog/products/${product.id}/variants`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ options: { sku: uniqueToken('opt') } })
      .expect(201);
    const variant = variantRes.body.data as Record<string, unknown>;

    await prisma.product.update({ where: { id: product.id as string }, data: { status: 'PUBLISHED' } });
    await prisma.productVariant.update({
      where: { id: variant.id as string },
      data: { status: 'PUBLISHED' },
    });

    await request(app.getHttpServer())
      .post(`/v1/catalog/variants/${variant.id}/identifiers`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ type: 'GTIN', value: gtin })
      .expect(201);

    return variant.id as string;
  }

  async function createImportJob(
    ownerToken: string,
    sellerId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const res = await request(app.getHttpServer())
      .post('/v1/seller/catalog/imports')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        seller_id: sellerId,
        filename: 'catalog.csv',
        mime_type: 'text/csv',
        size_bytes: 1024,
        ...overrides,
      })
      .expect(201);
    return res.body.data as Record<string, unknown>;
  }

  async function uploadCsvBody(uploadUrl: string, content: string): Promise<void> {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/csv' },
      body: content,
    });
    if (res.status !== 200) {
      throw new Error(`upload to presigned URL failed with status ${res.status}`);
    }
  }

  async function getJob(token: string, jobId: string): Promise<Record<string, unknown>> {
    const res = await request(app.getHttpServer())
      .get(`/v1/seller/catalog/imports/${jobId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data as Record<string, unknown>;
  }

  async function pollJobStatus(
    token: string,
    jobId: string,
    targetStatuses: string[],
    timeoutMs = 10_000,
  ): Promise<Record<string, unknown>> {
    return pollUntil(
      () => getJob(token, jobId),
      (job) => targetStatuses.includes(job.status as string),
      { timeoutMs },
    );
  }

  // Full create -> upload -> confirm -> (poll READY) flow, returning the
  // READY job payload. Shared by every test below that just needs "some
  // validated job" to act on next.
  async function createConfirmedJob(
    ownerToken: string,
    sellerId: string,
    rows: CsvRowInput[],
  ): Promise<{ jobId: string }> {
    const created = await createImportJob(ownerToken, sellerId);
    await uploadCsvBody(created.upload_url as string, buildCsv(rows));
    await request(app.getHttpServer())
      .post(`/v1/seller/catalog/imports/${created.id}/confirm`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    await pollJobStatus(ownerToken, created.id as string, ['READY', 'FAILED']);
    return { jobId: created.id as string };
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

    const superAdmin = await login(SUPER_ADMIN_PHONE);
    superAdminToken = superAdmin.accessToken;
    const moderator = await login(MODERATOR_PHONE);
    moderatorToken = moderator.accessToken;

    const categoriesRes = await request(app.getHttpServer())
      .get('/v1/catalog/categories?limit=100')
      .expect(200);
    const phonesCategory = (categoriesRes.body.data.items as Array<Record<string, unknown>>).find(
      (c) => c.slug === PHONES_CATEGORY_SLUG,
    );
    if (!phonesCategory) {
      throw new Error(`seed fixture category "${PHONES_CATEGORY_SLUG}" not found`);
    }
    phonesCategoryId = phonesCategory.id as string;
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/seller/catalog/imports', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/seller/catalog/imports')
        .send({ seller_id: '00000000-0000-0000-0000-000000000000', filename: 'a.csv', mime_type: 'text/csv', size_bytes: 10 })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 403 FORBIDDEN when the caller is not a member of seller_id', async () => {
      const { sellerId } = await createActiveSeller();
      const stranger = await loginNewApplicant();

      const res = await request(app.getHttpServer())
        .post('/v1/seller/catalog/imports')
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({ seller_id: sellerId, filename: 'a.csv', mime_type: 'text/csv', size_bytes: 10 })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it("rejects an OPERATOR (lacks seller:offers:manage) with 403 FORBIDDEN — TZ §02 'pick/dispatch limited', OWNER/MANAGER only", async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const operator = await inviteOperator(ownerToken, sellerId);

      const res = await request(app.getHttpServer())
        .post('/v1/seller/catalog/imports')
        .set('Authorization', `Bearer ${operator.accessToken}`)
        .send({ seller_id: sellerId, filename: 'a.csv', mime_type: 'text/csv', size_bytes: 10 })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects a disallowed mime_type with 422 VALIDATION_ERROR', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const res = await request(app.getHttpServer())
        .post('/v1/seller/catalog/imports')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ seller_id: sellerId, filename: 'a.xlsx', mime_type: 'application/vnd.ms-excel', size_bytes: 10 })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('issues a signed upload URL and creates an UPLOADED catalog_import_jobs row', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const job = await createImportJob(ownerToken, sellerId);

      expect(job.status).toBe('UPLOADED');
      expect(typeof job.upload_url).toBe('string');
      expect(job.upload_url_expires_in_seconds).toBeGreaterThan(0);

      const row = await prisma.catalogImportJob.findUniqueOrThrow({ where: { id: job.id as string } });
      expect(row.sellerId).toBe(sellerId);
      expect(row.status).toBe('UPLOADED');
    });
  });

  describe('GET /v1/seller/catalog/imports/:id', () => {
    it('returns 404 NOT_FOUND for an unknown job id', async () => {
      const { ownerToken } = await createActiveSeller();
      const res = await request(app.getHttpServer())
        .get('/v1/seller/catalog/imports/3fa85f64-5717-4562-b3fc-2c963f66afa6')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 FORBIDDEN when a different seller tries to read this job', async () => {
      const sellerA = await createActiveSeller();
      const sellerB = await createActiveSeller();
      const job = await createImportJob(sellerA.ownerToken, sellerA.sellerId);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/catalog/imports/${job.id}`)
        .set('Authorization', `Bearer ${sellerB.ownerToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('confirm -> VALIDATING -> READY (real file, real BullMQ worker)', () => {
    it(
      'parses the uploaded CSV, matches one row to an existing variant, routes an unmatched row to a new draft product, and exports per-row errors for invalid rows',
      async () => {
        const { sellerId, ownerToken } = await createActiveSeller();
        const matchedGtin = uniqueValidGtin();
        const unmatchedGtin = uniqueValidGtin();
        const badChecksumGtin = '04006381333930';
        const variantId = await createPublishedVariantWithGtin(matchedGtin);

        const matchedSku = uniqueToken('SKU-MATCH');
        const unmatchedSku = uniqueToken('SKU-NEW');

        const rows: CsvRowInput[] = [
          {
            identifier_type: 'GTIN',
            identifier_value: matchedGtin,
            seller_sku: matchedSku,
            price_minor: '1500000',
            currency: 'UZS',
            fulfillment_mode: 'SELLER_WAREHOUSE',
          },
          {
            identifier_type: 'GTIN',
            identifier_value: unmatchedGtin,
            seller_sku: unmatchedSku,
            category_id: phonesCategoryId,
            title: 'Imported Draft Widget',
          },
          {
            // invalid: bad GS1 check digit
            identifier_type: 'GTIN',
            identifier_value: badChecksumGtin,
            seller_sku: uniqueToken('SKU-BAD'),
          },
          {
            // invalid: matches an identifier but is missing the
            // CREATE_OFFER-path-required price_minor/currency/fulfillment_mode
            identifier_type: 'GTIN',
            identifier_value: matchedGtin,
            seller_sku: '',
          },
        ];

        const created = await createImportJob(ownerToken, sellerId);
        await uploadCsvBody(created.upload_url as string, buildCsv(rows));

        const confirmRes = await request(app.getHttpServer())
          .post(`/v1/seller/catalog/imports/${created.id}/confirm`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);
        expect(confirmRes.body.data.status).toBe('VALIDATING');

        const ready = await pollJobStatus(ownerToken, created.id as string, ['READY', 'FAILED']);
        expect(ready.status).toBe('READY');
        expect(ready.total_rows).toBe(4);
        expect(ready.valid_row_count).toBe(2);
        expect(ready.error_row_count).toBe(2);

        const errorsRes = await request(app.getHttpServer())
          .get(`/v1/seller/catalog/imports/${created.id}/errors`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);
        const errorItems = errorsRes.body.data.items as Array<Record<string, unknown>>;
        expect(errorItems).toHaveLength(2);
        expect(errorItems.map((e) => e.row_number).sort()).toEqual([3, 4]);
        expect(errorItems.every((e) => typeof e.field === 'string' && typeof e.message === 'string')).toBe(
          true,
        );

        // Commit step: the 2 valid rows should produce exactly one
        // seller_offers row (matched) and one new DRAFT product (unmatched);
        // the 2 invalid rows are never (re)processed.
        const productCountBefore = await prisma.product.count();

        const commitRes = await request(app.getHttpServer())
          .post(`/v1/seller/catalog/imports/${created.id}/commit`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);
        expect(commitRes.body.data.status).toBe('IMPORTING');

        const completed = await pollJobStatus(ownerToken, created.id as string, ['COMPLETED', 'PARTIAL']);
        expect(completed.status).toBe('COMPLETED');
        expect(completed.error_row_count).toBe(2);

        const importRows = await prisma.catalogImportRow.findMany({ where: { jobId: created.id as string } });
        expect(importRows).toHaveLength(2);

        const offerRow = importRows.find((r) => r.action === 'CREATE_OFFER');
        expect(offerRow).toBeDefined();
        const offer = await prisma.sellerOffer.findUniqueOrThrow({
          where: { id: offerRow?.sellerOfferId as string },
        });
        expect(offer.sellerId).toBe(sellerId);
        expect(offer.variantId).toBe(variantId);
        expect(offer.sku).toBe(matchedSku);
        expect(offer.priceMinor.toString()).toBe('1500000');

        const draftRow = importRows.find((r) => r.action === 'CREATE_DRAFT_PRODUCT');
        expect(draftRow).toBeDefined();
        const draftProduct = await prisma.product.findUniqueOrThrow({
          where: { id: draftRow?.productId as string },
        });
        expect(draftProduct.status).toBe('DRAFT');
        expect(draftProduct.categoryId).toBe(phonesCategoryId);
        expect(draftProduct.title).toBe('Imported Draft Widget');

        const draftIdentifier = await prisma.productIdentifier.findFirst({
          where: { type: 'GTIN', value: unmatchedGtin },
        });
        expect(draftIdentifier).not.toBeNull();

        // bulk import never auto-publishes — exactly one new product row
        // (the draft), still DRAFT, never PUBLISHED.
        const productCountAfter = await prisma.product.count();
        expect(productCountAfter).toBe(productCountBefore + 1);
      },
      20_000,
    );

    it(
      'marks the job FAILED when the uploaded file has no recognizable CSV header',
      async () => {
        const { sellerId, ownerToken } = await createActiveSeller();
        const created = await createImportJob(ownerToken, sellerId);
        await uploadCsvBody(created.upload_url as string, 'not_a_real_header\nx,y,z\n');

        await request(app.getHttpServer())
          .post(`/v1/seller/catalog/imports/${created.id}/confirm`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);

        const failed = await pollJobStatus(ownerToken, created.id as string, ['READY', 'FAILED']);
        expect(failed.status).toBe('FAILED');

        const errorsRes = await request(app.getHttpServer())
          .get(`/v1/seller/catalog/imports/${created.id}/errors`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);
        expect((errorsRes.body.data.items as unknown[]).length).toBeGreaterThan(0);
      },
      20_000,
    );
  });

  describe('POST /v1/seller/catalog/imports/:id/commit', () => {
    it(
      'returns 409 INVALID_STATE_TRANSITION on a second commit call once the job has left READY (no Idempotency-Key reuse)',
      async () => {
        const { sellerId, ownerToken } = await createActiveSeller();
        const gtin = uniqueValidGtin();
        await createPublishedVariantWithGtin(gtin);
        const { jobId } = await createConfirmedJob(ownerToken, sellerId, [
          {
            identifier_type: 'GTIN',
            identifier_value: gtin,
            seller_sku: uniqueToken('SKU'),
            price_minor: '1000000',
            currency: 'UZS',
            fulfillment_mode: 'SELLER_WAREHOUSE',
          },
        ]);

        await request(app.getHttpServer())
          .post(`/v1/seller/catalog/imports/${jobId}/commit`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);

        const res = await request(app.getHttpServer())
          .post(`/v1/seller/catalog/imports/${jobId}/commit`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(409);
        expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
      },
      20_000,
    );

    it(
      '[Idempotency-Key] a repeat commit call with the same key replays the original cached response, never creating a second batch of offers',
      async () => {
        const { sellerId, ownerToken } = await createActiveSeller();
        const gtin = uniqueValidGtin();
        await createPublishedVariantWithGtin(gtin);
        const { jobId } = await createConfirmedJob(ownerToken, sellerId, [
          {
            identifier_type: 'GTIN',
            identifier_value: gtin,
            seller_sku: uniqueToken('SKU'),
            price_minor: '1000000',
            currency: 'UZS',
            fulfillment_mode: 'SELLER_WAREHOUSE',
          },
        ]);
        const idempotencyKey = uniqueToken('idem');

        const first = await request(app.getHttpServer())
          .post(`/v1/seller/catalog/imports/${jobId}/commit`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .set('Idempotency-Key', idempotencyKey)
          .expect(200);
        await pollJobStatus(ownerToken, jobId, ['COMPLETED', 'PARTIAL']);

        const offerCountAfterFirst = await prisma.sellerOffer.count({ where: { sellerId } });

        const second = await request(app.getHttpServer())
          .post(`/v1/seller/catalog/imports/${jobId}/commit`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .set('Idempotency-Key', idempotencyKey)
          .expect(200);

        // The cached replay reflects the state *at the moment of the
        // original call* (api-contract-g2.md), i.e. IMPORTING, not the
        // eventual COMPLETED outcome.
        expect(second.body.data.status).toBe(first.body.data.status);
        expect(second.body.data.id).toBe(first.body.data.id);

        const offerCountAfterSecond = await prisma.sellerOffer.count({ where: { sellerId } });
        expect(offerCountAfterSecond).toBe(offerCountAfterFirst);
      },
      20_000,
    );

    it(
      'surfaces a commit-time identifier conflict (CONFLICT_DETECTED) as a catalog_import_errors row instead of a silent success, still creating the draft product but marking the job PARTIAL',
      async () => {
        const { sellerId, ownerToken } = await createActiveSeller();

        // A GTIN already attached to a DRAFT (unpublished) variant — this
        // makes IdentifiersService.findByTypeValue find a real identifier
        // row but findVariantIdByIdentifier.lookupDeps still return null
        // (not PUBLISHED), so the CSV row below is classified
        // CREATE_DRAFT_PRODUCT, not CREATE_OFFER. The identifier value
        // itself still collides at commit time, when the newly created
        // draft product's own variant tries to attach the same (type,
        // value) pair.
        const existingProductRes = await request(app.getHttpServer())
          .post('/v1/catalog/products')
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({ category_id: phonesCategoryId, title: `Import Conflict Source ${uniqueToken('p')}` })
          .expect(201);
        const existingVariantRes = await request(app.getHttpServer())
          .post(`/v1/catalog/products/${existingProductRes.body.data.id}/variants`)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({ options: { sku: uniqueToken('opt') } })
          .expect(201);
        const conflictingGtin = uniqueValidGtin();
        await request(app.getHttpServer())
          .post(`/v1/catalog/variants/${existingVariantRes.body.data.id}/identifiers`)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({ type: 'GTIN', value: conflictingGtin })
          .expect(201);

        const { jobId } = await createConfirmedJob(ownerToken, sellerId, [
          {
            identifier_type: 'GTIN',
            identifier_value: conflictingGtin,
            seller_sku: uniqueToken('SKU-CONFLICT'),
            category_id: phonesCategoryId,
            title: 'Imported Conflicting Widget',
          },
        ]);

        const productCountBefore = await prisma.product.count();

        await request(app.getHttpServer())
          .post(`/v1/seller/catalog/imports/${jobId}/commit`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);

        const completed = await pollJobStatus(ownerToken, jobId, ['COMPLETED', 'PARTIAL']);
        expect(completed.status).toBe('PARTIAL');

        const errorsRes = await request(app.getHttpServer())
          .get(`/v1/seller/catalog/imports/${jobId}/errors`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);
        const errorItems = errorsRes.body.data.items as Array<Record<string, unknown>>;
        const conflictError = errorItems.find((e) => e.field === 'identifier');
        expect(conflictError).toBeDefined();
        expect(conflictError?.message).toContain(conflictingGtin);

        // The draft product was still created (the row's other half
        // succeeded) — just with no identifier attached, and a merge case
        // opened in its place, never silently absorbed.
        const importRows = await prisma.catalogImportRow.findMany({ where: { jobId } });
        const draftRow = importRows.find((r) => r.action === 'CREATE_DRAFT_PRODUCT');
        expect(draftRow).toBeDefined();

        const newVariant = await prisma.productVariant.findFirstOrThrow({
          where: { productId: draftRow?.productId as string },
        });
        const identifierOnNewVariant = await prisma.productIdentifier.findFirst({
          where: { variantId: newVariant.id },
        });
        expect(identifierOnNewVariant).toBeNull();

        const mergeCase = await prisma.productMergeCase.findFirst({
          where: { identifierType: 'GTIN', identifierValue: conflictingGtin },
        });
        expect(mergeCase).not.toBeNull();

        const productCountAfter = await prisma.product.count();
        expect(productCountAfter).toBe(productCountBefore + 1);
      },
      20_000,
    );

    it('returns 403 FORBIDDEN when an OPERATOR (same seller) attempts to commit', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const operator = await inviteOperator(ownerToken, sellerId);
      const job = await createImportJob(ownerToken, sellerId);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller/catalog/imports/${job.id}/commit`)
        .set('Authorization', `Bearer ${operator.accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Duplicate upload dedup (same seller, identical file bytes)', () => {
    it(
      'marks the second job COMPLETED with duplicate_of_job_id set, parses no rows, and creates no new offers/products',
      async () => {
        const { sellerId, ownerToken } = await createActiveSeller();
        const gtin = uniqueValidGtin();
        await createPublishedVariantWithGtin(gtin);
        const csv = buildCsv([
          {
            identifier_type: 'GTIN',
            identifier_value: gtin,
            seller_sku: uniqueToken('SKU'),
            price_minor: '1000000',
            currency: 'UZS',
            fulfillment_mode: 'SELLER_WAREHOUSE',
          },
        ]);

        const first = await createImportJob(ownerToken, sellerId);
        await uploadCsvBody(first.upload_url as string, csv);
        await request(app.getHttpServer())
          .post(`/v1/seller/catalog/imports/${first.id}/confirm`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);
        await pollJobStatus(ownerToken, first.id as string, ['READY', 'FAILED']);

        const second = await createImportJob(ownerToken, sellerId);
        await uploadCsvBody(second.upload_url as string, csv);
        await request(app.getHttpServer())
          .post(`/v1/seller/catalog/imports/${second.id}/confirm`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200);

        const secondFinal = await pollJobStatus(ownerToken, second.id as string, ['COMPLETED', 'FAILED']);
        expect(secondFinal.status).toBe('COMPLETED');
        expect(secondFinal.duplicate_of_job_id).toBe(first.id);
        expect(secondFinal.total_rows).toBe(0);

        const offerCount = await prisma.sellerOffer.count({ where: { sellerId } });
        expect(offerCount).toBe(0);
      },
      20_000,
    );
  });
});
