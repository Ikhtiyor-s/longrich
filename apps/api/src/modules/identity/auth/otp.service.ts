import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  OtpInvalidOrExpiredError,
  OtpLockedError,
  SmsProviderUnavailableError,
} from '../../../common/http/api-error';
import { AUTH_CONFIG } from '../config/auth-config.token';
import type { AuthConfig } from '../config/auth.config';
import { generateOtpCode, hashOtpCode, timingSafeEqualHex } from '../lib/crypto';
import { maskPhone } from '../lib/phone';
import { OtpRateLimiterService } from './otp-rate-limiter.service';
import { SMS_SENDER_ADAPTER, type SmsSenderAdapter } from './sms-sender.adapter';
import type { User } from '@prisma/client';

export interface CreateChallengeResult {
  challengeId: string;
  expiresInSeconds: number;
  resendAvailableAt: Date;
}

export interface VerifyResult {
  user: User;
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimiter: OtpRateLimiterService,
    @Inject(SMS_SENDER_ADAPTER) private readonly smsSender: SmsSenderAdapter,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async createChallenge(
    phone: string,
    purpose: string,
    deviceId: string | null,
    ip: string,
  ): Promise<CreateChallengeResult> {
    const resendAvailableAt = await this.rateLimiter.enforceRequestLimits(phone, deviceId, ip);

    const challengeId = randomUUID();
    const code = generateOtpCode();
    const codeHash = hashOtpCode(challengeId, code, this.config.otpHmacSecret);
    const expiresAt = new Date(Date.now() + this.config.otpTtlSeconds * 1000);

    await this.prisma.otpChallenge.create({
      data: {
        id: challengeId,
        phone,
        purpose,
        codeHash,
        maxAttempts: this.config.otpMaxAttempts,
        deviceId: deviceId ?? undefined,
        expiresAt,
      },
    });

    const smsBody = `Longrich: your verification code is ${code}. It expires in ${this.config.otpTtlSeconds} seconds.`;
    try {
      void this.smsSender.send(phone, smsBody).catch((error: unknown) => {
        this.logger.warn(
          `OTP SMS dispatch failed for ${maskPhone(phone)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    } catch {
      throw new SmsProviderUnavailableError();
    }

    return { challengeId, expiresInSeconds: this.config.otpTtlSeconds, resendAvailableAt };
  }

  async verify(challengeId: string, code: string): Promise<VerifyResult> {
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.status !== 'PENDING') {
      throw new OtpInvalidOrExpiredError();
    }

    if (challenge.expiresAt.getTime() < Date.now()) {
      await this.prisma.otpChallenge.updateMany({
        where: { id: challengeId, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      throw new OtpInvalidOrExpiredError();
    }

    const expectedHash = hashOtpCode(challenge.id, code, this.config.otpHmacSecret);
    const isMatch = timingSafeEqualHex(expectedHash, challenge.codeHash);

    if (!isMatch) {
      await this.rejectAttempt(challenge.id);
    }

    const claimed = await this.prisma.otpChallenge.updateMany({
      where: { id: challengeId, status: 'PENDING' },
      data: { status: 'VERIFIED', verifiedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new OtpInvalidOrExpiredError();
    }

    const user = await this.resolveVerifiedUser(challenge.phone);
    await this.prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { userId: user.id },
    });

    return { user };
  }

  // Compare-and-swap on the OLD attemptsCount read inside this call, not a value
  // read earlier by the caller — each retry re-reads attemptsCount fresh, so N
  // concurrent wrong-code requests for the same challenge serialize through this
  // loop one increment at a time instead of all computing the same stale
  // "nextAttempts" and clobbering each other down to a single effective
  // increment. Models SessionService.rotateRefreshToken's updateMany-keyed-on-
  // expected-prior-state pattern.
  private async rejectAttempt(challengeId: string): Promise<never> {
    for (;;) {
      const current = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
      if (!current || current.status !== 'PENDING') {
        throw new OtpInvalidOrExpiredError();
      }

      const nextAttempts = current.attemptsCount + 1;
      const lockedNow = nextAttempts >= current.maxAttempts;
      const claimed = await this.prisma.otpChallenge.updateMany({
        where: { id: challengeId, status: 'PENDING', attemptsCount: current.attemptsCount },
        data: {
          attemptsCount: nextAttempts,
          status: lockedNow ? 'LOCKED' : 'PENDING',
        },
      });

      if (claimed.count === 0) {
        // Another concurrent request already advanced attemptsCount (or flipped
        // status) between our read and our write — re-read and retry the CAS
        // rather than silently dropping this attempt's increment.
        continue;
      }

      if (lockedNow) {
        throw new OtpLockedError();
      }
      throw new OtpInvalidOrExpiredError();
    }
  }

  private async resolveVerifiedUser(phone: string): Promise<User> {
    const user = await this.prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, phoneVerifiedAt: new Date(), status: 'ACTIVE' },
    });
    if (user.phoneVerifiedAt) {
      return user;
    }
    return this.prisma.user.update({
      where: { id: user.id },
      data: { phoneVerifiedAt: new Date() },
    });
  }
}
