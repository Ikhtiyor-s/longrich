import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ForbiddenError, UnauthenticatedError } from '../../../common/http/api-error';
import type { RequestWithId } from '../../../common/http/request-id.middleware';

interface PermissionCheckActor {
  id: string;
}

const REQUIRED_PERMISSION_LABEL = 'catalog:moderate or offers:moderate';

// GET /v1/admin/catalog/moderation-queue is viewable by either grant
// (api-contract-g2.md: "either grant can view; see per-decision endpoints
// below for who may act"). PermissionGuard/@RequirePermission only ever
// checks one fixed (resource, action) pair — this is a small dedicated
// OR-guard scoped to this one shared-queue endpoint, rather than widening
// the shared guard's contract (and its decorator's string signature) for
// every other call site in the codebase. Composes after JwtAuthGuard, same
// trust boundary as PermissionGuard.
@Injectable()
export class ModerationQueueAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithId & { user?: PermissionCheckActor }>();
    const actor = request.user;
    if (!actor?.id) {
      throw new UnauthenticatedError();
    }

    const grant = await this.prisma.adminMember.findFirst({
      where: {
        userId: actor.id,
        status: 'ACTIVE',
        role: {
          rolePermissions: {
            some: {
              permission: {
                OR: [
                  { resource: 'catalog', action: 'moderate' },
                  { resource: 'offers', action: 'moderate' },
                ],
              },
            },
          },
        },
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
      entityId: REQUIRED_PERMISSION_LABEL,
      after: { required_permission: REQUIRED_PERMISSION_LABEL },
      requestId: request.requestId ?? null,
      traceId: request.traceId ?? null,
    });

    throw new ForbiddenError(`Missing required permission: ${REQUIRED_PERMISSION_LABEL}`);
  }
}
