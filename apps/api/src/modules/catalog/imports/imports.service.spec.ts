import { ImportsService } from './imports.service';
import { ForbiddenError, InvalidStateTransitionError, ValidationError } from '../../../common/http/api-error';

const ACTOR = { id: 'user-1', sessionId: 'session-1' };

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    sellerId: 'seller-1',
    status: 'UPLOADED',
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

function buildService(overrides: {
  prisma?: Record<string, unknown>;
  sellersService?: Record<string, unknown>;
  storageService?: Record<string, unknown>;
  queue?: Record<string, unknown>;
} = {}) {
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const sellersService = {
    findMembership: jest.fn().mockResolvedValue({ role: 'OWNER' }),
    ...overrides.sellersService,
  };
  const storageService = {
    createPresignedUploadUrl: jest
      .fn()
      .mockResolvedValue({ url: 'https://minio.local/signed', expiresInSeconds: 900 }),
    ...overrides.storageService,
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined), ...overrides.queue };
  const prisma = {
    catalogImportJob: {
      create: jest.fn().mockResolvedValue(jobRow()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(jobRow({ status: 'VALIDATING', version: 2 })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    catalogImportError: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides.prisma,
  };

  const service = new ImportsService(
    prisma as never,
    storageService as never,
    auditService as never,
    sellersService as never,
    queue as never,
  );
  return { service, prisma, auditService, sellersService, storageService, queue };
}

describe('ImportsService', () => {
  describe('create', () => {
    const dto = {
      seller_id: 'seller-1',
      filename: 'catalog.csv',
      mime_type: 'text/csv',
      size_bytes: 1024,
    };

    it('issues a signed upload URL and creates an UPLOADED catalog_import_jobs row', async () => {
      const { service, prisma, storageService } = buildService();

      const result = await service.create(ACTOR, dto);

      expect(result.id).toBe('job-1');
      expect(result.status).toBe('UPLOADED');
      expect(result.upload_url).toBe('https://minio.local/signed');
      expect(result.upload_url_expires_in_seconds).toBe(900);
      expect(storageService.createPresignedUploadUrl).toHaveBeenCalledWith(
        expect.stringContaining('catalog-imports/seller-1/'),
        'text/csv',
      );
      expect(prisma.catalogImportJob.create).toHaveBeenCalledWith({
        data: {
          sellerId: 'seller-1',
          objectKey: expect.stringContaining('catalog-imports/seller-1/'),
          createdBy: 'user-1',
        },
      });
    });

    it('rejects a non-member of the target seller with 403 FORBIDDEN', async () => {
      const { service } = buildService({
        sellersService: { findMembership: jest.fn().mockResolvedValue(null) },
      });
      await expect(service.create(ACTOR, dto)).rejects.toThrow(ForbiddenError);
    });

    it("rejects an OPERATOR (lacks seller:offers:manage) with 403 FORBIDDEN — TZ §02 'pick/dispatch limited'", async () => {
      const { service } = buildService({
        sellersService: { findMembership: jest.fn().mockResolvedValue({ role: 'OPERATOR' }) },
      });
      await expect(service.create(ACTOR, dto)).rejects.toThrow(ForbiddenError);
    });

    it('rejects a disallowed mime_type with 422 VALIDATION_ERROR before any job row is created', async () => {
      const { service, prisma } = buildService();
      await expect(
        service.create(ACTOR, { ...dto, mime_type: 'application/vnd.ms-excel' }),
      ).rejects.toThrow(ValidationError);
      expect(prisma.catalogImportJob.create).not.toHaveBeenCalled();
    });

    it('rejects an oversized file with 422 VALIDATION_ERROR before any job row is created', async () => {
      const { service, prisma } = buildService();
      await expect(service.create(ACTOR, { ...dto, size_bytes: 999_999_999 })).rejects.toThrow(
        ValidationError,
      );
      expect(prisma.catalogImportJob.create).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    it('flips UPLOADED -> VALIDATING and enqueues a validate job', async () => {
      const { service, prisma, queue } = buildService();
      const loaded = jobRow({ seller: { id: 'seller-1' } }) as never;

      const result = await service.confirm(loaded, ACTOR);

      expect(prisma.catalogImportJob.updateMany).toHaveBeenCalledWith({
        where: { id: 'job-1', version: 1, status: 'UPLOADED' },
        data: { status: 'VALIDATING', version: { increment: 1 } },
      });
      expect(queue.add).toHaveBeenCalledWith('validate', { jobId: 'job-1' });
      expect(result.status).toBe('VALIDATING');
    });

    it('throws 409 INVALID_STATE_TRANSITION when the job is not UPLOADED (lost CAS race)', async () => {
      const { service, queue } = buildService({
        prisma: { catalogImportJob: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } },
      });
      const loaded = jobRow({ status: 'READY', seller: { id: 'seller-1' } }) as never;

      await expect(service.confirm(loaded, ACTOR)).rejects.toThrow(InvalidStateTransitionError);
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('commit', () => {
    it('flips READY -> IMPORTING and enqueues a commit job', async () => {
      const { service, prisma, queue } = buildService({
        prisma: {
          catalogImportJob: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUniqueOrThrow: jest
              .fn()
              .mockResolvedValue(jobRow({ status: 'IMPORTING', version: 2 })),
          },
        },
      });
      const loaded = jobRow({ status: 'READY', seller: { id: 'seller-1' } }) as never;

      const result = await service.commit(loaded, ACTOR);

      expect(prisma.catalogImportJob.updateMany).toHaveBeenCalledWith({
        where: { id: 'job-1', version: 1, status: 'READY' },
        data: { status: 'IMPORTING', version: { increment: 1 } },
      });
      expect(queue.add).toHaveBeenCalledWith('commit', { jobId: 'job-1' });
      expect(result.status).toBe('IMPORTING');
    });

    it('throws 409 INVALID_STATE_TRANSITION when the job is not READY (e.g. committing twice)', async () => {
      const { service, queue } = buildService({
        prisma: { catalogImportJob: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } },
      });
      const loaded = jobRow({ status: 'IMPORTING', seller: { id: 'seller-1' } }) as never;

      await expect(service.commit(loaded, ACTOR)).rejects.toThrow(InvalidStateTransitionError);
      expect(queue.add).not.toHaveBeenCalled();
    });
  });
});
