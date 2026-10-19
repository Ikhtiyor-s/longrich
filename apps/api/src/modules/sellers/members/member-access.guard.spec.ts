import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { MemberAccessGuard } from './member-access.guard';

function buildGuard(targetMember: unknown, callerMembership: unknown) {
  const prisma = {
    sellerMember: { findUnique: jest.fn().mockResolvedValue(targetMember) },
  };
  const sellersService = { findMembership: jest.fn().mockResolvedValue(callerMembership) };
  const guard = new MemberAccessGuard(prisma as never, sellersService as never);
  return { guard, prisma, sellersService };
}

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('MemberAccessGuard', () => {
  const targetMember = {
    id: 'member-2',
    sellerId: 'seller-1',
    userId: 'staff-1',
    role: 'MANAGER',
    seller: { id: 'seller-1' },
  };

  it('throws 404 NotFoundException when no seller_member exists for the :id param', async () => {
    const { guard } = buildGuard(null, null);
    const request = { params: { id: 'missing' }, user: { id: 'user-1' }, loadedResource: undefined };

    await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(NotFoundException);
  });

  it("attaches the caller's own full membership row (not just a bool) when the caller belongs to the target's seller", async () => {
    const callerMembership = { id: 'member-1', sellerId: 'seller-1', userId: 'owner-1', role: 'OWNER' };
    const { guard, sellersService } = buildGuard(targetMember, callerMembership);
    const request = {
      params: { id: 'member-2' },
      user: { id: 'owner-1' },
      loadedResource: undefined as unknown,
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(sellersService.findMembership).toHaveBeenCalledWith('seller-1', 'owner-1');
    expect(request.loadedResource).toEqual({ targetMember, callerMembership });
  });

  it('attaches callerMembership=null when the caller has no membership for this seller (cross-seller case)', async () => {
    const { guard } = buildGuard(targetMember, null);
    const request = {
      params: { id: 'member-2' },
      user: { id: 'stranger' },
      loadedResource: undefined as unknown,
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.loadedResource).toEqual({ targetMember, callerMembership: null });
  });

  it('attaches callerMembership=null without calling findMembership when there is no authenticated user', async () => {
    const { guard, sellersService } = buildGuard(targetMember, null);
    const request = { params: { id: 'member-2' }, user: undefined, loadedResource: undefined as unknown };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(sellersService.findMembership).not.toHaveBeenCalled();
  });
});
