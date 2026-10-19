import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

// seller_id is client-supplied (TZ §34 "user-supplied seller_id spoofing"),
// same shape as InviteMemberDto/UpdateProfileDto — no :id path param exists
// for this endpoint, so the request body is the only place to carry which
// seller is being edited. `reference` is just string-validated (no
// digit-only regex, no numeric coercion): TZ §28 only confirms "bank
// account as strings (leading zeros retained)," not a closed format — same
// reasoning CreateApplicationDto's own tax_id field comment already gives.
// 128 is a generous bound (seller_bank_accounts.raw_reference is @db.Text,
// no DB-level cap) chosen only to reject obviously-wrong input, not to
// constrain any real bank reference format.
export class CreateBankAccountDto {
  @IsUUID()
  seller_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  reference!: string;
}
