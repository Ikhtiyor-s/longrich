import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { JwtAuthGuard } from '../identity/auth/auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RbacDemoController } from './rbac-demo.controller';

// G0: first real content in this stub module is T-G0-5's RBAC enforcement
// mechanism (PermissionGuard) plus its throwaway proof endpoint. Full
// admin-audit business logic (moderation cases, real audit-log read
// endpoints) lands in later milestones per ADR-001's module list.
//
// JwtAuthGuard is re-declared as a provider here (NestJS instantiates
// class-reference guards scoped to the consuming module) — it resolves
// against IdentityModule's exported AuthJwtService + the global
// PrismaService, not a duplicate of identity's own token/session logic.
@Module({
  imports: [IdentityModule],
  controllers: [RbacDemoController],
  providers: [JwtAuthGuard, PermissionGuard],
})
export class AdminAuditModule {}
