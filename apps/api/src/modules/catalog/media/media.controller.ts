import { Body, Controller, Headers, HttpCode, Param, Post, Req, UseGuards, UsePipes } from '@nestjs/common';
import { createValidationPipe } from '../../../common/http/validation.pipe';
import type { RequestWithId } from '../../../common/http/request-id.middleware';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { JwtAuthGuard } from '../../identity/auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { MediaService } from './media.service';
import { CreateMediaDto } from './dto/create-media.dto';

// Owns both /v1/catalog/products/:product_id/media (create) and
// /v1/catalog/media/:id/confirm — same route/controller-folder independence
// already established by VariantsController.
@Controller()
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission('category:manage')
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('v1/catalog/products/:product_id/media')
  @HttpCode(201)
  @UsePipes(createValidationPipe())
  create(
    @Param('product_id') productId: string,
    @Body() dto: CreateMediaDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // Templated with product_id, matching the variant:${productId}:create
    // pattern — CreateMediaDto carries no product_id of its own, so a
    // literal 'media:create' scope would let a reused Idempotency-Key with
    // a coincidentally-identical body (same filename/size/mimetype,
    // variant_id: null) leak one product's cached presigned-upload
    // response to a different product.
    return this.idempotency.run(`media:${productId}:create`, idempotencyKey, dto, () =>
      this.mediaService.create(productId, user, dto, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Post('v1/catalog/media/:id/confirm')
  @HttpCode(200)
  confirm(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`media:${id}:confirm`, idempotencyKey, {}, () =>
      this.mediaService.confirm(id, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }
}
