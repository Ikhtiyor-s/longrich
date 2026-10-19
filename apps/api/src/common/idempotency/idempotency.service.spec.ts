import { IdempotencyService } from './idempotency.service';

function buildService(prismaOverrides: Record<string, unknown>) {
  return new IdempotencyService(prismaOverrides as never);
}

describe('IdempotencyService', () => {
  it('runs the handler directly when no key is supplied', async () => {
    const handler = jest.fn().mockResolvedValue({ ok: true });
    const service = buildService({});

    const result = await service.run('scope-a', undefined, { a: 1 }, handler);

    expect(result).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('creates an IN_PROGRESS row, runs the handler once, then marks it COMPLETED with the result cached', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({});
    const update = jest.fn().mockResolvedValue({});
    const handler = jest.fn().mockResolvedValue({ id: 'app-1' });
    const service = buildService({ idempotencyKey: { findUnique, create, update } });

    const result = await service.run('scope-a', 'key-1', { a: 1 }, handler);

    expect(result).toEqual({ id: 'app-1' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scope: 'scope-a', key: 'key-1', status: 'IN_PROGRESS' }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scope_key: { scope: 'scope-a', key: 'key-1' } },
        data: expect.objectContaining({ status: 'COMPLETED', responsePayload: { id: 'app-1' } }),
      }),
    );
  });

  it('replays the cached response for a repeat call with the same key and the same request body, without re-running the handler', async () => {
    // requestHash must match what the service itself would compute for this
    // body, so the "same body" branch (not the conflict branch) is taken.
    const crypto = await import('node:crypto');
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ a: 1 }))
      .digest('hex');
    const findUnique = jest
      .fn()
      .mockResolvedValue({ requestHash, status: 'COMPLETED', responsePayload: { id: 'app-1' } });
    const handler = jest.fn();
    const service = buildService({ idempotencyKey: { findUnique } });

    const result = await service.run('scope-a', 'key-1', { a: 1 }, handler);

    expect(result).toEqual({ id: 'app-1' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects with DUPLICATE_REQUEST when the same key is reused with a different request body', async () => {
    const crypto = await import('node:crypto');
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ a: 1 }))
      .digest('hex');
    const findUnique = jest
      .fn()
      .mockResolvedValue({ requestHash, status: 'COMPLETED', responsePayload: {} });
    const handler = jest.fn();
    const service = buildService({ idempotencyKey: { findUnique } });

    await expect(service.run('scope-a', 'key-1', { a: 2 }, handler)).rejects.toThrow(
      expect.objectContaining({ code: 'DUPLICATE_REQUEST' }),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects with DUPLICATE_REQUEST when a same-key call is still IN_PROGRESS (concurrent retry)', async () => {
    const crypto = await import('node:crypto');
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ a: 1 }))
      .digest('hex');
    const findUnique = jest
      .fn()
      .mockResolvedValue({ requestHash, status: 'IN_PROGRESS', responsePayload: null });
    const handler = jest.fn();
    const service = buildService({ idempotencyKey: { findUnique } });

    await expect(service.run('scope-a', 'key-1', { a: 1 }, handler)).rejects.toThrow(
      expect.objectContaining({ code: 'DUPLICATE_REQUEST' }),
    );
  });

  it('deletes the IN_PROGRESS row and rethrows when the handler itself fails, so a retry with the same key can succeed later', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({});
    const del = jest.fn().mockResolvedValue({});
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    const service = buildService({ idempotencyKey: { findUnique, create, delete: del } });

    await expect(service.run('scope-a', 'key-1', { a: 1 }, handler)).rejects.toThrow('boom');
    expect(del).toHaveBeenCalledWith({ where: { scope_key: { scope: 'scope-a', key: 'key-1' } } });
  });
});
