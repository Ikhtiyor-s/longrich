'use server';

import type { PublicOfferDto } from '@longrich/shared-types';
import { fetchVariantOffers } from './product-data';

export interface LoadVariantOffersResult {
  offers: PublicOfferDto[];
  error: string | null;
}

const OFFERS_FETCH_ERROR = "Taklif ro'yxatini olishda xatolik yuz berdi. Keyinroq qayta urinib ko'ring.";

export async function loadVariantOffers(variantId: string): Promise<LoadVariantOffersResult> {
  const result = await fetchVariantOffers(variantId);
  if (result.status === 'error') {
    return { offers: [], error: OFFERS_FETCH_ERROR };
  }
  return { offers: result.offers, error: null };
}
