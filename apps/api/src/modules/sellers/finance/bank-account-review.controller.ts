import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { createValidationPipe } from '../../../common/http/validation.pipe';
import type { RequestWithId } from '../../../common/http/request-id.middleware';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { JwtAuthGuard } from '../../identity/auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { BankAccountReviewService } from './bank-account-review.service';
import { DecisionReasonDto } from '../moderation/dto/decision-reason.dto';

// Admin-side actor (seller:moderate), not a seller_members-scoped actor —
// same split ModerationController (T-G1-5) already established for
// v1/seller-applications: a moderator reviews someone else's
// seller_bank_accounts row by design, so PermissionGuard alone (401 before
// 403, audit-on-deny) is the correct and sufficient gate, not
// MemberAccessGuard/OwnershipGuard/SellerPermissionGuard. Shares its base
// path with BankAccountsController (seller-side GET/POST) without route
// collision, same as ApplicationsController/ModerationController both being
// @Controller('v1/seller-applications').
@Controller('v1/seller/bank-accounts')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class BankAccountReviewController {
  constructor(
    private readonly reviewService: BankAccountReviewService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('seller:moderate')
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const loaded = await this.reviewService.loadOrThrow(id);
    // "bank-accounts" (not "seller-bank-accounts") specifically to stay
    // under commerce.idempotency_keys.scope's VarChar(64) cap once the
    // 36-char UUID and ":approve" suffix are appended — the longer prefix
    // overflowed by a single character.
    return this.idempotency.run(`bank-accounts:${id}:approve`, idempotencyKey, {}, () =>
      this.reviewService.approve(loaded, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('seller:moderate')
  @UsePipes(createValidationPipe())
  async reject(
    @Param('id') id: string,
    @Body() dto: DecisionReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const loaded = await this.reviewService.loadOrThrow(id);
    return this.idempotency.run(`bank-accounts:${id}:reject`, idempotencyKey, dto, () =>
      this.reviewService.reject(loaded, user, dto.reason, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }
}
