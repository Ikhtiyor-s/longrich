import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

// Global like PrismaModule/RedisModule — every module needs a single shared
// AuditService instance without each one importing this module explicitly.
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
