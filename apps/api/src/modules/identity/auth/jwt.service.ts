import { Inject, Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { AUTH_CONFIG } from '../config/auth-config.token';
import type { AuthConfig } from '../config/auth.config';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface SignedAccessToken {
  token: string;
  expiresIn: number;
}

// Claims are intentionally limited to sub/sid/jti here — no admin_roles/permissions.
// g0-design-notes.md §4 documents a richer claims shape for RBAC, but computing it
// means reading admin-audit's tables, which is T-G0-5's owned territory per this
// ticket's brief; T-G0-5 extends issuance with those claims, not this file.
@Injectable()
export class AuthJwtService {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  sign(userId: string, sessionId: string): SignedAccessToken {
    const token = jwt.sign(
      { sub: userId, sid: sessionId, jti: randomUUID() },
      this.config.jwtSecret,
      {
        expiresIn: this.config.accessTokenTtlSeconds,
        issuer: this.config.jwtIssuer,
      },
    );
    return { token, expiresIn: this.config.accessTokenTtlSeconds };
  }

  verify(token: string): AccessTokenClaims {
    return jwt.verify(token, this.config.jwtSecret, {
      issuer: this.config.jwtIssuer,
    }) as AccessTokenClaims;
  }
}
