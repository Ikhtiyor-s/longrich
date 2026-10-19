import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { ImportRowProcessor } from './import-row-processor';
import {
  CATALOG_IMPORT_QUEUE_NAME,
  createBullMqRedisConnection,
  type CatalogImportJobName,
  type CatalogImportJobPayload,
} from './import-queue';

// The first real BullMQ consumer in this codebase. Registered as a provider
// on CatalogModule, which both apps/api/src/main.ts and
// apps/api/src/worker.main.ts bootstrap via the same AppModule (see
// app.module.ts — there is no separate "api-only" vs "worker-only" module
// graph in this codebase today, docker-compose.dev.yml's `api`/`worker`
// containers differ only in entrypoint). This means both processes run a
// consumer instance; BullMQ supports N concurrent workers on one queue by
// design (jobs are distributed, not duplicated), so this is redundant
// processing capacity, not a correctness issue — splitting api/worker onto
// separate module graphs so only the worker process consumes jobs would be
// a larger architectural change than this ticket's own scope (no other G0-G2
// ticket introduced that split either), flagged here rather than silently
// done.
@Injectable()
export class CatalogImportWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('CatalogImportWorker');
  private worker: Worker<CatalogImportJobPayload> | undefined;

  constructor(private readonly processor: ImportRowProcessor) {}

  onModuleInit(): void {
    this.worker = new Worker<CatalogImportJobPayload>(
      CATALOG_IMPORT_QUEUE_NAME,
      async (job: Job<CatalogImportJobPayload>) => {
        const name = job.name as CatalogImportJobName;
        if (name === 'validate') {
          await this.processor.validateJob(job.data.jobId);
        } else if (name === 'commit') {
          await this.processor.commitJob(job.data.jobId);
        } else {
          this.logger.warn(`Unknown catalog-import job name: ${name}`);
        }
      },
      { connection: createBullMqRedisConnection() },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`catalog-import job ${job?.id ?? '?'} failed: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
