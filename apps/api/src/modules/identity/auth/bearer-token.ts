import type { Request } from 'express';
import { UnauthenticatedError } from '../../../common/http/api-error';

export function extractBearerToken(request: Request): string {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new UnauthenticatedError();
  }
  return header.slice('Bearer '.length).trim();
}
