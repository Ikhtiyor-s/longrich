import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { IdentifierType } from '@prisma/client';

export const IDENTIFIER_TYPES: IdentifierType[] = ['GTIN', 'EAN', 'UPC', 'MXIK'];

export class CreateIdentifierDto {
  @IsIn(IDENTIFIER_TYPES)
  type!: IdentifierType;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  value!: string;

  // Required only for type MXIK — cross-validated against `type` in the
  // service (class-validator can't express a type-dependent requiredness
  // cleanly, same reasoning CreateCategoryAttributeDto's `validation` field
  // already uses in this module).
  @IsOptional()
  @IsString()
  @MaxLength(32)
  classification_version?: string;
}
