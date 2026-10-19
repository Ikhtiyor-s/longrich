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
import { OfferModerationService } from './offer-moderation.service';
import { ApproveDecisionDto } from './dto/approve-decision.dto';
import { DecisionReasonDto } from './dto/decision-reason.dto';

// Offer decisions — gated on offers:moderate exclusively, independent of
// catalog:moderate (api-contract-g2.md's own explicit given/when/then: a
// catalog:moderate-only caller must get 403 here).
@Controller('v1/admin/offers/moderation')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission('offers:moderate')
export class OfferModerationController {
  constructor(
    private readonly moderationService: OfferModerationService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post(':id/approve')
  @HttpCode(200)
  @UsePipes(createValidationPipe())
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`off-mod:${id}:approve`, idempotencyKey, dto, () =>
      this.moderationService.approve(id, dto, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @UsePipes(createValidationPipe())
  deactivate(
    @Param('id') id: string,
    @Body() dto: DecisionReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`off-mod:${id}:deactivate`, idempotencyKey, dto, () =>
      this.moderationService.deactivate(id, dto, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post(':id/reject')
  @HttpCode(200)
  @UsePipes(createValidationPipe())
  reject(
    @Param('id') id: string,
    @Body() dto: DecisionReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`off-mod:${id}:reject`, idempotencyKey, dto, () =>
      this.moderationService.reject(id, dto, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }
}
