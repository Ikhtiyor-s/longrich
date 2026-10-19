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
const CUSTOMER_PHONE = '+998901000001';
const PHONES_CATEGORY_SLUG = 'electronics-phones';

function extractOtpCode(smsBody: string): string {
  const match = smsBody.match(/\b(\d{6})\b/);
  if (!match || !match[1]) {
    throw new Error(`no 6-digit OTP code found in captured SMS body: ${smsBody}`);
  }
  return match[1];
}

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

describe('Catalog products/variants/brands/media (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let superAdminToken: string;
  let moderatorToken: string;
  let customerToken: string;
  let phonesCategoryId: string;
  let colorAttributeId: string;
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

  async function createProduct(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const res = await request(app.getHttpServer())
      .post('/v1/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ category_id: phonesCategoryId, title: 'Test Product', ...overrides })
      .expect(201);
    return res.body.data as Record<string, unknown>;
  }

  async function createVariant(
    token: string,
    productId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const res = await request(app.getHttpServer())
      .post(`/v1/catalog/products/${productId}/variants`)
      .set('Authorization', `Bearer ${token}`)
      .send({ options: { size: 'L', color: 'red' }, ...overrides })
      .expect(201);
    return res.body.data as Record<string, unknown>;
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
    moderatorToken = await login(MODERATOR_PHONE);
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

    const attributesRes = await request(app.getHttpServer())
      .get(`/v1/catalog/categories/${phonesCategoryId}/attributes`)
      .expect(200);
    const colorAttribute = (attributesRes.body.data as Array<Record<string, unknown>>).find(
      (a) => a.key === 'color',
    );
    if (!colorAttribute) {
      throw new Error('seed fixture category_attribute "color" not found');
    }
    colorAttributeId = colorAttribute.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/catalog/products', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/catalog/products')
        .send({ category_id: phonesCategoryId, title: 'X' })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 403 FORBIDDEN for a non-admin (customer) caller — sellers never author global product data', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/catalog/products')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ category_id: phonesCategoryId, title: 'X' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 403 FORBIDDEN for a MODERATOR (category:manage is SUPER_ADMIN-only)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/catalog/products')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ category_id: phonesCategoryId, title: 'X' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects a title shorter than 3 characters with 422 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/catalog/products')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ category_id: phonesCategoryId, title: 'X' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('SUPER_ADMIN creates a DRAFT product with sanitized description', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/catalog/products')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          category_id: phonesCategoryId,
          title: 'Smartphone X',
          description: '<script>alert(1)</script>Great phone',
        })
        .expect(201);
      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.description).toBe('alert(1)Great phone');
      expect(res.body.data.variants).toEqual([]);
      expect(res.body.data.media).toEqual([]);
      expect(res.body.data.offers_summary).toEqual({
        active_offer_count: 0,
        lowest_price_minor: null,
        currency: null,
      });
      expect(res.body.data.version).toBe(1);
    });

    it('[Idempotency-Key] a repeat create call with the same key replays the original response', async () => {
      const idempotencyKey = `prod-create-${Math.random()}`;
      const title = `Idempotent Product ${uniqueSlug('x')}`;
      const body = { category_id: phonesCategoryId, title };

      const first = await request(app.getHttpServer())
        .post('/v1/catalog/products')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/v1/catalog/products')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);

      expect(second.body.data.id).toBe(first.body.data.id);
      const count = await prisma.product.count({ where: { title } });
      expect(count).toBe(1);
    });
  });

  describe('GET /v1/catalog/products + /:id', () => {
    // Walks the public list's cursor pages (optionally scoped to one category) looking for
    // `id`, rather than assuming it lands on page 1 — the shared dev Postgres accumulates
    // PUBLISHED fixtures across many repeated local e2e runs over this project's lifetime
    // (CI always starts from a fresh service-container Postgres, so this never flakes there;
    // it's a local-dev-only accumulation), so a created_at-ASC default page is not a reliable
    // place to find a just-published item once enough history has built up.
    async function listContains(id: string, categoryId?: string): Promise<boolean> {
      let cursor: string | undefined;
      for (let page = 0; page < 50; page += 1) {
        const query: Record<string, string> = { limit: '100' };
        if (categoryId) query.category_id = categoryId;
        if (cursor) query.cursor = cursor;
        const res = await request(app.getHttpServer())
          .get('/v1/catalog/products')
          .query(query)
          .expect(200);
        const items = res.body.data.items as Array<Record<string, unknown>>;
        if (items.some((i) => i.id === id)) return true;
        cursor = res.body.data.next_cursor as string | undefined;
        if (!cursor) return false;
      }
      throw new Error('listContains: exceeded 50 pages without exhausting cursor — pagination likely looping');
    }

    it('list is public, filters to PUBLISHED only, and a DRAFT product never appears', async () => {
      const draft = await createProduct(superAdminToken, { title: 'Draft Only Product' });

      expect(await listContains(draft.id as string, phonesCategoryId)).toBe(false);

      await prisma.product.update({ where: { id: draft.id as string }, data: { status: 'PUBLISHED' } });

      expect(await listContains(draft.id as string, phonesCategoryId)).toBe(true);
    });

    it('detail GET returns variants + media + resolved attribute_values + brand, for a PUBLISHED product', async () => {
      const brandRes = await request(app.getHttpServer())
        .post('/v1/catalog/brands')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ name: `Brand ${uniqueSlug('b')}`, slug: uniqueSlug('brand') })
        .expect(201);
      const brand = brandRes.body.data as Record<string, unknown>;

      const product = await createProduct(superAdminToken, { brand_id: brand.id });
      await createVariant(superAdminToken, product.id as string, {
        options: { size: 'L', color: 'red' },
        attribute_values: [{ category_attribute_id: colorAttributeId, value: 'red' }],
      });
      await prisma.product.update({ where: { id: product.id as string }, data: { status: 'PUBLISHED' } });

      const detailRes = await request(app.getHttpServer())
        .get(`/v1/catalog/products/${product.id}`)
        .expect(200);
      expect(detailRes.body.data.brand).toEqual({ id: brand.id, name: brand.name });
      expect(detailRes.body.data.variants).toHaveLength(1);
      expect(detailRes.body.data.variants[0].attribute_values).toEqual([
        { category_attribute_id: colorAttributeId, key: 'color', value: 'red' },
      ]);
      expect(detailRes.body.data.media).toEqual([]);
    });

    it('returns 404 NOT_FOUND for a well-formed but non-existent id', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/catalog/products/3fa85f64-5717-4562-b3fc-2c963f66afa6')
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 NOT_FOUND for a DRAFT product\'s detail, even to an unauthenticated public caller (info-disclosure fix)', async () => {
      const product = await createProduct(superAdminToken, { title: 'Still Draft Product' });

      const res = await request(app.getHttpServer())
        .get(`/v1/catalog/products/${product.id}`)
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 NOT_FOUND for a PENDING_REVIEW product\'s detail (its latest_moderation_decision.reason must never leak publicly)', async () => {
      const product = await createProduct(superAdminToken, { title: 'Pending Review Product' });
      await request(app.getHttpServer())
        .post(`/v1/catalog/products/${product.id}/submit`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/v1/catalog/products/${product.id}`)
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('never includes a PENDING or REJECTED media row in a PUBLISHED product\'s detail, at either the product or variant level', async () => {
      const product = await createProduct(superAdminToken, { title: 'Product With Mixed Media' });
      const variant = await createVariant(superAdminToken, product.id as string, {
        attribute_values: [{ category_attribute_id: colorAttributeId, value: 'red' }],
      });

      const approvedMediaRes = await request(app.getHttpServer())
        .post(`/v1/catalog/products/${product.id}/media`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ filename: 'approved.png', mime_type: 'image/png', size_bytes: 1024, variant_id: null })
        .expect(201);
      const pendingMediaRes = await request(app.getHttpServer())
        .post(`/v1/catalog/products/${product.id}/media`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ filename: 'pending.png', mime_type: 'image/png', size_bytes: 1024, variant_id: null })
        .expect(201);
      const rejectedVariantMediaRes = await request(app.getHttpServer())
        .post(`/v1/catalog/products/${product.id}/media`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ filename: 'rejected.png', mime_type: 'image/png', size_bytes: 1024, variant_id: variant.id })
        .expect(201);

      await prisma.productMedia.update({
        where: { id: approvedMediaRes.body.data.id as string },
        data: { moderationStatus: 'APPROVED' },
      });
      await prisma.productMedia.update({
        where: { id: rejectedVariantMediaRes.body.data.id as string },
        data: { moderationStatus: 'REJECTED' },
      });
      // pendingMediaRes stays PENDING (default) — never confirmed/decided.

      await prisma.product.update({ where: { id: product.id as string }, data: { status: 'PUBLISHED' } });

      const detailRes = await request(app.getHttpServer())
        .get(`/v1/catalog/products/${product.id}`)
        .expect(200);

      const productMediaIds = (detailRes.body.data.media as Array<Record<string, unknown>>).map((m) => m.id);
      expect(productMediaIds).toContain(approvedMediaRes.body.data.id);
      expect(productMediaIds).not.toContain(pendingMediaRes.body.data.id);

      const variantPayload = (detailRes.body.data.variants as Array<Record<string, unknown>>).find(
        (v) => v.id === variant.id,
      );
      const variantMediaIds = ((variantPayload?.media ?? []) as Array<Record<string, unknown>>).map((m) => m.id);
      expect(variantMediaIds).not.toContain(rejectedVariantMediaRes.body.data.id);
    });
  });

  describe('PATCH /v1/catalog/products/:id', () => {
    it('updates via compare-and-swap on version', async () => {
      const product = await createProduct(superAdminToken);
      const res = await request(app.getHttpServer())
        .patch(`/v1/catalog/products/${product.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ version: 1, title: 'Renamed Product' })
        .expect(200);
      expect(res.body.data.title).toBe('Renamed Product');
      expect(res.body.data.version).toBe(2);
    });

    it('returns 409 INVALID_STATE_TRANSITION on a stale version', async () => {
      const product = await createProduct(superAdminToken);
      const res = await request(app.getHttpServer())
        .patch(`/v1/catalog/products/${product.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ version: 99, title: 'Stale Write' })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('returns 409 INVALID_STATE_TRANSITION when attempting to edit an ARCHIVED (terminal) product', async () => {
      const product = await createProduct(superAdminToken);
      await prisma.product.update({ where: { id: product.id as string }, data: { status: 'ARCHIVED' } });

      const res = await request(app.getHttpServer())
        .patch(`/v1/catalog/products/${product.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ version: 1, title: 'Should not apply' })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });
  });

  describe('POST /v1/catalog/products/:id/submit', () => {
    it('transitions DRAFT -> PENDING_REVIEW and opens a moderation_cases row', async () => {
      const product = await createProduct(superAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/products/${product.id}/submit`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('PENDING_REVIEW');

      const moderationCase = await prisma.moderationCase.findFirst({
        where: { entityType: 'product', entityId: product.id as string },
      });
      expect(moderationCase).not.toBeNull();
      expect(moderationCase?.status).toBe('OPEN');
    });

    it('returns 409 INVALID_STATE_TRANSITION on a second submit (already PENDING_REVIEW)', async () => {
      const product = await createProduct(superAdminToken);
      await request(app.getHttpServer())
        .post(`/v1/catalog/products/${product.id}/submit`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/products/${product.id}/submit`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });
  });

  describe('POST /v1/catalog/products/:id/variants', () => {
    it('returns 403 FORBIDDEN for a non-admin caller', async () => {
      const product = await createProduct(superAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/products/${product.id}/variants`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ options: { size: 'L' } })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('creates a DRAFT variant with valid attribute_values', async () => {
      const product = await createProduct(superAdminToken);
      const variant = await createVariant(superAdminToken, product.id as string, {
        attribute_values: [{ category_attribute_id: colorAttributeId, value: 'red' }],
      });
      expect(variant.status).toBe('DRAFT');
      expect(variant.attribute_values).toEqual([
        { category_attribute_id: colorAttributeId, key: 'color', value: 'red' },
      ]);
    });

    it('rejects an attribute value outside the ENUM rule with 422 VALIDATION_ERROR', async () => {
      const product = await createProduct(superAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/products/${product.id}/variants`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          options: { size: 'L', color: 'green' },
          attribute_values: [{ category_attribute_id: colorAttributeId, value: 'green' }],
        })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects two variants of the same product sharing the same options combination with 422', async () => {
      const product = await createProduct(superAdminToken);
      await createVariant(superAdminToken, product.id as string, { options: { size: 'L', color: 'red' } });

      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/products/${product.id}/variants`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ options: { color: 'red', size: 'L' } })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      const count = await prisma.productVariant.count({ where: { productId: product.id as string } });
      expect(count).toBe(1);
    });
  });

  describe('PATCH /v1/catalog/variants/:id', () => {
    it('updates via compare-and-swap on version', async () => {
      const product = await createProduct(superAdminToken);
      const variant = await createVariant(superAdminToken, product.id as string);

      const res = await request(app.getHttpServer())
        .patch(`/v1/catalog/variants/${variant.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ version: 1, options: { size: 'M', color: 'red' } })
        .expect(200);
      expect(res.body.data.options).toEqual({ size: 'M', color: 'red' });
      expect(res.body.data.version).toBe(2);
    });

    it('returns 409 INVALID_STATE_TRANSITION on a stale version', async () => {
      const product = await createProduct(superAdminToken);
      const variant = await createVariant(superAdminToken, product.id as string);

      const res = await request(app.getHttpServer())
        .patch(`/v1/catalog/variants/${variant.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ version: 99, options: { size: 'M' } })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });
  });

  describe('POST /v1/catalog/variants/:id/submit', () => {
    it('blocks submission with 422 and details.missing_attribute_keys when the required "color" attribute has no value, and the status stays DRAFT', async () => {
      const product = await createProduct(superAdminToken);
      const variant = await createVariant(superAdminToken, product.id as string);

      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variant.id}/submit`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.missing_attribute_keys).toContain('color');

      const unchanged = await prisma.productVariant.findUniqueOrThrow({
        where: { id: variant.id as string },
      });
      expect(unchanged.status).toBe('DRAFT');
    });

    it('transitions DRAFT -> PENDING_REVIEW and opens a moderation_cases row once the required attribute is present', async () => {
      const product = await createProduct(superAdminToken);
      const variant = await createVariant(superAdminToken, product.id as string, {
        attribute_values: [{ category_attribute_id: colorAttributeId, value: 'red' }],
      });

      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/variants/${variant.id}/submit`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('PENDING_REVIEW');

      const moderationCase = await prisma.moderationCase.findFirst({
        where: { entityType: 'product_variant', entityId: variant.id as string },
      });
      expect(moderationCase).not.toBeNull();
    });
  });

  describe('Brands CRUD', () => {
    it('SUPER_ADMIN creates a brand (201); it is readable via the public list/detail GETs', async () => {
      const slug = uniqueSlug('brand');
      const createRes = await request(app.getHttpServer())
        .post('/v1/catalog/brands')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ name: `Brand ${slug}`, slug })
        .expect(201);
      const brand = createRes.body.data as Record<string, unknown>;

      const listRes = await request(app.getHttpServer()).get('/v1/catalog/brands').expect(200);
      expect(Array.isArray(listRes.body.data)).toBe(true);
      expect((listRes.body.data as Array<Record<string, unknown>>).map((b) => b.id)).toContain(
        brand.id,
      );

      const detailRes = await request(app.getHttpServer())
        .get(`/v1/catalog/brands/${brand.id}`)
        .expect(200);
      expect(detailRes.body.data.slug).toBe(slug);
    });

    it('returns 403 FORBIDDEN for a non-admin caller', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/catalog/brands')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ name: 'X', slug: uniqueSlug('brand') })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('PATCH updates via compare-and-swap on version', async () => {
      const slug = uniqueSlug('brand');
      const createRes = await request(app.getHttpServer())
        .post('/v1/catalog/brands')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ name: `Brand ${slug}`, slug })
        .expect(201);
      const brand = createRes.body.data as Record<string, unknown>;

      const renamedName = `Renamed Brand ${slug}`;
      const res = await request(app.getHttpServer())
        .patch(`/v1/catalog/brands/${brand.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ version: 1, name: renamedName })
        .expect(200);
      expect(res.body.data.name).toBe(renamedName);
      expect(res.body.data.version).toBe(2);
    });
  });

  describe('Product media upload + confirm', () => {
    it('POST .../media returns an upload_url and the row starts PENDING moderation', async () => {
      const product = await createProduct(superAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/products/${product.id}/media`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ filename: 'photo.png', mime_type: 'image/png', size_bytes: 2048, variant_id: null })
        .expect(201);
      expect(res.body.data.upload_url).toBeDefined();
      expect(res.body.data.moderation_status).toBe('PENDING');
    });

    it('rejects a non-image mime_type with 422 VALIDATION_ERROR', async () => {
      const product = await createProduct(superAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/products/${product.id}/media`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ filename: 'clip.mp4', mime_type: 'video/mp4', size_bytes: 2048, variant_id: null })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('confirm keeps moderation_status PENDING on a clean (mock) scan and opens exactly one moderation_cases row, even if confirmed twice', async () => {
      const product = await createProduct(superAdminToken);
      const mediaRes = await request(app.getHttpServer())
        .post(`/v1/catalog/products/${product.id}/media`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ filename: 'photo.png', mime_type: 'image/png', size_bytes: 2048, variant_id: null })
        .expect(201);
      const media = mediaRes.body.data as Record<string, unknown>;

      const confirmRes = await request(app.getHttpServer())
        .post(`/v1/catalog/media/${media.id}/confirm`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);
      expect(confirmRes.body.data.moderation_status).toBe('PENDING');

      await request(app.getHttpServer())
        .post(`/v1/catalog/media/${media.id}/confirm`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      const caseCount = await prisma.moderationCase.count({
        where: { entityType: 'product_media', entityId: media.id as string },
      });
      expect(caseCount).toBe(1);
    });

    it('[Idempotency-Key] two different products\' media-create calls with the same key and an identical body do NOT collide', async () => {
      const productA = await createProduct(superAdminToken, { title: `Media Collision A ${uniqueSlug('a')}` });
      const productB = await createProduct(superAdminToken, { title: `Media Collision B ${uniqueSlug('b')}` });
      const idempotencyKey = `media-create-${Math.random()}`;
      const body = { filename: 'identical.png', mime_type: 'image/png', size_bytes: 2048, variant_id: null };

      const resA = await request(app.getHttpServer())
        .post(`/v1/catalog/products/${productA.id}/media`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);
      const resB = await request(app.getHttpServer())
        .post(`/v1/catalog/products/${productB.id}/media`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);

      expect(resA.body.data.id).not.toBe(resB.body.data.id);

      const mediaA = await prisma.productMedia.findUniqueOrThrow({ where: { id: resA.body.data.id as string } });
      const mediaB = await prisma.productMedia.findUniqueOrThrow({ where: { id: resB.body.data.id as string } });
      expect(mediaA.productId).toBe(productA.id);
      expect(mediaB.productId).toBe(productB.id);
    });
  });
});
