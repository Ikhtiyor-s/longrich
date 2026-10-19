import { forwardRef, Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { JwtAuthGuard } from '../identity/auth/auth.guard';
import { OwnershipGuard } from '../../common/guards/ownership.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { MALWARE_SCAN_ADAPTER, MockMalwareScanAdapter } from '../sellers/documents/malware-scan.adapter';
import { SellersModule } from '../sellers/sellers.module';
import { SellerPermissionGuard } from '../sellers/members/seller-permission.guard';
import { OffersModule } from '../offers/offers.module';
import { CatalogService } from './catalog.service';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { CategoryAttributesController } from './category-attributes/category-attributes.controller';
import { CategoryAttributesService } from './category-attributes/category-attributes.service';
import { BrandsController } from './brands/brands.controller';
import { BrandsService } from './brands/brands.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { VariantsController } from './variants/variants.controller';
import { VariantsService } from './variants/variants.service';
import { MediaController } from './media/media.controller';
import { MediaService } from './media/media.service';
import { IdentifiersController } from './identifiers/identifiers.controller';
import { IdentifiersService } from './identifiers/identifiers.service';
import { CatalogModerationController } from './moderation/catalog-moderation.controller';
import { CatalogModerationService } from './moderation/catalog-moderation.service';
import { ModerationQueueAccessGuard } from './moderation/moderation-queue-access.guard';
import { MergeCasesController } from './merge-cases/merge-cases.controller';
import { MergeCasesService } from './merge-cases/merge-cases.service';
import { MergeCaseViewGuard } from './merge-cases/merge-case-view.guard';
import { ImportsController } from './imports/imports.controller';
import { ImportsService } from './imports/imports.service';
import { ImportAccessGuard } from './imports/import-access.guard';
import { ImportRowProcessor } from './imports/import-row-processor';
import { CatalogImportWorker } from './imports/import-worker';
import { catalogImportQueueProviders } from './imports/import-queue';

// T-G2-2 adds the first two controllers to this module (category taxonomy +
// per-category attribute schema). T-G2-3 adds brands/products/variants/media
// (the product/variant/brand/media lifecycle, gated on the same
// `category:manage` grant — see api-contract-g2.md's "Resolved here, not
// left ambiguous" note on why product authorship reuses the taxonomy-admin
// code rather than a dedicated fifth permission). Read is public; write is
// gated on `category:manage` via JwtAuthGuard+PermissionGuard — no
// OwnershipGuard, per docs/architecture/api-contract-g2.md (these are
// platform-wide admin resources, not seller_id-scoped). JwtAuthGuard/
// PermissionGuard are re-declared as providers here per the same pattern
// SellersModule uses (Nest instantiates class-reference guards scoped to
// the consuming module) — they resolve against IdentityModule's exported
// AuthJwtService + the global PrismaService, not a duplicate implementation.
// MALWARE_SCAN_ADAPTER reuses T-G1-3's token/mock verbatim (imported
// straight from the sellers/documents module, not re-declared) per the
// ticket's own "no second adapter invented" instruction — scoped to a fresh
// provider binding here, same as JwtAuthGuard/PermissionGuard above.
// T-G2-7 adds CatalogModerationController/Service (product/variant/media
// moderation decisions, catalog's half of the catalog/offers module split —
// see api-contract-g2.md's resolved "exact module home" note) plus
// ModerationQueueAccessGuard, a small dedicated OR-permission guard for the
// shared GET moderation-queue endpoint (viewable on either catalog:moderate
// or offers:moderate, per the contract) — PermissionGuard itself is
// untouched, this is an additional guard, not a change to its contract.
//
// T-G2-6 adds MergeCasesController/Service (+ its own small OR-permission
// guard, MergeCaseViewGuard, same shape/reasoning as ModerationQueueAccessGuard
// above but scoped to category:manage|merge_case:approve). MergeCasesService
// injects offers' exported OffersService to call
// repointVariantOwnership(tx, ...) inside its own approve transaction, per
// api-contract-g2.md's catalog<->offers cross-module boundary rule — this is
// the one place CatalogModule needs OffersModule, which itself already
// imports CatalogModule (for VariantsService); forwardRef on both sides
// breaks that module-level circularity (standard Nest pattern, see
// offers.module.ts's own mirrored forwardRef).
//
// T-G2-8 adds ImportsController/Service (seller-scoped, SellersModule's
// SellersService is reached via SellersModule — see sellers import below,
// mirroring offers.module.ts's own SellersModule import). ImportRowProcessor
// is the BullMQ job body (reuses ProductsService/VariantsService/
// IdentifiersService directly — same module — and offers' exported
// OffersService via the existing forwardRef); CatalogImportWorker is the
// first real BullMQ consumer registered anywhere in this codebase
// (import-worker.ts's own comment explains why it is registered here rather
// than on a separate api-only/worker-only module graph, which doesn't exist
// in this codebase).
@Module({
  imports: [IdentityModule, SellersModule, forwardRef(() => OffersModule)],
  controllers: [
    CategoriesController,
    CategoryAttributesController,
    BrandsController,
    ProductsController,
    VariantsController,
    MediaController,
    IdentifiersController,
    CatalogModerationController,
    MergeCasesController,
    ImportsController,
  ],
  providers: [
    CatalogService,
    CategoriesService,
    CategoryAttributesService,
    BrandsService,
    ProductsService,
    VariantsService,
    MediaService,
    IdentifiersService,
    CatalogModerationService,
    ModerationQueueAccessGuard,
    MergeCasesService,
    MergeCaseViewGuard,
    ImportsService,
    ImportAccessGuard,
    ImportRowProcessor,
    CatalogImportWorker,
    ...catalogImportQueueProviders,
    IdempotencyService,
    JwtAuthGuard,
    OwnershipGuard,
    SellerPermissionGuard,
    PermissionGuard,
    { provide: MALWARE_SCAN_ADAPTER, useClass: MockMalwareScanAdapter },
  ],
  exports: [CatalogService, ProductsService, VariantsService, IdentifiersService],
})
export class CatalogModule {}
