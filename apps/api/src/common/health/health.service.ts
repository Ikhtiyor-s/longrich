import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async checkPostgres(): Promise<boolean> {
    try {
      // Reuses PrismaService's own pooled connection (PrismaModule is @Global,
      // already $connect()-ed via its OnModuleInit) instead of opening a fresh
      // pg.Client per readiness check.
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.warn(`Postgres readiness check failed: ${(error as Error).message}`);
      return false;
    }
  }

  async checkRedis(): Promise<boolean> {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    try {
      await redis.connect();
      await redis.ping();
      return true;
    } catch (error) {
      this.logger.warn(`Redis readiness check failed: ${(error as Error).message}`);
      return false;
    } finally {
      redis.disconnect();
    }
  }
}
