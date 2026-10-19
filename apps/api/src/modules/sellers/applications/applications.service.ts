import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { InvalidStateTransitionError, ValidationError } from '../../../common/http/api-error';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { AcceptContractDto } from './dto/accept-contract.dto';
import type { SellerApplicationWithSeller } from './application-access.guard';
import { toApplicationPayload, toContractPayload } from './applications.mapper';

// The real contract-versioning/e-sign process is legally unconfirmed
// (TZ §06 SEL-004 "where applicable"; docs/open-questions.md #12) — this is
// an engineering placeholder for "the one current contract version," not a
// business decision. Bump manually if/when the actual contract text changes;
// historical acceptances stay keyed to whatever version they were accepted
// against (seller_contracts is append-only, never overwritten).
export const CURRENT_SELLER_CONTRACT_VERSION = 1;

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(userId: string, dto: CreateApplicationDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const seller = await tx.seller.create({
        data: {
          legalName: dto.legal_name,
          taxId: dto.tax_id,
          legalType: dto.legal_type,
          displayName: dto.display_name,
        },
      });
      const application = await tx.sellerApplication.create({
        data: {
          sellerId: seller.id,
          ...(dto.contacts !== undefined
            ? { contacts: dto.contacts as Prisma.InputJsonValue }
            : {}),
        },
      });
      await tx.sellerMember.create({
        data: { sellerId: seller.id, userId, role: 'OWNER' },
      });
      return { seller, application };
    });

    await this.auditService.record({
      actor: { id: userId, type: 'USER' },
      action: 'seller_application.created',
      entityType: 'seller_application',
      entityId: result.application.id,
      after: { seller_id: result.seller.id, status: result.application.status },
    });

    return toApplicationPayload(result.seller, result.application);
  }

  async findOne(loaded: SellerApplicationWithSeller) {
    return toApplicationPayload(loaded.seller, loaded);
  }

  // Editable from DRAFT (first-time intake) and NEEDS_CHANGES (a moderator
  // sent it back for correction) — not just DRAFT. Without NEEDS_CHANGES
  // here, an applicant sent back for changes had no way to ever edit or
  // resubmit (G1 QA review major #3): a real dead end.
  async update(loaded: SellerApplicationWithSeller, dto: UpdateApplicationDto) {
    if (loaded.status !== 'DRAFT' && loaded.status !== 'NEEDS_CHANGES') {
      throw new InvalidStateTransitionError(
        `Seller application cannot be edited while in status ${loaded.status}.`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Guarded against both the caller's own loaded.seller/loaded rows
      // having gone stale (optimistic concurrency, G1 QA review major #2):
      // updateMany's WHERE re-checks version at write time, so a concurrent
      // write between our read and this write loses the row count and this
      // request gets a 409 instead of silently clobbering the other
      // request's result. Mirrors SessionService.rotateRefreshToken /
      // OtpService.rejectAttempt's compare-and-swap idiom.
      const sellerClaim = await tx.seller.updateMany({
        where: { id: loaded.sellerId, version: loaded.seller.version },
        data: {
          ...(dto.legal_name !== undefined ? { legalName: dto.legal_name } : {}),
          ...(dto.tax_id !== undefined ? { taxId: dto.tax_id } : {}),
          ...(dto.legal_type !== undefined ? { legalType: dto.legal_type } : {}),
          ...(dto.display_name !== undefined ? { displayName: dto.display_name } : {}),
          version: { increment: 1 },
        },
      });
      const applicationClaim = await tx.sellerApplication.updateMany({
        where: { id: loaded.id, version: loaded.version, status: loaded.status },
        data: {
          ...(dto.contacts !== undefined
            ? { contacts: dto.contacts as Prisma.InputJsonValue }
            : {}),
          version: { increment: 1 },
        },
      });
      if (sellerClaim.count === 0 || applicationClaim.count === 0) {
        throw new InvalidStateTransitionError(
          'Seller application was modified by another request; reload and retry.',
        );
      }

      const seller = await tx.seller.findUniqueOrThrow({ where: { id: loaded.sellerId } });
      const application = await tx.sellerApplication.findUniqueOrThrow({
        where: { id: loaded.id },
      });
      return { seller, application };
    });

    return toApplicationPayload(result.seller, result.application);
  }

  async acceptContract(loaded: SellerApplicationWithSeller, dto: AcceptContractDto) {
    if (loaded.status !== 'DRAFT') {
      throw new InvalidStateTransitionError(
        `Contract cannot be accepted while application is in status ${loaded.status}.`,
      );
    }

    const version = dto.contract_version ?? CURRENT_SELLER_CONTRACT_VERSION;
    const existing = await this.prisma.sellerContract.findUnique({
      where: { sellerId_version: { sellerId: loaded.sellerId, version } },
    });
    if (existing) {
      return toContractPayload(existing);
    }

    const contract = await this.prisma.sellerContract.create({
      data: {
        sellerId: loaded.sellerId,
        version,
        signedKey: `seller-contract-ack:${loaded.sellerId}:v${version}`,
        acceptedAt: new Date(),
      },
    });
    return toContractPayload(contract);
  }

  // NEEDS_CHANGES is also a valid starting state (resubmission after
  // moderator feedback), not just DRAFT — the other half of the G1 QA
  // review major #3 fix: DRAFT->SUBMITTED is a first submission,
  // NEEDS_CHANGES->SUBMITTED is a resubmission, both land on the same
  // SUBMITTED target and the same completeness gate below, but are
  // distinguished in the emitted event/audit action so a moderator or any
  // downstream consumer can tell "first time" from "sent back once already"
  // without inferring it from application history.
  async submit(
    loaded: SellerApplicationWithSeller,
    actor: AuthenticatedUser,
    requestContext: { requestId: string | null; traceId: string | null },
  ) {
    const isResubmission = loaded.status === 'NEEDS_CHANGES';
    if (loaded.status !== 'DRAFT' && !isResubmission) {
      throw new InvalidStateTransitionError(
        `Seller application cannot be submitted while in status ${loaded.status}.`,
      );
    }

    const [documentCount, contract] = await Promise.all([
      // T-G1-3: a document whose malware scan came back REJECTED does not
      // satisfy the completeness gate — only a PENDING (not yet scanned) or
      // VERIFIED (clean) document counts. A seller whose only upload was
      // rejected must re-upload a new version (seller_documents is
      // append-only, see DocumentsService.create) before they can submit.
      this.prisma.sellerDocument.count({
        where: { sellerId: loaded.sellerId, verificationStatus: { not: 'REJECTED' } },
      }),
      this.prisma.sellerContract.findFirst({ where: { sellerId: loaded.sellerId } }),
    ]);

    const missing: string[] = [];
    if (documentCount === 0) missing.push('documents');
    if (!contract) missing.push('contract_acceptance');
    if (missing.length > 0) {
      throw new ValidationError('Seller application is missing required items for submission.', {
        missing,
      });
    }

    const eventType = isResubmission
      ? 'seller_application.resubmitted.v1'
      : 'seller_application.submitted.v1';
    const auditAction = isResubmission
      ? 'seller_application.resubmitted'
      : 'seller_application.submitted';

    const result = await this.prisma.$transaction(async (tx) => {
      // Same compare-and-swap guard as update() above (G1 QA review major
      // #2): re-checks both version and the starting status at write time.
      const applicationClaim = await tx.sellerApplication.updateMany({
        where: { id: loaded.id, version: loaded.version, status: loaded.status },
        data: { status: 'SUBMITTED', version: { increment: 1 } },
      });
      const sellerClaim = await tx.seller.updateMany({
        where: {
          id: loaded.sellerId,
          version: loaded.seller.version,
          status: loaded.seller.status,
        },
        data: { status: 'SUBMITTED', version: { increment: 1 } },
      });
      if (applicationClaim.count === 0 || sellerClaim.count === 0) {
        throw new InvalidStateTransitionError(
          'Seller application was modified by another request; reload and retry.',
        );
      }

      const application = await tx.sellerApplication.findUniqueOrThrow({
        where: { id: loaded.id },
      });
      const seller = await tx.seller.findUniqueOrThrow({ where: { id: loaded.sellerId } });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'seller_application',
          aggregateId: application.id,
          eventType,
          payload: {
            application_id: application.id,
            seller_id: seller.id,
            submitted_at: application.updatedAt.toISOString(),
          },
          occurredAt: new Date(),
        },
      });
      return { seller, application };
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: auditAction,
      entityType: 'seller_application',
      entityId: loaded.id,
      before: { status: loaded.status },
      after: { status: 'SUBMITTED' },
      requestId: requestContext.requestId,
      traceId: requestContext.traceId,
    });

    return toApplicationPayload(result.seller, result.application);
  }
}
