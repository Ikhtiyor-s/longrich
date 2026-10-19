import type { NodeSDK } from '@opentelemetry/sdk-node';

export { getActiveTraceId, tagActiveSpan } from './trace-context';

// Deliberately NOT a persistent collector/Grafana/Loki/Prometheus stack — see
// docs/architecture/g0-design-notes.md and the T-G0-6 ticket's own resource-
// awareness note (dev machine already runs ~15 other Compose projects).
// ConsoleSpanExporter gives live stdout visibility; FileSpanExporter produces
// the "exported trace JSON" evidence the ticket's acceptance criteria accepts
// as an alternative to a Grafana/Loki/Prometheus screenshot.
//
// All @opentelemetry/sdk-node + instrumentation-http imports below are
// dynamic (inside startTelemetry(), not at module top level) so that
// importing this file's cheap exports (getActiveTraceId/tagActiveSpan, used
// by RequestIdMiddleware on every request) never pulls in the SDK's full
// module graph. Only main.ts/worker.main.ts — the two real process
// entrypoints — ever call startTelemetry(), so only they pay that load cost.
// Jest unit/e2e runs boot AppModule directly and never call it at all.
let sdk: NodeSDK | undefined;

function serviceName(): string {
  return process.env.OTEL_SERVICE_NAME ?? '@longrich/api';
}

export async function startTelemetry(): Promise<void> {
  if (sdk) {
    return;
  }

  const [
    { ConsoleSpanExporter, SimpleSpanProcessor },
    { resourceFromAttributes },
    { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION },
    { HttpInstrumentation },
    { NodeSDK: NodeSDKCtor },
    { FileSpanExporter },
  ] = await Promise.all([
    import('@opentelemetry/sdk-trace-base'),
    import('@opentelemetry/resources'),
    import('@opentelemetry/semantic-conventions'),
    import('@opentelemetry/instrumentation-http'),
    import('@opentelemetry/sdk-node'),
    import('./file-span-exporter'),
  ]);

  const traceFile = process.env.OTEL_TRACE_FILE ?? 'var/telemetry/traces.ndjson';

  sdk = new NodeSDKCtor({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName(),
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.0.0',
    }),
    spanProcessors: [
      new SimpleSpanProcessor(new ConsoleSpanExporter()),
      new SimpleSpanProcessor(new FileSpanExporter(traceFile)),
    ],
    instrumentations: [new HttpInstrumentation()],
  });

  sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) {
    return;
  }
  await sdk.shutdown();
  sdk = undefined;
}
