import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { JwtAuthGuard } from '../identity/auth/auth.guard';
import { OwnershipGuard } from '../../common/guards/ownership.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { SellersService } from './sellers.service';
import { ApplicationsController } from './applications/applications.controller';
import { ApplicationsService } from './applications/applications.service';
import { ApplicationAccessGuard } from './applications/application-access.guard';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { DocumentAccessGuard } from './documents/document-access.guard';
import { MALWARE_SCAN_ADAPTER, MockMalwareScanAdapter } from './documents/malware-scan.adapter';
import { MembersController } from './members/members.controller';
import { MembersService } from './members/members.service';
import { MemberAccessGuard } from './members/member-access.guard';
import { SellerPermissionGuard } from './members/seller-permission.guard';
import { ModerationController } from './moderation/moderation.controller';
import { ModerationService } from './moderation/moderation.service';
import { SuspensionController } from './suspension/suspension.controller';
import { SuspensionService } from './suspension/suspension.service';
import { ProfileController } from './profile/profile.controller';
import { ProfileService } from './profile/profile.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { FinanceController } from './finance/finance.controller';
import { FinanceService } from './finance/finance.service';
import { BankAccountsController } from './finance/bank-accounts.controller';
import { BankAccountReviewController } from './finance/bank-account-review.controller';
import { BankAccountReviewService } from './finance/bank-account-review.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';

// T-G1-2: first controller in this module (seller application intake).
// T-G1-3 adds the documents controller (KYB document upload).
// T-G1-4 adds the members controller (staff/team RBAC — invite, list,
// promote/demote, OWNER-only, per docs/open-questions.md #30's resolution).
// T-G1-5 adds moderation (seller_applications review decisions + the
// separate APPROVED->ACTIVE step) and suspension (sellers suspend/reinstate)
// — both admin-side (PermissionGuard: seller:moderate / seller:suspend), not
// seller_members-scoped, so they do not use ApplicationAccessGuard/
// OwnershipGuard/MemberAccessGuard at all.
// T-G1-6 adds the profile controller (shop profile GET/PATCH, OWNER/MANAGER
// via seller:profile:manage) — service-level membership+permission checks
// like MembersService.invite/DocumentsService.create, not the
// AccessGuard+OwnershipGuard+SellerPermissionGuard pipeline, because there
// is no :id path param for a Guard to load a target resource from.
// JwtAuthGuard is re-declared as a provider here per the same pattern
// admin-audit's module uses (Nest instantiates class-reference guards scoped
// to the consuming module) — it resolves against IdentityModule's exported
// AuthJwtService + the global PrismaService, not a duplicate implementation.
// T-G1-7 adds the dashboard controller (shell GET /v1/seller/dashboard,
// membership-only like profile's GET — the three new permission codes it
// registers in members/seller-permissions.ts have no gate here; they exist
// for G2/G3/G4/G6's future real endpoints) and registers
// seller:offers:manage/seller:inventory:view/seller:orders:view in the same
// lookup table SellerPermissionGuard already reads, no parallel mechanism.
// T-G1-8 adds the finance/bank-account surface: FinanceController
// (GET /v1/seller/finance/summary — NOT_AVAILABLE placeholder until G5) and
// BankAccountsController (GET/POST /v1/seller/bank-accounts — seller-side,
// service-level seller:finance:view/seller:bank:manage checks, same style
// as MembersService/ProfileService) share one FinanceService.
// BankAccountReviewController (POST /v1/seller/bank-accounts/:id/approve,
// /reject — admin-side, PermissionGuard: seller:moderate, same code T-G1-5
// already seeded to MODERATOR) is its own controller+service mirroring
// ModerationController/ModerationService's split, and shares its base path
// with BankAccountsController without route collision, same as
// ApplicationsController/ModerationController both being
// @Controller('v1/seller-applications').
@Module({
  imports: [IdentityModule],
  controllers: [
    ApplicationsController,
    DocumentsController,
    MembersController,
    ModerationController,
    SuspensionController,
    ProfileController,
    DashboardController,
    FinanceController,
    BankAccountsController,
    BankAccountReviewController,
  ],
  providers: [
    SellersService,
    ApplicationsService,
    ApplicationAccessGuard,
    DocumentsService,
    DocumentAccessGuard,
    { provide: MALWARE_SCAN_ADAPTER, useClass: MockMalwareScanAdapter },
    MembersService,
    MemberAccessGuard,
    SellerPermissionGuard,
    ModerationService,
    SuspensionService,
    ProfileService,
    DashboardService,
    FinanceService,
    BankAccountReviewService,
    IdempotencyService,
    JwtAuthGuard,
    OwnershipGuard,
    PermissionGuard,
  ],
  exports: [SellersService],
})
export class SellersModule {}
