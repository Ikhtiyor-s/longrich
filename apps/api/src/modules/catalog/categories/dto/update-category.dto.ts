import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CATEGORY_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;

// version is required (not optional) — frozen contract: "version is required
// in the body and checked via CAS" on every G2 category/category_attribute
// PATCH. Every other field is an optional partial-update subset.
export class UpdateCategoryDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(SLUG_PATTERN, { message: 'slug must be lowercase alphanumeric with hyphen separators' })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsBoolean()
  requires_certification?: boolean;

  @IsOptional()
  @IsUUID()
  parent_id?: string | null;

  @IsOptional()
  @IsIn(CATEGORY_STATUSES)
  status?: 'ACTIVE' | 'ARCHIVED';
}
