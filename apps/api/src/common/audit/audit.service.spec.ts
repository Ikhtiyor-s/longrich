import { Prisma } from '@prisma/client';
import { AuditService } from './audit.service';

function buildService() {
  const prisma = { auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) } };
  const service = new AuditService(prisma as never);
  return { service, prisma };
}

describe('AuditService', () => {
  it('redacts configured sensitive field names in before/after JSON BEFORE persisting, not just before logging', async () => {
    const { service, prisma } = buildService();

    await service.record({
      actor: { id: 'user-1', type: 'USER' },
      action: 'auth.otp.verify',
      entityType: 'otp_challenge',
      entityId: 'challenge-1',
      before: { otp_code: '482913', status: 'PENDING' },
      after: {
        otp_code: '482913',
        password: 'super-secret',
        refresh_token: 'raw-refresh-token-value',
        access_token: 'raw-access-token-value',
        secret: 'otp-hmac-secret-value',
        bank_account: '1234 5678 9012',
        card_number: '4111111111111111',
        nested: { token: 'nested-secret', safe_field: 'keep-me' },
        status: 'VERIFIED',
      },
      requestId: 'req-1',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const persisted = prisma.auditLog.create.mock.calls[0][0].data;

    expect(persisted.beforeJson).toEqual({ otp_code: '[REDACTED]', status: 'PENDING' });
    expect(persisted.afterJson).toEqual({
      otp_code: '[REDACTED]',
      password: '[REDACTED]',
      refresh_token: '[REDACTED]',
      access_token: '[REDACTED]',
      secret: '[REDACTED]',
      bank_account: '[REDACTED]',
      card_number: '[REDACTED]',
      nested: { token: '[REDACTED]', safe_field: 'keep-me' },
      status: 'VERIFIED',
    });

    const persistedAsWritten = JSON.stringify(persisted);
    expect(persistedAsWritten).not.toContain('482913');
    expect(persistedAsWritten).not.toContain('super-secret');
    expect(persistedAsWritten).not.toContain('raw-refresh-token-value');
    expect(persistedAsWritten).not.toContain('raw-access-token-value');
    expect(persistedAsWritten).not.toContain('otp-hmac-secret-value');
    expect(persistedAsWritten).not.toContain('1234 5678 9012');
    expect(persistedAsWritten).not.toContain('4111111111111111');
    expect(persistedAsWritten).not.toContain('nested-secret');
  });

  it('writes actor/action/entity/request_id even when before/after are omitted', async () => {
    const { service, prisma } = buildService();

    await service.record({
      actor: { id: 'user-2', type: 'USER' },
      action: 'authz.permission_denied',
      entityType: 'permission',
      entityId: 'test:read',
      requestId: 'req-2',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'user-2',
        actorType: 'USER',
        action: 'authz.permission_denied',
        entityType: 'permission',
        entityId: 'test:read',
        requestId: 'req-2',
        beforeJson: Prisma.JsonNull,
        afterJson: Prisma.JsonNull,
      }),
      select: { id: true },
    });
  });

  it('supports non-user (SYSTEM/SERVICE) actors with no actor id, per the schema design note', async () => {
    const { service, prisma } = buildService();

    await service.record({
      actor: { type: 'SYSTEM' },
      action: 'outbox.dead_letter',
      entityType: 'outbox_event',
      entityId: 'event-1',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: null, actorType: 'SYSTEM' }),
      }),
    );
  });

  it('honors a call-site-specific extra redacted field name', async () => {
    const { service, prisma } = buildService();

    await service.record({
      actor: { id: 'seller-1', type: 'USER' },
      action: 'sellers.kyb.updated',
      entityType: 'seller',
      entityId: 'seller-1',
      after: { tax_id: '123456789' },
      extraRedactedFields: ['tax_id'],
    });

    const persisted = prisma.auditLog.create.mock.calls[0][0].data;
    expect(persisted.afterJson).toEqual({ tax_id: '[REDACTED]' });
  });
});
