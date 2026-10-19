import { IsIn, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { OFFER_CURRENCIES, OFFER_FULFILLMENT_MODES } from '../offers.constants';

// seller_id is client-supplied: this create endpoint has no :id path param
// to load a target resource from, so (same precedent as
// sellers/finance/dto/create-bank-account.dto.ts's CreateBankAccountDto and
// sellers/members/dto/invite-member.dto.ts's InviteMemberDto — both already
// in this codebase) the request body is the only place to carry which
// seller the new offer belongs to. FLAGGED: api-contract-g2.md's own
// literal request example for POST /v1/seller/offers
// (`{variant_id, seller_sku, price_minor, currency, fulfillment_mode}`)
// omits seller_id entirely — without it there is no way to resolve which
// seller's membership/ACTIVE-status to check or which seller_id column
// value to write. This DTO adds seller_id, following the only coherent
// precedent already established in this codebase for a body-only
// (no-:id) create route, rather than guessing silently. Flagged loudly in
// the implementation report as a contract gap needing architect sign-off.
//
// price_minor stays a plain string here (not a digit regex at the DTO
// layer) — parsePositivePriceMinor (./price-minor.ts) is the single place
// that parses/validates it, so there is exactly one code path a future
// change to the rule has to touch.
export class CreateOfferDto {
  @IsUUID()
  seller_id!: string;

  @IsUUID()
  variant_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  seller_sku!: string;

  @IsString()
  @IsNotEmpty()
  price_minor!: string;

  @IsIn(OFFER_CURRENCIES)
  currency!: string;

  @IsIn(OFFER_FULFILLMENT_MODES)
  fulfillment_mode!: string;
}
