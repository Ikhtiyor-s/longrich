import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExportResult } from '@opentelemetry/core';
import { ExportResultCode } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { hrTimeToMilliseconds } from '@opentelemetry/core';

// Minimal custom SpanExporter writing one JSON object per line (NDJSON) to a
// local file. Exists so a real exported trace can be produced as filesystem
// evidence (per T-G0-6's own "exported trace JSON" acceptance clause) without
// standing up a persistent collector/Grafana/Loki/Prometheus stack on a dev
// machine already running ~15 other Compose projects.
export class FileSpanExporter implements SpanExporter {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    try {
      for (const span of spans) {
        const record = {
          trace_id: span.spanContext().traceId,
          span_id: span.spanContext().spanId,
          parent_span_id: span.parentSpanContext?.spanId ?? null,
          name: span.name,
          kind: span.kind,
          start_time_ms: hrTimeToMilliseconds(span.startTime),
          end_time_ms: hrTimeToMilliseconds(span.endTime),
          attributes: span.attributes,
          status: span.status,
          resource: span.resource.attributes,
        };
        appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
      }
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (error) {
      resultCallback({ code: ExportResultCode.FAILED, error: error as Error });
    }
  }

  async shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
