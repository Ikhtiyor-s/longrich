import { IsInt, IsNotEmpty, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

// seller_id is a client-supplied field, same as TZ §34's own named threat
// ("user-supplied seller_id spoofing") expects to exist and be defended —
// the defense is DocumentsService checking SellersService.findMembership
// before anything else runs, not omitting the field. type stays a bounded
// string, not a closed enum, for the same reason seller_documents.type is a
// plain VARCHAR in prisma/schema.prisma (document category list tied to the
// still-open legal review, docs/open-questions.md #6).
export class CreateDocumentDto {
  @IsUUID()
  seller_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  type!: string;

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
