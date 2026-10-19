import {
  Body,
  Controller,
  Get,
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
import { CategoryAttributesService } from './category-attributes.service';
import { CreateCategoryAttributeDto } from './dto/create-category-attribute.dto';
import { UpdateCategoryAttributeDto } from './dto/update-category-attribute.dto';

// Read is public; write gated on `category:manage`, same as
// CategoriesController — see docs/architecture/api-contract-g2.md.
@Controller('v1/catalog/categories/:category_id/attributes')
export class CategoryAttributesController {
  constructor(
    private readonly categoryAttributesService: CategoryAttributesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  list(@Param('category_id') categoryId: string) {
    return this.categoryAttributesService.list(categoryId);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('category:manage')
  @UsePipes(createValidationPipe())
  create(
    @Param('category_id') categoryId: string,
    @Body() dto: CreateCategoryAttributeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // Scope is the literal `cat-attr:create` string, frozen verbatim by
    // docs/architecture/api-contract-g2.md — no category_id interpolated,
    // same shape as `cat:create` for categories (no entity id exists yet at
    // creation time).
    return this.idempotency.run('cat-attr:create', idempotencyKey, dto, () =>
      this.categoryAttributesService.create(categoryId, user, dto, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('category:manage')
  @UsePipes(createValidationPipe())
  update(
    @Param('category_id') categoryId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryAttributeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
  ) {
    return this.categoryAttributesService.update(categoryId, id, user, dto, {
      requestId: req.requestId ?? null,
      traceId: req.traceId ?? null,
    });
  }
}
