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
import { ModerationService } from './moderation.service';
import { DecisionReasonDto } from './dto/decision-reason.dto';

// Admin-side actor (seller:moderate), not a seller_members-scoped actor —
// deliberately does not reuse ApplicationAccessGuard/OwnershipGuard from the
// applications module (those answer "does the caller belong to this
// seller", irrelevant here: a moderator acts on someone else's seller by
// design). PermissionGuard alone (401 before 403, audit-on-deny) is the
// correct and sufficient gate, mirroring admin-audit's RbacDemoController.
@Controller('v1/seller-applications')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ModerationController {
  constructor(
    private readonly moderationService: ModerationService,
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
    const loaded = await this.moderationService.loadApplicationOrThrow(id);
    // "sel-app:" (not "seller-applications:") to stay under
    // commerce.idempotency_keys.scope's VarChar(64) cap once a real 36-char
    // UUID is appended (G1 QA review major #1) — ":needs-changes" and
    // ":activate" overflowed the longer prefix; every scope string in this
    // controller uses the shorter prefix now, not just those two, to keep
    // the "seller application" idempotency namespace consistent with
    // applications.controller.ts.
    return this.idempotency.run(`sel-app:${id}:approve`, idempotencyKey, {}, () =>
      this.moderationService.approve(loaded, user, {
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
    const loaded = await this.moderationService.loadApplicationOrThrow(id);
    return this.idempotency.run(`sel-app:${id}:reject`, idempotencyKey, dto, () =>
      this.moderationService.reject(loaded, user, dto.reason, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post(':id/needs-changes')
  @HttpCode(200)
  @RequirePermission('seller:moderate')
  @UsePipes(createValidationPipe())
  async needsChanges(
    @Param('id') id: string,
    @Body() dto: DecisionReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const loaded = await this.moderationService.loadApplicationOrThrow(id);
    return this.idempotency.run(`sel-app:${id}:needs-changes`, idempotencyKey, dto, () =>
      this.moderationService.needsChanges(loaded, user, dto.reason, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermission('seller:moderate')
  async activate(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const loaded = await this.moderationService.loadApplicationOrThrow(id);
    return this.idempotency.run(`sel-app:${id}:activate`, idempotencyKey, {}, () =>
      this.moderationService.activate(loaded, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }
}
