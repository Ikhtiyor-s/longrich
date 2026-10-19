export {};

// Every import below is dynamic and sequentially awaited, not static, so
// that startTelemetry() (which itself dynamically imports
// @opentelemetry/sdk-node + instrumentation-http) fully resolves — and
// therefore finishes patching Node's 'http' module — strictly before
// '@nestjs/core'/'./app.module' are ever required. A static top-level
// import of '@nestjs/core' above a merely-called-but-unawaited
// startTelemetry() would race: Node resolves static imports before running
// any module-body code, so the patch could lose the race against Nest's own
// (transitive) first `require('http')`.
async function bootstrap() {
  const { startTelemetry, shutdownTelemetry } = await import('./common/telemetry/otel.setup');
  await startTelemetry();

  await import('reflect-metadata');
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);

  process.on('SIGTERM', () => {
    shutdownTelemetry().finally(() => process.exit(0));
  });
}

bootstrap();
