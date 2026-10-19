import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SellerPermissionGuard } from './seller-permission.guard';
import { RequireSellerPermission, SELLER_PERMISSION_METADATA_KEY } from './require-seller-permission.decorator';

function buildGuard(requiredCode: unknown) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredCode),
  } as unknown as Reflector;
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const guard = new SellerPermissionGuard(reflector, auditService as never);
  return { guard, auditService };
}

function createContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
    getClass: () => class Fixture {},
  } as unknown as ExecutionContext;
}

describe('SellerPermissionGuard', () => {
  it('passes through when no @RequireSellerPermission metadata is set on the handler', async () => {
    const { guard } = buildGuard(undefined);
    const context = createContext({ user: { id: 'user-1' } });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows an OWNER caller through a seller:members:manage-gated handler', async () => {
    const { guard } = buildGuard('seller:members:manage');
    const context = createContext({
      user: { id: 'owner-1' },
      loadedResource: { callerMembership: { role: 'OWNER' } },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  // Real privilege-escalation-denial test: this is the actual production
  // guard (not a hand-rolled boolean), given a MANAGER's real role straight
  // from the DB-shaped loadedResource, attempting the exact same
  // seller:members:manage gate that the real PATCH /v1/seller/members/:id
  // route uses — not a tautological "assert false === false".
  it('rejects a MANAGER caller with 403 FORBIDDEN on a seller:members:manage-gated handler (no privilege escalation, TZ §34)', async () => {
    const { guard, auditService } = buildGuard('seller:members:manage');
    const context = createContext({
      user: { id: 'manager-1' },
      loadedResource: { callerMembership: { role: 'MANAGER' } },
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'authz.permission_denied',
        entityId: 'seller:members:manage',
      }),
    );
  });

  it('rejects a caller with no membership at all (callerMembership null) with 403 FORBIDDEN', async () => {
    const { guard } = buildGuard('seller:members:manage');
    const context = createContext({
      user: { id: 'stranger' },
      loadedResource: { callerMembership: null },
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // seller:bank:*/payout-adjacent proof (TZ §34 "no payout or bank data" for
  // operator) — real bank endpoints land in T-G1-8, this proves the
  // mechanism they will reuse already denies OPERATOR today.
  it('rejects an OPERATOR caller with 403 FORBIDDEN on a seller:bank:manage-gated handler even with an otherwise-valid session', async () => {
    const { guard } = buildGuard('seller:bank:manage');
    const context = createContext({
      user: { id: 'operator-1' },
      loadedResource: { callerMembership: { role: 'OPERATOR' } },
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects an OPERATOR caller with 403 FORBIDDEN on a seller:payout:manage-gated handler', async () => {
    const { guard } = buildGuard('seller:payout:manage');
    const context = createContext({
      user: { id: 'operator-1' },
      loadedResource: { callerMembership: { role: 'OPERATOR' } },
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('throws 401 UNAUTHENTICATED (not a 500) when there is no authenticated actor on the request', async () => {
    const { guard } = buildGuard('seller:members:manage');
    const context = createContext({ loadedResource: { callerMembership: { role: 'OWNER' } } });

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('checks both handler and class metadata (getAllAndOverride), not handler-only', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('seller:members:manage'),
    } as unknown as Reflector;
    const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    const guard = new SellerPermissionGuard(reflector, auditService as never);
    const context = createContext({
      user: { id: 'owner-1' },
      loadedResource: { callerMembership: { role: 'OWNER' } },
    });

    await guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(SELLER_PERMISSION_METADATA_KEY, [
      expect.anything(),
      expect.anything(),
    ]);
  });

  it('wires real metadata end to end via the actual @RequireSellerPermission decorator + Reflector', async () => {
    class FixtureController {
      @RequireSellerPermission('seller:members:manage')
      promote(): void {}
    }
    const reflector = new Reflector();
    const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    const guard = new SellerPermissionGuard(reflector, auditService as never);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'owner-1' },
          loadedResource: { callerMembership: { role: 'OWNER' } },
        }),
      }),
      getHandler: () => FixtureController.prototype.promote,
      getClass: () => FixtureController,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
