import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { createValidationPipe } from '../../../common/http/validation.pipe';
import { ValidationError } from '../../../common/http/api-error';
import { OwnershipGuard } from '../../../common/guards/ownership.guard';
import {
  RequireOwnership,
  type OwnershipRequestShape,
} from '../../../common/decorators/require-ownership.decorator';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { JwtAuthGuard } from '../../identity/auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { SellerPermissionGuard } from '../../sellers/members/seller-permission.guard';
import { RequireSellerPermission } from '../../sellers/members/require-seller-permission.decorator';
import { ImportsService } from './imports.service';
import { ImportAccessGuard, type LoadedImportResource } from './import-access.guard';
import { LoadedImport, type CatalogImportJobWithSeller } from './loaded-import.decorator';
import { CreateImportDto } from './dto/create-import.dto';
import { ListImportsQueryDto } from './dto/list-imports.query.dto';
import { ListImportErrorsQueryDto } from './dto/list-import-errors.query.dto';

// Resolver for the ownership check on routes scoped to an existing import
// job: ImportAccessGuard (runs first) has already resolved whether the
// caller has their own seller_members row for this job's seller — same
// pattern as offers/seller-offers.controller.ts's resolveOfferOwner.
const resolveImportOwner = (
  request: OwnershipRequestShape,
  resource: LoadedImportResource,
): string | null => (resource.callerMembership ? (request.user?.id ?? null) : null);

@Controller('v1/seller/catalog/imports')
@UseGuards(JwtAuthGuard)
export class ImportsController {
  constructor(
    private readonly importsService: ImportsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @HttpCode(201)
  @UsePipes(createValidationPipe())
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateImportDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run('cat-imp:create', idempotencyKey, dto, () =>
      this.importsService.create(user, dto),
    );
  }

  @Get()
  @UsePipes(createValidationPipe())
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListImportsQueryDto) {
    if (!query.seller_id) {
      throw new ValidationError('seller_id query parameter is required.', {
        seller_id: ['seller_id is required.'],
      });
    }
    return this.importsService.list(user, query.seller_id, query);
  }

  @Get(':id')
  @UseGuards(ImportAccessGuard, OwnershipGuard)
  @RequireOwnership<LoadedImportResource>(resolveImportOwner)
  findOne(@LoadedImport() job: CatalogImportJobWithSeller) {
    return this.importsService.findOne(job);
  }

  @Get(':id/errors')
  @UseGuards(ImportAccessGuard, OwnershipGuard)
  @RequireOwnership<LoadedImportResource>(resolveImportOwner)
  @UsePipes(createValidationPipe())
  listErrors(
    @LoadedImport() job: CatalogImportJobWithSeller,
    @Query() query: ListImportErrorsQueryDto,
  ) {
    return this.importsService.listErrors(job, query);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @UseGuards(ImportAccessGuard, OwnershipGuard, SellerPermissionGuard)
  @RequireOwnership<LoadedImportResource>(resolveImportOwner)
  @RequireSellerPermission('seller:offers:manage')
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @LoadedImport() job: CatalogImportJobWithSeller,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`cat-imp:${id}:confirm`, idempotencyKey, {}, () =>
      this.importsService.confirm(job, user),
    );
  }

  @Post(':id/commit')
  @HttpCode(200)
  @UseGuards(ImportAccessGuard, OwnershipGuard, SellerPermissionGuard)
  @RequireOwnership<LoadedImportResource>(resolveImportOwner)
  @RequireSellerPermission('seller:offers:manage')
  commit(
    @CurrentUser() user: AuthenticatedUser,
    @LoadedImport() job: CatalogImportJobWithSeller,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.idempotency.run(`cat-imp:${id}:commit`, idempotencyKey, {}, () =>
      this.importsService.commit(job, user),
    );
  }
}
