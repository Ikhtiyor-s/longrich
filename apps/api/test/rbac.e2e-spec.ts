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

function extractOtpCode(smsBody: string): string {
  const match = smsBody.match(/\b(\d{6})\b/);
  if (!match || !match[1]) {
    throw new Error(`no 6-digit OTP code found in captured SMS body: ${smsBody}`);
  }
  return match[1];
}

describe('RBAC authorization middleware (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sentMessages = new Map<string, string>();

  const smsSender: SmsSenderAdapter = {
    send: jest.fn(async (phone: string, body: string) => {
      sentMessages.set(phone, body);
    }),
  };

  async function loginSeededMember(
    phone: string,
  ): Promise<{ accessToken: string; userId: string }> {
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

  it('returns 401 UNAUTHENTICATED with no Authorization header', async () => {
    const res = await request(app.getHttpServer()).get('/v1/admin/rbac-demo/test-read').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 UNAUTHENTICATED (not 500) for a garbage bearer token', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/admin/rbac-demo/test-read')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('a real-login SUPER_ADMIN session (seeded with test:read) gets 200', async () => {
    const { accessToken, userId } = await loginSeededMember(SUPER_ADMIN_PHONE);

    const res = await request(app.getHttpServer())
      .get('/v1/admin/rbac-demo/test-read')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.data.ok).toBe(true);
    expect(res.body.data.actor_id).toBe(userId);
    expect(res.body.meta.request_id).toBeDefined();
  });

  it('a real-login SUPPORT_AGENT session (seeded without test:read) gets 403 FORBIDDEN with the frozen envelope, and a denial is audit-logged', async () => {
    const { accessToken, userId } = await loginSeededMember(SUPPORT_AGENT_PHONE);

    const res = await request(app.getHttpServer())
      .get('/v1/admin/rbac-demo/test-read')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.request_id).toBeDefined();
    expect(res.headers['x-request-id']).toBe(res.body.request_id);

    const denialLog = await prisma.auditLog.findFirst({
      where: { actorId: userId, action: 'authz.permission_denied', entityId: 'test:read' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(denialLog).not.toBeNull();
    expect(denialLog?.requestId).toBe(res.body.request_id);
    expect(denialLog?.actorType).toBe('USER');
  });
});
