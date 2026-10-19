import type { ModerationCase } from '@prisma/client';

// GET /v1/admin/catalog/moderation-queue item shape, frozen exactly by
// api-contract-g2.md: { id, entity_type, entity_id, opened_at } — no
// version/status fields (status is always OPEN by construction, per the
// endpoint's own implicit filter).
export function toModerationQueueItemPayload(moderationCase: ModerationCase) {
  return {
    id: moderationCase.id,
    entity_type: moderationCase.entityType,
    entity_id: moderationCase.entityId,
    opened_at: moderationCase.openedAt.toISOString(),
  };
}
