import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../../common/storage/storage.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ForbiddenError, InvalidStateTransitionError, ValidationError } from '../../../common/http/api-error';
import {
  CURSOR_KEYSET_ORDER_BY,
  cursorKeysetWhere,
  decodeCursor,
  paginate,
} from '../../../common/pagination/cursor';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { SellersService } from '../../sellers/sellers.service';
import { sellerRoleHasPermission } from '../../sellers/members/seller-permissions';
import type { CatalogImportJobWithSeller } from './import-access.guard';
import { CATALOG_IMPORT_QUEUE } from './import-queue';
import { toImportErrorPayload, toImportJobPayload, toImportUploadPayload } from './imports.mapper';
import { loadCatalogImportUploadConfig } from './imports.config';
import { CreateImportDto } from './dto/create-import.dto';
import { ListImportsQueryDto } from './dto/list-imports.query.dto';
import { ListImportErrorsQueryDto } from './dto/list-import-errors.query.dto';

export interface RequestContext {
  requestId: string | null;
  traceId: string | null;
}

const DEFAULT_PAGE_LIMIT = 20;

function sanitizeFilenameSegment(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-128);
}

function buildObjectKey(sellerId: string, filename: string): string {
  return `catalog-imports/${sellerId}/${randomUUID()}-${sanitizeFilenameSegment(filename)}`;
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly sellersService: SellersService,
    @Inject(CATALOG_IMPORT_QUEUE) private readonly queue: Queue,
  ) {}

  // Same two-reasons-for-403 split OffersService.requireOffersManagePermission
  // already uses: no membership at all is a cross-seller denial (not
  // audited — the caller never had a role to check); a membership lacking
  // seller:offers:manage is a real privilege denial (audited).
  private async requireImportPermission(sellerId: string, actorId: string) {
    const membership = await this.sellersService.findMembership(sellerId, actorId);
    if (!membership) {
      throw new ForbiddenError('Caller is not a member of this seller.');
    }
    if (!sellerRoleHasPermission(membership.role, 'seller:offers:manage')) {
      await this.auditService.record({
        actor: { id: actorId, type: 'USER' },
        action: 'authz.permission_denied',
        entityType: 'seller_permission',
        entityId: 'seller:offers:manage',
        after: { seller_id: sellerId, caller_role: membership.role },
      });
      throw new ForbiddenError('Only a seller OWNER or MANAGER can trigger a catalog import.');
    }
    return membership;
  }

  private assertUploadAllowed(mimeType: string, sizeBytes: number): void {
    const config = loadCatalogImportUploadConfig();
    const details: Record<string, string[]> = {};
    if (!config.allowedMimeTypes.includes(mimeType)) {
      details.mime_type = [
        `mime_type "${mimeType}" is not allowed. Allowed types: ${config.allowedMimeTypes.join(', ')}.`,
      ];
    }
    if (sizeBytes > config.maxSizeBytes) {
      details.size_bytes = [`size_bytes exceeds the maximum allowed size of ${config.maxSizeBytes} bytes.`];
    }
    if (Object.keys(details).length > 0) {
      throw new ValidationError('Catalog import upload rejected.', details);
    }
  }

  async create(actor: AuthenticatedUser, dto: CreateImportDto) {
    await this.requireImportPermission(dto.seller_id, actor.id);
    this.assertUploadAllowed(dto.mime_type, dto.size_bytes);

    const objectKey = buildObjectKey(dto.seller_id, dto.filename);
    const upload = await this.storageService.createPresignedUploadUrl(objectKey, dto.mime_type);

    const job = await this.prisma.catalogImportJob.create({
      data: { sellerId: dto.seller_id, objectKey, createdBy: actor.id },
    });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'catalog_import_job.upload_requested',
      entityType: 'catalog_import_job',
      entityId: job.id,
      after: { seller_id: job.sellerId, object_key: job.objectKey },
    });

    return toImportUploadPayload(job, { url: upload.url, expiresInSeconds: upload.expiresInSeconds });
  }

  async confirm(loaded: CatalogImportJobWithSeller, actor: AuthenticatedUser) {
    const claim = await this.prisma.catalogImportJob.updateMany({
      where: { id: loaded.id, version: loaded.version, status: 'UPLOADED' },
      data: { status: 'VALIDATING', version: { increment: 1 } },
    });
    if (claim.count === 0) {
      throw new InvalidStateTransitionError('Import job is not in an UPLOADED state.');
    }

    await this.queue.add('validate', { jobId: loaded.id });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'catalog_import_job.confirmed',
      entityType: 'catalog_import_job',
      entityId: loaded.id,
    });

    const updated = await this.prisma.catalogImportJob.findUniqueOrThrow({ where: { id: loaded.id } });
    return toImportJobPayload(updated);
  }

  async commit(loaded: CatalogImportJobWithSeller, actor: AuthenticatedUser) {
    const claim = await this.prisma.catalogImportJob.updateMany({
      where: { id: loaded.id, version: loaded.version, status: 'READY' },
      data: { status: 'IMPORTING', version: { increment: 1 } },
    });
    if (claim.count === 0) {
      throw new InvalidStateTransitionError('Import job is not in a READY state.');
    }

    await this.queue.add('commit', { jobId: loaded.id });

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'catalog_import_job.commit_requested',
      entityType: 'catalog_import_job',
      entityId: loaded.id,
    });

    const updated = await this.prisma.catalogImportJob.findUniqueOrThrow({ where: { id: loaded.id } });
    return toImportJobPayload(updated);
  }

  findOne(loaded: CatalogImportJobWithSeller) {
    return toImportJobPayload(loaded);
  }

  async list(actor: AuthenticatedUser, sellerId: string, query: ListImportsQueryDto) {
    const membership = await this.sellersService.findMembership(sellerId, actor.id);
    if (!membership) {
      throw new ForbiddenError('Caller is not a member of this seller.');
    }

    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.prisma.catalogImportJob.findMany({
      where: {
        sellerId,
        ...(query.status ? { status: query.status as never } : {}),
        ...(cursorKeysetWhere(cursor) ?? {}),
      },
      orderBy: CURSOR_KEYSET_ORDER_BY,
      take: limit + 1,
    });

    const { items, nextCursor } = paginate(rows, limit);
    return { items: items.map(toImportJobPayload), next_cursor: nextCursor };
  }

  async listErrors(loaded: CatalogImportJobWithSeller, query: ListImportErrorsQueryDto) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.prisma.catalogImportError.findMany({
      where: { jobId: loaded.id, ...(cursorKeysetWhere(cursor) ?? {}) },
      orderBy: CURSOR_KEYSET_ORDER_BY,
      take: limit + 1,
    });

    const { items, nextCursor } = paginate(rows, limit);
    return { items: items.map(toImportErrorPayload), next_cursor: nextCursor };
  }
}
