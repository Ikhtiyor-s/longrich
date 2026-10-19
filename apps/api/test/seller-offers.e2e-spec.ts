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
    legal_name: 'Offers Test Trading LLC',
    display_name: 'Offers Test Shop',
    contacts: { phone: '+998901234567', email: 'owner@example.com' },
    ...overrides,
  };
}

describe('Seller offers CRUD + price history (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let superAdminToken: string;
  let moderatorToken: string;
  let phonesCategoryId: string;
  // Shared across every test that only needs "some PUBLISHED variant to
  // attach an offer to" (the vast majority of this file's cases) — created
  // once in beforeAll, not per-test. Earlier revisions created a fresh
  // product+variant pair per test (~25+ products), which pollutes the
  // shared dev Postgres instance's `products` table enough to push
  // catalog-products.e2e-spec.ts's own default-first-page assertion (no
  // cursor, default limit=20, ordered by created_at ASC) off the page —
  // a real cross-file regression, not a flake. Only the public
  // "GET /v1/catalog/variants/:id/offers" test below still creates its own
  // isolated variant, since it specifically asserts which offers are/aren't
  // visible for one exact variant_id.
  let sharedVariantId: string;
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

  // Builds an ACTIVE seller end-to-end through the real
  // application->approve->activate flow (same helper shape
  // seller-lifecycle-moderation-suspension.e2e-spec.ts already
  // established), returning the OWNER's own token/id alongside the
  // seller_id so tests can exercise the OWNER-authored offer-management
  // paths directly.
  async function createActiveSeller(): Promise<{
    sellerId: string;
    ownerToken: string;
    ownerId: string;
  }> {
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

  // Creates a PUBLISHED product/variant pair via the real T-G2-3 endpoints,
  // then flips both rows directly to PUBLISHED (same "direct DB write to
  // reach a status no T-G2-7 decision endpoint exists yet to grant" fixture
  // precedent catalog-products.e2e-spec.ts already uses for the exact same
  // reason — moderation decision endpoints are T-G2-7, out of this
  // ticket's scope and not yet implemented).
  async function createPublishedVariant(): Promise<string> {
    const productRes = await request(app.getHttpServer())
      .post('/v1/catalog/products')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ category_id: phonesCategoryId, title: `Offer Test Product ${uniqueToken('p')}` })
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

  async function createOffer(
    ownerToken: string,
    sellerId: string,
    variantId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const res = await request(app.getHttpServer())
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
        ...overrides,
      })
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
    sharedVariantId = await createPublishedVariant();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/seller/offers', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer()).post('/v1/seller/offers').send({}).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 422 VALIDATION_ERROR with details.idempotency_key when Idempotency-Key is missing', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const variantId = sharedVariantId;

      const res = await request(app.getHttpServer())
        .post('/v1/seller/offers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          seller_id: sellerId,
          variant_id: variantId,
          seller_sku: uniqueToken('SKU'),
          price_minor: '4500000',
          currency: 'UZS',
          fulfillment_mode: 'SELLER_WAREHOUSE',
        })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.idempotency_key).toBeDefined();
    });

    it('returns 403 FORBIDDEN when the caller is not a member of seller_id', async () => {
      const { sellerId } = await createActiveSeller();
      const variantId = sharedVariantId;
      const stranger = await loginNewApplicant();

      const res = await request(app.getHttpServer())
        .post('/v1/seller/offers')
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .set('Idempotency-Key', uniqueToken('idem'))
        .send({
          seller_id: sellerId,
          variant_id: variantId,
          seller_sku: uniqueToken('SKU'),
          price_minor: '4500000',
          currency: 'UZS',
          fulfillment_mode: 'SELLER_WAREHOUSE',
        })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 403 FORBIDDEN while the owning seller is not ACTIVE ("seller cannot publish while non-ACTIVE")', async () => {
      const applicant = await loginNewApplicant();
      const appRes = await request(app.getHttpServer())
        .post('/v1/seller-applications')
        .set('Authorization', `Bearer ${applicant.accessToken}`)
        .send(validSellerApplicationBody())
        .expect(201);
      const created = appRes.body.data as Record<string, unknown>;
      const variantId = sharedVariantId;

      const res = await request(app.getHttpServer())
        .post('/v1/seller/offers')
        .set('Authorization', `Bearer ${applicant.accessToken}`)
        .set('Idempotency-Key', uniqueToken('idem'))
        .send({
          seller_id: created.seller_id,
          variant_id: variantId,
          seller_sku: uniqueToken('SKU'),
          price_minor: '4500000',
          currency: 'UZS',
          fulfillment_mode: 'SELLER_WAREHOUSE',
        })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 NOT_FOUND when variant_id does not resolve to a PUBLISHED variant', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();

      const res = await request(app.getHttpServer())
        .post('/v1/seller/offers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('Idempotency-Key', uniqueToken('idem'))
        .send({
          seller_id: sellerId,
          variant_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          seller_sku: uniqueToken('SKU'),
          price_minor: '4500000',
          currency: 'UZS',
          fulfillment_mode: 'SELLER_WAREHOUSE',
        })
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it.each(['0', '-5', 'abc', '5.5'])(
      'rejects a non-positive/non-numeric price_minor (%p) with 422 VALIDATION_ERROR',
      async (badPrice) => {
        const { sellerId, ownerToken } = await createActiveSeller();
        const variantId = sharedVariantId;

        const res = await request(app.getHttpServer())
          .post('/v1/seller/offers')
          .set('Authorization', `Bearer ${ownerToken}`)
          .set('Idempotency-Key', uniqueToken('idem'))
          .send({
            seller_id: sellerId,
            variant_id: variantId,
            seller_sku: uniqueToken('SKU'),
            price_minor: badPrice,
            currency: 'UZS',
            fulfillment_mode: 'SELLER_WAREHOUSE',
          })
          .expect(422);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      },
    );

    it('creates a DRAFT offer, writes exactly one offer_price_history row (old=null), and never clones products/product_variants rows', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const variantId = sharedVariantId;

      const productCountBefore = await prisma.product.count();
      const variantCountBefore = await prisma.productVariant.count();

      const offer = await createOffer(ownerToken, sellerId, variantId);

      expect(offer.status).toBe('DRAFT');
      expect(offer.price_minor).toBe('4500000');
      expect(typeof offer.price_minor).toBe('string');
      expect(offer.version).toBe(1);

      const productCountAfter = await prisma.product.count();
      const variantCountAfter = await prisma.productVariant.count();
      expect(productCountAfter).toBe(productCountBefore);
      expect(variantCountAfter).toBe(variantCountBefore);

      const history = await prisma.offerPriceHistory.findMany({
        where: { offerId: offer.id as string },
      });
      expect(history).toHaveLength(1);
      expect(history[0]?.oldPriceMinor).toBeNull();
      expect(history[0]?.newPriceMinor.toString()).toBe('4500000');
    });

    it('rejects a duplicate seller_sku for the SAME seller with 422 and details.seller_sku, but allows two different sellers to reuse the same sku', async () => {
      const sellerA = await createActiveSeller();
      const sellerB = await createActiveSeller();
      const variantId = sharedVariantId;
      const sku = uniqueToken('SKU');

      await createOffer(sellerA.ownerToken, sellerA.sellerId, variantId, { seller_sku: sku });

      const dupRes = await request(app.getHttpServer())
        .post('/v1/seller/offers')
        .set('Authorization', `Bearer ${sellerA.ownerToken}`)
        .set('Idempotency-Key', uniqueToken('idem'))
        .send({
          seller_id: sellerA.sellerId,
          variant_id: variantId,
          seller_sku: sku,
          price_minor: '4500000',
          currency: 'UZS',
          fulfillment_mode: 'SELLER_WAREHOUSE',
        })
        .expect(422);
      expect(dupRes.body.error.code).toBe('VALIDATION_ERROR');
      expect(dupRes.body.error.details.seller_sku).toBeDefined();

      const otherSellerOffer = await createOffer(sellerB.ownerToken, sellerB.sellerId, variantId, {
        seller_sku: sku,
      });
      expect(otherSellerOffer.seller_sku).toBe(sku);
    });

    it('[Idempotency-Key] a repeat create call with the same key replays the original response, no second offer created', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const variantId = sharedVariantId;
      const idempotencyKey = uniqueToken('idem');
      const sku = uniqueToken('SKU');
      const body = {
        seller_id: sellerId,
        variant_id: variantId,
        seller_sku: sku,
        price_minor: '4500000',
        currency: 'UZS',
        fulfillment_mode: 'SELLER_WAREHOUSE',
      };

      const first = await request(app.getHttpServer())
        .post('/v1/seller/offers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/v1/seller/offers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);

      expect(second.body.data.id).toBe(first.body.data.id);
      const count = await prisma.sellerOffer.count({ where: { sellerId, sku } });
      expect(count).toBe(1);
    });
  });

  describe('GET /v1/seller/offers/:id and GET /v1/seller/offers?seller_id=', () => {
    it('returns 403 FORBIDDEN when a different seller tries to read this offer', async () => {
      const sellerA = await createActiveSeller();
      const sellerB = await createActiveSeller();
      const variantId = sharedVariantId;
      const offer = await createOffer(sellerA.ownerToken, sellerA.sellerId, variantId);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/offers/${offer.id}`)
        .set('Authorization', `Bearer ${sellerB.ownerToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns the offer to its own seller OWNER', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const variantId = sharedVariantId;
      const offer = await createOffer(ownerToken, sellerId, variantId);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/offers/${offer.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(offer.id);
    });

    it('list requires a seller_id query parameter (422 when missing)', async () => {
      const { ownerToken } = await createActiveSeller();
      const res = await request(app.getHttpServer())
        .get('/v1/seller/offers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('list returns only this seller\'s own offers', async () => {
      const sellerA = await createActiveSeller();
      const sellerB = await createActiveSeller();
      const variantId = sharedVariantId;
      await createOffer(sellerA.ownerToken, sellerA.sellerId, variantId);
      await createOffer(sellerB.ownerToken, sellerB.sellerId, variantId);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/offers?seller_id=${sellerA.sellerId}`)
        .set('Authorization', `Bearer ${sellerA.ownerToken}`)
        .expect(200);
      const items = res.body.data.items as Array<Record<string, unknown>>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.seller_id === sellerA.sellerId)).toBe(true);
    });
  });

  describe('PATCH /v1/seller/offers/:id', () => {
    it('returns 403 FORBIDDEN when a different seller tries to PATCH this offer', async () => {
      const sellerA = await createActiveSeller();
      const sellerB = await createActiveSeller();
      const variantId = sharedVariantId;
      const offer = await createOffer(sellerA.ownerToken, sellerA.sellerId, variantId);

      const res = await request(app.getHttpServer())
        .patch(`/v1/seller/offers/${offer.id}`)
        .set('Authorization', `Bearer ${sellerB.ownerToken}`)
        .send({ version: 1, price_minor: '5000000' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('updates price via compare-and-swap on version', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const variantId = sharedVariantId;
      const offer = await createOffer(ownerToken, sellerId, variantId);

      const res = await request(app.getHttpServer())
        .patch(`/v1/seller/offers/${offer.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ version: 1, price_minor: '5000000' })
        .expect(200);
      expect(res.body.data.price_minor).toBe('5000000');
      expect(res.body.data.version).toBe(2);
    });

    it('returns 409 INVALID_STATE_TRANSITION on a stale version', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const variantId = sharedVariantId;
      const offer = await createOffer(ownerToken, sellerId, variantId);

      const res = await request(app.getHttpServer())
        .patch(`/v1/seller/offers/${offer.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ version: 99, price_minor: '5000000' })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('three price changes write three immutable offer_price_history rows, and offer.price_minor reflects only the latest value', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const variantId = sharedVariantId;
      const offer = await createOffer(ownerToken, sellerId, variantId);

      await request(app.getHttpServer())
        .patch(`/v1/seller/offers/${offer.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ version: 1, price_minor: '5000000' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/v1/seller/offers/${offer.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ version: 2, price_minor: '5500000' })
        .expect(200);
      const third = await request(app.getHttpServer())
        .patch(`/v1/seller/offers/${offer.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ version: 3, price_minor: '6000000' })
        .expect(200);

      expect(third.body.data.price_minor).toBe('6000000');

      const history = await prisma.offerPriceHistory.findMany({
        where: { offerId: offer.id as string },
        orderBy: { changedAt: 'asc' },
      });
      // 1 row from create + 3 rows from the three PATCHes above = 4 total,
      // every row immutable (append-only — none were ever updated in place).
      expect(history).toHaveLength(4);
      expect(history.map((h) => h.newPriceMinor.toString())).toEqual([
        '4500000',
        '5000000',
        '5500000',
        '6000000',
      ]);
    });

    it('[CONCURRENCY] two simultaneous PATCHes racing on the same version: exactly one succeeds (200), the other gets 409', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const variantId = sharedVariantId;
      const offer = await createOffer(ownerToken, sellerId, variantId);

      const [firstRes, secondRes] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/v1/seller/offers/${offer.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ version: 1, price_minor: '5000000' }),
        request(app.getHttpServer())
          .patch(`/v1/seller/offers/${offer.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ version: 1, price_minor: '7000000' }),
      ]);

      const statuses = [firstRes.status, secondRes.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);
      const loser = firstRes.status === 200 ? secondRes : firstRes;
      expect(loser.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it.each([
      ['ACTIVE', 'INACTIVE'],
      ['ACTIVE', 'SUSPENDED'],
      ['INACTIVE', 'SUSPENDED'],
      ['SUSPENDED', 'INACTIVE'],
    ])(
      'allows the self-service status toggle %s -> %s',
      async (from, to) => {
        const { sellerId, ownerToken } = await createActiveSeller();
        const variantId = sharedVariantId;
        const offer = await createOffer(ownerToken, sellerId, variantId);
        await prisma.sellerOffer.update({
          where: { id: offer.id as string },
          data: { status: from as never },
        });

        const res = await request(app.getHttpServer())
          .patch(`/v1/seller/offers/${offer.id}`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ version: 1, status: to })
          .expect(200);
        expect(res.body.data.status).toBe(to);
      },
    );

    it('rejects a disallowed status value (e.g. DRAFT) via this field with 409 INVALID_STATE_TRANSITION', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const variantId = sharedVariantId;
      const offer = await createOffer(ownerToken, sellerId, variantId);
      await prisma.sellerOffer.update({ where: { id: offer.id as string }, data: { status: 'ACTIVE' } });

      const res = await request(app.getHttpServer())
        .patch(`/v1/seller/offers/${offer.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ version: 1, status: 'DRAFT' })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('allows a price edit while the offer is ACTIVE (no re-moderation on price-only edits)', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const variantId = sharedVariantId;
      const offer = await createOffer(ownerToken, sellerId, variantId);
      await prisma.sellerOffer.update({ where: { id: offer.id as string }, data: { status: 'ACTIVE' } });

      const res = await request(app.getHttpServer())
        .patch(`/v1/seller/offers/${offer.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ version: 1, price_minor: '9999999' })
        .expect(200);
      expect(res.body.data.status).toBe('ACTIVE');
      expect(res.body.data.price_minor).toBe('9999999');
    });

    it('returns 409 INVALID_STATE_TRANSITION when attempting to edit a REJECTED (terminal) offer', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const variantId = sharedVariantId;
      const offer = await createOffer(ownerToken, sellerId, variantId);
      await prisma.sellerOffer.update({ where: { id: offer.id as string }, data: { status: 'REJECTED' } });

      const res = await request(app.getHttpServer())
        .patch(`/v1/seller/offers/${offer.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ version: 1, price_minor: '5000000' })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });
  });

  describe('POST /v1/seller/offers/:id/submit', () => {
    it('transitions DRAFT -> PENDING_REVIEW and opens a moderation_cases row (entity_type=offer)', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const variantId = sharedVariantId;
      const offer = await createOffer(ownerToken, sellerId, variantId);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller/offers/${offer.id}/submit`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.data.status).toBe('PENDING_REVIEW');

      const moderationCase = await prisma.moderationCase.findFirst({
        where: { entityType: 'offer', entityId: offer.id as string },
      });
      expect(moderationCase).not.toBeNull();
      expect(moderationCase?.status).toBe('OPEN');
    });

    it('returns 409 INVALID_STATE_TRANSITION on a second submit (already PENDING_REVIEW)', async () => {
      const { sellerId, ownerToken } = await createActiveSeller();
      const variantId = sharedVariantId;
      const offer = await createOffer(ownerToken, sellerId, variantId);

      await request(app.getHttpServer())
        .post(`/v1/seller/offers/${offer.id}/submit`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/v1/seller/offers/${offer.id}/submit`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });
  });

  describe('GET /v1/catalog/variants/:id/offers (public)', () => {
    it('returns only offers whose own status=ACTIVE AND whose owning seller is ACTIVE; DRAFT offers and SUSPENDED-seller offers are hidden', async () => {
      const activeSeller = await createActiveSeller();
      const suspendedSeller = await createActiveSeller();
      const variantId = await createPublishedVariant();

      const draftOffer = await createOffer(activeSeller.ownerToken, activeSeller.sellerId, variantId);
      const activeOffer = await createOffer(activeSeller.ownerToken, activeSeller.sellerId, variantId);
      await prisma.sellerOffer.update({
        where: { id: activeOffer.id as string },
        data: { status: 'ACTIVE' },
      });

      const suspendedSellerOffer = await createOffer(
        suspendedSeller.ownerToken,
        suspendedSeller.sellerId,
        variantId,
      );
      await prisma.sellerOffer.update({
        where: { id: suspendedSellerOffer.id as string },
        data: { status: 'ACTIVE' },
      });
      await prisma.seller.update({
        where: { id: suspendedSeller.sellerId },
        data: { status: 'SUSPENDED' },
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/catalog/variants/${variantId}/offers`)
        .expect(200);
      const items = res.body.data.items as Array<Record<string, unknown>>;
      const ids = items.map((i) => i.id);

      expect(ids).toContain(activeOffer.id);
      expect(ids).not.toContain(draftOffer.id);
      expect(ids).not.toContain(suspendedSellerOffer.id);

      const activeItem = items.find((i) => i.id === activeOffer.id) as Record<string, unknown>;
      expect(activeItem).toEqual({
        id: activeOffer.id,
        seller_id: activeSeller.sellerId,
        seller_sku: activeOffer.seller_sku,
        price_minor: activeOffer.price_minor,
        currency: 'UZS',
        fulfillment_mode: 'SELLER_WAREHOUSE',
      });
    });
  });
});
