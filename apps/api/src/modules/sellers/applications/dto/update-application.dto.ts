import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

// Same field-level rules as CreateApplicationDto, all optional — a PATCH may
// touch any subset of the application's legal-entity fields + contacts.
export class UpdateApplicationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  legal_type?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  tax_id?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  legal_name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  display_name?: string;

  @IsOptional()
  @IsObject()
  contacts?: Record<string, unknown>;
}
