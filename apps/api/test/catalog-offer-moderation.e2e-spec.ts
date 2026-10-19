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
const PHONES_CATEGORY_SLUG = 'electronics-phones';

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
    tax_id: '0098765432',
    legal_name: 'Moderation Test Trading LLC',
    display_name: 'Moderation Test Shop',
    contacts: { phone: '+998901234999', email: 'owner-mod@example.com' },
    ...overrides,
  };
}

describe('Catalog & offer moderation queue (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let superAdminToken: string;
  let supportAgentToken: string;
  let moderatorToken: string;
  let phonesCategoryId: string;
  let colorAttributeId: string;
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

  async function createPendingProduct(): Promise<Record<string, unknown>> {
    const productRes = await request(app.getHttpServer())
      .post('/v1/catalog/products')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ category_id: phonesCategoryId, title: `Moderation Product ${uniqueToken('p')}` })
      .expect(201);
    const product = productRes.body.data as Record<string, unknown>;

    const submitRes = await request(app.getHttpServer())
      .post(`/v1/catalog/products/${product.id}/submit`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    return submitRes.body.data as Record<string, unknown>;
  }

  async function createPendingVariant(): Promise<{
    product: Record<string, unknown>;
    variant: Record<string, unknown>;
  }> {
    const productRes = await request(app.getHttpServer())
      .post('/v1/catalog/products')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ category_id: phonesCategoryId, title: `Moderation Product ${uniqueToken('p')}` })
      .expect(201);
    const product = productRes.body.data as Record<string, unknown>;

    const variantRes = await request(app.getHttpServer())
      .post(`/v1/catalog/products/${product.id}/variants`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        options: { size: 'L', color: 'red' },
        attribute_values: [{ category_attribute_id: colorAttributeId, value: 'red' }],
      })
      .expect(201);
    const variant = variantRes.body.data as Record<string, unknown>;

    const submitRes = await request(app.getHttpServer())
      .post(`/v1/catalog/variants/${variant.id}/submit`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200);
    return { product, variant: submitRes.body.data as Record<string, unknown> };
  }

  async function createPendingMedia(): Promise<Record<string, unknown>> {
    const productRes = await request(app.getHttpServer())
      .post('/v1/catalog/products')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ category_id: phonesCategoryId, title: `Moderation Product ${uniqueToken('p')}` })
      .expect(201);
    const product = productRes.body.data as Record<string, unknown>;

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
    return confirmRes.body.data as Record<string, unknown>;
  }

  async function createPublishedVariantId(): Promise<string> {
    const productRes = await request(app.getHttpServer())
      .post('/v1/catalog/products')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ category_id: phonesCategoryId, title: `Offer Fixture Product ${uniqueToken('p')}` })
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
    return variant.id as string;
  }

  async function createActiveSeller(): Promise<{ sellerId: string; ownerToken: string }> {
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

    return { sellerId: created.seller_id as string, ownerToken: applicant.accessToken };
  }

  async function createPendingOffer(): Promise<Record<string, unknown>> {
    const { sellerId, ownerToken } = await createActiveSeller();
    const variantId = await createPublishedVariantId();

    const offerRes = await request(app.getHttpServer())
      .post('/v1/seller/offers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', uniqueToken('idem'))
      .send({
        seller_id: sellerId,
        variant_id: variantId,
        seller_sku: uniqueToken('SKU'),
        price_minor: '4500000',
        currency: 'UZS',
        fulfillment_mode: 'SELLER_WAREHOUSE',
      })
      .expect(201);
    const offer = offerRes.body.data as Record<string, unknown>;

    const submitRes = await request(app.getHttpServer())
      .post(`/v1/seller/offers/${offer.id}/submit`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    return submitRes.body.data as Record<string, unknown>;
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
    const supportAgent = await login(SUPPORT_AGENT_PHONE);
    supportAgentToken = supportAgent.accessToken;
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

  describe('GET /v1/admin/catalog/moderation-queue', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/catalog/moderation-queue')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 403 FORBIDDEN for a SUPPORT_AGENT (neither catalog:moderate nor offers:moderate)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/catalog/moderation-queue')
        .set('Authorization', `Bearer ${supportAgentToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('a MODERATOR (offers:moderate/catalog:moderate) sees an OPEN product case and never a RESOLVED one', async () => {
      const product = await createPendingProduct();

      const res = await request(app.getHttpServer())
        .get('/v1/admin/catalog/moderation-queue?entity_type=product&limit=100')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);
      const items = res.body.data.items as Array<Record<string, unknown>>;
      expect(items.some((i) => i.entity_id === product.id)).toBe(true);

      await request(app.getHttpServer())
        .post(`/v1/admin/catalog/products/${product.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: product.version })
        .expect(200);

      const afterRes = await request(app.getHttpServer())
        .get('/v1/admin/catalog/moderation-queue?entity_type=product&limit=100')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);
      const afterItems = afterRes.body.data.items as Array<Record<string, unknown>>;
      expect(afterItems.some((i) => i.entity_id === product.id)).toBe(false);
    });
  });

  describe('POST /v1/admin/catalog/products/:id/approve|needs-changes|reject', () => {
    it('returns 403 FORBIDDEN for a SUPPORT_AGENT', async () => {
      const product = await createPendingProduct();
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/products/${product.id}/approve`)
        .set('Authorization', `Bearer ${supportAgentToken}`)
        .send({ version: product.version })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('approve: PENDING_REVIEW -> PUBLISHED, resolves the moderation_cases row, writes an immutable moderation_decisions row and an audit_logs row', async () => {
      const product = await createPendingProduct();

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/products/${product.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: product.version })
        .expect(200);
      expect(res.body.data.status).toBe('PUBLISHED');

      const moderationCase = await prisma.moderationCase.findFirst({
        where: { entityType: 'product', entityId: product.id as string },
      });
      expect(moderationCase?.status).toBe('RESOLVED');
      expect(moderationCase?.resolvedAt).not.toBeNull();

      const decision = await prisma.moderationDecision.findFirst({
        where: { entityType: 'product', entityId: product.id as string },
      });
      expect(decision?.outcome).toBe('PUBLISHED');
      expect(decision?.reason).toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'product', entityId: product.id as string, action: 'product.moderation_decided' },
      });
      expect(audit).not.toBeNull();
    });

    it('needs-changes: PENDING_REVIEW -> CHANGES_REQUESTED with a required reason, readable back via moderation_decisions', async () => {
      const product = await createPendingProduct();
      const reason = 'Please add more photos.';

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/products/${product.id}/needs-changes`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: product.version, reason })
        .expect(200);
      expect(res.body.data.status).toBe('CHANGES_REQUESTED');

      // Not asserted via the public product GET: a CHANGES_REQUESTED
      // product is not PUBLISHED, so that endpoint correctly 404s on it
      // (info-disclosure fix — a non-published product's moderation
      // reason must never be readable through the public detail route).
      const decision = await prisma.moderationDecision.findFirst({
        where: { entityType: 'product', entityId: product.id as string, outcome: 'CHANGES_REQUESTED' },
      });
      expect(decision?.reason).toBe(reason);

      const detailRes = await request(app.getHttpServer())
        .get(`/v1/catalog/products/${product.id}`)
        .expect(404);
      expect(detailRes.body.error.code).toBe('NOT_FOUND');
    });

    it('needs-changes/reject reject an empty reason with 422 VALIDATION_ERROR, and the product status is unchanged', async () => {
      const product = await createPendingProduct();
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/products/${product.id}/reject`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: product.version, reason: '' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: product.id as string } });
      expect(unchanged.status).toBe('PENDING_REVIEW');
    });

    it('returns 409 INVALID_STATE_TRANSITION with a stale version (queue-fetch read version N, a concurrent edit bumped it), and products.status is unchanged', async () => {
      const product = await createPendingProduct();
      // Simulates "a concurrent edit has since bumped it" (api-contract-g2.md's
      // own given/when/then) — a direct version bump with status left
      // PENDING_REVIEW, so only the version-mismatch half of the CAS guard
      // is exercised, not the status-guard half.
      await prisma.product.update({
        where: { id: product.id as string },
        data: { version: { increment: 1 } },
      });

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/products/${product.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: product.version })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');

      const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: product.id as string } });
      expect(unchanged.status).toBe('PENDING_REVIEW');
    });

    it('returns 409 INVALID_STATE_TRANSITION attempting to approve a product that never passed through PENDING_REVIEW (no bypass to PUBLISHED)', async () => {
      const productRes = await request(app.getHttpServer())
        .post('/v1/catalog/products')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ category_id: phonesCategoryId, title: `Draft Product ${uniqueToken('p')}` })
        .expect(201);
      const product = productRes.body.data as Record<string, unknown>;

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/products/${product.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: product.version })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');

      const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: product.id as string } });
      expect(unchanged.status).toBe('DRAFT');
    });

    it('[Idempotency-Key] a repeat approve call with the same key replays the original response, no double-decision', async () => {
      const product = await createPendingProduct();
      const idempotencyKey = uniqueToken('idem');
      const body = { version: product.version };

      const first = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/products/${product.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(200);
      const second = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/products/${product.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(200);

      expect(second.body.data.status).toBe(first.body.data.status);
      const decisionCount = await prisma.moderationDecision.count({
        where: { entityType: 'product', entityId: product.id as string },
      });
      expect(decisionCount).toBe(1);
    });
  });

  describe('POST /v1/admin/catalog/variants/:id/approve|needs-changes|reject', () => {
    it('approve: PENDING_REVIEW -> PUBLISHED, resolves the moderation_cases row', async () => {
      const { variant } = await createPendingVariant();

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/variants/${variant.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: variant.version })
        .expect(200);
      expect(res.body.data.status).toBe('PUBLISHED');

      const moderationCase = await prisma.moderationCase.findFirst({
        where: { entityType: 'product_variant', entityId: variant.id as string },
      });
      expect(moderationCase?.status).toBe('RESOLVED');
    });

    it('reject: PENDING_REVIEW -> REJECTED with a required reason', async () => {
      const { variant } = await createPendingVariant();
      const reason = 'Duplicate of an existing SKU.';

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/variants/${variant.id}/reject`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: variant.version, reason })
        .expect(200);
      expect(res.body.data.status).toBe('REJECTED');

      const decision = await prisma.moderationDecision.findFirst({
        where: { entityType: 'product_variant', entityId: variant.id as string },
      });
      expect(decision?.reason).toBe(reason);
    });

    it('returns 403 FORBIDDEN for a non-admin caller', async () => {
      const { variant } = await createPendingVariant();
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/variants/${variant.id}/approve`)
        .set('Authorization', `Bearer ${supportAgentToken}`)
        .send({ version: variant.version })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /v1/admin/catalog/media/:id/approve|reject', () => {
    it('approve: PENDING -> APPROVED, resolves the moderation_cases row', async () => {
      const media = await createPendingMedia();

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/media/${media.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: media.version })
        .expect(200);
      expect(res.body.data.moderation_status).toBe('APPROVED');

      const moderationCase = await prisma.moderationCase.findFirst({
        where: { entityType: 'product_media', entityId: media.id as string },
      });
      expect(moderationCase?.status).toBe('RESOLVED');
    });

    it('reject requires a non-empty reason (422 otherwise)', async () => {
      const media = await createPendingMedia();
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/media/${media.id}/reject`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: media.version })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('reject: PENDING -> REJECTED with a reason', async () => {
      const media = await createPendingMedia();
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/media/${media.id}/reject`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: media.version, reason: 'Low quality photo.' })
        .expect(200);
      expect(res.body.data.moderation_status).toBe('REJECTED');
    });
  });

  describe('POST /v1/admin/offers/moderation/:id/approve|deactivate|reject', () => {
    it('returns 403 FORBIDDEN for a caller with only catalog:moderate-adjacent access (SUPPORT_AGENT has neither)', async () => {
      const offer = await createPendingOffer();
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/offers/moderation/${offer.id}/approve`)
        .set('Authorization', `Bearer ${supportAgentToken}`)
        .send({ version: offer.version })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('approve: PENDING_REVIEW -> ACTIVE, resolves moderation_cases, writes moderation_decisions + a separate audit_logs row from the price-change audit path', async () => {
      const offer = await createPendingOffer();

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/offers/moderation/${offer.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: offer.version })
        .expect(200);
      expect(res.body.data.status).toBe('ACTIVE');

      const moderationCase = await prisma.moderationCase.findFirst({
        where: { entityType: 'offer', entityId: offer.id as string },
      });
      expect(moderationCase?.status).toBe('RESOLVED');

      const decision = await prisma.moderationDecision.findFirst({
        where: { entityType: 'offer', entityId: offer.id as string },
      });
      expect(decision?.outcome).toBe('ACTIVE');

      // The ticket's own audit cross-check: this moderation-decision audit
      // row is separate from (not a replacement for) the one T-G2-5's
      // price-change path already writes at offer creation.
      const moderationAudit = await prisma.auditLog.findFirst({
        where: { entityType: 'seller_offer', entityId: offer.id as string, action: 'seller_offer.moderation_decided' },
      });
      expect(moderationAudit).not.toBeNull();
      const creationAudit = await prisma.auditLog.findFirst({
        where: { entityType: 'seller_offer', entityId: offer.id as string, action: 'seller_offer.created' },
      });
      expect(creationAudit).not.toBeNull();
      expect(moderationAudit?.id).not.toBe(creationAudit?.id);
    });

    it('deactivate: PENDING_REVIEW -> INACTIVE with a required reason', async () => {
      const offer = await createPendingOffer();
      const reason = 'Needs clearer fulfillment terms.';

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/offers/moderation/${offer.id}/deactivate`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: offer.version, reason })
        .expect(200);
      expect(res.body.data.status).toBe('INACTIVE');
    });

    it('reject: PENDING_REVIEW -> REJECTED with a required reason', async () => {
      const offer = await createPendingOffer();
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/offers/moderation/${offer.id}/reject`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: offer.version, reason: 'Prohibited item.' })
        .expect(200);
      expect(res.body.data.status).toBe('REJECTED');
    });

    it('returns 409 INVALID_STATE_TRANSITION attempting to approve an offer that never passed through PENDING_REVIEW (no bypass to ACTIVE)', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const variantId = await createPublishedVariantId();
      const offerRes = await request(app.getHttpServer())
        .post('/v1/seller/offers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('Idempotency-Key', uniqueToken('idem'))
        .send({
          seller_id: sellerId,
          variant_id: variantId,
          seller_sku: uniqueToken('SKU'),
          price_minor: '4500000',
          currency: 'UZS',
          fulfillment_mode: 'SELLER_WAREHOUSE',
        })
        .expect(201);
      const offer = offerRes.body.data as Record<string, unknown>;

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/offers/moderation/${offer.id}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: offer.version })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');

      const unchanged = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id as string } });
      expect(unchanged.status).toBe('DRAFT');
    });
  });
});
