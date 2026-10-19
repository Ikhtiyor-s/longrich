import { forwardRef, Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { JwtAuthGuard } from '../identity/auth/auth.guard';
import { OwnershipGuard } from '../../common/guards/ownership.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { SellersModule } from '../sellers/sellers.module';
import { SellerPermissionGuard } from '../sellers/members/seller-permission.guard';
import { CatalogModule } from '../catalog/catalog.module';
import { OffersService } from './seller-offers.service';
import { OfferAccessGuard } from './offer-access.guard';
import { SellerOffersController } from './seller-offers.controller';
import { PublicOffersController } from './public-offers.controller';
import { PriceHistoryService } from './price-history/price-history.service';
import { OfferModerationController } from './moderation/offer-moderation.controller';
import { OfferModerationService } from './moderation/offer-moderation.service';

// T-G2-5: first real code in this module (replacing the empty ADR-001
// stub). Imports CatalogModule for VariantsService (cross-module boundary
// rule, api-contract-g2.md: offers validates a target variant via catalog's
// exported VariantsService.findPublishedOrThrow, never a direct Prisma
// read of catalog's own models) and SellersModule for SellersService
// (membership/ACTIVE-status lookups, same as every seller-scoped module).
// JwtAuthGuard/OwnershipGuard/SellerPermissionGuard are re-declared as
// providers here per the same pattern CatalogModule/SellersModule already
// use (Nest instantiates class-reference guards scoped to the consuming
// module) — SellerPermissionGuard is reused verbatim from
// sellers/members/ (its own module doesn't export it, so it is re-provided
// here exactly as JwtAuthGuard/PermissionGuard already are in
// CatalogModule), not a second seller-permission mechanism.
//
// T-G2-6 implements OffersService.repointVariantOwnership (the method
// T-G2-6's merge-case approval calls via DI, per
// api-contract-g2.md's file-structure note) directly on this service —
// CatalogModule now imports OffersModule (forwardRef, see below) to inject
// OffersService into MergeCasesService.
//
// T-G2-7 adds OfferModerationController/Service (offer moderation decisions
// — offers' half of the catalog/offers module split, per
// api-contract-g2.md's resolved "exact module home" note). Gated on
// offers:moderate via the existing JwtAuthGuard+PermissionGuard already
// provided below — no new guard needed on this side, unlike catalog's
// shared queue endpoint.
//
// forwardRef(() => CatalogModule): T-G2-6 made this circular — CatalogModule
// now also imports OffersModule (for OffersService.repointVariantOwnership,
// called from MergeCasesService) while this module still imports
// CatalogModule (for VariantsService). Standard Nest circular-module-
// dependency resolution: both sides wrap the import in forwardRef (see
// catalog.module.ts's mirrored forwardRef(() => OffersModule)).
@Module({
  imports: [IdentityModule, SellersModule, forwardRef(() => CatalogModule)],
  controllers: [SellerOffersController, PublicOffersController, OfferModerationController],
  providers: [
    OffersService,
    PriceHistoryService,
    OfferModerationService,
    OfferAccessGuard,
    JwtAuthGuard,
    OwnershipGuard,
    SellerPermissionGuard,
    PermissionGuard,
    IdempotencyService,
  ],
  exports: [OffersService],
})
export class OffersModule {}
