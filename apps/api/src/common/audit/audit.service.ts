import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { redactSensitiveFields } from './redact';

export type AuditActorType = 'USER' | 'SYSTEM' | 'SERVICE';

export interface AuditActor {
  id?: string | null;
  type: AuditActorType;
}

export interface AuditRecordInput {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  requestId?: string | null;
  traceId?: string | null;
  ipHash?: string | null;
  // Allows a call site to widen the deny-list for a payload shape only it
  // knows about, without editing the shared default list in redact.ts.
  extraRedactedFields?: readonly string[];
}

// A redacted plain object is JSON-serializable by construction (redact.ts
// only ever replaces values, never introduces functions/symbols/etc.) — the
// cast here just tells Prisma's generated InputJsonValue type what redact.ts
// already guarantees at runtime.
function toJsonInput(
  value: Record<string, unknown> | null | undefined,
  extra: readonly string[],
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return redactSensitiveFields(value, extra) as Prisma.InputJsonValue;
}

// Canonical write path into audit_logs (ADM-008). Per ADR-001/g0-design-notes
// the table is append-only (DB trigger blocks UPDATE/DELETE) — this service
// never updates or deletes a row, only ever inserts. Every caller across every
// module should go through here instead of calling prisma.auditLog.create
// directly, so redaction is enforced in exactly one place.
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<{ id: string }> {
    const extra = input.extraRedactedFields ?? [];
    return this.prisma.auditLog.create({
      data: {
        actorId: input.actor.id ?? null,
        actorType: input.actor.type,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        beforeJson: toJsonInput(input.before, extra),
        afterJson: toJsonInput(input.after, extra),
        requestId: input.requestId ?? null,
        traceId: input.traceId ?? null,
        ipHash: input.ipHash ?? null,
      },
      select: { id: true },
    });
  }
}
