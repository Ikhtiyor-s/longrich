import { ImportRowProcessor } from './import-row-processor';

const CSV_HEADER =
  'identifier_type,identifier_value,classification_version,seller_sku,price_minor,currency,fulfillment_mode,category_id,title\n';

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    sellerId: 'seller-1',
    status: 'VALIDATING',
    objectKey: 'catalog-imports/seller-1/file.csv',
    contentHash: null,
    totalRows: null,
    validRowCount: null,
    errorRowCount: null,
    duplicateOfJobId: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-10-18T10:00:00.000Z'),
    updatedAt: new Date('2026-10-18T10:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

function buildProcessor(overrides: {
  prisma?: Record<string, unknown>;
  storageService?: Record<string, unknown>;
  identifiersService?: Record<string, unknown>;
  productsService?: Record<string, unknown>;
  variantsService?: Record<string, unknown>;
  offersService?: Record<string, unknown>;
} = {}) {
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const identifiersService = {
    findByTypeValue: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'identifier-1' }),
    ...overrides.identifiersService,
  };
  const productsService = {
    create: jest.fn().mockResolvedValue({ id: 'product-1' }),
    ...overrides.productsService,
  };
  const variantsService = {
    create: jest.fn().mockResolvedValue({ id: 'variant-new-1' }),
    ...overrides.variantsService,
  };
  const offersService = {
    create: jest.fn().mockResolvedValue({ id: 'offer-1' }),
    ...overrides.offersService,
  };
  const storageService = {
    getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from(CSV_HEADER)),
    ...overrides.storageService,
  };
  const prismaOverrides = (overrides.prisma ?? {}) as Record<string, Record<string, unknown>>;
  const prisma = {
    catalogImportJob: {
      findUnique: jest.fn().mockResolvedValue(jobRow()),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      ...prismaOverrides.catalogImportJob,
    },
    catalogImportError: {
      create: jest.fn().mockResolvedValue({ id: 'err-1' }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      ...prismaOverrides.catalogImportError,
    },
    catalogImportRow: {
      create: jest.fn().mockResolvedValue({ id: 'row-1' }),
      ...prismaOverrides.catalogImportRow,
    },
    productVariant: {
      findUnique: jest.fn().mockResolvedValue({ id: 'variant-1', status: 'PUBLISHED' }),
      ...prismaOverrides.productVariant,
    },
    category: {
      findUnique: jest.fn().mockResolvedValue({ id: 'cat-1' }),
      ...prismaOverrides.category,
    },
  };

  const processor = new ImportRowProcessor(
    prisma as never,
    storageService as never,
    auditService as never,
    identifiersService as never,
    productsService as never,
    variantsService as never,
    offersService as never,
  );
  return {
    processor,
    prisma,
    auditService,
    storageService,
    identifiersService,
    productsService,
    variantsService,
    offersService,
  };
}

describe('ImportRowProcessor', () => {
  describe('validateJob', () => {
    it('is a no-op when the job is no longer VALIDATING (idempotent against BullMQ redelivery)', async () => {
      const { processor, prisma, storageService } = buildProcessor({
        prisma: { catalogImportJob: { findUnique: jest.fn().mockResolvedValue(jobRow({ status: 'READY' })) } },
      });
      await processor.validateJob('job-1');
      expect(storageService.getObjectBuffer).not.toHaveBeenCalled();
      expect(prisma.catalogImportJob.updateMany).not.toHaveBeenCalled();
    });

    it('detects a duplicate upload (same seller_id+content_hash, non-FAILED) and marks COMPLETED without parsing rows', async () => {
      const { processor, prisma } = buildProcessor({
        prisma: {
          catalogImportJob: {
            findUnique: jest.fn().mockResolvedValue(jobRow()),
            findFirst: jest.fn().mockResolvedValue({ id: 'original-job' }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        },
      });

      await processor.validateJob('job-1');

      expect(prisma.catalogImportJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1', version: 1 },
          data: expect.objectContaining({
            status: 'COMPLETED',
            duplicateOfJobId: 'original-job',
            totalRows: 0,
            validRowCount: 0,
            errorRowCount: 0,
          }),
        }),
      );
      // Regression guard: writing contentHash on the duplicate row itself
      // would collide with the partial unique index
      // (seller_id, content_hash) WHERE status != 'FAILED' — the original
      // `duplicate` row already holds that slot. A mocked Prisma client
      // can't reproduce the real P2002 this caused, so this assertion is
      // the only thing standing between this bug and silent reintroduction.
      const updateManyCall = (prisma.catalogImportJob.updateMany as jest.Mock).mock.calls[0][0];
      expect(updateManyCall.data).not.toHaveProperty('contentHash');
    });

    it('marks the job FAILED when a required column is missing', async () => {
      const { processor, prisma, storageService } = buildProcessor({
        storageService: {
          getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from('not_a_real_header\nx\n')),
        },
      });

      await processor.validateJob('job-1');

      expect(prisma.catalogImportError.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ rowNumber: 0, field: 'file' }) }),
      );
      expect(prisma.catalogImportJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
      expect(storageService.getObjectBuffer).toHaveBeenCalledWith('catalog-imports/seller-1/file.csv');
    });

    it('parses rows, writes per-row errors, and flips VALIDATING -> READY with correct valid/error counts', async () => {
      const csv =
        CSV_HEADER +
        'GTIN,04006381333931,,SKU-1,4500000,UZS,SELLER_WAREHOUSE,,\n' + // valid, matched
        'GTIN,BADVALUE,,SKU-2,,,,,\n'; // invalid: bad checksum + missing price/currency/mode
      const { processor, prisma, identifiersService } = buildProcessor({
        storageService: { getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from(csv)) },
      });
      identifiersService.findByTypeValue.mockResolvedValue({ variantId: 'variant-1' });

      await processor.validateJob('job-1');

      expect(prisma.catalogImportError.createMany).toHaveBeenCalled();
      const insertedErrors = (prisma.catalogImportError.createMany as jest.Mock).mock.calls[0][0].data;
      expect(insertedErrors.some((e: { rowNumber: number }) => e.rowNumber === 2)).toBe(true);

      expect(prisma.catalogImportJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'READY',
            totalRows: 2,
            validRowCount: 1,
            errorRowCount: 1,
          }),
        }),
      );
    });
  });

  describe('commitJob', () => {
    it('is a no-op when the job is not IMPORTING', async () => {
      const { processor, storageService } = buildProcessor({
        prisma: { catalogImportJob: { findUnique: jest.fn().mockResolvedValue(jobRow({ status: 'READY' })) } },
      });
      await processor.commitJob('job-1');
      expect(storageService.getObjectBuffer).not.toHaveBeenCalled();
    });

    it('creates only a seller_offers row for a matched row, writing a CREATE_OFFER catalog_import_rows entry', async () => {
      const csv = CSV_HEADER + 'GTIN,04006381333931,,SKU-1,4500000,UZS,SELLER_WAREHOUSE,,\n';
      const { processor, prisma, offersService, productsService, identifiersService } = buildProcessor({
        prisma: { catalogImportJob: { findUnique: jest.fn().mockResolvedValue(jobRow({ status: 'IMPORTING' })) } },
        storageService: { getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from(csv)) },
      });
      identifiersService.findByTypeValue.mockResolvedValue({ variantId: 'variant-1' });

      await processor.commitJob('job-1');

      expect(offersService.create).toHaveBeenCalledWith(
        { id: 'user-1', sessionId: 'catalog-import-worker' },
        expect.objectContaining({ seller_id: 'seller-1', variant_id: 'variant-1', seller_sku: 'SKU-1' }),
        expect.anything(),
      );
      expect(productsService.create).not.toHaveBeenCalled();
      expect(prisma.catalogImportRow.create).toHaveBeenCalledWith({
        data: { jobId: 'job-1', rowNumber: 1, action: 'CREATE_OFFER', sellerOfferId: 'offer-1' },
      });
      expect(prisma.catalogImportJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
    });

    it('creates a new DRAFT product+variant+identifier for an unmatched row, writing a CREATE_DRAFT_PRODUCT catalog_import_rows entry', async () => {
      const csv =
        CSV_HEADER +
        `GTIN,04006381333931,,SKU-1,,,,${'11111111-1111-1111-1111-111111111111'},New Widget\n`;
      const { processor, prisma, offersService, productsService, variantsService, identifiersService } =
        buildProcessor({
          prisma: { catalogImportJob: { findUnique: jest.fn().mockResolvedValue(jobRow({ status: 'IMPORTING' })) } },
          storageService: { getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from(csv)) },
        });
      identifiersService.findByTypeValue.mockResolvedValue(null);

      await processor.commitJob('job-1');

      expect(offersService.create).not.toHaveBeenCalled();
      expect(productsService.create).toHaveBeenCalledWith(
        { id: 'user-1', sessionId: 'catalog-import-worker' },
        expect.objectContaining({ category_id: '11111111-1111-1111-1111-111111111111', title: 'New Widget' }),
        expect.anything(),
      );
      expect(variantsService.create).toHaveBeenCalledWith(
        'product-1',
        { id: 'user-1', sessionId: 'catalog-import-worker' },
        expect.objectContaining({ options: { sku: 'SKU-1' } }),
        expect.anything(),
      );
      expect(identifiersService.create).toHaveBeenCalled();
      expect(prisma.catalogImportRow.create).toHaveBeenCalledWith({
        data: { jobId: 'job-1', rowNumber: 1, action: 'CREATE_DRAFT_PRODUCT', productId: 'product-1' },
      });
    });

    it('records a catalog_import_errors row and marks the job PARTIAL when identifiersService.create returns CONFLICT_DETECTED for an unmatched row (product/variant are still created, but without the identifier)', async () => {
      const csv =
        CSV_HEADER +
        `GTIN,04006381333931,,SKU-1,,,,${'11111111-1111-1111-1111-111111111111'},New Widget\n`;
      const { processor, prisma, productsService, variantsService, identifiersService } = buildProcessor({
        prisma: { catalogImportJob: { findUnique: jest.fn().mockResolvedValue(jobRow({ status: 'IMPORTING' })) } },
        storageService: { getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from(csv)) },
        identifiersService: {
          findByTypeValue: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({
            status: 'CONFLICT_DETECTED',
            merge_case_id: 'merge-case-1',
            identifier_type: 'GTIN',
            identifier_value: '04006381333931',
          }),
        },
      });

      await processor.commitJob('job-1');

      expect(productsService.create).toHaveBeenCalled();
      expect(variantsService.create).toHaveBeenCalled();
      expect(identifiersService.create).toHaveBeenCalled();
      expect(prisma.catalogImportError.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            jobId: 'job-1',
            rowNumber: 1,
            field: 'identifier',
            message: expect.stringContaining('merge-case-1'),
          }),
        }),
      );
      expect(prisma.catalogImportRow.create).toHaveBeenCalledWith({
        data: { jobId: 'job-1', rowNumber: 1, action: 'CREATE_DRAFT_PRODUCT', productId: 'product-1' },
      });
      expect(prisma.catalogImportJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PARTIAL' }) }),
      );
    });

    it('skips rows already recorded as invalid during VALIDATING (does not create anything for them)', async () => {
      const csv =
        CSV_HEADER +
        'GTIN,04006381333931,,SKU-1,4500000,UZS,SELLER_WAREHOUSE,,\n' +
        'GTIN,BADVALUE,,SKU-2,,,,,\n';
      const { processor, offersService, identifiersService } = buildProcessor({
        prisma: {
          catalogImportJob: { findUnique: jest.fn().mockResolvedValue(jobRow({ status: 'IMPORTING' })) },
          catalogImportError: {
            create: jest.fn(),
            createMany: jest.fn(),
            findMany: jest.fn().mockResolvedValue([{ rowNumber: 2 }]),
          },
        },
        storageService: { getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from(csv)) },
      });
      identifiersService.findByTypeValue.mockResolvedValue({ variantId: 'variant-1' });

      await processor.commitJob('job-1');

      expect(offersService.create).toHaveBeenCalledTimes(1);
    });

    it('marks the job PARTIAL (not COMPLETED) when at least one row fails during commit itself', async () => {
      const csv = CSV_HEADER + 'GTIN,04006381333931,,SKU-1,4500000,UZS,SELLER_WAREHOUSE,,\n';
      const { processor, prisma } = buildProcessor({
        prisma: { catalogImportJob: { findUnique: jest.fn().mockResolvedValue(jobRow({ status: 'IMPORTING' })) } },
        storageService: { getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from(csv)) },
        identifiersService: { findByTypeValue: jest.fn().mockResolvedValue({ variantId: 'variant-1' }) },
        offersService: { create: jest.fn().mockRejectedValue(new Error('SKU collision')) },
      });

      await processor.commitJob('job-1');

      expect(prisma.catalogImportError.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ field: 'row' }) }),
      );
      expect(prisma.catalogImportJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PARTIAL' }) }),
      );
    });
  });
});
