import { SetMetadata } from '@nestjs/common';
import type { SellerPermissionCode } from './seller-permissions';

export const SELLER_PERMISSION_METADATA_KEY = 'requiredSellerPermission';

// Same shape as common/decorators/require-permission.decorator.ts, keyed by
// SellerPermissionCode (seller_members.role lookup) instead of an admin
// permission code — see seller-permissions.ts's own comment and
// docs/open-questions.md #30 for why this is a sibling pattern, not a
// parallel generic mechanism.
export const RequireSellerPermission = (code: SellerPermissionCode): MethodDecorator & ClassDecorator =>
  SetMetadata(SELLER_PERMISSION_METADATA_KEY, code);
