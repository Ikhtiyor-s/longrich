import { context, trace } from '@opentelemetry/api';

// Deliberately split out of otel.setup.ts: this file only imports the tiny
// @opentelemetry/api package (a thin interface with a no-op default
// implementation when no SDK has registered itself — e.g. every Jest
// unit/e2e run, which boots AppModule directly and never imports
// otel.setup.ts's startTelemetry()). RequestIdMiddleware/HttpExceptionFilter
// import from here, NOT from otel.setup.ts, so loading them never pulls in
// @opentelemetry/sdk-node + instrumentation-http's module graph — that cost
// is paid only by main.ts/worker.main.ts, the two real process entrypoints.
export function getActiveTraceId(): string | undefined {
  const span = trace.getSpan(context.active());
  if (!span) {
    return undefined;
  }
  const spanContext = span.spanContext();
  return trace.isSpanContextValid(spanContext) ? spanContext.traceId : undefined;
}

export function tagActiveSpan(attributes: Record<string, string>): void {
  const span = trace.getSpan(context.active());
  if (!span) {
    return;
  }
  for (const [key, value] of Object.entries(attributes)) {
    span.setAttribute(key, value);
  }
}
