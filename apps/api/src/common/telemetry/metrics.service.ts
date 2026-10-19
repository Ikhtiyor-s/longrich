import { Injectable } from '@nestjs/common';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests handled, by method and status code.',
    labelNames: ['method', 'status_code'],
    registers: [this.registry],
  });

  // No outbox worker emits this yet (worker has no BullMQ processors
  // registered in G0 — see worker.main.ts / g0-design-notes.md §8) — the
  // counter is registered now so the dead-letter alerting path g0-design-notes
  // §8 describes has somewhere to report to the moment it exists, matching
  // the same "register the contract surface before the first emitter lands"
  // approach T-G0-6 takes with the reserved error codes.
  readonly outboxDeadLetterTotal = new Counter({
    name: 'outbox_dead_letter_total',
    help: 'Total outbox events moved to DEAD_LETTER status.',
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  recordHttpRequest(method: string, statusCode: number): void {
    this.httpRequestsTotal.labels(method, String(statusCode)).inc();
  }

  async metricsText(): Promise<string> {
    return this.registry.metrics();
  }
}
