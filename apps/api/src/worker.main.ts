export {};

async function bootstrap() {
  process.env.OTEL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? '@longrich/worker';
  const { startTelemetry, shutdownTelemetry } = await import('./common/telemetry/otel.setup');
  await startTelemetry();

  await import('reflect-metadata');
  const { NestFactory } = await import('@nestjs/core');
  const { Logger } = await import('@nestjs/common');
  const { AppModule } = await import('./app.module');

  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log(
    'Worker process started (CatalogImportWorker registered — T-G2-8, apps/api/src/modules/catalog/imports/import-worker.ts)',
    'Worker',
  );

  // createApplicationContext() does not hold the event loop open by itself.
  // CatalogImportWorker's own BullMQ Worker/ioredis connection (registered
  // via CatalogModule, see import-worker.ts) now does that in practice, but
  // this interval is kept as a harmless belt-and-suspenders safeguard against
  // the process exiting (and restart-looping under `restart: unless-stopped`)
  // on any future refactor that leaves a moment with zero active consumers.
  setInterval(() => {}, 60_000);

  process.on('SIGTERM', () => {
    shutdownTelemetry().finally(() => process.exit(0));
  });
}

bootstrap();
