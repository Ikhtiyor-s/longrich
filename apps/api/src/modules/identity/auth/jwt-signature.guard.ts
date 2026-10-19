import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { UnauthenticatedError } from '../../../common/http/api-error';
import { extractBearerToken } from './bearer-token';
import { AuthJwtService } from './jwt.service';
import type { AuthenticatedUser } from './current-user.decorator';

// Token-validity-only check (signature + expiry), no DB session-active lookup.
// Used only by /v1/auth/logout: the contract requires logout to stay idempotent —
// a second logout call with the same (now-revoked-session) access token must still
// return 200, which JwtAuthGuard's stricter "session must be ACTIVE" check would break.
@Injectable()
export class JwtSignatureGuard implements CanActivate {
  constructor(private readonly jwt: AuthJwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractBearerToken(request);

    try {
      const claims = this.jwt.verify(token);
      request.user = { id: claims.sub, sessionId: claims.sid };
      return true;
    } catch {
      throw new UnauthenticatedError();
    }
  }
}
