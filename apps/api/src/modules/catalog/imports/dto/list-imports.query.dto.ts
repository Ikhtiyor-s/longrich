import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { IMPORT_JOB_STATUSES } from '../import-statuses';

// seller_id optional here, same precedent as offers/dto/list-offers.query.dto.ts
// — the controller enforces "required" manually for a more specific error
// message.
export class ListImportsQueryDto {
  @IsOptional()
  @IsUUID()
  seller_id?: string;

  @IsOptional()
  @IsIn(IMPORT_JOB_STATUSES)
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
