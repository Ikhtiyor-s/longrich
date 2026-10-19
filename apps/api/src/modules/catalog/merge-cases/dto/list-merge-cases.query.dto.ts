import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const MERGE_CASE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export class ListMergeCasesQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  // Defaults to PENDING (the queue) when omitted, per
  // api-contract-g2.md's T-G2-6 section ("filterable by status, default
  // PENDING").
  @IsOptional()
  @IsIn(MERGE_CASE_STATUSES)
  status?: (typeof MERGE_CASE_STATUSES)[number];
}
