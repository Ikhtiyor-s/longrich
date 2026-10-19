import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { IdentifierType } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { StorageService } from '../../../common/storage/storage.service';
import { AuditService } from '../../../common/audit/audit.service';
import type { AuthenticatedUser } from '../../identity/auth/current-user.decorator';
import { IdentifiersService } from '../identifiers/identifiers.service';
import { ProductsService } from '../products/products.service';
import { VariantsService } from '../variants/variants.service';
import { OffersService } from '../../offers/seller-offers.service';
import { CsvParseError, parseCsv } from './csv-parser';
import { assertRequiredHeadersPresent, extractRawRow, validateRow, type RowValidationDeps } from './import-row-schema';
import { loadCatalogImportUploadConfig } from './imports.config';

const SYSTEM_SESSION_ID = 'catalog-import-worker';

// BullMQ job handler — the actual background work for both the confirm
// (validate) and commit steps (apps/api/src/modules/catalog/imports/
// import-worker.ts registers the Worker that calls into this class).
// Reuses catalog's own ProductsService/VariantsService/IdentifiersService
// directly (same module) and offers' exported OffersService via DI
// (cross-module boundary rule, api-contract-g2.md) — a CSV row is "create a
// product+variant+identifiers+offer via the same rules as the individual
// endpoints" per the ticket's own instruction, not a second validation path.
@Injectable()
export class ImportRowProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly identifiersService: IdentifiersService,
    private readonly productsService: ProductsService,
    private readonly variantsService: VariantsService,
    private readonly offersService: OffersService,
  ) {}

  private systemActor(userId: string): AuthenticatedUser {
    return { id: userId, sessionId: SYSTEM_SESSION_ID };
  }

  private lookupDeps(): RowValidationDeps {
    return {
      findVariantIdByIdentifier: async (type: IdentifierType, value: string) => {
        const identifier = await this.identifiersService.findByTypeValue(type, value);
        if (!identifier) {
          return null;
        }
        const variant = await this.prisma.productVariant.findUnique({
          where: { id: identifier.variantId },
        });
        return variant && variant.status === 'PUBLISHED' ? variant.id : null;
      },
      categoryExists: async (categoryId: string) => {
        const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
        return Boolean(category);
      },
    };
  }

  private async failJob(jobId: string, version: number, field: string, message: string): Promise<void> {
    await this.prisma.catalogImportError.create({ data: { jobId, rowNumber: 0, field, message } });
    await this.prisma.catalogImportJob.updateMany({
      where: { id: jobId, version },
      data: { status: 'FAILED', version: { increment: 1 } },
    });
  }

  // VALIDATING -> READY|COMPLETED(duplicate)|FAILED. Idempotent against
  // BullMQ at-least-once redelivery: a job no longer in VALIDATING (already
  // processed by an earlier delivery attempt) is a silent no-op, the same
  // "check current state before redoing the side effect" idea
  // g0-design-notes.md §9's inbox pattern uses for outbox-sourced jobs — this
  // job isn't outbox-sourced, so the job's own status column is the
  // dedup signal instead of a separate InboxProcessedEvent row.
  async validateJob(jobId: string): Promise<void> {
    const job = await this.prisma.catalogImportJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'VALIDATING') {
      return;
    }

    const buffer = await this.storageService.getObjectBuffer(job.objectKey);
    const contentHash = createHash('sha256').update(buffer).digest('hex');

    const duplicate = await this.prisma.catalogImportJob.findFirst({
      where: { sellerId: job.sellerId, contentHash, status: { not: 'FAILED' }, id: { not: job.id } },
      orderBy: { createdAt: 'asc' },
    });

    if (duplicate) {
      // contentHash is deliberately NOT written on this row: the partial
      // unique index (catalog_import_jobs_seller_id_content_hash_active_key)
      // only allows one non-FAILED row per (seller_id, content_hash) — the
      // original `duplicate` row already holds that slot, so writing the
      // same hash here would violate the very constraint this duplicate
      // path exists to respect (reproduced: P2002 on every real duplicate
      // upload, leaving the job stuck in VALIDATING forever since the
      // throw happens before this row's status is ever updated). The
      // duplicate_of_job_id column is sufficient for the GET-endpoint
      // contract and the dedup query above never needs *this* row's hash.
      const claim = await this.prisma.catalogImportJob.updateMany({
        where: { id: job.id, version: job.version },
        data: {
          duplicateOfJobId: duplicate.id,
          status: 'COMPLETED',
          totalRows: 0,
          validRowCount: 0,
          errorRowCount: 0,
          version: { increment: 1 },
        },
      });
      if (claim.count > 0) {
        await this.auditService.record({
          actor: { id: job.createdBy, type: 'USER' },
          action: 'catalog_import_job.duplicate_detected',
          entityType: 'catalog_import_job',
          entityId: job.id,
          after: { duplicate_of_job_id: duplicate.id },
        });
      }
      return;
    }

    const text = buffer.toString('utf8');
    let parsed: { headers: string[]; rows: string[][] };
    try {
      parsed = parseCsv(text);
      assertRequiredHeadersPresent(parsed.headers);
    } catch (error) {
      const message = error instanceof CsvParseError ? error.message : 'File could not be parsed as CSV.';
      await this.failJob(job.id, job.version, 'file', message);
      return;
    }

    const config = loadCatalogImportUploadConfig();
    if (parsed.rows.length > config.maxRows) {
      await this.failJob(
        job.id,
        job.version,
        'file',
        `File exceeds the maximum of ${config.maxRows} rows.`,
      );
      return;
    }

    const deps = this.lookupDeps();
    const seenSkus = new Set<string>();
    const errorRows: { jobId: string; rowNumber: number; field: string; message: string }[] = [];
    let validCount = 0;

    for (let i = 0; i < parsed.rows.length; i += 1) {
      const rowNumber = i + 1;
      const raw = extractRawRow(parsed.headers, parsed.rows[i] as string[]);
      const result = await validateRow(raw, seenSkus, deps);
      if (result.ok) {
        validCount += 1;
      } else {
        for (const err of result.errors) {
          errorRows.push({ jobId: job.id, rowNumber, field: err.field, message: err.message });
        }
      }
    }

    if (errorRows.length > 0) {
      await this.prisma.catalogImportError.createMany({ data: errorRows });
    }

    const claim = await this.prisma.catalogImportJob.updateMany({
      where: { id: job.id, version: job.version, status: 'VALIDATING' },
      data: {
        contentHash,
        status: 'READY',
        totalRows: parsed.rows.length,
        validRowCount: validCount,
        errorRowCount: parsed.rows.length - validCount,
        version: { increment: 1 },
      },
    });
    if (claim.count === 0) {
      return;
    }

    await this.auditService.record({
      actor: { id: job.createdBy, type: 'USER' },
      action: 'catalog_import_job.validated',
      entityType: 'catalog_import_job',
      entityId: job.id,
      after: {
        total_rows: parsed.rows.length,
        valid_row_count: validCount,
        error_row_count: parsed.rows.length - validCount,
      },
    });
  }

  // IMPORTING -> COMPLETED|PARTIAL. Re-parses the same object (object_key is
  // immutable once set) and skips every row_number already recorded in
  // catalog_import_errors by the VALIDATING step, re-validating each
  // remaining row defensively (api-contract-g2.md: "a SKU collision
  // introduced by a concurrent request after validation" is explicitly
  // anticipated) rather than trusting the earlier classification blindly.
  async commitJob(jobId: string): Promise<void> {
    const job = await this.prisma.catalogImportJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'IMPORTING') {
      return;
    }

    const buffer = await this.storageService.getObjectBuffer(job.objectKey);
    const parsed = parseCsv(buffer.toString('utf8'));
    const actor = this.systemActor(job.createdBy);
    const requestContext = { requestId: null, traceId: null };

    const existingErrors = await this.prisma.catalogImportError.findMany({
      where: { jobId: job.id },
      select: { rowNumber: true },
    });
    const invalidRowNumbers = new Set(existingErrors.map((e) => e.rowNumber));

    const deps = this.lookupDeps();
    const seenSkus = new Set<string>();
    let anyFailure = false;

    for (let i = 0; i < parsed.rows.length; i += 1) {
      const rowNumber = i + 1;
      if (invalidRowNumbers.has(rowNumber)) {
        continue;
      }

      const raw = extractRawRow(parsed.headers, parsed.rows[i] as string[]);
      const result = await validateRow(raw, seenSkus, deps);

      if (!result.ok) {
        anyFailure = true;
        await this.prisma.catalogImportError.createMany({
          data: result.errors.map((err) => ({
            jobId: job.id,
            rowNumber,
            field: err.field,
            message: err.message,
          })),
        });
        continue;
      }

      try {
        if (result.data.action === 'CREATE_OFFER') {
          const offer = await this.offersService.create(
            actor,
            {
              seller_id: job.sellerId,
              variant_id: result.data.variantId,
              seller_sku: result.data.sellerSku,
              price_minor: result.data.priceMinor,
              currency: result.data.currency,
              fulfillment_mode: result.data.fulfillmentMode,
            },
            requestContext,
          );
          await this.prisma.catalogImportRow.create({
            data: {
              jobId: job.id,
              rowNumber,
              action: 'CREATE_OFFER',
              sellerOfferId: (offer as { id: string }).id,
            },
          });
        } else {
          const product = await this.productsService.create(
            actor,
            { category_id: result.data.categoryId, brand_id: null, title: result.data.title },
            requestContext,
          );
          const productId = (product as { id: string }).id;
          const variant = await this.variantsService.create(
            productId,
            actor,
            { options: { sku: result.data.sellerSku }, attribute_values: [] },
            requestContext,
          );
          const identifierResult = await this.identifiersService.create(
            (variant as { id: string }).id,
            actor,
            {
              type: result.data.identifierType,
              value: result.data.identifierValue,
              classification_version: result.data.classificationVersion ?? undefined,
            },
            requestContext,
          );

          // identifiersService.create can return (not throw)
          // CONFLICT_DETECTED — the product/variant were still created, but
          // with no identifier attached and a merge case opened elsewhere.
          // Previously this return value was discarded entirely, leaving
          // the seller with no way to discover the gap. Recorded as a row
          // error (the mechanism GET .../imports/{id}/errors already
          // surfaces) rather than a silent success.
          if ('status' in identifierResult && identifierResult.status === 'CONFLICT_DETECTED') {
            anyFailure = true;
            await this.prisma.catalogImportError.create({
              data: {
                jobId: job.id,
                rowNumber,
                field: 'identifier',
                message: `Identifier ${result.data.identifierType} ${result.data.identifierValue} conflicts with an existing identifier on a different product; merge case ${identifierResult.merge_case_id} was opened and this product was created without the identifier attached.`,
              },
            });
          }

          await this.prisma.catalogImportRow.create({
            data: { jobId: job.id, rowNumber, action: 'CREATE_DRAFT_PRODUCT', productId },
          });
        }
      } catch (error) {
        anyFailure = true;
        const message = error instanceof Error ? error.message : 'Commit failed for this row.';
        await this.prisma.catalogImportError.create({
          data: { jobId: job.id, rowNumber, field: 'row', message },
        });
      }
    }

    const finalStatus = anyFailure ? 'PARTIAL' : 'COMPLETED';
    const claim = await this.prisma.catalogImportJob.updateMany({
      where: { id: job.id, version: job.version, status: 'IMPORTING' },
      data: { status: finalStatus, version: { increment: 1 } },
    });
    if (claim.count === 0) {
      return;
    }

    await this.auditService.record({
      actor: { id: job.createdBy, type: 'USER' },
      action: 'catalog_import_job.committed',
      entityType: 'catalog_import_job',
      entityId: job.id,
      after: { status: finalStatus },
    });
  }
}
