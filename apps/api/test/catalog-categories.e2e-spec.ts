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

describe('Catalog categories + category attributes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let superAdminToken: string;
  let moderatorToken: string;
  let moderatorId: string;
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

  async function createCategory(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const res = await request(app.getHttpServer())
      .post('/v1/catalog/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ slug: uniqueSlug('cat'), name: 'Test Category', ...overrides })
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
    moderatorId = moderator.userId;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/catalog/categories', () => {
    it('is public (no Authorization header required) and returns the frozen envelope shape', async () => {
      const res = await request(app.getHttpServer()).get('/v1/catalog/categories').expect(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data).toHaveProperty('next_cursor');
      expect(res.body.meta.request_id).toBeDefined();
    });

    it('returns 422 VALIDATION_ERROR on an out-of-range limit', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/catalog/categories?limit=101')
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 422 VALIDATION_ERROR on a malformed cursor', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/catalog/categories?cursor=not-a-real-cursor')
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('paginates with limit=1 and a next_cursor that fetches the next distinct row', async () => {
      await createCategory(superAdminToken);
      await createCategory(superAdminToken);

      const page1 = await request(app.getHttpServer())
        .get('/v1/catalog/categories?limit=1')
        .expect(200);
      expect(page1.body.data.items).toHaveLength(1);
      expect(page1.body.data.next_cursor).not.toBeNull();

      const page2 = await request(app.getHttpServer())
        .get(
          `/v1/catalog/categories?limit=1&cursor=${encodeURIComponent(page1.body.data.next_cursor)}`,
        )
        .expect(200);
      expect(page2.body.data.items).toHaveLength(1);
      expect(page2.body.data.items[0].id).not.toBe(page1.body.data.items[0].id);
    });

    it('filters to direct children when parent_id is provided', async () => {
      const parent = await createCategory(superAdminToken);
      const child = await createCategory(superAdminToken, { parent_id: parent.id });

      const res = await request(app.getHttpServer())
        .get(`/v1/catalog/categories?parent_id=${parent.id}`)
        .expect(200);
      const ids = (res.body.data.items as Array<Record<string, unknown>>).map((i) => i.id);
      expect(ids).toContain(child.id);
    });
  });

  describe('GET /v1/catalog/categories/:id', () => {
    it('returns 404 NOT_FOUND for a well-formed but non-existent id', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/catalog/categories/3fa85f64-5717-4562-b3fc-2c963f66afa6')
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('is public and returns the created category', async () => {
      const created = await createCategory(superAdminToken);
      const res = await request(app.getHttpServer())
        .get(`/v1/catalog/categories/${created.id}`)
        .expect(200);
      expect(res.body.data.id).toBe(created.id);
    });
  });

  describe('POST /v1/catalog/categories', () => {
    it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/catalog/categories')
        .send({ slug: uniqueSlug('cat'), name: 'X' })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 403 FORBIDDEN for a MODERATOR (category:manage is SUPER_ADMIN-only), and the denial is audit-logged', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/catalog/categories')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ slug: uniqueSlug('cat'), name: 'X' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      const denialLog = await prisma.auditLog.findFirst({
        where: {
          actorId: moderatorId,
          action: 'authz.permission_denied',
          entityId: 'category:manage',
        },
        orderBy: { occurredAt: 'desc' },
      });
      expect(denialLog).not.toBeNull();
    });

    it('SUPER_ADMIN gets 201 and the category is readable via GET', async () => {
      const slug = uniqueSlug('cat');
      const res = await request(app.getHttpServer())
        .post('/v1/catalog/categories')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ slug, name: 'Appliances', requires_certification: true })
        .expect(201);
      expect(res.body.data.slug).toBe(slug);
      expect(res.body.data.requires_certification).toBe(true);
      expect(res.body.data.version).toBe(1);
    });

    it('rejects a duplicate slug with 422 VALIDATION_ERROR, and no second row is created', async () => {
      const slug = uniqueSlug('cat');
      await request(app.getHttpServer())
        .post('/v1/catalog/categories')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ slug, name: 'Appliances' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/v1/catalog/categories')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ slug, name: 'Appliances Again' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.slug).toBeDefined();

      const count = await prisma.category.count({ where: { slug } });
      expect(count).toBe(1);
    });

    it('rejects an unknown parent_id with 422 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/catalog/categories')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          slug: uniqueSlug('cat'),
          name: 'X',
          parent_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.parent_id).toBeDefined();
    });

    it('[Idempotency-Key] a repeat create call with the same key replays the original response instead of creating a duplicate', async () => {
      const slug = uniqueSlug('cat');
      const idempotencyKey = `cat-create-${Math.random()}`;
      const body = { slug, name: 'Idempotent Category' };

      const first = await request(app.getHttpServer())
        .post('/v1/catalog/categories')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/v1/catalog/categories')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(body)
        .expect(201);

      expect(second.body.data.id).toBe(first.body.data.id);
      const count = await prisma.category.count({ where: { slug } });
      expect(count).toBe(1);
    });
  });

  describe('PATCH /v1/catalog/categories/:id', () => {
    it('updates via compare-and-swap on version', async () => {
      const created = await createCategory(superAdminToken);

      const res = await request(app.getHttpServer())
        .patch(`/v1/catalog/categories/${created.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ version: 1, name: 'Renamed Category' })
        .expect(200);
      expect(res.body.data.name).toBe('Renamed Category');
      expect(res.body.data.version).toBe(2);
    });

    it('returns 409 INVALID_STATE_TRANSITION on a stale version', async () => {
      const created = await createCategory(superAdminToken);

      const res = await request(app.getHttpServer())
        .patch(`/v1/catalog/categories/${created.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ version: 99, name: 'Stale Write' })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('returns 422 VALIDATION_ERROR when the new parent_id would create a cycle, and parent_id is left unchanged', async () => {
      const a = await createCategory(superAdminToken);
      const b = await createCategory(superAdminToken, { parent_id: a.id });

      const res = await request(app.getHttpServer())
        .patch(`/v1/catalog/categories/${a.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ version: 1, parent_id: b.id })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      const unchanged = await prisma.category.findUniqueOrThrow({ where: { id: a.id as string } });
      expect(unchanged.parentId).toBeNull();
    });

    it('returns 403 FORBIDDEN for a MODERATOR', async () => {
      const created = await createCategory(superAdminToken);

      const res = await request(app.getHttpServer())
        .patch(`/v1/catalog/categories/${created.id}`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ version: 1, name: 'Should not apply' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /v1/catalog/categories/:category_id/attributes', () => {
    it('returns 404 NOT_FOUND for an unknown category', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/catalog/categories/3fa85f64-5717-4562-b3fc-2c963f66afa6/attributes')
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('is public and returns a plain array (not cursor-paginated)', async () => {
      const category = await createCategory(superAdminToken);
      const res = await request(app.getHttpServer())
        .get(`/v1/catalog/categories/${category.id}/attributes`)
        .expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('POST /v1/catalog/categories/:category_id/attributes', () => {
    it('returns 403 FORBIDDEN for a MODERATOR', async () => {
      const category = await createCategory(superAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/categories/${category.id}/attributes`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ key: 'color', label: 'Color', type: 'ENUM', validation: { enum_values: ['red'] } })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('SUPER_ADMIN creates a well-formed ENUM attribute (201), readable afterward via the list GET', async () => {
      const category = await createCategory(superAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/categories/${category.id}/attributes`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          key: 'color',
          label: 'Color',
          type: 'ENUM',
          required: true,
          validation: { enum_values: ['red', 'blue'] },
        })
        .expect(201);
      expect(res.body.data.key).toBe('color');
      expect(res.body.data.type).toBe('ENUM');

      const listRes = await request(app.getHttpServer())
        .get(`/v1/catalog/categories/${category.id}/attributes`)
        .expect(200);
      expect((listRes.body.data as Array<Record<string, unknown>>).map((a) => a.key)).toContain(
        'color',
      );
    });

    it('rejects a malformed NUMERIC_RANGE validation shape with 422 VALIDATION_ERROR, and no row is created', async () => {
      const category = await createCategory(superAdminToken);
      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/categories/${category.id}/attributes`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          key: 'warranty_months',
          label: 'Warranty (months)',
          type: 'NUMERIC_RANGE',
          validation: { min: 10, max: 5 },
        })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.validation).toBeDefined();

      const count = await prisma.categoryAttribute.count({
        where: { categoryId: category.id as string, key: 'warranty_months' },
      });
      expect(count).toBe(0);
    });

    it('rejects a duplicate (category_id, key) with 422 VALIDATION_ERROR', async () => {
      const category = await createCategory(superAdminToken);
      await request(app.getHttpServer())
        .post(`/v1/catalog/categories/${category.id}/attributes`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ key: 'color', label: 'Color', type: 'TEXT' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/v1/catalog/categories/${category.id}/attributes`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ key: 'color', label: 'Color Again', type: 'TEXT' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /v1/catalog/categories/:category_id/attributes/:id', () => {
    it('updates via compare-and-swap on version', async () => {
      const category = await createCategory(superAdminToken);
      const created = (
        await request(app.getHttpServer())
          .post(`/v1/catalog/categories/${category.id}/attributes`)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({ key: 'color', label: 'Color', type: 'TEXT' })
          .expect(201)
      ).body.data as Record<string, unknown>;

      const res = await request(app.getHttpServer())
        .patch(`/v1/catalog/categories/${category.id}/attributes/${created.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ version: 1, label: 'Primary Color' })
        .expect(200);
      expect(res.body.data.label).toBe('Primary Color');
      expect(res.body.data.version).toBe(2);
    });

    it('returns 409 INVALID_STATE_TRANSITION on a stale version', async () => {
      const category = await createCategory(superAdminToken);
      const created = (
        await request(app.getHttpServer())
          .post(`/v1/catalog/categories/${category.id}/attributes`)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({ key: 'color', label: 'Color', type: 'TEXT' })
          .expect(201)
      ).body.data as Record<string, unknown>;

      const res = await request(app.getHttpServer())
        .patch(`/v1/catalog/categories/${category.id}/attributes/${created.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ version: 99, label: 'Stale Write' })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('returns 404 NOT_FOUND when the attribute id does not belong to the given category_id', async () => {
      const categoryA = await createCategory(superAdminToken);
      const categoryB = await createCategory(superAdminToken);
      const created = (
        await request(app.getHttpServer())
          .post(`/v1/catalog/categories/${categoryA.id}/attributes`)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({ key: 'color', label: 'Color', type: 'TEXT' })
          .expect(201)
      ).body.data as Record<string, unknown>;

      const res = await request(app.getHttpServer())
        .patch(`/v1/catalog/categories/${categoryB.id}/attributes/${created.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ version: 1, label: 'Should not apply' })
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
