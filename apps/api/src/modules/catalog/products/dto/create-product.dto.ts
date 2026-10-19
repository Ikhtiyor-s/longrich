import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateProductDto {
  @IsUUID()
  category_id!: string;

  @IsOptional()
  @IsUUID()
  brand_id?: string | null;

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
