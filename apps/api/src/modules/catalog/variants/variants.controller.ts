import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Patch,
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
import { VariantsService } from './variants.service';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';

// Owns every /v1/catalog/variants/... route plus the nested
// /v1/catalog/products/:product_id/variants create route — route path and
// owning module/controller folder are independent in this codebase (same
// non-issue CategoryAttributesController already demonstrates nested under
// categories/:category_id/attributes, and api-contract-g2.md's own
// public-offers.controller.ts note makes explicit for a sibling module).
@Controller()
@UseGuards(JwtAuthGuard, PermissionGuard)
export class VariantsController {
  constructor(
    private readonly variantsService: VariantsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('v1/catalog/products/:product_id/variants')
  @HttpCode(201)
  @RequirePermission('category:manage')
  @UsePipes(createValidationPipe())
  create(
    @Param('product_id') productId: string,
    @Body() dto: CreateVariantDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // Scope templated with product_id (not a literal fixed string): no
    // scope string is frozen for this endpoint in api-contract-g2.md (unlike
    // prod:create/prod:{id}:submit, which are) — templating here is a
    // deliberate gap-fill judgment call to avoid the exact
    // identical-body-across-different-parents collision T-G2-2's own
    // implementer flagged for the literal `cat-attr:create` scope, not a
    // silent widening of a scope the contract actually froze.
    return this.idempotency.run(`variant:${productId}:create`, idempotencyKey, dto, () =>
      this.variantsService.create(productId, user, dto, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Patch('v1/catalog/variants/:id')
  @RequirePermission('category:manage')
  @UsePipes(createValidationPipe())
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVariantDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
  ) {
    return this.variantsService.update(id, user, dto, {
      requestId: req.requestId ?? null,
      traceId: req.traceId ?? null,
    });
  }

  @Post('v1/catalog/variants/:id/submit')
  @HttpCode(200)
  @RequirePermission('category:manage')
  submit(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // Templated the same shape as the frozen `prod:{id}:submit` scope — same
    // action, different entity, following the one concrete precedent the
    // contract does freeze rather than inventing an unrelated shape.
    return this.idempotency.run(`variant:${id}:submit`, idempotencyKey, {}, () =>
      this.variantsService.submit(id, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }
}
