import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class CreateBrandDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsString()
  @MaxLength(255)
  @Matches(SLUG_PATTERN, { message: 'slug must be lowercase alphanumeric with hyphen separators' })
  slug!: string;

  @IsOptional()
  @IsString()
  logo_object_key?: string | null;
}
