import { Injectable } from '@nestjs/common';
import { ValidationError } from '../../../common/http/api-error';
import { normalizePhone } from '../lib/phone';
import { OtpService } from './otp.service';
import { SessionService, type SessionContext } from './session.service';
import { toAuthUserPayload } from './auth-response.mapper';

@Injectable()
export class AuthService {
  constructor(
    private readonly otpService: OtpService,
    private readonly sessionService: SessionService,
  ) {}

  async requestOtp(rawPhone: string, purpose: string, deviceId: string | null, ip: string) {
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      throw new ValidationError('phone must be a valid E.164 number.', {
        phone: ['must be a valid E.164 number (+ followed by 7-15 digits)'],
      });
    }

    const result = await this.otpService.createChallenge(phone, purpose, deviceId, ip);
    return {
      challenge_id: result.challengeId,
      expires_in_seconds: result.expiresInSeconds,
      resend_available_at: result.resendAvailableAt.toISOString(),
    };
  }

  async verifyOtp(challengeId: string, code: string, context: SessionContext) {
    const { user } = await this.otpService.verify(challengeId, code);
    const tokens = await this.sessionService.createSession(user.id, context);
    return {
      token_type: 'Bearer',
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      user: toAuthUserPayload(user),
    };
  }

  async refresh(refreshToken: string) {
    const tokens = await this.sessionService.rotateRefreshToken(refreshToken);
    return {
      token_type: 'Bearer',
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
    };
  }

  async logout(sessionId: string) {
    await this.sessionService.revokeSession(sessionId);
    return { revoked: true };
  }
}
