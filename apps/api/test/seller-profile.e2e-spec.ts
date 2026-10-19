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

describe('Seller profile / shop settings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let moderatorToken: string;
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
  // flow, which is a separate ticket's own concern) — this file is only
  // responsible for proving GET/PATCH /v1/seller/profile's own behavior
  // given a caller with a known role, not re-testing invite.
  function addMember(sellerId: string, userId: string, role: SellerMemberRole) {
    return prisma.sellerMember.create({ data: { sellerId, userId, role } });
  }

  // Same submit->approve->activate path seller-lifecycle's own e2e suite
  // uses — this seller's profile edits need a real ACTIVE seller to prove
  // the publish-affecting-fields gate actually opens, not just that it
  // closes.
  async function createActiveSeller(accessToken: string): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/v1/seller-applications')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(validCreateApplicationBody())
      .expect(201);
    const sellerId = created.body.data.seller_id as string;
    const applicationId = created.body.data.id as string;

    await prisma.sellerDocument.create({
      data: {
        sellerId,
        type: 'REGISTRATION_CERTIFICATE',
        objectKey: `fixtures/${sellerId}/doc.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    });
    await request(app.getHttpServer())
      .post(`/v1/seller-applications/${applicationId}/contract-acceptance`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/seller-applications/${applicationId}/submit`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/seller-applications/${applicationId}/approve`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/seller-applications/${applicationId}/activate`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    return sellerId;
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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/seller/profile', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/seller/profile?seller_id=00000000-0000-0000-0000-000000000000')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('requires a seller_id query parameter (422 VALIDATION_ERROR when missing)', async () => {
      const { accessToken } = await loginNewUser();
      const res = await request(app.getHttpServer())
        .get('/v1/seller/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it("returns the caller's own seller profile, with the new shop-profile fields defaulting to null", async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/profile?seller_id=${sellerId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(res.body.data).toMatchObject({
        id: sellerId,
        display_name: 'Test Shop',
        legal_name: 'Test Trading LLC',
        description: null,
        logo_object_key: null,
        working_hours: null,
        delivery_terms: null,
      });
    });

    it("cross-seller: reading another seller's profile returns 403 FORBIDDEN", async () => {
      const ownerA = await loginNewUser();
      const ownerB = await loginNewUser();
      const sellerIdA = await createSeller(ownerA.accessToken);

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/profile?seller_id=${sellerIdA}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('an OPERATOR member can still read the profile (view is not OWNER/MANAGER-restricted, only PATCH is)', async () => {
      const owner = await loginNewUser();
      const operator = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await addMember(sellerId, operator.userId, 'OPERATOR');

      const res = await request(app.getHttpServer())
        .get(`/v1/seller/profile?seller_id=${sellerId}`)
        .set('Authorization', `Bearer ${operator.accessToken}`)
        .expect(200);
      expect(res.body.data.id).toBe(sellerId);
    });
  });

  describe('PATCH /v1/seller/profile', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/seller/profile')
        .send({ seller_id: '00000000-0000-0000-0000-000000000000', display_name: 'x' })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it("cross-seller: editing another seller's profile returns 403 FORBIDDEN (user-supplied seller_id spoofing, TZ §34)", async () => {
      const ownerA = await loginNewUser();
      const ownerB = await loginNewUser();
      const sellerIdA = await createSeller(ownerA.accessToken);

      const res = await request(app.getHttpServer())
        .patch('/v1/seller/profile')
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({ seller_id: sellerIdA, display_name: 'Hijacked Name' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const seller = await prisma.seller.findUniqueOrThrow({ where: { id: sellerIdA } });
      expect(seller.displayName).toBe('Test Shop');
    });

    it('an OWNER can update display_name, and the audit log records the real before/after values', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      const res = await request(app.getHttpServer())
        .patch('/v1/seller/profile')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, display_name: 'Renamed Shop' })
        .expect(200);
      expect(res.body.data.display_name).toBe('Renamed Shop');

      const seller = await prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
      expect(seller.displayName).toBe('Renamed Shop');

      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'seller', entityId: sellerId, action: 'seller_profile.updated' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(audit).not.toBeNull();
      expect(audit?.beforeJson).toEqual({ display_name: 'Test Shop' });
      expect(audit?.afterJson).toEqual({ display_name: 'Renamed Shop' });
    });

    it('rejects with 422 VALIDATION_ERROR when display_name exceeds 120 characters (TZ §28)', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      const res = await request(app.getHttpServer())
        .patch('/v1/seller/profile')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, display_name: 'a'.repeat(121) })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('cannot change legal_name/tax_id/legal_type through this endpoint: they are silently stripped and the row is unchanged (SEL-001 owns that write path)', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      const res = await request(app.getHttpServer())
        .patch('/v1/seller/profile')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          seller_id: sellerId,
          display_name: 'Still Allowed Name',
          legal_name: 'Hijacked LLC',
          tax_id: '9999999999',
          legal_type: 'SOLE_PROPRIETOR',
        })
        .expect(200);
      expect(res.body.data.display_name).toBe('Still Allowed Name');
      expect(res.body.data.legal_name).toBe('Test Trading LLC');

      const seller = await prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
      expect(seller.legalName).toBe('Test Trading LLC');
      expect(seller.taxId).toBe('0012345678');
      expect(seller.legalType).toBe('LLC');
    });

    it('an OPERATOR gets 403 FORBIDDEN attempting to edit the profile, and the denial is audit-logged', async () => {
      const owner = await loginNewUser();
      const operator = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await addMember(sellerId, operator.userId, 'OPERATOR');

      const res = await request(app.getHttpServer())
        .patch('/v1/seller/profile')
        .set('Authorization', `Bearer ${operator.accessToken}`)
        .send({ seller_id: sellerId, display_name: 'Operator Should Not Win' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const denialLog = await prisma.auditLog.findFirst({
        where: {
          actorId: operator.userId,
          action: 'authz.permission_denied',
          entityId: 'seller:profile:manage',
        },
        orderBy: { occurredAt: 'desc' },
      });
      expect(denialLog).not.toBeNull();

      const seller = await prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
      expect(seller.displayName).toBe('Test Shop');
    });

    it('a MANAGER can update the profile (OWNER/MANAGER, not OWNER-only)', async () => {
      const owner = await loginNewUser();
      const manager = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);
      await addMember(sellerId, manager.userId, 'MANAGER');

      const res = await request(app.getHttpServer())
        .patch('/v1/seller/profile')
        .set('Authorization', `Bearer ${manager.accessToken}`)
        .send({ seller_id: sellerId, display_name: 'Manager Renamed Shop' })
        .expect(200);
      expect(res.body.data.display_name).toBe('Manager Renamed Shop');
    });

    it('rejects with 422 VALIDATION_ERROR when changing a publish-affecting field (description) while the seller is DRAFT (not ACTIVE)', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      const res = await request(app.getHttpServer())
        .patch('/v1/seller/profile')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId, description: 'We sell the finest honey.' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      const seller = await prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
      expect(seller.description).toBeNull();
    });

    it('allows changing description/logo_object_key/working_hours/delivery_terms once the seller is ACTIVE, and audits the real before/after', async () => {
      const owner = await loginNewUser();
      const sellerId = await createActiveSeller(owner.accessToken);

      const res = await request(app.getHttpServer())
        .patch('/v1/seller/profile')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          seller_id: sellerId,
          description: 'We sell the finest honey in Tashkent.',
          logo_object_key: 'seller-logos/seller-1/logo.png',
          working_hours: 'Mon-Fri 09:00-18:00',
          delivery_terms: 'Tashkent shahri boylab 1-2 kun ichida.',
        })
        .expect(200);

      expect(res.body.data.description).toBe('We sell the finest honey in Tashkent.');
      expect(res.body.data.logo_object_key).toBe('seller-logos/seller-1/logo.png');
      expect(res.body.data.working_hours).toBe('Mon-Fri 09:00-18:00');
      expect(res.body.data.delivery_terms).toBe('Tashkent shahri boylab 1-2 kun ichida.');

      const seller = await prisma.seller.findUniqueOrThrow({ where: { id: sellerId } });
      expect(seller.description).toBe('We sell the finest honey in Tashkent.');

      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'seller', entityId: sellerId, action: 'seller_profile.updated' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(audit).not.toBeNull();
      expect(audit?.beforeJson).toEqual({
        description: null,
        logo_object_key: null,
        working_hours: null,
        delivery_terms: null,
      });
      expect(audit?.afterJson).toEqual({
        description: 'We sell the finest honey in Tashkent.',
        logo_object_key: 'seller-logos/seller-1/logo.png',
        working_hours: 'Mon-Fri 09:00-18:00',
        delivery_terms: 'Tashkent shahri boylab 1-2 kun ichida.',
      });
    });

    it('is a no-op (200, no audit entry written) when the PATCH body has no updatable fields beyond seller_id', async () => {
      const owner = await loginNewUser();
      const sellerId = await createSeller(owner.accessToken);

      const auditCountBefore = await prisma.auditLog.count({
        where: { entityType: 'seller', entityId: sellerId, action: 'seller_profile.updated' },
      });

      await request(app.getHttpServer())
        .patch('/v1/seller/profile')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ seller_id: sellerId })
        .expect(200);

      const auditCountAfter = await prisma.auditLog.count({
        where: { entityType: 'seller', entityId: sellerId, action: 'seller_profile.updated' },
      });
      expect(auditCountAfter).toBe(auditCountBefore);
    });
  });
});
