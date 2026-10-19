import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { LoadedDocumentResource, SellerDocumentWithSeller } from './document-access.guard';

export type { SellerDocumentWithSeller };

// Mirrors LoadedApplication's shape/throw convention. Only valid on routes
// guarded by DocumentAccessGuard (which populates request.loadedResource).
export const LoadedDocument = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SellerDocumentWithSeller => {
    const request = ctx.switchToHttp().getRequest<{ loadedResource?: LoadedDocumentResource }>();
    const document = request.loadedResource?.document;
    if (!document) {
      throw new Error('LoadedDocument used on a route without DocumentAccessGuard');
    }
    return document;
  },
);
