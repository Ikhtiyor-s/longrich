import { HttpStatus } from '@nestjs/common';
import {
  DuplicateRequestError,
  InvalidStateTransitionError,
  RESERVED_ERROR_CODES,
} from './api-error';

describe('InvalidStateTransitionError', () => {
  it('is a 409 with code INVALID_STATE_TRANSITION', () => {
    const error = new InvalidStateTransitionError('Cannot submit twice.');
    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.code).toBe('INVALID_STATE_TRANSITION');
    expect(error.message).toBe('Cannot submit twice.');
  });
});

describe('DuplicateRequestError', () => {
  it('is a 409 with code DUPLICATE_REQUEST', () => {
    const error = new DuplicateRequestError();
    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.code).toBe('DUPLICATE_REQUEST');
  });
});

describe('RESERVED_ERROR_CODES', () => {
  it('registers every TZ §19 custom business error code not yet emitted by a real handler', () => {
    // INVALID_STATE_TRANSITION and DUPLICATE_REQUEST moved out of this list
    // in T-G1-2 (seller-applications PATCH/submit state gate, Idempotency-Key
    // conflict) — see InvalidStateTransitionError/DuplicateRequestError below.
    expect(new Set(RESERVED_ERROR_CODES)).toEqual(
      new Set([
        'STALE_QUOTE',
        'INSUFFICIENT_STOCK',
        'FORBIDDEN_SELLER',
        'PAYMENT_MISMATCH',
        'UNSUPPORTED_REFUND',
        'DELIVERY_ZONE_UNAVAILABLE',
      ]),
    );
  });
});
