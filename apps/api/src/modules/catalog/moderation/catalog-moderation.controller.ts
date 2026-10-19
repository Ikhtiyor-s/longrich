import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
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
import { CatalogModerationService } from './catalog-moderation.service';
import { ModerationQueueAccessGuard } from './moderation-queue-access.guard';
import { ApproveDecisionDto } from './dto/approve-decision.dto';
import { DecisionReasonDto } from './dto/decision-reason.dto';
import { ListModerationQueueQueryDto } from './dto/list-moderation-queue.query.dto';

// Product/variant/media moderation decisions — catalog-side of T-G2-7's
// module split (offer decisions live in offers/moderation/, per
// api-contract-g2.md's resolved "exact module home" note). The queue GET
// is shared across both entity domains and lives here under the
// /v1/admin/catalog/... prefix the contract gives it, gated by its own
// OR-permission guard rather than the single-code PermissionGuard.
@Controller('v1/admin/catalog')
@UseGuards(JwtAuthGuard)
export class CatalogModerationController {
  constructor(
    private readonly moderationService: CatalogModerationService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('moderation-queue')
  @UseGuards(ModerationQueueAccessGuard)
  @UsePipes(createValidationPipe())
  listQueue(@Query() query: ListModerationQueueQueryDto) {
    return this.moderationService.listQueue(query);
  }

  @Post('products/:id/approve')
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission('catalog:moderate')
  @UsePipes(createValidationPipe())
  approveProduct(
    @Param('id') id: string,
    @Body() dto: ApproveDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`cat-mod:${id}:approve`, idempotencyKey, dto, () =>
      this.moderationService.approveProduct(id, dto, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post('products/:id/needs-changes')
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission('catalog:moderate')
  @UsePipes(createValidationPipe())
  needsChangesProduct(
    @Param('id') id: string,
    @Body() dto: DecisionReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`cat-mod:${id}:needs-changes`, idempotencyKey, dto, () =>
      this.moderationService.needsChangesProduct(id, dto, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post('products/:id/reject')
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission('catalog:moderate')
  @UsePipes(createValidationPipe())
  rejectProduct(
    @Param('id') id: string,
    @Body() dto: DecisionReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`cat-mod:${id}:reject`, idempotencyKey, dto, () =>
      this.moderationService.rejectProduct(id, dto, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post('variants/:id/approve')
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission('catalog:moderate')
  @UsePipes(createValidationPipe())
  approveVariant(
    @Param('id') id: string,
    @Body() dto: ApproveDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`var-mod:${id}:approve`, idempotencyKey, dto, () =>
      this.moderationService.approveVariant(id, dto, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post('variants/:id/needs-changes')
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission('catalog:moderate')
  @UsePipes(createValidationPipe())
  needsChangesVariant(
    @Param('id') id: string,
    @Body() dto: DecisionReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`var-mod:${id}:needs-changes`, idempotencyKey, dto, () =>
      this.moderationService.needsChangesVariant(id, dto, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post('variants/:id/reject')
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission('catalog:moderate')
  @UsePipes(createValidationPipe())
  rejectVariant(
    @Param('id') id: string,
    @Body() dto: DecisionReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`var-mod:${id}:reject`, idempotencyKey, dto, () =>
      this.moderationService.rejectVariant(id, dto, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post('media/:id/approve')
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission('catalog:moderate')
  @UsePipes(createValidationPipe())
  approveMedia(
    @Param('id') id: string,
    @Body() dto: ApproveDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`media-mod:${id}:approve`, idempotencyKey, dto, () =>
      this.moderationService.approveMedia(id, dto, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post('media/:id/reject')
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission('catalog:moderate')
  @UsePipes(createValidationPipe())
  rejectMedia(
    @Param('id') id: string,
    @Body() dto: DecisionReasonDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`media-mod:${id}:reject`, idempotencyKey, dto, () =>
      this.moderationService.rejectMedia(id, dto, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }
}
