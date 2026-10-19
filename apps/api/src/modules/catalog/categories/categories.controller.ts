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
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories.query.dto';

// Read is public (no @UseGuards at method level for GET); write is gated on
// `category:manage` (JwtAuthGuard + PermissionGuard), per
// docs/architecture/api-contract-g2.md — platform-wide admin resource, no
// OwnershipGuard involved.
@Controller('v1/catalog/categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @UsePipes(createValidationPipe())
  list(@Query() query: ListCategoriesQueryDto) {
    return this.categoriesService.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.categoriesService.findOne(id);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('category:manage')
  @UsePipes(createValidationPipe())
  create(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run('cat:create', idempotencyKey, dto, () =>
      this.categoriesService.create(user, dto, {
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
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: RequestWithId,
  ) {
    return this.categoriesService.update(id, user, dto, {
      requestId: req.requestId ?? null,
      traceId: req.traceId ?? null,
    });
  }
}
