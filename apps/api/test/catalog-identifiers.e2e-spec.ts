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
const CUSTOMER_PHONE = '+998901000002';
const PHONES_CATEGORY_SLUG = 'electronics-phones';

const VALID_GTIN = '04006381333931';
const INVALID_CHECKSUM_GTIN = '04006381333930';

function extractOtpCode(smsBody: string): string {
  const match = smsBody.match(/\b(\d{6})\b/);
  if (!match || !match[1]) {
    throw new Error(`no 6-digit OTP code found in captured SMS body: ${smsBody}`);
  }
  return match[1];
}

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

// Each independent test needs its own valid GTIN — reusing one across
// unrelated tests would trip this very feature's own cross-variant conflict
// detection (two different variants attaching the "same real-world
// barcode"), which is only intentional in the dedicated conflict-path tests
// below (those use sharedGtin deliberately, on purpose, exactly once).
// Seeded from Date.now() (not a plain in-process counter) so the generated
// values stay unique across repeated local test runs against the same
// never-reset dev Postgres instance, not just within a single run.
let gtinCounter = 0;
function uniqueValidGtin(): string {
  gtinCounter += 1;
  const payload = `${Date.now()}${String(gtinCounter).padStart(3, '0')}`.slice(-13).padStart(13, '0');
  return `${payload}${gs1CheckDigit(payload)}`;
}

describe('Catalog barcode/MXIK identifiers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let superAdminToken: string;
  let customerToken: string;
  let phonesCategoryId: string;
  const sentMessages = new Map<string, string>();

  const smsSender: SmsSenderAdapter = {
    send: jest.fn(async (phone: string, body: string) => {
      sentMessages.set(phone, body);
    }),
  };

  async function login(phone: string): Promise<string> {
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

    return verifyRes.body.data.access_token as string;
  }

  async function createProduct(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/catalog/products')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ category_id: phonesCategoryId, title: 'Identifier Test Product', ...overrides })
      .expect(201);
    return res.body.data.id as string;
  }

  async function createVariant(
    productId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/v1/catalog/products/${productId}/variants`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ options: { size: 'L', color: 'red' }, ...overrides })
      .expect(201);
    return res.body.data.id as string;
  }

  async function publishProductAndVariant(productId: string, variantId: string): Promise<void> {
    await prisma.product.update({ where: { id: productId }, data: { status: 'PUBLISHED' } });
    await prisma.productVariant.update({ where: { id: variantId }, data: { status: 'PUBLISHED' } });
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

    superAdminToken = await login(SUPER_ADMIN_PHONE);
    customerToken = await login(CUSTOMER_PHONE);

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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/catalog/variants/:id/identifiers — auth', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const productId = await createProduct();
      const variantId = await createVariant(productId);

      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantId}/identifiers`)
        .send({ type: 'GTIN', value: VALID_GTIN })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 403 FORBIDDEN for a non-admin (customer) caller', async () => {
      const productId = await createProduct();
      const variantId = await createVariant(productId);

      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantId}/identifiers`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ type: 'GTIN', value: VALID_GTIN })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /v1/catalog/variants/:id/identifiers — GTIN/EAN/UPC checksum', () => {
    it('rejects a checksum-invalid GTIN with 422, and no row is ever created', async () => {
      const productId = await createProduct();
      const variantId = await createVariant(productId);

      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantId}/identifiers`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ type: 'GTIN', value: INVALID_CHECKSUM_GTIN })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      const count = await prisma.productIdentifier.count({ where: { variantId } });
      expect(count).toBe(0);
    });

    it('rejects a non-numeric value with 422', async () => {
      const productId = await createProduct();
      const variantId = await createVariant(productId);

      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantId}/identifiers`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ type: 'GTIN', value: 'NOTDIGITS1' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a wrong-length value with 422', async () => {
      const productId = await createProduct();
      const variantId = await createVariant(productId);

      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantId}/identifiers`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ type: 'GTIN', value: '123456789' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts a checksum-valid GTIN and creates the row (201)', async () => {
      const productId = await createProduct();
      const variantId = await createVariant(productId);
      const gtin = uniqueValidGtin();

      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantId}/identifiers`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ type: 'GTIN', value: gtin })
        .expect(201);
      expect(res.body.data.type).toBe('GTIN');
      expect(res.body.data.value).toBe(gtin);

      const stored = await prisma.productIdentifier.findFirst({ where: { variantId } });
      expect(stored?.value).toBe(gtin);
    });

    it('[Idempotency-Key] a repeat create call with the same key replays the original response', async () => {
      const productId = await createProduct();
      const variantId = await createVariant(productId);
      const idempotencyKey = `ident-create-${Math.random()}`;
      const gtin = uniqueValidGtin();

      const first = await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantId}/identifiers`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ type: 'GTIN', value: gtin })
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantId}/identifiers`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ type: 'GTIN', value: gtin })
        .expect(201);

      expect(second.body.data.id).toBe(first.body.data.id);
      const count = await prisma.productIdentifier.count({ where: { variantId } });
      expect(count).toBe(1);
    });
  });

  describe('POST /v1/catalog/variants/:id/identifiers — MXIK', () => {
    it('rejects an MXIK identifier with no classification_version with 422', async () => {
      const productId = await createProduct();
      const variantId = await createVariant(productId);

      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantId}/identifiers`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ type: 'MXIK', value: '01234567890123456' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('stores an MXIK identifier with classification_version and never claims it is verified', async () => {
      const productId = await createProduct();
      const variantId = await createVariant(productId);
      const mxikValue = `MXIK${Date.now()}${Math.floor(Math.random() * 100000)}`;

      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantId}/identifiers`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ type: 'MXIK', value: mxikValue, classification_version: '2024.3' })
        .expect(201);
      expect(res.body.data.classification_version).toBe('2024.3');
      expect(JSON.stringify(res.body).toLowerCase()).not.toContain('verified');
    });
  });

  describe('POST /v1/catalog/variants/:id/identifiers — cross-variant conflict', () => {
    it('returns 202 CONFLICT_DETECTED when the same GTIN already exists on a different variant, creates no identifier row, and a repeat does not open a second merge case', async () => {
      const sharedGtin = uniqueValidGtin();
      const productA = await createProduct({ title: 'Product A' });
      const variantA = await createVariant(productA);
      await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantA}/identifiers`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ type: 'GTIN', value: sharedGtin })
        .expect(201);

      const productB = await createProduct({ title: 'Product B' });
      const variantB = await createVariant(productB);

      const conflictRes = await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantB}/identifiers`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ type: 'GTIN', value: sharedGtin })
        .expect(202);
      expect(conflictRes.body.data).toMatchObject({
        status: 'CONFLICT_DETECTED',
        identifier_type: 'GTIN',
        identifier_value: sharedGtin,
      });
      const mergeCaseId = conflictRes.body.data.merge_case_id as string;
      expect(mergeCaseId).toBeDefined();

      const identifierCountForB = await prisma.productIdentifier.count({ where: { variantId: variantB } });
      expect(identifierCountForB).toBe(0);

      const repeatRes = await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantB}/identifiers`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ type: 'GTIN', value: sharedGtin })
        .expect(202);
      expect(repeatRes.body.data.merge_case_id).toBe(mergeCaseId);

      const mergeCaseCount = await prisma.productMergeCase.count({
        where: { identifierValue: sharedGtin },
      });
      expect(mergeCaseCount).toBe(1);

      const mergeCase = await prisma.productMergeCase.findUniqueOrThrow({ where: { id: mergeCaseId } });
      expect([productA, productB]).toContain(mergeCase.winningProductId);
      expect([productA, productB]).toContain(mergeCase.losingProductId);
      expect(mergeCase.winningProductId).not.toBe(mergeCase.losingProductId);
    });
  });

  describe('GET /v1/catalog/variants/:id/identifiers — public read', () => {
    it('returns an empty array for a variant/product that is not PUBLISHED, with no Authorization header', async () => {
      const productId = await createProduct();
      const variantId = await createVariant(productId);
      await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantId}/identifiers`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ type: 'GTIN', value: uniqueValidGtin() })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/v1/catalog/variants/${variantId}/identifiers`)
        .expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('returns the stored identifiers once the variant and product are PUBLISHED', async () => {
      const productId = await createProduct();
      const variantId = await createVariant(productId);
      const gtin = uniqueValidGtin();
      await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variantId}/identifiers`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ type: 'GTIN', value: gtin })
        .expect(201);

      await publishProductAndVariant(productId, variantId);

      const res = await request(app.getHttpServer())
        .get(`/v1/catalog/variants/${variantId}/identifiers`)
        .expect(200);
      expect(res.body.data).toEqual([{ type: 'GTIN', value: gtin, classification_version: null }]);
    });

    it('returns 404 NOT_FOUND for an unknown variant id', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/catalog/variants/3fa85f64-5717-4562-b3fc-2c963f66afa6/identifiers')
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('product_identifiers(type, value) index usage', () => {
    it('the conflict-check query plan uses the type/value index, not a sequential scan (EXPLAIN-backed)', async () => {
      const planRows = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off;');
        return tx.$queryRawUnsafe<Array<Record<string, string>>>(
          `EXPLAIN SELECT "id", "variant_id" FROM "product_identifiers" WHERE "type" = 'GTIN' AND "value" = $1`,
          VALID_GTIN,
        );
      });
      const planText = planRows.map((row) => Object.values(row)[0]).join('\n');
      expect(planText).toMatch(/Index.*Scan/i);
      expect(planText).toContain('product_identifiers_type_value_idx');
    });
  });
});
