import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const QUEUE_ENTITY_TYPES = ['product', 'product_variant', 'product_media', 'offer'] as const;
export type QueueEntityType = (typeof QUEUE_ENTITY_TYPES)[number];

// Always implicitly status=OPEN only (api-contract-g2.md) — no status query
// param, same "no status param on the implicitly-filtered list" shape
// GET /v1/catalog/products already established for its own implicit filter.
export class ListModerationQueueQueryDto {
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
  @IsIn(QUEUE_ENTITY_TYPES)
  entity_type?: QueueEntityType;
}
