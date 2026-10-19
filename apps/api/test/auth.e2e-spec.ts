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

describe('Auth / OTP / Sessions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sentMessages = new Map<string, string>();

  const smsSender: SmsSenderAdapter = {
    send: jest.fn(async (phone: string, body: string) => {
      sentMessages.set(phone, body);
    }),
  };

  async function requestAndGetCode(
    phone: string,
    deviceId?: string,
  ): Promise<{ challengeId: string; code: string }> {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/otp/request')
      .set(deviceId ? { 'X-Device-Id': deviceId } : {})
      .send({ phone, purpose: 'LOGIN' })
      .expect(202);

    const challengeId = res.body.data.challenge_id;
    const code = extractOtpCode(sentMessages.get(phone) as string);
    return { challengeId, code };
  }

  async function loginNewUser(phone = uniquePhone()) {
    const { challengeId, code } = await requestAndGetCode(phone);
    const res = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ challenge_id: challengeId, code })
      .expect(200);
    return { phone, body: res.body.data as Record<string, unknown> };
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

  describe('POST /v1/auth/otp/request', () => {
    it('returns 202 with challenge_id/expires_in_seconds/resend_available_at, envelope + request_id header', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone: uniquePhone(), purpose: 'LOGIN' })
        .expect(202);

      expect(res.body.data.challenge_id).toBeDefined();
      expect(typeof res.body.data.expires_in_seconds).toBe('number');
      expect(res.body.data.resend_available_at).toBeDefined();
      expect(res.body.meta.request_id).toBeDefined();
      expect(res.headers['x-request-id']).toBe(res.body.meta.request_id);
    });

    it('is byte-for-byte identical in shape for a never-registered phone vs an existing user phone (anti-enumeration)', async () => {
      // Seed an existing user row directly (bypassing OTP) so neither phone below has
      // ever hit the resend-cooldown key — otherwise the "existing" phone's own prior
      // OTP flow would leave it rate-limited and the comparison wouldn't be apples-to-apples.
      const existingPhone = uniquePhone();
      await prisma.user.create({ data: { phone: existingPhone, phoneVerifiedAt: new Date() } });

      const neverRegisteredPhone = uniquePhone();
      const [existingRes, neverRes] = await Promise.all([
        request(app.getHttpServer())
          .post('/v1/auth/otp/request')
          .send({ phone: existingPhone, purpose: 'LOGIN' }),
        request(app.getHttpServer())
          .post('/v1/auth/otp/request')
          .send({ phone: neverRegisteredPhone, purpose: 'LOGIN' }),
      ]);

      expect(existingRes.status).toBe(202);
      expect(neverRes.status).toBe(202);
      expect(Object.keys(existingRes.body.data).sort()).toEqual(
        Object.keys(neverRes.body.data).sort(),
      );
      expect(typeof existingRes.body.data.challenge_id).toBe(
        typeof neverRes.body.data.challenge_id,
      );
      expect(typeof existingRes.body.data.expires_in_seconds).toBe(
        typeof neverRes.body.data.expires_in_seconds,
      );
    });

    it('rejects a malformed phone with 422 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone: 'not-a-phone', purpose: 'LOGIN' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an unsupported purpose with 422 VALIDATION_ERROR', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone: uniquePhone(), purpose: 'SIGNUP' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rate-limits a second request for the same phone within the resend cooldown with 429 RATE_LIMITED', async () => {
      const phone = uniquePhone();
      await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone, purpose: 'LOGIN' })
        .expect(202);

      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone, purpose: 'LOGIN' })
        .expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(typeof res.body.error.details.retry_after_seconds).toBe('number');
    });
  });

  describe('POST /v1/auth/otp/verify', () => {
    it('correct code logs in: 200 with tokens, user row created, challenge VERIFIED', async () => {
      const phone = uniquePhone();
      const { challengeId, code } = await requestAndGetCode(phone);

      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challenge_id: challengeId, code })
        .expect(200);

      expect(res.body.data.token_type).toBe('Bearer');
      expect(res.body.data.access_token).toBeDefined();
      expect(res.body.data.refresh_token).toBeDefined();
      expect(res.body.data.expires_in).toBeGreaterThan(0);
      expect(res.body.data.user.phone).toBe(phone);
      expect(res.body.data.user.status).toBe('ACTIVE');
      expect(res.body.data.user.phone_verified_at).toBeDefined();

      const challenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
      expect(challenge?.status).toBe('VERIFIED');
    });

    it('wrong code is rejected with 401 OTP_INVALID_OR_EXPIRED and does not log in', async () => {
      const phone = uniquePhone();
      const { challengeId } = await requestAndGetCode(phone);

      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challenge_id: challengeId, code: '000000' })
        .expect(401);
      expect(res.body.error.code).toBe('OTP_INVALID_OR_EXPIRED');
    });

    it('unknown challenge_id is rejected with the same generic 401 OTP_INVALID_OR_EXPIRED (anti-enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challenge_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', code: '123456' })
        .expect(401);
      expect(res.body.error.code).toBe('OTP_INVALID_OR_EXPIRED');
    });

    it('an expired challenge is rejected with 401 OTP_INVALID_OR_EXPIRED and flips to EXPIRED server-side', async () => {
      const phone = uniquePhone();
      const { challengeId, code } = await requestAndGetCode(phone);
      await prisma.otpChallenge.update({
        where: { id: challengeId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challenge_id: challengeId, code })
        .expect(401);
      expect(res.body.error.code).toBe('OTP_INVALID_OR_EXPIRED');

      const expired = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
      expect(expired?.status).toBe('EXPIRED');
    });

    it('a second verify of an already-VERIFIED challenge is rejected even with the correct code', async () => {
      const phone = uniquePhone();
      const { challengeId, code } = await requestAndGetCode(phone);
      await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challenge_id: challengeId, code })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challenge_id: challengeId, code })
        .expect(401);
      expect(res.body.error.code).toBe('OTP_INVALID_OR_EXPIRED');
    });

    it('exceeding max attempts locks the challenge with 429 OTP_LOCKED and no further verify can succeed', async () => {
      const phone = uniquePhone();
      const { challengeId, code } = await requestAndGetCode(phone);

      const challenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
      const maxAttempts = challenge?.maxAttempts ?? 5;

      let lastStatus = 0;
      for (let i = 0; i < maxAttempts; i += 1) {
        const res = await request(app.getHttpServer())
          .post('/v1/auth/otp/verify')
          .send({ challenge_id: challengeId, code: '000000' });
        lastStatus = res.status;
      }
      expect(lastStatus).toBe(429);

      const lockedChallenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
      expect(lockedChallenge?.status).toBe('LOCKED');

      const finalAttempt = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challenge_id: challengeId, code });
      expect(finalAttempt.status).not.toBe(200);
    });

    it('[CONCURRENCY] N truly-parallel wrong-code verify requests cannot bypass OTP_MAX_ATTEMPTS (Blocker #1 regression guard)', async () => {
      const phone = uniquePhone();
      const { challengeId, code } = await requestAndGetCode(phone);

      const challenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
      const maxAttempts = challenge?.maxAttempts ?? 5;

      // Fire more concurrent wrong-code attempts than the threshold allows, all
      // at once via Promise.all (not sequential/awaited one at a time) — this is
      // the scenario the read-then-write counter bug let through: every request
      // read the same stale attemptsCount and all wrote the same incremented
      // value, so only one increment ever landed regardless of N.
      const concurrency = maxAttempts + 4;
      const responses = await Promise.all(
        Array.from({ length: concurrency }, () =>
          request(app.getHttpServer())
            .post('/v1/auth/otp/verify')
            .send({ challenge_id: challengeId, code: '000000' }),
        ),
      );

      const lockedChallenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
      expect(lockedChallenge?.status).toBe('LOCKED');
      expect(lockedChallenge?.attemptsCount).toBeGreaterThanOrEqual(maxAttempts);

      expect(responses.some((res) => res.status === 429)).toBe(true);

      // The real guarantee: the account never allows more live guesses than
      // OTP_MAX_ATTEMPTS — even the CORRECT code must now be rejected because
      // the challenge is LOCKED, not still PENDING with a clobbered-low counter.
      const afterRace = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challenge_id: challengeId, code });
      expect(afterRace.status).not.toBe(200);
    });

    it('malformed code (not 6 digits) is rejected with 422 VALIDATION_ERROR', async () => {
      const phone = uniquePhone();
      const { challengeId } = await requestAndGetCode(phone);
      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challenge_id: challengeId, code: '12' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /v1/auth/token/refresh', () => {
    it('rotates: issues a new pair and invalidates the old refresh token', async () => {
      const { body } = await loginNewUser();
      const firstRefreshToken = body.refresh_token as string;

      const refreshRes = await request(app.getHttpServer())
        .post('/v1/auth/token/refresh')
        .send({ refresh_token: firstRefreshToken })
        .expect(200);

      expect(refreshRes.body.data.access_token).toBeDefined();
      expect(refreshRes.body.data.refresh_token).toBeDefined();
      expect(refreshRes.body.data.refresh_token).not.toBe(firstRefreshToken);

      const reuseRes = await request(app.getHttpServer())
        .post('/v1/auth/token/refresh')
        .send({ refresh_token: firstRefreshToken })
        .expect(401);
      expect(reuseRes.body.error.code).toBe('SESSION_INVALID');
    });

    it('reusing an already-rotated refresh token revokes the whole session (the new token also stops working)', async () => {
      const { body } = await loginNewUser();
      const firstRefreshToken = body.refresh_token as string;

      const rotateRes = await request(app.getHttpServer())
        .post('/v1/auth/token/refresh')
        .send({ refresh_token: firstRefreshToken })
        .expect(200);
      const secondRefreshToken = rotateRes.body.data.refresh_token as string;

      await request(app.getHttpServer())
        .post('/v1/auth/token/refresh')
        .send({ refresh_token: firstRefreshToken })
        .expect(401);

      const secondUseRes = await request(app.getHttpServer())
        .post('/v1/auth/token/refresh')
        .send({ refresh_token: secondRefreshToken })
        .expect(401);
      expect(secondUseRes.body.error.code).toBe('SESSION_INVALID');
    });

    it('[CONCURRENCY] two simultaneous rotations of the SAME refresh token still trigger reuse detection + session revocation + audit (Major #6 regression guard)', async () => {
      const { body } = await loginNewUser();
      const firstRefreshToken = body.refresh_token as string;
      const userId = (body.user as Record<string, unknown>).id as string;

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post('/v1/auth/token/refresh')
          .send({ refresh_token: firstRefreshToken }),
        request(app.getHttpServer())
          .post('/v1/auth/token/refresh')
          .send({ refresh_token: firstRefreshToken }),
      ]);

      const statuses = [resA.status, resB.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 401]);
      const winner = resA.status === 200 ? resA : resB;
      const loser = resA.status === 200 ? resB : resA;
      expect(loser.body.error.code).toBe('SESSION_INVALID');

      const sessions = await prisma.session.findMany({ where: { userId } });
      expect(sessions).toHaveLength(1);
      const [session] = sessions;
      if (!session) {
        throw new Error('expected exactly one session row');
      }
      expect(session.status).toBe('REVOKED');
      expect(session.revokedReason).toBe('refresh_token_reuse_detected');

      const auditRow = await prisma.auditLog.findFirst({
        where: { entityId: session.id, action: 'auth.refresh_token_reuse_detected' },
      });
      expect(auditRow).not.toBeNull();

      // Revocation covers the whole session chain, including the "winner"'s
      // brand-new token — not just the specific row both requests raced over.
      const winnerRefreshToken = winner.body.data.refresh_token as string;
      const afterRaceAttempt = await request(app.getHttpServer())
        .post('/v1/auth/token/refresh')
        .send({ refresh_token: winnerRefreshToken })
        .expect(401);
      expect(afterRaceAttempt.body.error.code).toBe('SESSION_INVALID');
    });

    it('unknown refresh token returns 401 SESSION_INVALID', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/token/refresh')
        .send({ refresh_token: 'this-token-was-never-issued' })
        .expect(401);
      expect(res.body.error.code).toBe('SESSION_INVALID');
    });
  });

  describe('POST /v1/auth/logout', () => {
    it('revokes the session; a subsequent refresh with that session token fails', async () => {
      const { body } = await loginNewUser();
      const accessToken = body.access_token as string;
      const refreshToken = body.refresh_token as string;

      const logoutRes = await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(logoutRes.body.data.revoked).toBe(true);

      const secondLogout = await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(secondLogout.body.data.revoked).toBe(true);

      const refreshAfterLogout = await request(app.getHttpServer())
        .post('/v1/auth/token/refresh')
        .send({ refresh_token: refreshToken })
        .expect(401);
      expect(refreshAfterLogout.body.error.code).toBe('SESSION_INVALID');
    });

    it('requires a valid access token: 401 UNAUTHENTICATED without one', async () => {
      await request(app.getHttpServer()).post('/v1/auth/logout').expect(401);
    });
  });

  describe('GET /v1/me', () => {
    it('returns 401 UNAUTHENTICATED without an Authorization header', async () => {
      const res = await request(app.getHttpServer()).get('/v1/me').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 401 UNAUTHENTICATED for a garbage bearer token', async () => {
      await request(app.getHttpServer())
        .get('/v1/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it('returns the caller profile for a valid access token', async () => {
      const { phone, body } = await loginNewUser();
      const accessToken = body.access_token as string;

      const res = await request(app.getHttpServer())
        .get('/v1/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.data.phone).toBe(phone);
      expect(res.body.data.id).toBe((body.user as Record<string, unknown>).id);
      expect(res.body.data.updated_at).toBeDefined();
    });

    it('an access token from a logged-out session is rejected', async () => {
      const { body } = await loginNewUser();
      const accessToken = body.access_token as string;
      await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get('/v1/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
    });
  });

  describe('PATCH /v1/me', () => {
    it('updates locale and GET afterward reflects it', async () => {
      const { body } = await loginNewUser();
      const accessToken = body.access_token as string;

      const patchRes = await request(app.getHttpServer())
        .patch('/v1/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ locale: 'ru' })
        .expect(200);
      expect(patchRes.body.data.locale).toBe('ru');

      const getRes = await request(app.getHttpServer())
        .get('/v1/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(getRes.body.data.locale).toBe('ru');
    });

    it('rejects an invalid locale with 422 VALIDATION_ERROR', async () => {
      const { body } = await loginNewUser();
      const accessToken = body.access_token as string;

      const res = await request(app.getHttpServer())
        .patch('/v1/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ locale: 'en' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it("a caller cannot mutate another user's profile by smuggling an id in the body", async () => {
      const userA = await loginNewUser();
      const userB = await loginNewUser();
      const userAId = (userA.body.user as Record<string, unknown>).id as string;
      const userBId = (userB.body.user as Record<string, unknown>).id as string;
      const userAToken = userA.body.access_token as string;

      await request(app.getHttpServer())
        .patch('/v1/me')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ id: userBId, locale: 'ru' })
        .expect(200);

      const userARow = await prisma.user.findUniqueOrThrow({ where: { id: userAId } });
      const userBRow = await prisma.user.findUniqueOrThrow({ where: { id: userBId } });
      expect(userARow.locale).toBe('RU');
      expect(userBRow.locale).toBe('UZ');
    });
  });

  it('never writes an OTP code or token in plaintext to logs', async () => {
    const logSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const phone = uniquePhone();
      const { challengeId, code } = await requestAndGetCode(phone);
      await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challenge_id: challengeId, code })
        .expect(200);

      const allOutput = [...logSpy.mock.calls, ...errSpy.mock.calls]
        .map((call) => String(call[0]))
        .join('\n');
      expect(allOutput.includes(code)).toBe(false);
      expect(allOutput.includes(phone)).toBe(false);
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
