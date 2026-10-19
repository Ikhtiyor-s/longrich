import type { User } from '@prisma/client';

export function toAuthUserPayload(user: User) {
  return {
    id: user.id,
    phone: user.phone,
    status: user.status,
    locale: user.locale.toLowerCase(),
    phone_verified_at: user.phoneVerifiedAt ? user.phoneVerifiedAt.toISOString() : null,
    created_at: user.createdAt.toISOString(),
  };
}

export function toMePayload(user: User) {
  return {
    ...toAuthUserPayload(user),
    updated_at: user.updatedAt.toISOString(),
  };
}
