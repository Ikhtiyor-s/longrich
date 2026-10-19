import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExportResultCode } from '@opentelemetry/core';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { FileSpanExporter } from './file-span-exporter';

function fakeSpan(overrides: Partial<ReadableSpan> = {}): ReadableSpan {
  return {
    name: 'GET /v1/me',
    kind: 1,
    spanContext: () => ({ traceId: 'trace-1', spanId: 'span-1', traceFlags: 1 }),
    parentSpanContext: undefined,
    startTime: [0, 0],
    endTime: [0, 1_000_000],
    attributes: { 'http.method': 'GET' },
    status: { code: 0 },
    resource: { attributes: { 'service.name': 'longrich-api' } },
    ...overrides,
  } as unknown as ReadableSpan;
}

describe('FileSpanExporter', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'otel-file-exporter-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes one NDJSON line per exported span, including trace_id/span_id and no raw request data', (done) => {
    const filePath = join(dir, 'nested', 'traces.ndjson');
    const exporter = new FileSpanExporter(filePath);

    exporter.export([fakeSpan(), fakeSpan({ name: 'POST /v1/auth/otp/request' })], (result) => {
      expect(result.code).toBe(ExportResultCode.SUCCESS);

      const lines = readFileSync(filePath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);

      const first = JSON.parse(lines[0] as string);
      expect(first.trace_id).toBe('trace-1');
      expect(first.span_id).toBe('span-1');
      expect(first.name).toBe('GET /v1/me');

      done();
    });
  });
});
