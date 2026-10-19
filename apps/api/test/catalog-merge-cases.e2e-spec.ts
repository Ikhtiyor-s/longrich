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

function validSellerApplicationBody(overrides: Record<string, unknown> = {}) {
  return {
    legal_type: 'LLC',
    tax_id: '0099887766',
    legal_name: 'Merge Case Test Trading LLC',
    display_name: 'Merge Case Test Shop',
    contacts: { phone: '+998901234999', email: 'owner@example.com' },
    ...overrides,
  };
}

describe('Catalog GTIN duplicate merge-case review (e2e)', () => {
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

  // Same end-to-end application->approve->activate flow
  // seller-offers.e2e-spec.ts already established.
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

  async function createProduct(title: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/catalog/products')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ category_id: phonesCategoryId, title })
      .expect(201);
    return (res.body.data as Record<string, unknown>).id as string;
  }

  async function createVariant(productId: string, options: Record<string, unknown>): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/v1/catalog/products/${productId}/variants`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ options })
      .expect(201);
    return (res.body.data as Record<string, unknown>).id as string;
  }

  async function publishVariant(productId: string, variantId: string): Promise<void> {
    await prisma.product.update({ where: { id: productId }, data: { status: 'PUBLISHED' } });
    await prisma.productVariant.update({ where: { id: variantId }, data: { status: 'PUBLISHED' } });
  }

  async function attachIdentifier(variantId: string, value: string): Promise<Record<string, unknown>> {
    const res = await request(app.getHttpServer())
      .post(`/v1/catalog/variants/${variantId}/identifiers`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ type: 'GTIN', value });
    return res.body.data as Record<string, unknown>;
  }

  async function createOffer(
    ownerToken: string,
    sellerId: string,
    variantId: string,
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
      })
      .expect(201);
    return res.body.data as Record<string, unknown>;
  }

  // Builds a PENDING merge case via the real T-G2-4 conflict path: product A
  // is created first (tie-break winner), product B second (loser). Each
  // product gets `variantOptionsList.length` variants, matched pairwise by
  // index — callers that want an "unmatched" variant simply give B one
  // extra options entry A doesn't have.
  async function buildConflict(
    variantOptionsA: Array<Record<string, unknown>>,
    variantOptionsB: Array<Record<string, unknown>>,
  ): Promise<{
    productAId: string;
    productBId: string;
    variantAIds: string[];
    variantBIds: string[];
    mergeCaseId: string;
  }> {
    const productAId = await createProduct(`Merge Test A ${uniqueToken('a')}`);
    const variantAIds = await Promise.all(variantOptionsA.map((o) => createVariant(productAId, o)));

    const productBId = await createProduct(`Merge Test B ${uniqueToken('b')}`);
    const variantBIds = await Promise.all(variantOptionsB.map((o) => createVariant(productBId, o)));

    const sharedGtin = uniqueValidGtin();
    await attachIdentifier(variantAIds[0] as string, sharedGtin).then((r) =>
      expect(r.status).not.toBe('CONFLICT_DETECTED'),
    );
    const conflict = await attachIdentifier(variantBIds[0] as string, sharedGtin);
    expect(conflict.status).toBe('CONFLICT_DETECTED');

    return {
      productAId,
      productBId,
      variantAIds: variantAIds as string[],
      variantBIds: variantBIds as string[],
      mergeCaseId: conflict.merge_case_id as string,
    };
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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('auth', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header on every route', async () => {
      await request(app.getHttpServer()).get('/v1/admin/catalog/merge-proposals').expect(401);
      await request(app.getHttpServer())
        .get('/v1/admin/catalog/merge-proposals/00000000-0000-0000-0000-000000000000')
        .expect(401);
      await request(app.getHttpServer())
        .post('/v1/admin/catalog/merge-proposals/00000000-0000-0000-0000-000000000000/approve')
        .expect(401);
      await request(app.getHttpServer())
        .post('/v1/admin/catalog/merge-proposals/00000000-0000-0000-0000-000000000000/reject')
        .send({ reason: 'x' })
        .expect(401);
    });

    it('returns 403 FORBIDDEN for a caller with neither category:manage nor merge_case:approve (MODERATOR)', async () => {
      const { mergeCaseId } = await buildConflict([{ sku: uniqueToken('opt') }], [{ sku: uniqueToken('opt') }]);

      const listRes = await request(app.getHttpServer())
        .get('/v1/admin/catalog/merge-proposals')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(403);
      expect(listRes.body.error.code).toBe('FORBIDDEN');

      const detailRes = await request(app.getHttpServer())
        .get(`/v1/admin/catalog/merge-proposals/${mergeCaseId}`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(403);
      expect(detailRes.body.error.code).toBe('FORBIDDEN');

      const approveRes = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/merge-proposals/${mergeCaseId}/approve`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(403);
      expect(approveRes.body.error.code).toBe('FORBIDDEN');

      const rejectRes = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/merge-proposals/${mergeCaseId}/reject`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ reason: 'Not the same product.' })
        .expect(403);
      expect(rejectRes.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /v1/admin/catalog/merge-proposals', () => {
    it('defaults to status=PENDING and includes a freshly detected conflict', async () => {
      const { mergeCaseId, productAId, productBId } = await buildConflict(
        [{ sku: uniqueToken('opt') }],
        [{ sku: uniqueToken('opt') }],
      );

      const res = await request(app.getHttpServer())
        .get('/v1/admin/catalog/merge-proposals?limit=100')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      const items = res.body.data.items as Array<Record<string, unknown>>;
      const found = items.find((i) => i.id === mergeCaseId);
      expect(found).toBeDefined();
      expect(found?.status).toBe('PENDING');
      expect([productAId, productBId]).toContain(found?.winning_product_id);
      expect([productAId, productBId]).toContain(found?.losing_product_id);
    });

    it('returns 404 NOT_FOUND for an unknown merge-case id', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/catalog/merge-proposals/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /v1/admin/catalog/merge-proposals/:id/approve — clean 1:1 match', () => {
    it('redirects canonical_id, repoints the losing variant\'s offers to the matching winning variant, and never deletes the losing rows', async () => {
      const sharedOptions = { sku: uniqueToken('match') };
      const { mergeCaseId, productAId, productBId, variantAIds, variantBIds } = await buildConflict(
        [sharedOptions],
        [sharedOptions],
      );

      await publishVariant(productAId, variantAIds[0] as string);
      await publishVariant(productBId, variantBIds[0] as string);

      const seller = await createActiveSeller();
      const offer = await createOffer(seller.ownerToken, seller.sellerId, variantBIds[0] as string);

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/merge-proposals/${mergeCaseId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.data).toMatchObject({
        id: mergeCaseId,
        status: 'APPROVED',
        manual_resolution_required: false,
        repointed_offer_count: 1,
        unmatched_variant_count: 0,
      });

      const losingProduct = await prisma.product.findUniqueOrThrow({ where: { id: productBId } });
      expect(losingProduct.canonicalId).toBe(productAId);

      const movedOffer = await prisma.sellerOffer.findUniqueOrThrow({ where: { id: offer.id as string } });
      expect(movedOffer.variantId).toBe(variantAIds[0]);

      // Never deleted — still queryable by id (G2-level proof of "merging
      // preserves historical orders," per this ticket's own "Done means").
      const stillThere = await prisma.product.findUnique({ where: { id: productBId } });
      expect(stillThere).not.toBeNull();
      const variantStillThere = await prisma.productVariant.findUnique({
        where: { id: variantBIds[0] as string },
      });
      expect(variantStillThere).not.toBeNull();

      const decision = await prisma.moderationDecision.findFirst({
        where: { entityType: 'product_merge_case', entityId: mergeCaseId, outcome: 'APPROVED' },
      });
      expect(decision).not.toBeNull();
      expect(decision?.reason).toBeNull();
    });
  });

  describe('POST /v1/admin/catalog/merge-proposals/:id/approve — partial match', () => {
    it('repoints only the matched variants\' offers, flags manual_resolution_required, and leaves the unmatched variant\'s offer on the (redirected) losing product unchanged', async () => {
      const matchOptions1 = { sku: uniqueToken('match1') };
      const matchOptions2 = { sku: uniqueToken('match2') };
      const unmatchedOptions = { sku: uniqueToken('nomatch') };

      const { mergeCaseId, productAId, productBId, variantAIds, variantBIds } = await buildConflict(
        [matchOptions1, matchOptions2],
        [matchOptions1, matchOptions2, unmatchedOptions],
      );

      for (let i = 0; i < variantAIds.length; i += 1) {
        await publishVariant(productAId, variantAIds[i] as string);
      }
      for (let i = 0; i < variantBIds.length; i += 1) {
        await publishVariant(productBId, variantBIds[i] as string);
      }

      const seller = await createActiveSeller();
      const offerMatched1 = await createOffer(seller.ownerToken, seller.sellerId, variantBIds[0] as string);
      const offerMatched2 = await createOffer(seller.ownerToken, seller.sellerId, variantBIds[1] as string);
      const offerUnmatched = await createOffer(seller.ownerToken, seller.sellerId, variantBIds[2] as string);

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/merge-proposals/${mergeCaseId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.data).toMatchObject({
        status: 'APPROVED',
        manual_resolution_required: true,
        repointed_offer_count: 2,
        unmatched_variant_count: 1,
      });

      const movedOffer1 = await prisma.sellerOffer.findUniqueOrThrow({
        where: { id: offerMatched1.id as string },
      });
      expect(movedOffer1.variantId).toBe(variantAIds[0]);
      const movedOffer2 = await prisma.sellerOffer.findUniqueOrThrow({
        where: { id: offerMatched2.id as string },
      });
      expect(movedOffer2.variantId).toBe(variantAIds[1]);

      // Unmatched variant's offer stays exactly where it was — never guessed.
      const untouchedOffer = await prisma.sellerOffer.findUniqueOrThrow({
        where: { id: offerUnmatched.id as string },
      });
      expect(untouchedOffer.variantId).toBe(variantBIds[2]);

      const mergeCase = await prisma.productMergeCase.findUniqueOrThrow({ where: { id: mergeCaseId } });
      expect(mergeCase.manualResolutionRequired).toBe(true);
    });
  });

  // A real e2e reproduction of the offer-level (seller_id, sku) collision
  // (MAJOR 1) was attempted here and dropped: `seller_offers` has a single
  // global `(seller_id, sku)` unique constraint (not scoped per-variant,
  // per api-contract-g2.md's own Prisma field reference), so a seller can
  // never have two live offers sharing a sku at all, on any variant,
  // through the real create endpoint OR a direct Prisma insert — the
  // precondition this collision needs is unconstructible against the real
  // schema. The P2002 branch in
  // OffersService.repointVariantOwnership stays defensive/unreachable
  // under the schema as currently frozen; it is exercised at the correct
  // level instead — seller-offers.service.spec.ts's existing P2002
  // simulation, and merge-cases.service.spec.ts's new
  // "unmatched_offer_count" test (both mock the collision directly rather
  // than construct real conflicting rows).

  describe('POST /v1/admin/catalog/merge-proposals/:id/reject', () => {
    it('requires a non-empty reason (422), and a subsequent valid reject sets REJECTED without touching canonical_id', async () => {
      const { mergeCaseId, productBId } = await buildConflict(
        [{ sku: uniqueToken('r') }],
        [{ sku: uniqueToken('r') }],
      );

      const emptyReasonRes = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/merge-proposals/${mergeCaseId}/reject`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: '' })
        .expect(422);
      expect(emptyReasonRes.body.error.code).toBe('VALIDATION_ERROR');

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/merge-proposals/${mergeCaseId}/reject`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Not actually the same product.' })
        .expect(200);
      expect(res.body.data.status).toBe('REJECTED');

      const losingProduct = await prisma.product.findUniqueOrThrow({ where: { id: productBId } });
      expect(losingProduct.canonicalId).toBeNull();

      const decision = await prisma.moderationDecision.findFirst({
        where: { entityType: 'product_merge_case', entityId: mergeCaseId, outcome: 'REJECTED' },
      });
      expect(decision?.reason).toBe('Not actually the same product.');
    });
  });

  describe('decision state guards', () => {
    it('returns 409 INVALID_STATE_TRANSITION when approving an already-decided merge case', async () => {
      const { mergeCaseId } = await buildConflict([{ sku: uniqueToken('s') }], [{ sku: uniqueToken('s') }]);

      await request(app.getHttpServer())
        .post(`/v1/admin/catalog/merge-proposals/${mergeCaseId}/reject`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Already decided once.' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/merge-proposals/${mergeCaseId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('[concurrency] exactly one of two simultaneous decisions on the same PENDING case wins; the loser gets 409 on the version CAS', async () => {
      const { mergeCaseId } = await buildConflict([{ sku: uniqueToken('c') }], [{ sku: uniqueToken('c') }]);

      const [approveRes, rejectRes] = await Promise.all([
        request(app.getHttpServer())
          .post(`/v1/admin/catalog/merge-proposals/${mergeCaseId}/approve`)
          .set('Authorization', `Bearer ${superAdminToken}`),
        request(app.getHttpServer())
          .post(`/v1/admin/catalog/merge-proposals/${mergeCaseId}/reject`)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({ reason: 'Racing the approve call.' }),
      ]);

      const statuses = [approveRes.status, rejectRes.status].sort();
      expect(statuses).toEqual([200, 409]);
    });

    it('[Idempotency-Key] a repeat approve call with the same key replays the original response without a second effect', async () => {
      const sharedOptions = { sku: uniqueToken('idem-match') };
      const { mergeCaseId, productAId, productBId, variantAIds, variantBIds } = await buildConflict(
        [sharedOptions],
        [sharedOptions],
      );
      await publishVariant(productAId, variantAIds[0] as string);
      await publishVariant(productBId, variantBIds[0] as string);
      const seller = await createActiveSeller();
      await createOffer(seller.ownerToken, seller.sellerId, variantBIds[0] as string);

      const idempotencyKey = uniqueToken('merge-approve-idem');
      const first = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/merge-proposals/${mergeCaseId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);
      const second = await request(app.getHttpServer())
        .post(`/v1/admin/catalog/merge-proposals/${mergeCaseId}/approve`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);

      expect(second.body.data).toEqual(first.body.data);
      expect(first.body.data.repointed_offer_count).toBe(1);

      const mergeCase = await prisma.productMergeCase.findUniqueOrThrow({ where: { id: mergeCaseId } });
      expect(mergeCase.version).toBe(2);
    });
  });
});
