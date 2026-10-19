import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SessionInvalidError } from '../../../common/http/api-error';
import { AUTH_CONFIG } from '../config/auth-config.token';
import type { AuthConfig } from '../config/auth.config';
import { generateRefreshTokenValue, sha256Hex } from '../lib/crypto';
import { AuthJwtService } from './jwt.service';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SessionContext {
  deviceId: string | null;
  userAgent: string | null;
  ipHash: string | null;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: AuthJwtService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async createSession(userId: string, context: SessionContext): Promise<IssuedTokens> {
    const refreshTokenValue = generateRefreshTokenValue();
    const refreshExpiresAt = this.refreshExpiry();

    const session = await this.prisma.session.create({
      data: {
        userId,
        deviceId: context.deviceId ?? undefined,
        userAgent: context.userAgent ?? undefined,
        ipHash: context.ipHash ?? undefined,
        lastUsedAt: new Date(),
        refreshTokens: {
          create: {
            tokenHash: sha256Hex(refreshTokenValue),
            expiresAt: refreshExpiresAt,
          },
        },
      },
    });

    const { token, expiresIn } = this.jwt.sign(userId, session.id);
    return { accessToken: token, refreshToken: refreshTokenValue, expiresIn };
  }

  async rotateRefreshToken(presentedToken: string): Promise<IssuedTokens> {
    const tokenHash = sha256Hex(presentedToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { session: true },
    });

    if (!existing) {
      throw new SessionInvalidError();
    }

    if (existing.status === 'ROTATED' || existing.status === 'REVOKED') {
      await this.revokeSessionForReuse(existing.sessionId);
      throw new SessionInvalidError();
    }

    if (existing.expiresAt.getTime() < Date.now() || existing.session.status !== 'ACTIVE') {
      throw new SessionInvalidError();
    }

    const newRefreshValue = generateRefreshTokenValue();
    try {
      await this.prisma.$transaction(async (tx) => {
        const newToken = await tx.refreshToken.create({
          data: {
            sessionId: existing.sessionId,
            tokenHash: sha256Hex(newRefreshValue),
            expiresAt: this.refreshExpiry(),
          },
        });
        // Atomic claim keyed on the expected prior state (status still ACTIVE),
        // not the pre-transaction read above — if this loses the race against a
        // concurrent rotation of the SAME presented token, claimed.count is 0
        // *here*, not just discoverable on the token's next presentation. That
        // is itself a reuse event (two requests presented one still-ACTIVE
        // token), so it must trigger revocation now, in the catch block below,
        // not wait for a third request to notice.
        const claimed = await tx.refreshToken.updateMany({
          where: { id: existing.id, status: 'ACTIVE' },
          data: { status: 'ROTATED', usedAt: new Date(), rotatedToId: newToken.id },
        });
        if (claimed.count === 0) {
          throw new SessionInvalidError();
        }
        await tx.session.update({
          where: { id: existing.sessionId },
          data: { lastUsedAt: new Date() },
        });
      });
    } catch (error) {
      if (error instanceof SessionInvalidError) {
        await this.revokeSessionForReuse(existing.sessionId);
      }
      throw error;
    }

    const { token, expiresIn } = this.jwt.sign(existing.session.userId, existing.sessionId);
    return { accessToken: token, refreshToken: newRefreshValue, expiresIn };
  }

  async revokeSession(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.status === 'REVOKED') {
      return;
    }
    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { id: sessionId },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: 'logout' },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId, status: { in: ['ACTIVE', 'ROTATED'] } },
        data: { status: 'REVOKED' },
      }),
    ]);
  }

  // Reusing an already-rotated/revoked refresh token is treated as possible theft:
  // the entire session chain is revoked, not just the presented token.
  // See docs/architecture/g0-design-notes.md §2.
  private async revokeSessionForReuse(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.status === 'REVOKED') {
      return;
    }
    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { id: sessionId },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedReason: 'refresh_token_reuse_detected',
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId, status: { in: ['ACTIVE', 'ROTATED'] } },
        data: { status: 'REVOKED' },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: session.userId,
          actorType: 'USER',
          action: 'auth.refresh_token_reuse_detected',
          entityType: 'session',
          entityId: sessionId,
        },
      }),
    ]);
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  }
}
