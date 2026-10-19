import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// GET /v1/catalog/variants/{id}/offers (public) — cursor pagination only,
// no status filter (the endpoint is unconditionally filtered to
// status='ACTIVE' + seller.status='ACTIVE', per api-contract-g2.md).
export class ListVariantOffersQueryDto {
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
