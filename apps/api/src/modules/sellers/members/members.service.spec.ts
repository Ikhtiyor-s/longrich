import { MembersService } from './members.service';
import {
  ForbiddenError,
  InvalidStateTransitionError,
  ValidationError,
} from '../../../common/http/api-error';

const OWNER_ACTOR = { id: 'owner-1', sessionId: 'session-1' };
const MANAGER_ACTOR = { id: 'manager-1', sessionId: 'session-2' };

function buildService(overrides: {
  prisma?: Record<string, unknown>;
  membershipByUser?: Record<string, unknown>;
}) {
  const membershipByUser = overrides.membershipByUser ?? {};
  const prisma = overrides.prisma ?? {};
  const sellersService = {
    findMembership: jest.fn((sellerId: string, userId: string) =>
      Promise.resolve(membershipByUser[userId] ?? null),
    ),
  };
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };

  const service = new MembersService(
    prisma as never,
    sellersService as never,
    auditService as never,
  );
  return { service, prisma, sellersService, auditService };
}

describe('MembersService', () => {
  describe('list', () => {
    it('rejects with 403 ForbiddenError when caller is not a member of the requested seller_id (cross-seller)', async () => {
      const { service } = buildService({ membershipByUser: {} });

      await expect(service.list(OWNER_ACTOR, 'seller-1')).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("returns every seller_members row for the caller's own seller", async () => {
      const rows = [
        {
          id: 'm1',
          sellerId: 's1',
          userId: 'owner-1',
          role: 'OWNER',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'm2',
          sellerId: 's1',
          userId: 'manager-1',
          role: 'MANAGER',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const findMany = jest.fn().mockResolvedValue(rows);
      const { service } = buildService({
        prisma: { sellerMember: { findMany } },
        membershipByUser: { 'owner-1': { id: 'm1', role: 'OWNER' } },
      });

      const result = await service.list(OWNER_ACTOR, 's1');
      expect(result.map((r) => r.id)).toEqual(['m1', 'm2']);
      expect(result[0]?.role).toBe('OWNER');
    });
  });

  describe('invite', () => {
    const validDto = { seller_id: 'seller-1', phone: '+998901112233', role: 'MANAGER' as const };

    it('rejects with 403 ForbiddenError before any lookup when caller is not a member of seller_id', async () => {
      const { service, prisma } = buildService({
        prisma: { user: { findUnique: jest.fn() } },
        membershipByUser: {},
      });

      await expect(service.invite(MANAGER_ACTOR, validDto)).rejects.toBeInstanceOf(ForbiddenError);
      expect((prisma.user as { findUnique: jest.Mock }).findUnique).not.toHaveBeenCalled();
    });

    // Real no-privilege-escalation case at the service layer: a real
    // MANAGER row (not a hand-rolled boolean) attempting to invite someone
    // as OWNER — proves sellerRoleHasPermission is actually consulted, not
    // just an "always allow OWNER actor" shortcut.
    it('rejects with 403 ForbiddenError when caller is a MANAGER attempting to invite (even role=OWNER): MANAGER cannot grant OWNER or MANAGER to anyone', async () => {
      const { service, prisma, auditService } = buildService({
        prisma: { user: { findUnique: jest.fn() } },
        membershipByUser: {
          'manager-1': { id: 'm2', sellerId: 'seller-1', userId: 'manager-1', role: 'MANAGER' },
        },
      });

      await expect(
        service.invite(MANAGER_ACTOR, { ...validDto, role: 'OWNER' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect((prisma.user as { findUnique: jest.Mock }).findUnique).not.toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'authz.permission_denied',
          entityId: 'seller:members:manage',
        }),
      );
    });

    it('rejects with 422 ValidationError when the phone does not match a registered user', async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const { service } = buildService({
        prisma: { user: { findUnique } },
        membershipByUser: {
          'owner-1': { id: 'm1', sellerId: 'seller-1', userId: 'owner-1', role: 'OWNER' },
        },
      });

      await expect(service.invite(OWNER_ACTOR, validDto)).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects with 422 ValidationError when the target user is already a member of this seller', async () => {
      const findUnique = jest.fn().mockResolvedValue({ id: 'staff-1', phone: '+998901112233' });
      const { service } = buildService({
        prisma: { user: { findUnique } },
        membershipByUser: {
          'owner-1': { id: 'm1', sellerId: 'seller-1', userId: 'owner-1', role: 'OWNER' },
          'staff-1': { id: 'm3', sellerId: 'seller-1', userId: 'staff-1', role: 'MANAGER' },
        },
      });

      await expect(service.invite(OWNER_ACTOR, validDto)).rejects.toBeInstanceOf(ValidationError);
    });

    it('creates a new seller_members row with the requested role when caller is OWNER and the phone matches an existing, not-yet-member user', async () => {
      const findUnique = jest.fn().mockResolvedValue({ id: 'staff-1', phone: '+998901112233' });
      const create = jest.fn().mockResolvedValue({
        id: 'member-new',
        sellerId: 'seller-1',
        userId: 'staff-1',
        role: 'MANAGER',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const { service, auditService } = buildService({
        prisma: { user: { findUnique }, sellerMember: { create } },
        membershipByUser: {
          'owner-1': { id: 'm1', sellerId: 'seller-1', userId: 'owner-1', role: 'OWNER' },
        },
      });

      const result = await service.invite(OWNER_ACTOR, validDto);
      expect(result.role).toBe('MANAGER');
      expect(create).toHaveBeenCalledWith({
        data: { sellerId: 'seller-1', userId: 'staff-1', role: 'MANAGER' },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'seller_member.invited' }),
      );
    });
  });

  describe('updateRole', () => {
    function loadedMember(overrides: Record<string, unknown> = {}) {
      return {
        id: 'member-2',
        sellerId: 'seller-1',
        userId: 'staff-1',
        role: 'MANAGER',
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        seller: { id: 'seller-1' },
        ...overrides,
      };
    }

    it("updates the target member's role (compare-and-swap on version) and records before/after in the audit log", async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const findUniqueOrThrow = jest.fn().mockResolvedValue({
        id: 'member-2',
        sellerId: 'seller-1',
        userId: 'staff-1',
        role: 'OPERATOR',
        version: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const { service, auditService } = buildService({
        prisma: { sellerMember: { updateMany, findUniqueOrThrow } },
      });

      const result = await service.updateRole(OWNER_ACTOR, loadedMember() as never, {
        role: 'OPERATOR',
      });
      expect(result.role).toBe('OPERATOR');
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'member-2', version: 1 },
          data: expect.objectContaining({ role: 'OPERATOR' }),
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'seller_member.role_changed',
          before: { role: 'MANAGER' },
          after: { role: 'OPERATOR' },
        }),
      );
    });

    it('rejects with 409 InvalidStateTransitionError when the row was modified by another request (version mismatch, lost the compare-and-swap)', async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const { service } = buildService({ prisma: { sellerMember: { updateMany } } });

      await expect(
        service.updateRole(OWNER_ACTOR, loadedMember() as never, { role: 'OPERATOR' }),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    // G1 QA review minor #1: the last/only OWNER cannot be demoted, leaving
    // the seller with zero owners and no way back in.
    it('rejects with 409 InvalidStateTransitionError when demoting the sole OWNER would leave the seller with zero owners', async () => {
      const count = jest.fn().mockResolvedValue(1);
      const updateMany = jest.fn();
      const { service } = buildService({ prisma: { sellerMember: { count, updateMany } } });

      await expect(
        service.updateRole(OWNER_ACTOR, loadedMember({ role: 'OWNER' }) as never, {
          role: 'MANAGER',
        }),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('allows demoting an OWNER when at least one other OWNER remains for the same seller', async () => {
      const count = jest.fn().mockResolvedValue(2);
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const findUniqueOrThrow = jest.fn().mockResolvedValue({
        id: 'member-2',
        sellerId: 'seller-1',
        userId: 'staff-1',
        role: 'MANAGER',
        version: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const { service } = buildService({
        prisma: { sellerMember: { count, updateMany, findUniqueOrThrow } },
      });

      const result = await service.updateRole(
        OWNER_ACTOR,
        loadedMember({ role: 'OWNER' }) as never,
        {
          role: 'MANAGER',
        },
      );
      expect(result.role).toBe('MANAGER');
    });
  });
});
