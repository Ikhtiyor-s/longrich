import type { SellerMember } from '@prisma/client';

export function toMemberPayload(member: SellerMember) {
  return {
    id: member.id,
    seller_id: member.sellerId,
    user_id: member.userId,
    role: member.role,
    created_at: member.createdAt.toISOString(),
    updated_at: member.updatedAt.toISOString(),
  };
}
