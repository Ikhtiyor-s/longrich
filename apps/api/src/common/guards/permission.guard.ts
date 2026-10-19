import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ForbiddenError, UnauthenticatedError } from '../http/api-error';
import type { RequestWithId } from '../http/request-id.middleware';
import { PERMISSION_METADATA_KEY } from '../decorators/require-permission.decorator';

interface PermissionCheckActor {
  id: string;
}

// Composes on top of JwtAuthGuard (@UseGuards(JwtAuthGuard, PermissionGuard)) —
// relies on request.user.id already being set, does not re-validate the token.
// A permission grant/revoke takes effect on next token refresh, same tradeoff
// as the (currently unused) JWT-embedded-claims design in
// docs/architecture/g0-design-notes.md §3 — here it's a live DB lookup instead,
// so grants/revokes are visible immediately without waiting for refresh.
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // getAllAndOverride (handler, then class), not reflector.get(handler) alone —
    // @RequirePermission is typed MethodDecorator & ClassDecorator, so a
    // class-level application must not silently fail open just because this
    // guard only ever looked at the handler's own metadata.
    const requiredCode = this.reflector.getAllAndOverride<string | undefined>(
      PERMISSION_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredCode) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<RequestWithId & { user?: PermissionCheckActor }>();
    const actor = request.user;
    if (!actor?.id) {
      throw new UnauthenticatedError();
    }

    const [resource, action] = requiredCode.split(':');
    if (!resource || !action) {
      throw new ForbiddenError(`Malformed permission code: ${requiredCode}`);
    }

    const grant = await this.prisma.adminMember.findFirst({
      where: {
        userId: actor.id,
        status: 'ACTIVE',
        role: { rolePermissions: { some: { permission: { resource, action } } } },
      },
      select: { id: true },
    });

    if (grant) {
      return true;
    }

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'authz.permission_denied',
      entityType: 'permission',
      entityId: requiredCode,
      after: { required_permission: requiredCode },
      requestId: request.requestId ?? null,
      traceId: request.traceId ?? null,
    });

    throw new ForbiddenError(`Missing required permission: ${requiredCode}`);
  }
}
