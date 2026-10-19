import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  LoadedApplicationResource,
  SellerApplicationWithSeller,
} from './application-access.guard';

export type { SellerApplicationWithSeller };

// Mirrors CurrentUser's shape/throw convention. Only valid on routes guarded
// by ApplicationAccessGuard (which populates request.loadedResource) — using
// it elsewhere is a programmer error, not a runtime/user-facing condition.
export const LoadedApplication = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SellerApplicationWithSeller => {
    const request = ctx.switchToHttp().getRequest<{ loadedResource?: LoadedApplicationResource }>();
    const application = request.loadedResource?.application;
    if (!application) {
      throw new Error('LoadedApplication used on a route without ApplicationAccessGuard');
    }
    return application;
  },
);
