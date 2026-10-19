import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// version is required, CAS-checked — same convention as every other G2
// mutating PATCH.
export class UpdateBrandDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(SLUG_PATTERN, { message: 'slug must be lowercase alphanumeric with hyphen separators' })
  slug?: string;

  @IsOptional()
  @IsString()
  logo_object_key?: string | null;
}
