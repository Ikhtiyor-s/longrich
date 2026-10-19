import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // Liveness only — is the process up at all, no dependency checks. Formerly
  // a separate stub on the root AppController (removed: G0 QA review major
  // #5), which meant it skipped RequestIdMiddleware/HttpExceptionFilter/
  // ResponseEnvelopeInterceptor entirely. Now the same controller as the real
  // readiness check below, and covered by the same global wiring as every
  // other route.
  @Get()
  getLiveness(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async getReadiness(): Promise<{ status: string; checks: Record<string, string> }> {
    const [postgres, redis] = await Promise.all([
      this.healthService.checkPostgres(),
      this.healthService.checkRedis(),
    ]);

    const checks = {
      postgres: postgres ? 'ok' : 'unavailable',
      redis: redis ? 'ok' : 'unavailable',
    };

    if (postgres && redis) {
      return { status: 'ok', checks };
    }

    throw new HttpException({ status: 'unavailable', checks }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
