import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CatalogImportJobWithSeller, LoadedImportResource } from './import-access.guard';

export type { CatalogImportJobWithSeller };

// Mirrors LoadedOffer/LoadedDocument's shape/throw convention. Only valid on
// routes guarded by ImportAccessGuard (which populates request.loadedResource).
export const LoadedImport = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CatalogImportJobWithSeller => {
    const request = ctx.switchToHttp().getRequest<{ loadedResource?: LoadedImportResource }>();
    const job = request.loadedResource?.job;
    if (!job) {
      throw new Error('LoadedImport used on a route without ImportAccessGuard');
    }
    return job;
  },
);
