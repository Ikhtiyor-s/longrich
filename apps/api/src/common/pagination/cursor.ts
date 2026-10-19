import { ValidationError } from '../http/api-error';

// Frozen convention (docs/architecture/api-contract-g2.md "Cursor pagination"
// section) — first use anywhere in this codebase, shared here so every G2
// list endpoint (not just this ticket's) encodes/decodes the opaque token
// identically: base64url of {"created_at":"<iso>","id":"<uuid>"}, ordering
// fixed at (created_at ASC, id ASC) with no exception.
export interface DecodedCursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  const json = JSON.stringify({ created_at: row.createdAt.toISOString(), id: row.id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): DecodedCursor {
  let parsed: unknown;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    throw new ValidationError('Malformed cursor.', {
      cursor: ['must be a valid opaque cursor token'],
    });
  }

  const candidate = parsed as { created_at?: unknown; id?: unknown };
  if (typeof candidate.created_at !== 'string' || typeof candidate.id !== 'string') {
    throw new ValidationError('Malformed cursor.', {
      cursor: ['must be a valid opaque cursor token'],
    });
  }

  const createdAt = new Date(candidate.created_at);
  if (Number.isNaN(createdAt.getTime())) {
    throw new ValidationError('Malformed cursor.', {
      cursor: ['must be a valid opaque cursor token'],
    });
  }

  return { createdAt, id: candidate.id };
}

// Generic (created_at ASC, id ASC) keyset predicate — usable against any
// Prisma model that has both columns, which every G2 list endpoint's model
// does. Typed loosely (not against a specific *WhereInput) on purpose: this
// is a cross-model helper, not owned by one module's Prisma types.
export function cursorKeysetWhere(
  cursor: DecodedCursor | null,
): Record<string, unknown> | undefined {
  if (!cursor) {
    return undefined;
  }
  return {
    OR: [
      { createdAt: { gt: cursor.createdAt } },
      { AND: [{ createdAt: cursor.createdAt }, { id: { gt: cursor.id } }] },
    ],
  };
}

export const CURSOR_KEYSET_ORDER_BY = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

export const DEFAULT_PAGE_LIMIT = 20;
export const MIN_PAGE_LIMIT = 1;
export const MAX_PAGE_LIMIT = 100;

// Splits a `take: limit + 1` result set into the page + next_cursor, the
// shared tail-end of every G2 list handler.
export function paginate<T extends { createdAt: Date; id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) {
    return { items: rows, nextCursor: null };
  }
  const items = rows.slice(0, limit);
  const last = items[items.length - 1] as T;
  return { items, nextCursor: encodeCursor(last) };
}
