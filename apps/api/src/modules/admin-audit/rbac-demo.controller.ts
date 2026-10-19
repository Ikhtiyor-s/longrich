import { Controller, Get, UseGuards } from '@nestjs/common';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../identity/auth/auth.guard';
import { CurrentUser, type AuthenticatedUser } from '../identity/auth/current-user.decorator';

// T-G0-5's own throwaway fixture route proving @RequirePermission end-to-end
// against the seeded test:read permission (SUPER_ADMIN has it, SUPPORT_AGENT
// doesn't) — not part of the frozen api-contract-g0.md, removed/repurposed
// once a real admin-audit read endpoint exists.
@Controller('v1/admin/rbac-demo')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RbacDemoController {
  @Get('test-read')
  @RequirePermission('test:read')
  testRead(@CurrentUser() user: AuthenticatedUser) {
    return { ok: true, actor_id: user.id };
  }
}
