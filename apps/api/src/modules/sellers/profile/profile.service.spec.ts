import { ProfileService } from './profile.service';
import {
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '../../../common/http/api-error';

const OWNER_ACTOR = { id: 'owner-1', sessionId: 'session-1' };
const MANAGER_ACTOR = { id: 'manager-1', sessionId: 'session-2' };
const OPERATOR_ACTOR = { id: 'operator-1', sessionId: 'session-3' };
const STRANGER_ACTOR = { id: 'stranger-1', sessionId: 'session-4' };

const BASE_SELLER = {
  id: 'seller-1',
  legalName: 'Honey Trading LLC',
  taxId: '0012345678',
  legalType: 'LLC',
  displayName: 'Honey Store',
  status: 'DRAFT',
  description: null,
  logoObjectKey: null,
  workingHours: null,
  deliveryTerms: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  version: 1,
};

function buildService(overrides: {
  seller?: Record<string, unknown>;
  membershipByUser?: Record<string, { role: 'OWNER' | 'MANAGER' | 'OPERATOR' }>;
  updateMany?: jest.Mock;
  updatedSeller?: Record<string, unknown>;
}) {
  const seller = { ...BASE_SELLER, ...(overrides.seller ?? {}) };
  const membershipByUser = overrides.membershipByUser ?? {};
  const updateMany = overrides.updateMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const findUniqueOrThrow = jest.fn().mockResolvedValue(overrides.updatedSeller ?? seller);

  const sellersService = {
    findById: jest.fn().mockResolvedValue(seller),
    findMembership: jest.fn((_sellerId: string, userId: string) =>
      Promise.resolve(membershipByUser[userId] ?? null),
    ),
  };
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const prisma = { seller: { updateMany, findUniqueOrThrow } };

  const service = new ProfileService(
    prisma as never,
    sellersService as never,
    auditService as never,
  );
  return { service, prisma, sellersService, auditService, seller };
}

describe('ProfileService', () => {
  describe('getProfile', () => {
    it('rejects with 403 ForbiddenError when caller is not a member of seller_id (cross-seller)', async () => {
      const { service } = buildService({ membershipByUser: {} });

      await expect(service.getProfile(STRANGER_ACTOR, 'seller-1')).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("returns the caller's own seller profile, including the new shop-profile fields, for any member role (OPERATOR included)", async () => {
      const { service } = buildService({
        seller: { description: 'Best honey in town', workingHours: 'Mon-Fri 09:00-18:00' },
        membershipByUser: { 'operator-1': { role: 'OPERATOR' } },
      });

      const result = await service.getProfile(OPERATOR_ACTOR, 'seller-1');
      expect(result).toMatchObject({
        id: 'seller-1',
        display_name: 'Honey Store',
        description: 'Best honey in town',
        working_hours: 'Mon-Fri 09:00-18:00',
        logo_object_key: null,
        delivery_terms: null,
      });
    });
  });

  describe('updateProfile', () => {
    const validDto = { seller_id: 'seller-1', display_name: 'New Honey Store' };

    it('rejects with 403 ForbiddenError when caller is not a member of seller_id (cross-seller)', async () => {
      const { service, prisma } = buildService({ membershipByUser: {} });

      await expect(service.updateProfile(STRANGER_ACTOR, validDto)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect((prisma.seller as { updateMany: jest.Mock }).updateMany).not.toHaveBeenCalled();
    });

    it('rejects with 403 ForbiddenError when caller is OPERATOR (no seller:profile:manage)', async () => {
      const { service, prisma, auditService } = buildService({
        membershipByUser: { 'operator-1': { role: 'OPERATOR' } },
      });

      await expect(service.updateProfile(OPERATOR_ACTOR, validDto)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect((prisma.seller as { updateMany: jest.Mock }).updateMany).not.toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'authz.permission_denied',
          entityId: 'seller:profile:manage',
        }),
      );
    });

    it('allows MANAGER to update display_name (not OWNER-only, unlike seller:members:manage)', async () => {
      const { service } = buildService({
        membershipByUser: { 'manager-1': { role: 'MANAGER' } },
      });

      const result = await service.updateProfile(MANAGER_ACTOR, validDto);
      expect(result.display_name).toBe('Honey Store');
    });

    it('updates display_name, bumps version, and writes a before/after audit entry with real values', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const { service, auditService } = buildService({
        membershipByUser: { 'owner-1': { role: 'OWNER' } },
        updateMany,
        updatedSeller: { ...BASE_SELLER, displayName: 'New Honey Store' },
      });

      const result = await service.updateProfile(OWNER_ACTOR, validDto);
      expect(result.display_name).toBe('New Honey Store');
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'seller-1', version: 1 },
        data: { displayName: 'New Honey Store', version: { increment: 1 } },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'seller_profile.updated',
          entityType: 'seller',
          entityId: 'seller-1',
          before: { display_name: 'Honey Store' },
          after: { display_name: 'New Honey Store' },
        }),
      );
    });

    it('cannot change legal_name/tax_id/legal_type through this endpoint: those keys are not read even if present on the object passed in', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const { service, sellersService } = buildService({
        membershipByUser: { 'owner-1': { role: 'OWNER' } },
        updateMany,
        updatedSeller: { ...BASE_SELLER, displayName: 'New Honey Store' },
      });

      const dtoWithSneakyFields = {
        ...validDto,
        legal_name: 'Hijacked LLC',
        tax_id: '9999999999',
        legal_type: 'SOLE_PROPRIETOR',
      } as never;

      await service.updateProfile(OWNER_ACTOR, dtoWithSneakyFields);

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'seller-1', version: 1 },
        data: { displayName: 'New Honey Store', version: { increment: 1 } },
      });
      expect(sellersService.findById).toHaveBeenCalled();
      const updateCallArgs = updateMany.mock.calls[0]?.[0];
      expect(updateCallArgs.data).not.toHaveProperty('legalName');
      expect(updateCallArgs.data).not.toHaveProperty('taxId');
      expect(updateCallArgs.data).not.toHaveProperty('legalType');
    });

    it('rejects with 422 ValidationError when changing a publish-affecting field (description) while seller.status is DRAFT (not ACTIVE)', async () => {
      const { service, prisma } = buildService({
        seller: { status: 'DRAFT' },
        membershipByUser: { 'owner-1': { role: 'OWNER' } },
      });

      await expect(
        service.updateProfile(OWNER_ACTOR, {
          seller_id: 'seller-1',
          description: 'New description',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect((prisma.seller as { updateMany: jest.Mock }).updateMany).not.toHaveBeenCalled();
    });

    it('rejects with 422 ValidationError when changing logo_object_key/working_hours/delivery_terms while SUBMITTED/UNDER_REVIEW/APPROVED (not ACTIVE)', async () => {
      for (const status of ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'] as const) {
        const { service } = buildService({
          seller: { status },
          membershipByUser: { 'owner-1': { role: 'OWNER' } },
        });

        await expect(
          service.updateProfile(OWNER_ACTOR, {
            seller_id: 'seller-1',
            logo_object_key: 'seller-logos/seller-1/logo.png',
          }),
        ).rejects.toBeInstanceOf(ValidationError);
      }
    });

    it('allows changing publish-affecting fields (description, logo_object_key, working_hours, delivery_terms) when seller.status is ACTIVE', async () => {
      const { service, auditService } = buildService({
        seller: { status: 'ACTIVE' },
        membershipByUser: { 'owner-1': { role: 'OWNER' } },
        updatedSeller: {
          ...BASE_SELLER,
          status: 'ACTIVE',
          description: 'Best honey in town',
          logoObjectKey: 'seller-logos/seller-1/logo.png',
          workingHours: 'Mon-Fri 09:00-18:00',
          deliveryTerms: 'Tashkent shahri boylab 1-2 kun',
        },
      });

      const result = await service.updateProfile(OWNER_ACTOR, {
        seller_id: 'seller-1',
        description: 'Best honey in town',
        logo_object_key: 'seller-logos/seller-1/logo.png',
        working_hours: 'Mon-Fri 09:00-18:00',
        delivery_terms: 'Tashkent shahri boylab 1-2 kun',
      });

      expect(result.description).toBe('Best honey in town');
      expect(result.logo_object_key).toBe('seller-logos/seller-1/logo.png');
      expect(result.working_hours).toBe('Mon-Fri 09:00-18:00');
      expect(result.delivery_terms).toBe('Tashkent shahri boylab 1-2 kun');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          before: {
            description: null,
            logo_object_key: null,
            working_hours: null,
            delivery_terms: null,
          },
          after: {
            description: 'Best honey in town',
            logo_object_key: 'seller-logos/seller-1/logo.png',
            working_hours: 'Mon-Fri 09:00-18:00',
            delivery_terms: 'Tashkent shahri boylab 1-2 kun',
          },
        }),
      );
    });

    it('allows changing display_name while non-ACTIVE (DRAFT): display_name is not publish-affecting', async () => {
      const { service } = buildService({
        seller: { status: 'DRAFT' },
        membershipByUser: { 'owner-1': { role: 'OWNER' } },
      });

      const result = await service.updateProfile(OWNER_ACTOR, validDto);
      expect(result.display_name).toBe('Honey Store');
    });

    it('is a no-op (no DB write, no audit) when the DTO has no updatable fields beyond seller_id', async () => {
      const { service, prisma, auditService } = buildService({
        membershipByUser: { 'owner-1': { role: 'OWNER' } },
      });

      await service.updateProfile(OWNER_ACTOR, { seller_id: 'seller-1' });
      expect((prisma.seller as { updateMany: jest.Mock }).updateMany).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('rejects with 409 InvalidStateTransitionError when the seller row was modified by another request (version mismatch, lost the compare-and-swap)', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const { service } = buildService({
        membershipByUser: { 'owner-1': { role: 'OWNER' } },
        updateMany,
      });

      await expect(service.updateProfile(OWNER_ACTOR, validDto)).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
    });
  });
});
