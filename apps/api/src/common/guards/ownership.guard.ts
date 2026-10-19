import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenError, UnauthenticatedError } from '../http/api-error';
import {
  OWNERSHIP_METADATA_KEY,
  type OwnershipRequestShape,
  type OwnershipResolver,
} from '../decorators/require-ownership.decorator';

// No seller_id/warehouse-scoped resource exists yet (G1/G3) — this guard is
// proven in G0 only against a fake fixture (see ownership.guard.spec.ts), per
// T-G0-5's ticket text. A route wiring this for real supplies a resolver via
// @RequireOwnership(...) and is expected to have already loaded the resource
// onto request.loadedResource (e.g. in the handler or a prior interceptor)
// before this guard runs.
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // getAllAndOverride (handler, then class) — see permission.guard.ts's
    // identical comment; @RequireOwnership has the same ClassDecorator-typed
    // fail-open gap this guard must not reproduce.
    const resolve = this.reflector.getAllAndOverride<OwnershipResolver | undefined>(
      OWNERSHIP_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!resolve) {
      return true;
    }

    const request = context.switchToHttp().getRequest<OwnershipRequestShape>();
    const actor = request.user;
    if (!actor?.id) {
      throw new UnauthenticatedError();
    }

    const ownerId = resolve(request, request.loadedResource);
    if (!ownerId || ownerId !== actor.id) {
      throw new ForbiddenError('Caller does not own this resource.');
    }
    return true;
  }
}
