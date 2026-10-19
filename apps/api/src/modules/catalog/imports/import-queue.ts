import { Inject, Injectable, OnModuleDestroy, Provider } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

// First real BullMQ usage anywhere in this codebase (g0-design-notes.md §8's
// outbox-dispatcher design anticipated BullMQ but nothing registered a
// processor until this ticket — see worker.main.ts's own "no BullMQ
// processors registered yet" log line, now stale). A dedicated ioredis
// connection (not the shared common/redis/redis.module.ts REDIS_CLIENT) is
// used here deliberately: BullMQ requires `maxRetriesPerRequest: null` on
// any connection it manages, a setting that would be wrong to force onto the
// shared client used by OTP rate limiting elsewhere.
export const CATALOG_IMPORT_QUEUE = 'CATALOG_IMPORT_QUEUE';
export const CATALOG_IMPORT_QUEUE_NAME = 'catalog-imports';
export type CatalogImportJobName = 'validate' | 'commit';
export interface CatalogImportJobPayload {
  jobId: string;
}

export function createBullMqRedisConnection(): Redis {
  return new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
}

@Injectable()
class CatalogImportQueueLifecycle implements OnModuleDestroy {
  constructor(@Inject(CATALOG_IMPORT_QUEUE) private readonly queue: Queue) {}

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch(() => undefined);
  }
}

export const catalogImportQueueProviders: Provider[] = [
  {
    provide: CATALOG_IMPORT_QUEUE,
    useFactory: (): Queue =>
      new Queue(CATALOG_IMPORT_QUEUE_NAME, { connection: createBullMqRedisConnection() }),
  },
  CatalogImportQueueLifecycle,
];
