import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

// legal_type is validated as a bounded non-empty string, not a closed list:
// the real Uzbekistan legal-entity-type set is not legally confirmed yet
// (docs/open-questions.md #6) — same reasoning schema.prisma's
// Seller.legalType comment already gives for keeping it a VARCHAR, not an
// enum. tax_id is likewise just string-validated (no digit-only regex): TZ
// §28 only confirms "string, leading zeros retained," not a closed format.
export class CreateApplicationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  legal_type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  tax_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  legal_name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  display_name!: string;

  @IsOptional()
  @IsObject()
  contacts?: Record<string, unknown>;
}
