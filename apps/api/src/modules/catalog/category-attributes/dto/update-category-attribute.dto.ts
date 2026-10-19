import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MaxLength,
} from 'class-validator';
import { CATEGORY_ATTRIBUTE_TYPES, type CategoryAttributeType } from '../attribute-validation';

const KEY_PATTERN = /^[a-z0-9_]+$/;

export class UpdateCategoryAttributeDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(KEY_PATTERN, { message: 'key must be lowercase alphanumeric/underscore' })
  key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @IsOptional()
  @IsIn(CATEGORY_ATTRIBUTE_TYPES)
  type?: CategoryAttributeType;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  validation?: unknown;
}
