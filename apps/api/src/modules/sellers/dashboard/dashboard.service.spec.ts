import { DashboardService } from './dashboard.service';
import { ForbiddenError } from '../../../common/http/api-error';

const OWNER_ACTOR = { id: 'owner-1', sessionId: 'session-1' };
const OPERATOR_ACTOR = { id: 'operator-1', sessionId: 'session-3' };
const STRANGER_ACTOR = { id: 'stranger-1', sessionId: 'session-4' };

const BASE_SELLER = {
  id: 'seller-1',
  status: 'DRAFT',
};

function buildService(overrides: {
  seller?: Record<string, unknown>;
  membershipByUser?: Record<string, { role: 'OWNER' | 'MANAGER' | 'OPERATOR' }>;
}) {
  const seller = { ...BASE_SELLER, ...(overrides.seller ?? {}) };
  const membershipByUser = overrides.membershipByUser ?? {};

  const sellersService = {
    findById: jest.fn().mockResolvedValue(seller),
    findMembership: jest.fn((_sellerId: string, userId: string) =>
      Promise.resolve(membershipByUser[userId] ?? null),
    ),
  };

  const service = new DashboardService(sellersService as never);
  return { service, sellersService, seller };
}

describe('DashboardService', () => {
  describe('getDashboard', () => {
    it('rejects with 403 ForbiddenError when caller is not a member of seller_id (cross-seller)', async () => {
      const { service } = buildService({ membershipByUser: {} });

      await expect(service.getDashboard(STRANGER_ACTOR, 'seller-1')).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it('returns seller_status and a NOT_AVAILABLE placeholder for every section, naming the milestone that will populate it', async () => {
      const { service } = buildService({
        membershipByUser: { 'owner-1': { role: 'OWNER' } },
      });

      const result = await service.getDashboard(OWNER_ACTOR, 'seller-1');
      expect(result).toEqual({
        seller_id: 'seller-1',
        seller_status: 'DRAFT',
        sections: {
          offers: { status: 'NOT_AVAILABLE', available_from: 'G2' },
          inventory: { status: 'NOT_AVAILABLE', available_from: 'G3' },
          orders: { status: 'NOT_AVAILABLE', available_from: 'G4/G6' },
        },
      });
    });

    it('any member role, including OPERATOR, can view the dashboard (the shell is not permission-gated)', async () => {
      const { service } = buildService({
        membershipByUser: { 'operator-1': { role: 'OPERATOR' } },
      });

      const result = await service.getDashboard(OPERATOR_ACTOR, 'seller-1');
      expect(result.sections.offers.status).toBe('NOT_AVAILABLE');
    });

    it('surfaces the real seller.status (e.g. SUSPENDED), not a hardcoded value', async () => {
      const { service } = buildService({
        seller: { status: 'SUSPENDED' },
        membershipByUser: { 'owner-1': { role: 'OWNER' } },
      });

      const result = await service.getDashboard(OWNER_ACTOR, 'seller-1');
      expect(result.seller_status).toBe('SUSPENDED');
    });

    it('never returns a bare empty array or zero for a section (each section is an explicit NOT_AVAILABLE object)', async () => {
      const { service } = buildService({
        membershipByUser: { 'owner-1': { role: 'OWNER' } },
      });

      const result = await service.getDashboard(OWNER_ACTOR, 'seller-1');
      for (const section of Object.values(result.sections)) {
        expect(Array.isArray(section)).toBe(false);
        expect(section).toHaveProperty('status', 'NOT_AVAILABLE');
        expect(section).toHaveProperty('available_from');
        expect(typeof section.available_from).toBe('string');
      }
    });
  });
});
