import { ApiError } from '../http/api-error';
import { cursorKeysetWhere, decodeCursor, encodeCursor, paginate } from './cursor';

describe('cursor pagination helper', () => {
  it('round-trips encode/decode', () => {
    const createdAt = new Date('2026-10-18T10:00:00.000Z');
    const id = '11111111-1111-1111-1111-111111111111';
    const token = encodeCursor({ createdAt, id });
    const decoded = decodeCursor(token);
    expect(decoded.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(decoded.id).toBe(id);
  });

  it('throws 422 VALIDATION_ERROR on a garbage cursor', () => {
    expect(() => decodeCursor('not-a-valid-cursor-token')).toThrow(ApiError);
    try {
      decodeCursor('not-a-valid-cursor-token');
    } catch (error) {
      expect((error as ApiError).code).toBe('VALIDATION_ERROR');
      expect((error as ApiError).details.cursor).toBeDefined();
    }
  });

  it('throws on a well-formed-base64 payload missing required fields', () => {
    const token = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64url');
    expect(() => decodeCursor(token)).toThrow(ApiError);
  });

  it('builds the (created_at ASC, id ASC) keyset predicate', () => {
    const cursor = decodeCursor(
      encodeCursor({ createdAt: new Date('2026-10-18T10:00:00.000Z'), id: 'abc' }),
    );
    const where = cursorKeysetWhere(cursor);
    expect(where).toEqual({
      OR: [
        { createdAt: { gt: cursor.createdAt } },
        { AND: [{ createdAt: cursor.createdAt }, { id: { gt: 'abc' } }] },
      ],
    });
  });

  it('returns undefined keyset predicate with no cursor', () => {
    expect(cursorKeysetWhere(null)).toBeUndefined();
  });

  it('paginate() returns null next_cursor when rows fit within the limit', () => {
    const rows = [{ id: '1', createdAt: new Date() }];
    const { items, nextCursor } = paginate(rows, 20);
    expect(items).toHaveLength(1);
    expect(nextCursor).toBeNull();
  });

  it('paginate() trims to limit and emits next_cursor when an extra row was fetched', () => {
    const rows = [
      { id: '1', createdAt: new Date('2026-10-18T10:00:00.000Z') },
      { id: '2', createdAt: new Date('2026-10-18T10:00:01.000Z') },
    ];
    const { items, nextCursor } = paginate(rows, 1);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('1');
    expect(nextCursor).toBe(encodeCursor(rows[0] as { id: string; createdAt: Date }));
  });
});
