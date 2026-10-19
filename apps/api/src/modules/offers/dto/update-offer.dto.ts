import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { OFFER_CURRENCIES, OFFER_FULFILLMENT_MODES, OFFER_STATUSES } from '../offers.constants';

// version is required (not optional) — frozen contract: checked via CAS on
// every G2 PATCH. `status` is validated here against the *full* OfferStatus
// enum only (catches outright garbage input as 422) — the actual allow-listed
// transition table (ACTIVE<->INACTIVE, ACTIVE->SUSPENDED, etc.) is enforced
// in seller-offers.service.ts, which 409s on a well-formed-but-disallowed
// value, exactly as api-contract-g2.md's "any other requested value -> 409
// INVALID_STATE_TRANSITION" instruction states.
export class UpdateOfferDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  seller_sku?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  price_minor?: string;

  @IsOptional()
  @IsIn(OFFER_CURRENCIES)
  currency?: string;

  @IsOptional()
  @IsIn(OFFER_FULFILLMENT_MODES)
  fulfillment_mode?: string;

  @IsOptional()
  @IsIn(OFFER_STATUSES)
  status?: (typeof OFFER_STATUSES)[number];
}
