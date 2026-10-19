import { getActiveTraceId, tagActiveSpan } from './otel.setup';

describe('otel.setup trace-id helpers', () => {
  it('returns undefined when no telemetry SDK/span is active (e.g. Jest unit runs)', () => {
    expect(getActiveTraceId()).toBeUndefined();
  });

  it('tagActiveSpan is a safe no-op when there is no active span', () => {
    expect(() => tagActiveSpan({ request_id: 'req-1' })).not.toThrow();
  });
});
