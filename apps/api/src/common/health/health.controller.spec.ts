import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let service: { checkPostgres: jest.Mock; checkRedis: jest.Mock };

  beforeEach(async () => {
    service = {
      checkPostgres: jest.fn(),
      checkRedis: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: service }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('GET /health (liveness) returns status ok without touching HealthService', () => {
    expect(controller.getLiveness()).toEqual({ status: 'ok' });
    expect(service.checkPostgres).not.toHaveBeenCalled();
    expect(service.checkRedis).not.toHaveBeenCalled();
  });

  it('returns 200 ok when postgres and redis are both reachable', async () => {
    service.checkPostgres.mockResolvedValue(true);
    service.checkRedis.mockResolvedValue(true);

    await expect(controller.getReadiness()).resolves.toEqual({
      status: 'ok',
      checks: { postgres: 'ok', redis: 'ok' },
    });
  });

  it('throws a 503 when postgres is unreachable', async () => {
    service.checkPostgres.mockResolvedValue(false);
    service.checkRedis.mockResolvedValue(true);

    try {
      await controller.getReadiness();
      throw new Error('expected getReadiness to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(503);
      expect((error as HttpException).getResponse()).toEqual({
        status: 'unavailable',
        checks: { postgres: 'unavailable', redis: 'ok' },
      });
    }
  });
});
