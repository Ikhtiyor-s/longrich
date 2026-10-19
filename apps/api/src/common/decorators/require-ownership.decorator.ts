import { SetMetadata } from '@nestjs/common';

export const OWNERSHIP_METADATA_KEY = 'resourceOwnership';

export interface OwnershipRequestShape {
  params: Record<string, string>;
  user?: { id: string };
  loadedResource?: unknown;
}

// Given the request + whatever resource the route handler loaded, return that
// resource's owner id (e.g. a seller_id or user_id column) for OwnershipGuard
// to compare against the caller's own id. No seller/warehouse resource tables
// exist yet (G1/G3) — this is deliberately generic so those later modules can
// supply their own resolver without changing the guard/decorator shape.
export type OwnershipResolver<TResource = unknown> = (
  request: OwnershipRequestShape,
  resource: TResource,
) => string | null | undefined;

export function RequireOwnership<TResource = unknown>(
  resolve: OwnershipResolver<TResource>,
): MethodDecorator & ClassDecorator {
  return SetMetadata(OWNERSHIP_METADATA_KEY, resolve);
}
