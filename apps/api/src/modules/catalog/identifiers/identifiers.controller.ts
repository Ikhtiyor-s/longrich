import { Body, Controller, Get, Headers, Param, Post, Req, Res, UseGuards, UsePipes } from '@nestjs/common';
import type { Response } from 'express';
import { createValidationPipe } from '../../../common/http/validation.pipe';
import type { RequestWithId } from '../../../common/http/request-id.middleware';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { JwtAuthGuard } from '../../identity/auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { IdentifiersService } from './identifiers.service';
import { CreateIdentifierDto } from './dto/create-identifier.dto';

// GET is public (the PUBLISHED-only filter is enforced inside the service,
// not by a guard here); POST is gated the same as every other catalog
// authoring endpoint — category:manage, no OwnershipGuard.
@Controller('v1/catalog/variants/:id/identifiers')
export class IdentifiersController {
  constructor(
    private readonly identifiersService: IdentifiersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  list(@Param('id') id: string) {
    return this.identifiersService.listPublic(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('category:manage')
  @UsePipes(createValidationPipe())
  async create(
    @Param('id') id: string,
    @Body() dto: CreateIdentifierDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const result = await this.idempotency.run(`ident:${id}:create`, idempotencyKey, dto, () =>
      this.identifiersService.create(id, user, dto, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );

    // Dynamic status: 202 on the conflict path, 201 on a real create (or
    // the same-variant idempotent-success case) — the one endpoint in this
    // module that can't use a static @HttpCode().
    res.status('status' in result && result.status === 'CONFLICT_DETECTED' ? 202 : 201);
    return result;
  }
}
