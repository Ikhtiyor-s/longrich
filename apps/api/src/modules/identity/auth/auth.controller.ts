import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import type { Request } from 'express';
import { createValidationPipe } from '../../../common/http/validation.pipe';
import { sha256Hex } from '../lib/crypto';
import { AuthService } from './auth.service';
import { CurrentUser, type AuthenticatedUser } from './current-user.decorator';
import { JwtSignatureGuard } from './jwt-signature.guard';
import { OtpRequestDto } from '../dto/otp-request.dto';
import { OtpVerifyDto } from '../dto/otp-verify.dto';
import { TokenRefreshDto } from '../dto/token-refresh.dto';

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/request')
  @HttpCode(202)
  @UsePipes(createValidationPipe())
  async requestOtp(
    @Body() dto: OtpRequestDto,
    @Req() req: Request,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.authService.requestOtp(dto.phone, dto.purpose, deviceId ?? null, clientIp(req));
  }

  @Post('otp/verify')
  @HttpCode(200)
  @UsePipes(createValidationPipe())
  async verifyOtp(
    @Body() dto: OtpVerifyDto,
    @Req() req: Request,
    @Headers('x-device-id') deviceId?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.verifyOtp(dto.challenge_id, dto.code, {
      deviceId: deviceId ?? null,
      userAgent: userAgent ?? null,
      ipHash: sha256Hex(clientIp(req)),
    });
  }

  @Post('token/refresh')
  @HttpCode(200)
  @UsePipes(createValidationPipe())
  async refresh(@Body() dto: TokenRefreshDto) {
    return this.authService.refresh(dto.refresh_token);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtSignatureGuard)
  async logout(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logout(user.sessionId);
  }
}
