import type { Brand } from '@prisma/client';

export function toBrandPayload(brand: Brand) {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    logo_object_key: brand.logoObjectKey,
    created_at: brand.createdAt.toISOString(),
    updated_at: brand.updatedAt.toISOString(),
    version: brand.version,
  };
}

export function toBrandRefPayload(brand: Pick<Brand, 'id' | 'name'> | null) {
  return brand ? { id: brand.id, name: brand.name } : null;
}
