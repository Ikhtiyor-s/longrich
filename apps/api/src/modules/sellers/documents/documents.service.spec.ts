import { DocumentsService } from './documents.service';
import { ForbiddenError, ValidationError } from '../../../common/http/api-error';

const ACTOR = { id: 'user-1', sessionId: 'session-1' };

function buildService(overrides: {
  prisma?: Record<string, unknown>;
  membership?: unknown;
  presignedUpload?: { url: string; expiresInSeconds: number };
  scanResult?: { clean: boolean; scannedAt: Date };
}) {
  const prisma = overrides.prisma ?? {};
  const membership = 'membership' in overrides ? overrides.membership : { id: 'member-1' };
  const sellersService = {
    findMembership: jest.fn().mockResolvedValue(membership),
  };
  const storageService = {
    createPresignedUploadUrl: jest
      .fn()
      .mockResolvedValue(
        overrides.presignedUpload ?? { url: 'https://signed.example/key', expiresInSeconds: 900 },
      ),
  };
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const scanAdapter = {
    scan: jest
      .fn()
      .mockResolvedValue(
        overrides.scanResult ?? { clean: true, scannedAt: new Date('2026-10-18T00:00:00Z') },
      ),
  };

  const service = new DocumentsService(
    prisma as never,
    sellersService as never,
    storageService as never,
    auditService as never,
    scanAdapter as never,
  );

  return { service, prisma, sellersService, storageService, auditService, scanAdapter };
}

describe('DocumentsService', () => {
  beforeEach(() => {
    process.env.SELLER_DOCUMENT_ALLOWED_MIME_TYPES = 'application/pdf,image/jpeg,image/png';
    process.env.SELLER_DOCUMENT_MAX_SIZE_BYTES = '10485760';
  });

  describe('create', () => {
    const validDto = {
      seller_id: 'seller-1',
      type: 'REGISTRATION_CERTIFICATE',
      filename: 'cert.pdf',
      mime_type: 'application/pdf',
      size_bytes: 1024,
    };

    it('creates a PENDING seller_documents row and returns a signed upload URL + object_key when caller is a member', async () => {
      const create = jest.fn().mockResolvedValue({
        id: 'doc-1',
        sellerId: 'seller-1',
        type: 'REGISTRATION_CERTIFICATE',
        objectKey: 'seller-documents/seller-1/REGISTRATION_CERTIFICATE/key',
        fileName: 'cert.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        verificationStatus: 'PENDING',
        scannedAt: null,
        createdAt: new Date('2026-10-18T00:00:00Z'),
        updatedAt: new Date('2026-10-18T00:00:00Z'),
      });
      const { service, storageService } = buildService({ prisma: { sellerDocument: { create } } });

      const result = await service.create(ACTOR, validDto);

      expect(result.verification_status).toBe('PENDING');
      expect(result.upload_url).toBe('https://signed.example/key');
      expect(result.object_key).toContain('seller-documents/seller-1/');
      expect(storageService.createPresignedUploadUrl).toHaveBeenCalledWith(
        expect.stringContaining('seller-documents/seller-1/'),
        'application/pdf',
      );
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sellerId: 'seller-1',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
          }),
        }),
      );
    });

    it('rejects with 403 ForbiddenError before any URL is issued when caller is not a member of seller_id', async () => {
      const { service, storageService } = buildService({ membership: null });

      await expect(service.create(ACTOR, validDto)).rejects.toBeInstanceOf(ForbiddenError);
      expect(storageService.createPresignedUploadUrl).not.toHaveBeenCalled();
    });

    it('rejects with 422 ValidationError before a URL is issued when mime_type is not in the configured allowlist', async () => {
      const { service, storageService } = buildService({});

      await expect(
        service.create(ACTOR, { ...validDto, mime_type: 'application/x-msdownload' }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(storageService.createPresignedUploadUrl).not.toHaveBeenCalled();
    });

    it('rejects with 422 ValidationError before a URL is issued when size_bytes exceeds the configured cap', async () => {
      const { service, storageService } = buildService({});

      await expect(
        service.create(ACTOR, { ...validDto, size_bytes: 999_999_999 }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(storageService.createPresignedUploadUrl).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('rejects with 403 ForbiddenError when caller is not a member of the requested seller_id', async () => {
      const { service } = buildService({ membership: null });

      await expect(service.list(ACTOR, 'seller-1')).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("returns every historical version row (never collapsed) for the caller's seller", async () => {
      const rows = [
        {
          id: 'doc-1',
          verificationStatus: 'REJECTED',
          createdAt: new Date(),
          updatedAt: new Date(),
          scannedAt: null,
          sellerId: 's',
          type: 't',
          objectKey: 'k1',
          fileName: 'f',
          mimeType: 'application/pdf',
          sizeBytes: 1,
        },
        {
          id: 'doc-2',
          verificationStatus: 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
          scannedAt: null,
          sellerId: 's',
          type: 't',
          objectKey: 'k2',
          fileName: 'f',
          mimeType: 'application/pdf',
          sizeBytes: 1,
        },
      ];
      const findMany = jest.fn().mockResolvedValue(rows);
      const { service } = buildService({ prisma: { sellerDocument: { findMany } } });

      const result = await service.list(ACTOR, 'seller-1');
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id)).toEqual(['doc-1', 'doc-2']);
    });
  });

  describe('confirm', () => {
    function loadedDocument(overrides: Record<string, unknown> = {}) {
      return {
        id: 'doc-1',
        sellerId: 'seller-1',
        type: 'REGISTRATION_CERTIFICATE',
        objectKey: 'seller-documents/seller-1/key',
        fileName: 'cert.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        verificationStatus: 'PENDING',
        scannedAt: null,
        version: 1,
        createdAt: new Date('2026-10-18T00:00:00Z'),
        updatedAt: new Date('2026-10-18T00:00:00Z'),
        seller: { id: 'seller-1' },
        ...overrides,
      };
    }

    it('a clean scan result moves a PENDING document to VERIFIED', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const findUniqueOrThrow = jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ ...loadedDocument(), verificationStatus: 'VERIFIED' }),
        );
      const { service, scanAdapter, auditService } = buildService({
        prisma: { sellerDocument: { updateMany, findUniqueOrThrow } },
        scanResult: { clean: true, scannedAt: new Date('2026-10-18T01:00:00Z') },
      });

      const result = await service.confirm(loadedDocument() as never, ACTOR);

      expect(scanAdapter.scan).toHaveBeenCalledWith(
        'seller-documents/seller-1/key',
        'application/pdf',
      );
      expect(result.verification_status).toBe('VERIFIED');
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'doc-1',
            version: 1,
            verificationStatus: 'PENDING',
          }),
          data: expect.objectContaining({ verificationStatus: 'VERIFIED' }),
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'seller_document.scanned' }),
      );
    });

    it('an infected scan result (test double) flips a PENDING document to REJECTED', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const findUniqueOrThrow = jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ ...loadedDocument(), verificationStatus: 'REJECTED' }),
        );
      const { service } = buildService({
        prisma: { sellerDocument: { updateMany, findUniqueOrThrow } },
        scanResult: { clean: false, scannedAt: new Date('2026-10-18T01:00:00Z') },
      });

      const result = await service.confirm(loadedDocument() as never, ACTOR);

      expect(result.verification_status).toBe('REJECTED');
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ verificationStatus: 'REJECTED' }),
        }),
      );
    });

    it('is idempotent: confirming an already-VERIFIED document again does not re-run the scan adapter', async () => {
      const updateMany = jest.fn();
      const { service, scanAdapter } = buildService({ prisma: { sellerDocument: { updateMany } } });

      const result = await service.confirm(
        loadedDocument({ verificationStatus: 'VERIFIED' }) as never,
        ACTOR,
      );

      expect(scanAdapter.scan).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalled();
      expect(result.verification_status).toBe('VERIFIED');
    });

    // G1 QA review major #2: losing the compare-and-swap race (a concurrent
    // confirm() already recorded a decision) is not itself an error here —
    // the loser returns that decision rather than writing a second,
    // redundant audit entry.
    it('losing the compare-and-swap race to a concurrent confirm() call returns the decision the winner recorded, without writing a second audit entry', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const findUniqueOrThrow = jest
        .fn()
        .mockResolvedValue({ ...loadedDocument(), verificationStatus: 'VERIFIED' });
      const { service, auditService } = buildService({
        prisma: { sellerDocument: { updateMany, findUniqueOrThrow } },
      });

      const result = await service.confirm(loadedDocument() as never, ACTOR);

      expect(result.verification_status).toBe('VERIFIED');
      expect(auditService.record).not.toHaveBeenCalled();
    });
  });
});
