import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNotEmptyObject, IsOptional, Min, ValidateNested } from 'class-validator';
import { AttributeValueInputDto } from './create-variant.dto';

export class UpdateVariantDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsNotEmptyObject()
  options?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttributeValueInputDto)
  attribute_values?: AttributeValueInputDto[];
}
