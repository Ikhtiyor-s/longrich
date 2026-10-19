import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

// First cursor-paginated list query DTO in this codebase (the convention
// itself is frozen by docs/architecture/api-contract-g2.md — this is just
// its first concrete application). `limit`'s out-of-range -> 422 is
// enforced by @Min/@Max here, same mechanism as every other DTO validation
// in this codebase (createValidationPipe()'s exceptionFactory).
export class ListCategoriesQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID()
  parent_id?: string;
}
