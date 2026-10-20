export interface CategoryDto {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
  requires_certification: boolean;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface OffersSummaryDto {
  active_offer_count: number;
  lowest_price_minor: string | null;
  currency: string | null;
}

export interface ProductListItemDto {
  id: string;
  category_id: string;
  brand: { id: string; name: string } | null;
  title: string;
  status: 'PUBLISHED';
  cover_media: { object_key: string; position: number } | null;
  offers_summary: OffersSummaryDto;
}

export interface ProductAttributeValueDto {
  category_attribute_id: string;
  key: string;
  value: unknown;
}

export interface ProductMediaDto {
  id: string;
  object_key: string;
  position: number;
  moderation_status: 'APPROVED';
}

export interface ProductVariantDto {
  id: string;
  product_id: string;
  options: Record<string, string>;
  status: string;
  attribute_values: ProductAttributeValueDto[];
  media: ProductMediaDto[];
  offers_summary: OffersSummaryDto;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface ProductDetailDto {
  id: string;
  category_id: string;
  brand: { id: string; name: string } | null;
  title: string;
  description: string;
  status: string;
  canonical_id: string | null;
  variants: ProductVariantDto[];
  media: ProductMediaDto[];
  offers_summary: OffersSummaryDto;
  latest_moderation_decision: { outcome: string; reason: string | null; decided_at: string } | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface PublicOfferDto {
  id: string;
  seller_id: string;
  seller_name: string;
  seller_sku: string;
  price_minor: string;
  currency: string;
  fulfillment_mode: string;
}

export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}
