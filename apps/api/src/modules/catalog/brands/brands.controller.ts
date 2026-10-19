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
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

// Read is public, plain array (not cursor-paginated — "same CRUD shape as
// categories" per api-contract-g2.md, and brands have no dedicated
// permission code: write reuses `category:manage`).
@Controller('v1/catalog/brands')
export class BrandsController {
  constructor(
    private readonly brandsService: BrandsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  list() {
    return this.brandsService.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.brandsService.findOne(id);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('category:manage')
  @UsePipes(createValidationPipe())
  create(
    @Body() dto: CreateBrandDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run('brand:create', idempotencyKey, dto, () =>
      this.brandsService.create(user, dto, {
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
    @Body() dto: UpdateBrandDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
  ) {
    return this.brandsService.update(id, user, dto, {
      requestId: req.requestId ?? null,
      traceId: req.traceId ?? null,
    });
  }
}
