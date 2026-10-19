import { SetMetadata } from '@nestjs/common';

export const PERMISSION_METADATA_KEY = 'requiredPermission';

// code is "resource:action" (e.g. "test:read"), matching AdminPermission's
// (resource, action) columns — see docs/architecture/g0-design-notes.md §3.
export const RequirePermission = (code: string): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION_METADATA_KEY, code);
