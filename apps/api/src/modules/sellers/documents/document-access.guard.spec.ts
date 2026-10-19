import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { DocumentAccessGuard } from './document-access.guard';

function buildGuard(document: unknown, membership: unknown) {
  const prisma = {
    sellerDocument: { findUnique: jest.fn().mockResolvedValue(document) },
  };
  const sellersService = { findMembership: jest.fn().mockResolvedValue(membership) };
  const guard = new DocumentAccessGuard(prisma as never, sellersService as never);
  return { guard, prisma, sellersService };
}

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('DocumentAccessGuard', () => {
  const document = {
    id: 'doc-1',
    sellerId: 'seller-1',
    type: 'REGISTRATION_CERTIFICATE',
    seller: { id: 'seller-1' },
  };

  it('throws 404 NotFoundException when no document exists for the :id param', async () => {
    const { guard } = buildGuard(null, null);
    const request = { params: { id: 'missing' }, user: { id: 'user-1' }, loadedResource: undefined };

    await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(NotFoundException);
  });

  it("attaches loadedResource with isMember=true when the caller has a seller_members row for this document's seller", async () => {
    const { guard, sellersService } = buildGuard(document, { id: 'member-1', role: 'OWNER' });
    const request = { params: { id: 'doc-1' }, user: { id: 'user-1' }, loadedResource: undefined as unknown };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(sellersService.findMembership).toHaveBeenCalledWith('seller-1', 'user-1');
    expect(request.loadedResource).toEqual({ document, isMember: true });
  });

  it('attaches loadedResource with isMember=false when the caller has no membership for this seller (cross-seller case)', async () => {
    const { guard } = buildGuard(document, null);
    const request = { params: { id: 'doc-1' }, user: { id: 'stranger' }, loadedResource: undefined as unknown };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.loadedResource).toEqual({ document, isMember: false });
  });

  it('attaches isMember=false without calling findMembership when there is no authenticated user', async () => {
    const { guard, sellersService } = buildGuard(document, null);
    const request = { params: { id: 'doc-1' }, user: undefined, loadedResource: undefined as unknown };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(sellersService.findMembership).not.toHaveBeenCalled();
  });
});
