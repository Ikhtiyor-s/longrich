import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { UnauthenticatedError } from '../../../common/http/api-error';
import { extractBearerToken } from './bearer-token';
import { AuthJwtService } from './jwt.service';
import type { AuthenticatedUser } from './current-user.decorator';

// Minimal "is authenticated" check only — valid signature, unexpired JWT, and the
// claimed session must still be ACTIVE. Deliberately NOT a permission/role check:
// that layering is T-G0-5's territory (RBAC guards sit on top of this, not inside it).
// Logout uses JwtSignatureGuard instead (see that file) — logout must stay reachable
// with a token belonging to an already-revoked session for idempotent re-logout.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: AuthJwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractBearerToken(request);

    let claims;
    try {
      claims = this.jwt.verify(token);
    } catch {
      throw new UnauthenticatedError();
    }

    const session = await this.prisma.session.findUnique({ where: { id: claims.sid } });
    // session.userId !== claims.sub: never trust the JWT's own `sub` claim for
    // identity without cross-checking it against the session it's presented
    // with — a token whose `sid` and `sub` don't actually belong to the same
    // session row must not resolve to that `sub` as request.user.id.
    if (!session || session.status !== 'ACTIVE' || session.userId !== claims.sub) {
      throw new UnauthenticatedError();
    }

    request.user = { id: claims.sub, sessionId: claims.sid };
    return true;
  }
}
