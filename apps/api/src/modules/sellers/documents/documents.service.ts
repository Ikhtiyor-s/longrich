import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../../common/storage/storage.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ForbiddenError, ValidationError } from '../../../common/http/api-error';
import { SellersService } from '../sellers.service';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { CreateDocumentDto } from './dto/create-document.dto';
import { loadSellerDocumentUploadConfig } from './documents.config';
import { MALWARE_SCAN_ADAPTER, type MalwareScanAdapter } from './malware-scan.adapter';
import type { SellerDocumentWithSeller } from './document-access.guard';
import { toDocumentPayload } from './documents.mapper';

// Strips path separators/control characters so a client-supplied filename
// can never influence the object_key's directory structure (path traversal
// via "../" or an embedded "/").
function sanitizeFilenameSegment(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-128);
}

function buildObjectKey(sellerId: string, type: string, filename: string): string {
  const sanitizedType = type.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `seller-documents/${sellerId}/${sanitizedType}/${randomUUID()}-${sanitizeFilenameSegment(filename)}`;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellersService: SellersService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    @Inject(MALWARE_SCAN_ADAPTER) private readonly scanAdapter: MalwareScanAdapter,
  ) {}

  private async requireMembership(sellerId: string, userId: string): Promise<void> {
    const membership = await this.sellersService.findMembership(sellerId, userId);
    if (!membership) {
      throw new ForbiddenError('Caller is not a member of this seller.');
    }
  }

  private assertUploadAllowed(mimeType: string, sizeBytes: number): void {
    const config = loadSellerDocumentUploadConfig();
    const details: Record<string, string[]> = {};

    if (!config.allowedMimeTypes.includes(mimeType)) {
      details.mime_type = [
        `mime_type "${mimeType}" is not allowed. Allowed types: ${config.allowedMimeTypes.join(', ')}.`,
      ];
    }
    if (sizeBytes > config.maxSizeBytes) {
      details.size_bytes = [
        `size_bytes exceeds the maximum allowed size of ${config.maxSizeBytes} bytes.`,
      ];
    }

    if (Object.keys(details).length > 0) {
      throw new ValidationError('Seller document upload rejected.', details);
    }
  }

  async create(actor: AuthenticatedUser, dto: CreateDocumentDto) {
    await this.requireMembership(dto.seller_id, actor.id);
    this.assertUploadAllowed(dto.mime_type, dto.size_bytes);

    const objectKey = buildObjectKey(dto.seller_id, dto.type, dto.filename);
    const upload = await this.storageService.createPresignedUploadUrl(objectKey, dto.mime_type);

    const document = await this.prisma.sellerDocument.create({
      data: {
        sellerId: dto.seller_id,
        type: dto.type,
        objectKey,
        fileName: dto.filename,
        mimeType: dto.mime_type,
        sizeBytes: dto.size_bytes,
      },
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'seller_document.upload_requested',
      entityType: 'seller_document',
      entityId: document.id,
      after: { seller_id: document.sellerId, type: document.type, object_key: document.objectKey },
    });

    return toDocumentPayload(document, {
      uploadUrl: upload.url,
      expiresInSeconds: upload.expiresInSeconds,
    });
  }

  async list(actor: AuthenticatedUser, sellerId: string) {
    await this.requireMembership(sellerId, actor.id);

    const documents = await this.prisma.sellerDocument.findMany({
      where: { sellerId },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });
    return documents.map((document) => toDocumentPayload(document));
  }

  async findOne(loaded: SellerDocumentWithSeller) {
    return toDocumentPayload(loaded);
  }

  async confirm(loaded: SellerDocumentWithSeller, actor: AuthenticatedUser) {
    // Already decided (VERIFIED/REJECTED) — idempotent no-op, never re-scans
    // or flips a terminal decision back. Only a PENDING document is scanned.
    if (loaded.verificationStatus !== 'PENDING') {
      return toDocumentPayload(loaded);
    }

    const result = await this.scanAdapter.scan(loaded.objectKey, loaded.mimeType);
    const verificationStatus = result.clean ? 'VERIFIED' : 'REJECTED';

    // Compare-and-swap (G1 QA review major #2): guards against a concurrent
    // confirm() call on the same PENDING document. Unlike the moderation/
    // suspension/bank-account CAS sites, losing this race is not itself an
    // error — a concurrent call already recorded a real decision for this
    // document, so the loser just returns that decision (idempotent no-op,
    // same semantics as the already-decided early return above) instead of
    // writing a second, redundant audit entry.
    const claim = await this.prisma.sellerDocument.updateMany({
      where: { id: loaded.id, version: loaded.version, verificationStatus: 'PENDING' },
      data: {
        verificationStatus,
        scannedAt: result.scannedAt,
        version: { increment: 1 },
      },
    });
    const updated = await this.prisma.sellerDocument.findUniqueOrThrow({
      where: { id: loaded.id },
    });
    if (claim.count === 0) {
      return toDocumentPayload(updated);
    }

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'seller_document.scanned',
      entityType: 'seller_document',
      entityId: updated.id,
      before: { verification_status: 'PENDING' },
      after: { verification_status: updated.verificationStatus },
    });

    return toDocumentPayload(updated);
  }
}
