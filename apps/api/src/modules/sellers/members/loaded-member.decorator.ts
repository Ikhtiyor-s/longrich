import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { LoadedMemberResource, SellerMemberWithSeller } from './member-access.guard';

export type { SellerMemberWithSeller };

// Mirrors LoadedApplication/LoadedDocument's shape/throw convention. Only
// valid on routes guarded by MemberAccessGuard (which populates
// request.loadedResource) — using it elsewhere is a programmer error, not a
// runtime/user-facing condition.
export const LoadedMember = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SellerMemberWithSeller => {
    const request = ctx.switchToHttp().getRequest<{ loadedResource?: LoadedMemberResource }>();
    const targetMember = request.loadedResource?.targetMember;
    if (!targetMember) {
      throw new Error('LoadedMember used on a route without MemberAccessGuard');
    }
    return targetMember;
  },
);
