import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ForbiddenError, UnauthenticatedError } from '../../../common/http/api-error';
import type { RequestWithId } from '../../../common/http/request-id.middleware';

interface ViewCheckActor {
  id: string;
}

// GET /v1/admin/catalog/merge-proposals[/:id] — "category:manage or
// merge_case:approve (either grant can view the queue; only
// merge_case:approve can decide)" per api-contract-g2.md. The shared
// PermissionGuard/@RequirePermission only ever checks a single
// (resource, action) pair — no endpoint before this one needed an OR of two
// grants — so this is a small, local, read-only sibling guard (same shape
// as PermissionGuard: 401 before 403, audit-on-deny) rather than widening
// the shared guard for a need only this one route has.
@Injectable()
export class MergeCaseViewGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithId & { user?: ViewCheckActor }>();
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
                  { resource: 'category', action: 'manage' },
                  { resource: 'merge_case', action: 'approve' },
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
      entityId: 'category:manage|merge_case:approve',
      after: { required_permission: ['category:manage', 'merge_case:approve'] },
      requestId: request.requestId ?? null,
      traceId: request.traceId ?? null,
    });

    throw new ForbiddenError('Missing required permission: category:manage or merge_case:approve');
  }
}
