import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import {
  PERMISSION_METADATA_KEY,
  RequirePermission,
} from '../decorators/require-permission.decorator';

function createContext(request: unknown, klass: unknown = class Fixture {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
    getClass: () => klass,
  } as unknown as ExecutionContext;
}

function buildGuard(requiredCode: string | undefined, grantFound: boolean) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredCode),
  } as unknown as Reflector;
  const prisma = {
    adminMember: {
      findFirst: jest.fn().mockResolvedValue(grantFound ? { id: 'grant-id' } : null),
    },
  };
  const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const guard = new PermissionGuard(reflector, prisma as never, auditService as never);
  return { guard, prisma, auditService, reflector };
}

describe('PermissionGuard', () => {
  it('allows the request through when the handler has no @RequirePermission metadata', async () => {
    const { guard, prisma } = buildGuard(undefined, false);
    const context = createContext({ user: { id: 'user-1' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.adminMember.findFirst).not.toHaveBeenCalled();
  });

  it('returns true and does not write an audit row when the actor holds the required permission', async () => {
    const { guard, prisma, auditService } = buildGuard('test:read', true);
    const context = createContext({ user: { id: 'super-admin-id' }, requestId: 'req-1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.adminMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'super-admin-id',
          status: 'ACTIVE',
          role: {
            rolePermissions: { some: { permission: { resource: 'test', action: 'read' } } },
          },
        }),
      }),
    );
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('throws 403 FORBIDDEN and writes an audit_logs denial row (via AuditService) when the actor lacks the permission', async () => {
    const { guard, auditService } = buildGuard('test:read', false);
    const context = createContext({ user: { id: 'support-agent-id' }, requestId: 'req-2' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { id: 'support-agent-id', type: 'USER' },
        action: 'authz.permission_denied',
        entityType: 'permission',
        entityId: 'test:read',
        requestId: 'req-2',
      }),
    );
  });

  it('throws 401 UNAUTHENTICATED (not a 500) when the request has no authenticated actor', async () => {
    const { guard, prisma } = buildGuard('test:read', false);
    const context = createContext({});

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(prisma.adminMember.findFirst).not.toHaveBeenCalled();
  });

  it('checks both handler and class metadata (getAllAndOverride), not handler-only', async () => {
    const { guard, reflector } = buildGuard('test:read', true);
    const context = createContext({ user: { id: 'user-1' } });

    await guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(PERMISSION_METADATA_KEY, [
      expect.anything(),
      expect.anything(),
    ]);
  });

  it('a @RequirePermission applied at the CLASS level is honored, not silently fail-open (minor #10 regression guard)', async () => {
    @RequirePermission('test:read')
    class FixtureController {
      guardedMethod(): void {}
    }
    const reflector = new Reflector();
    const prisma = {
      adminMember: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const auditService = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
    const guard = new PermissionGuard(reflector, prisma as never, auditService as never);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'user-1' } }) }),
      getHandler: () => FixtureController.prototype.guardedMethod,
      getClass: () => FixtureController,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('wires real metadata end to end via the actual @RequirePermission decorator + Reflector', async () => {
    class FixtureController {
      @RequirePermission('test:read')
      testRead(): void {}
    }
    const reflector = new Reflector();
    const prisma = {
      adminMember: { findFirst: jest.fn().mockResolvedValue({ id: 'grant-id' }) },
    };
    const auditService = { record: jest.fn() };
    const guard = new PermissionGuard(reflector, prisma as never, auditService as never);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'user-1' } }) }),
      getHandler: () => FixtureController.prototype.testRead,
      getClass: () => FixtureController,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(reflector.get(PERMISSION_METADATA_KEY, FixtureController.prototype.testRead)).toBe(
      'test:read',
    );
  });
});
