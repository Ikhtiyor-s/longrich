import { Logger } from '@nestjs/common';

export interface LogCorrelation {
  request_id?: string | null;
  trace_id?: string | null;
}

// Single place every log line that needs request_id/trace_id correlation
// (TZ §19) goes through, so "structured" means the same shape everywhere
// instead of each call site hand-rolling its own JSON. Fields passed in
// `fields` are NOT redacted here — callers must never pass secret/OTP/card
// values into this function; AuditService.record is the only place that
// handles untrusted payload redaction, this is for small known-safe fields
// (method, path, status_code, error code, etc.).
export function logStructured(
  logger: Logger,
  level: 'log' | 'warn' | 'error',
  message: string,
  correlation: LogCorrelation,
  fields: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    message,
    request_id: correlation.request_id ?? null,
    trace_id: correlation.trace_id ?? null,
    ...fields,
  });
  logger[level](line);
}
