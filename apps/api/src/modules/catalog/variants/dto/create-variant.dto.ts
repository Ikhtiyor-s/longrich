import { Type } from 'class-transformer';
import { IsArray, IsDefined, IsNotEmptyObject, IsOptional, IsUUID, ValidateNested } from 'class-validator';

export class AttributeValueInputDto {
  @IsUUID()
  category_attribute_id!: string;

  // Shape is cross-validated against the referenced CategoryAttribute's
  // type/validation at the service layer (attribute-validation.ts's
  // assertAttributeValueMatchesRule) — class-validator decorators can't
  // express a type-dependent JSON shape cleanly, same reasoning as
  // CreateCategoryAttributeDto.validation. @IsDefined (not a bare field) is
  // required here even though it barely constrains anything: the global
  // ValidationPipe runs with whitelist:true, which silently strips any
  // nested property with zero validator decorators — without this, `value`
  // would be dropped before the service ever saw it.
  @IsDefined()
  value!: unknown;
}

export class CreateVariantDto {
  @IsNotEmptyObject()
  options!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttributeValueInputDto)
  attribute_values?: AttributeValueInputDto[];
}
