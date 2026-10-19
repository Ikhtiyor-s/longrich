import { HttpException, HttpStatus } from '@nestjs/common';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'OTP_INVALID_OR_EXPIRED'
  | 'SESSION_INVALID'
  | 'OTP_LOCKED'
  | 'RATE_LIMITED'
  | 'FORBIDDEN'
  | 'SMS_PROVIDER_UNAVAILABLE'
  // Activated by T-G1-2 (seller application PATCH-after-SUBMITTED gate,
  // submit-twice gate) and its Idempotency-Key replay-vs-conflict handling —
  // moved out of ReservedApiErrorCode below since a real handler now emits
  // both, same "actually produced" bar this type's own comment describes.
  | 'INVALID_STATE_TRANSITION'
  | 'DUPLICATE_REQUEST';

// TZ §19's custom business error codes, registered here per T-G0-6 and
// api-contract-g0.md's "Codes not reachable in G0 but reserved in the same
// enum" table even though no G1+ endpoint emits any of them yet. Kept as a
// separate type (not folded into ApiErrorCode) so ApiError's own `code`
// property — which IS thrown today — stays limited to codes this G0 codebase
// actually produces; widening it here would let a future call site construct
// an ApiError with a code no handler is ready to emit without anyone noticing.
export type ReservedApiErrorCode =
  | 'STALE_QUOTE'
  | 'INSUFFICIENT_STOCK'
  | 'FORBIDDEN_SELLER'
  | 'PAYMENT_MISMATCH'
  | 'UNSUPPORTED_REFUND'
  | 'DELIVERY_ZONE_UNAVAILABLE';

export const RESERVED_ERROR_CODES: readonly ReservedApiErrorCode[] = [
  'STALE_QUOTE',
  'INSUFFICIENT_STOCK',
  'FORBIDDEN_SELLER',
  'PAYMENT_MISMATCH',
  'UNSUPPORTED_REFUND',
  'DELIVERY_ZONE_UNAVAILABLE',
];

// Full set of known `error.code` string values across both tables in
// api-contract-g0.md (actively emitted + reserved), for anything that wants
// to validate/document against the whole contract surface at once.
export type KnownApiErrorCode =
  | ApiErrorCode
  | ReservedApiErrorCode
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'ERROR';

export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super({ code, message, details }, status);
  }
}

export class ValidationError extends ApiError {
  constructor(message = 'Request validation failed.', details: Record<string, unknown> = {}) {
    super(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthenticatedError extends ApiError {
  constructor(message = 'Missing or invalid access token.') {
    super(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', message);
  }
}

export class OtpInvalidOrExpiredError extends ApiError {
  constructor() {
    super(HttpStatus.UNAUTHORIZED, 'OTP_INVALID_OR_EXPIRED', 'Invalid or expired OTP challenge.');
  }
}

export class SessionInvalidError extends ApiError {
  constructor() {
    super(
      HttpStatus.UNAUTHORIZED,
      'SESSION_INVALID',
      'Refresh token is invalid, expired, or revoked.',
    );
  }
}

export class OtpLockedError extends ApiError {
  constructor() {
    super(HttpStatus.TOO_MANY_REQUESTS, 'OTP_LOCKED', 'Maximum OTP verify attempts exceeded.');
  }
}

export class RateLimitedError extends ApiError {
  constructor(retryAfterSeconds: number) {
    super(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Too many OTP requests. Try again later.', {
      retry_after_seconds: retryAfterSeconds,
    });
  }
}

export class ForbiddenError extends ApiError {
  constructor(
    message = 'You do not have permission to perform this action.',
    details: Record<string, unknown> = {},
  ) {
    super(HttpStatus.FORBIDDEN, 'FORBIDDEN', message, details);
  }
}

export class SmsProviderUnavailableError extends ApiError {
  constructor() {
    super(
      HttpStatus.SERVICE_UNAVAILABLE,
      'SMS_PROVIDER_UNAVAILABLE',
      'SMS adapter is unreachable or misconfigured.',
    );
  }
}

export class InvalidStateTransitionError extends ApiError {
  constructor(message = 'This action is not valid in the resource’s current state.') {
    super(HttpStatus.CONFLICT, 'INVALID_STATE_TRANSITION', message);
  }
}

export class DuplicateRequestError extends ApiError {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      'DUPLICATE_REQUEST',
      'Idempotency-Key was already used with a different request body.',
    );
  }
}
