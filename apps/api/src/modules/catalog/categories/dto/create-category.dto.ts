import { IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

// slug: lowercase/digits/hyphen only — the same shape every slug-bearing
// column in this codebase (seller.displayName has none, but
// brands.slug/categories.slug are the first two real slug columns) is
// expected to hold; enforced here rather than left to the DB unique
// constraint alone so a malformed slug fails with 422, not a raw 500.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class CreateCategoryDto {
  @IsOptional()
  @IsUUID()
  parent_id?: string | null;

  @IsString()
  @MaxLength(255)
  @Matches(SLUG_PATTERN, { message: 'slug must be lowercase alphanumeric with hyphen separators' })
  slug!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsBoolean()
  requires_certification?: boolean;
}
