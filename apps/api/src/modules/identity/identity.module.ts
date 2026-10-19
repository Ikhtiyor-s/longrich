import { Module } from '@nestjs/common';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthJwtService } from './auth/jwt.service';
import { JwtAuthGuard } from './auth/auth.guard';
import { JwtSignatureGuard } from './auth/jwt-signature.guard';
import { OtpService } from './auth/otp.service';
import { OtpRateLimiterService } from './auth/otp-rate-limiter.service';
import { SessionService } from './auth/session.service';
import { MockSmsSenderAdapter, SMS_SENDER_ADAPTER } from './auth/sms-sender.adapter';
import { AUTH_CONFIG } from './config/auth-config.token';
import { loadAuthConfig } from './config/auth.config';
import { MeController } from './me/me.controller';
import { AdminMfaService } from './admin-mfa.service';

@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    OtpService,
    OtpRateLimiterService,
    SessionService,
    AuthJwtService,
    JwtAuthGuard,
    JwtSignatureGuard,
    AdminMfaService,
    { provide: SMS_SENDER_ADAPTER, useClass: MockSmsSenderAdapter },
    { provide: AUTH_CONFIG, useFactory: loadAuthConfig },
  ],
  // Exported so other modules' controllers can compose
  // @UseGuards(JwtAuthGuard, <their own guard>) (e.g. admin-audit's
  // PermissionGuard, T-G0-5) without re-implementing token/session
  // validation. AuthJwtService is exported alongside it because NestJS's
  // class-reference guard resolution (@UseGuards(JwtAuthGuard)) instantiates
  // the guard scoped to the *consuming* module, so that module needs
  // JwtAuthGuard's own constructor dependency resolvable too — it does not
  // reuse this module's already-built singleton. No other T-G0-4 file
  // changes beyond these two export entries.
  exports: [JwtAuthGuard, AuthJwtService],
})
export class IdentityModule {}
