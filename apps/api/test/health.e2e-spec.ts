import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HealthService } from '../src/common/health/health.service';

describe('HealthController (e2e)', () => {
  let app: INestApplication;
  const healthService = { checkPostgres: jest.fn(), checkRedis: jest.fn() };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HealthService)
      .useValue(healthService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health -> 200, envelope with data.status "ok" and a meta.request_id (global wiring, no per-controller opt-in)', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.body.data).toEqual({ status: 'ok' });
    expect(res.body.meta.request_id).toBeDefined();
    expect(res.headers['x-request-id']).toBe(res.body.meta.request_id);
  });

  it('GET /health/ready -> 200 when postgres and redis are reachable, same envelope + request_id', async () => {
    healthService.checkPostgres.mockResolvedValue(true);
    healthService.checkRedis.mockResolvedValue(true);

    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);

    expect(res.body.data).toEqual({ status: 'ok', checks: { postgres: 'ok', redis: 'ok' } });
    expect(res.body.meta.request_id).toBeDefined();
    expect(res.headers['x-request-id']).toBe(res.body.meta.request_id);
  });

  it('GET /health/ready -> 503 when redis is unreachable, error envelope with request_id', async () => {
    healthService.checkPostgres.mockResolvedValue(true);
    healthService.checkRedis.mockResolvedValue(false);

    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);

    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.request_id).toBeDefined();
    expect(res.headers['x-request-id']).toBe(res.body.request_id);
  });
});
