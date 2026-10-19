import type { CategoryAttribute } from '@prisma/client';

export function toCategoryAttributePayload(attribute: CategoryAttribute) {
  return {
    id: attribute.id,
    category_id: attribute.categoryId,
    key: attribute.key,
    label: attribute.label,
    type: attribute.type,
    required: attribute.required,
    validation: attribute.validation,
    created_at: attribute.createdAt.toISOString(),
    updated_at: attribute.updatedAt.toISOString(),
    version: attribute.version,
  };
}
