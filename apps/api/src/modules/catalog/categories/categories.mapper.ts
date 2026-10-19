import type { Category } from '@prisma/client';

export function toCategoryPayload(category: Category) {
  return {
    id: category.id,
    parent_id: category.parentId,
    slug: category.slug,
    name: category.name,
    status: category.status,
    requires_certification: category.requiresCertification,
    created_at: category.createdAt.toISOString(),
    updated_at: category.updatedAt.toISOString(),
    version: category.version,
  };
}
