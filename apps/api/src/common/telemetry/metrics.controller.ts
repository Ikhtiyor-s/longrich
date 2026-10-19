import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';

// Unauthenticated, like /health — internal scraping endpoint, not part of the
// frozen /v1 contract (api-contract-g0.md). Prometheus (if/when brought up
// via the optional `observability` Compose profile) scrapes this directly.
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    return this.metrics.metricsText();
  }
}
