import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DuplicateRequestError } from '../http/api-error';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// Generic Idempotency-Key cache backed by commerce.idempotency_keys (table
// already defined in T-G0-3's migration per g0-design-notes.md §"outbox"
// companion — reserved there for G4 checkout but reused here since T-G1-2
// is the first ticket that needs real dedup on a resource-creating POST).
// No existing producer of this mechanism was found elsewhere in the
// codebase at the time this was written — see T-G1-2's own report for the
// "flagged, not silently decided" note on building it now instead of G4.
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  // Caller supplies `scope` (a fixed string identifying the endpoint) and the
  // raw request body used to detect a same-key-different-body conflict. If
  // `key` is undefined (client sent no Idempotency-Key header), `handler` just
  // runs normally — the header is optional, not required, on every write.
  async run<T>(
    scope: string,
    key: string | undefined,
    requestBody: unknown,
    handler: () => Promise<T>,
  ): Promise<T> {
    if (!key) {
      return handler();
    }

    const requestHash = createHash('sha256')
      .update(JSON.stringify(requestBody ?? {}))
      .digest('hex');

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { scope_key: { scope, key } },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new DuplicateRequestError();
      }
      if (existing.status === 'COMPLETED') {
        return existing.responsePayload as T;
      }
      // IN_PROGRESS: a concurrent call with the same key is still running.
      // Surfacing this as a conflict is safer than letting the side effect
      // run twice in a race.
      throw new DuplicateRequestError();
    }

    await this.prisma.idempotencyKey.create({
      data: {
        scope,
        key,
        requestHash,
        status: 'IN_PROGRESS',
        expiresAt: new Date(Date.now() + DEFAULT_TTL_MS),
      },
    });

    try {
      const result = await handler();
      await this.prisma.idempotencyKey.update({
        where: { scope_key: { scope, key } },
        data: {
          status: 'COMPLETED',
          responsePayload: result as unknown as Prisma.InputJsonValue,
        },
      });
      return result;
    } catch (error) {
      // A genuine failure must not permanently block a retry with the same
      // key — delete the IN_PROGRESS row so the next attempt starts clean.
      await this.prisma.idempotencyKey
        .delete({ where: { scope_key: { scope, key } } })
        .catch(() => undefined);
      throw error;
    }
  }
}
