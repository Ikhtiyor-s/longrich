import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { RateLimitedError } from '../../../common/http/api-error';
import { AUTH_CONFIG } from '../config/auth-config.token';
import type { AuthConfig } from '../config/auth.config';
import { sha256Hex } from '../lib/crypto';

const FIXED_WINDOW_SCRIPT = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return current
`;

// Per-phone/device/IP OTP request limits, Redis fixed-window counters.
// Defaults are config, not frozen business policy — see g0-design-notes.md §1.
@Injectable()
export class OtpRateLimiterService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /** Throws RateLimitedError if any limit is exceeded; otherwise returns the next allowed resend time. */
  async enforceRequestLimits(phone: string, deviceId: string | null, ip: string): Promise<Date> {
    const cooldownKey = `otp:resend:phone:${sha256Hex(phone)}`;
    const cooldownSet = await this.redis.set(
      cooldownKey,
      '1',
      'EX',
      this.config.otpResendCooldownSeconds,
      'NX',
    );
    if (cooldownSet === null) {
      throw new RateLimitedError(
        await this.ttlOrFallback(cooldownKey, this.config.otpResendCooldownSeconds),
      );
    }

    const phoneKey = `otp:req:phone:${sha256Hex(phone)}`;
    const phoneCount = await this.incrementWindow(phoneKey, 15 * 60);
    if (phoneCount > this.config.otpRateLimitPerPhonePer15Min) {
      throw new RateLimitedError(await this.ttlOrFallback(phoneKey, 15 * 60));
    }

    if (deviceId) {
      const deviceKey = `otp:req:device:${deviceId}`;
      const deviceCount = await this.incrementWindow(deviceKey, 60 * 60);
      if (deviceCount > this.config.otpRateLimitPerDevicePerHour) {
        throw new RateLimitedError(await this.ttlOrFallback(deviceKey, 60 * 60));
      }
    }

    const ipKey = `otp:req:ip:${sha256Hex(ip)}`;
    const ipCount = await this.incrementWindow(ipKey, 60 * 60);
    if (ipCount > this.config.otpRateLimitPerIpPerHour) {
      throw new RateLimitedError(await this.ttlOrFallback(ipKey, 60 * 60));
    }

    return new Date(Date.now() + this.config.otpResendCooldownSeconds * 1000);
  }

  private async incrementWindow(key: string, windowSeconds: number): Promise<number> {
    const result = await this.redis.eval(FIXED_WINDOW_SCRIPT, 1, key, windowSeconds);
    return Number(result);
  }

  private async ttlOrFallback(key: string, fallbackSeconds: number): Promise<number> {
    const ttl = await this.redis.ttl(key);
    return ttl > 0 ? ttl : fallbackSeconds;
  }
}
