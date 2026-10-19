import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { LoadedOfferResource, SellerOfferWithSeller } from './offer-access.guard';

export type { SellerOfferWithSeller };

// Mirrors LoadedMember/LoadedDocument's shape/throw convention. Only valid
// on routes guarded by OfferAccessGuard (which populates
// request.loadedResource).
export const LoadedOffer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SellerOfferWithSeller => {
    const request = ctx.switchToHttp().getRequest<{ loadedResource?: LoadedOfferResource }>();
    const offer = request.loadedResource?.offer;
    if (!offer) {
      throw new Error('LoadedOffer used on a route without OfferAccessGuard');
    }
    return offer;
  },
);
