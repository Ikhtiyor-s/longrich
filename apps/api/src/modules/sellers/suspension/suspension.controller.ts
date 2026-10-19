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
import { SuspensionService } from './suspension.service';
import { SuspendDto } from './dto/suspend.dto';
import { ReinstateDto } from './dto/reinstate.dto';

// Admin-side actor (seller:suspend), same reasoning as ModerationController:
// not a seller_members-scoped actor, so PermissionGuard alone is the gate —
// no OwnershipGuard/MemberAccessGuard involved.
@Controller('v1/sellers')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class SuspensionController {
  constructor(
    private readonly suspensionService: SuspensionService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePermission('seller:suspend')
  @UsePipes(createValidationPipe())
  async suspend(
    @Param('id') id: string,
    @Body() dto: SuspendDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const loaded = await this.suspensionService.loadSellerOrThrow(id);
    return this.idempotency.run(`sellers:${id}:suspend`, idempotencyKey, dto, () =>
      this.suspensionService.suspend(loaded, user, dto.reason, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post(':id/reinstate')
  @HttpCode(200)
  @RequirePermission('seller:suspend')
  @UsePipes(createValidationPipe())
  async reinstate(
    @Param('id') id: string,
    @Body() dto: ReinstateDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const loaded = await this.suspensionService.loadSellerOrThrow(id);
    return this.idempotency.run(`sellers:${id}:reinstate`, idempotencyKey, dto, () =>
      this.suspensionService.reinstate(loaded, user, dto.reason ?? null, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }
}
