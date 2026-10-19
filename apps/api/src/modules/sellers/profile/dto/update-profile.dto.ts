import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// seller_id is client-supplied, same TZ §34 "user-supplied seller_id
// spoofing" threat CreateDocumentDto/InviteMemberDto already name and
// defend against via ProfileService checking SellersService.findMembership
// first — no :id path param exists for this endpoint (TZ §31 lists it as a
// bare GET/PATCH /v1/seller/profile), so the request body is the only place
// to carry which seller is being edited, same shape as those two DTOs.
//
// legal_name/tax_id/legal_type are deliberately NOT fields on this DTO —
// SEL-001's own write path (seller_applications PATCH, DRAFT-only) owns
// them. createValidationPipe()'s whitelist:true silently strips any such
// keys a client sends here rather than erroring, so they can never reach
// ProfileService regardless of what the request body contains.
export class UpdateProfileDto {
  @IsUUID()
  seller_id!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  display_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  logo_object_key?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  working_hours?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  delivery_terms?: string;
}
