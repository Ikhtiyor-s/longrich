import { IsInt, IsNotEmpty, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

// Mirrors sellers/documents/dto/create-document.dto.ts's shape exactly
// (api-contract-g2.md: "Request mirrors T-G1-3's document-upload shape") —
// no `type` field here (documents has a KYB document category, imports
// don't), seller_id is client-supplied for the same reason
// CreateOfferDto's own comment gives (no :id path param on this create
// route to resolve a seller from).
export class CreateImportDto {
  @IsUUID()
  seller_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  mime_type!: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  size_bytes!: number;
}
