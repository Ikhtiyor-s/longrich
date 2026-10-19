import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../../../common/audit/audit.service';
import { ForbiddenError, UnauthenticatedError } from '../../../common/http/api-error';
import type { RequestWithId } from '../../../common/http/request-id.middleware';
import type { LoadedMemberResource } from './member-access.guard';
import { SELLER_PERMISSION_METADATA_KEY } from './require-seller-permission.decorator';
import { sellerRoleHasPermission, type SellerPermissionCode } from './seller-permissions';

interface PermissionCheckActor {
  id: string;
}

type RequestWithLoadedMember = RequestWithId & {
  user?: PermissionCheckActor;
  loadedResource?: LoadedMemberResource;
};

// Mirrors common/guards/permission.guard.ts's shape (metadata via
// getAllAndOverride, 401 before 403, audit on denial) but reads the caller's
// role from request.loadedResource.callerMembership — populated by
// MemberAccessGuard, which must run first — instead of an admin_members
// grant lookup. Must run after MemberAccessGuard:
// @UseGuards(MemberAccessGuard, OwnershipGuard, SellerPermissionGuard).
@Injectable()
export class SellerPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredCode = this.reflector.getAllAndOverride<SellerPermissionCode | undefined>(
      SELLER_PERMISSION_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredCode) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithLoadedMember>();
    const actor = request.user;
    if (!actor?.id) {
      throw new UnauthenticatedError();
    }

    const callerRole = request.loadedResource?.callerMembership?.role ?? null;
    if (callerRole && sellerRoleHasPermission(callerRole, requiredCode)) {
      return true;
    }

    await this.auditService.record({
      actor: { id: actor.id, type: 'USER' },
      action: 'authz.permission_denied',
      entityType: 'seller_permission',
      entityId: requiredCode,
      after: { caller_role: callerRole },
      requestId: request.requestId ?? null,
      traceId: request.traceId ?? null,
    });

    throw new ForbiddenError(`Missing required seller permission: ${requiredCode}`);
  }
}
