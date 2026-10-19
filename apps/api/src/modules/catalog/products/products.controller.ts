import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products.query.dto';

// Read is public; write (product authorship, distinct from the T-G2-7
// moderation decision) is gated on `category:manage` — per
// api-contract-g2.md's resolved reading of "a MODERATOR reviews, a
// SUPER_ADMIN authors."
@Controller('v1/catalog/products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @UsePipes(createValidationPipe())
  list(@Query() query: ListProductsQueryDto) {
    return this.productsService.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('category:manage')
  @UsePipes(createValidationPipe())
  create(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run('prod:create', idempotencyKey, dto, () =>
      this.productsService.create(user, dto, {
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
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
  ) {
    return this.productsService.update(id, user, dto, {
      requestId: req.requestId ?? null,
      traceId: req.traceId ?? null,
    });
  }

  @Post(':id/submit')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('category:manage')
  submit(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`prod:${id}:submit`, idempotencyKey, {}, () =>
      this.productsService.submit(id, user, {
        requestId: req.requestId ?? null,
        traceId: req.traceId ?? null,
      }),
    );
  }
}
