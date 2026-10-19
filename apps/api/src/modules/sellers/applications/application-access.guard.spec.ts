import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { ApplicationAccessGuard } from './application-access.guard';

function createContext(params: Record<string, string>, user?: { id: string }): ExecutionContext {
  const request = { params, user, loadedResource: undefined as unknown };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildGuard(application: unknown, membership: unknown) {
  const prisma = {
    sellerApplication: { findUnique: jest.fn().mockResolvedValue(application) },
  };
  const sellersService = { findMembership: jest.fn().mockResolvedValue(membership) };
  const guard = new ApplicationAccessGuard(prisma as never, sellersService as never);
  return { guard, prisma, sellersService };
}

describe('ApplicationAccessGuard', () => {
  const application = {
    id: 'app-1',
    sellerId: 'seller-1',
    status: 'DRAFT',
    seller: { id: 'seller-1' },
  };

  it('throws 404 NotFoundException when no application exists for the :id param', async () => {
    const { guard } = buildGuard(null, null);
    const context = createContext({ id: 'missing' }, { id: 'user-1' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("attaches loadedResource with isMember=true when the caller has a seller_members row for this application's seller", async () => {
    const { guard, sellersService } = buildGuard(application, { id: 'member-1', role: 'OWNER' });
    const request = {
      params: { id: 'app-1' },
      user: { id: 'user-1' },
      loadedResource: undefined as unknown,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sellersService.findMembership).toHaveBeenCalledWith('seller-1', 'user-1');
    expect(request.loadedResource).toEqual({ application, isMember: true });
  });

  it('attaches loadedResource with isMember=false when the caller has no membership for this seller (cross-seller case)', async () => {
    const { guard } = buildGuard(application, null);
    const request = {
      params: { id: 'app-1' },
      user: { id: 'stranger' },
      loadedResource: undefined as unknown,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.loadedResource).toEqual({ application, isMember: false });
  });

  it('attaches isMember=false without calling findMembership when there is no authenticated user (JwtAuthGuard should have already rejected, but this must not throw/500)', async () => {
    const { guard, sellersService } = buildGuard(application, null);
    const context = createContext({ id: 'app-1' }, undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sellersService.findMembership).not.toHaveBeenCalled();
  });
});
