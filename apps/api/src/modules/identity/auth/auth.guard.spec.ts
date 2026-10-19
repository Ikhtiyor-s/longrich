import { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './auth.guard';

function createContext(headers: Record<string, string>): ExecutionContext {
  const request = { headers, user: undefined as unknown };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function buildGuard(claims: unknown, session: unknown) {
  const jwt = { verify: jest.fn().mockReturnValue(claims) };
  const prisma = { session: { findUnique: jest.fn().mockResolvedValue(session) } };
  const guard = new JwtAuthGuard(jwt as never, prisma as never);
  return { guard, jwt, prisma };
}

describe('JwtAuthGuard', () => {
  it('allows a request whose claims.sub matches the session.userId it points at', async () => {
    const { guard } = buildGuard(
      { sub: 'user-1', sid: 'session-1' },
      { id: 'session-1', userId: 'user-1', status: 'ACTIVE' },
    );
    const context = createContext({ authorization: 'Bearer token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects with 401 UNAUTHENTICATED when claims.sub does not match the session.userId it points at (forged/mismatched subject)', async () => {
    const { guard, prisma } = buildGuard(
      { sub: 'attacker-user-id', sid: 'session-1' },
      // session-1 actually belongs to a different user than the token's own `sub` claims.
      { id: 'session-1', userId: 'victim-user-id', status: 'ACTIVE' },
    );
    const context = createContext({ authorization: 'Bearer token' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(prisma.session.findUnique).toHaveBeenCalledWith({ where: { id: 'session-1' } });
  });

  it('rejects with 401 UNAUTHENTICATED when the session is not ACTIVE, even if sub matches', async () => {
    const { guard } = buildGuard(
      { sub: 'user-1', sid: 'session-1' },
      { id: 'session-1', userId: 'user-1', status: 'REVOKED' },
    );
    const context = createContext({ authorization: 'Bearer token' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects with 401 UNAUTHENTICATED when no session row is found for the claimed sid', async () => {
    const { guard } = buildGuard({ sub: 'user-1', sid: 'unknown-session' }, null);
    const context = createContext({ authorization: 'Bearer token' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects with 401 UNAUTHENTICATED when the bearer token itself fails signature/expiry verification', async () => {
    const jwt = {
      verify: jest.fn(() => {
        throw new Error('invalid signature');
      }),
    };
    const prisma = { session: { findUnique: jest.fn() } };
    const guard = new JwtAuthGuard(jwt as never, prisma as never);
    const context = createContext({ authorization: 'Bearer garbage' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });
});
