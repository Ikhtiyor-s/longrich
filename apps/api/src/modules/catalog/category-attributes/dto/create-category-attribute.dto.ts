import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CATEGORY_ATTRIBUTE_TYPES, type CategoryAttributeType } from '../attribute-validation';

const KEY_PATTERN = /^[a-z0-9_]+$/;

export class CreateCategoryAttributeDto {
  @IsString()
  @MaxLength(64)
  @Matches(KEY_PATTERN, { message: 'key must be lowercase alphanumeric/underscore' })
  key!: string;

  @IsString()
  @MaxLength(255)
  label!: string;

  @IsIn(CATEGORY_ATTRIBUTE_TYPES)
  type!: CategoryAttributeType;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  // Shape is cross-validated against `type` in the service
  // (attribute-validation.ts), not here — class-validator decorators can't
  // express a type-dependent JSON shape cleanly.
  @IsOptional()
  validation?: unknown;
}
