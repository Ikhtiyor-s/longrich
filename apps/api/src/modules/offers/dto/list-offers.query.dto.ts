import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { OFFER_STATUSES } from '../offers.constants';

// seller_id is validated as optional here (IsUUID only applies when
// present) — the controller enforces "required" manually and throws
// ValidationError itself, same pattern
// sellers/members/members.controller.ts's `list()` and
// sellers/documents/documents.controller.ts's `list()` already use for
// their own seller_id query param, rather than a @IsNotEmpty here that
// would produce a less specific error message.
export class ListSellerOffersQueryDto {
  @IsOptional()
  @IsUUID()
  seller_id?: string;

  @IsOptional()
  @IsIn(OFFER_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
