import { redactSensitiveFields } from './redact';

describe('redactSensitiveFields', () => {
  it('redacts known sensitive keys regardless of snake_case/camelCase spelling', () => {
    const result = redactSensitiveFields({
      otp_code: '482913',
      otpCode: '482913',
      password: 'super-secret',
      refresh_token: 'raw-refresh-value',
      access_token: 'raw-access-value',
      secret: 'otp-hmac-secret-value',
      bank_account: '1234 5678 9012',
      card_number: '4111111111111111',
      cvv: '123',
      pin: '0000',
      status: 'VERIFIED',
      user_id: 'user-1',
    });

    expect(result).toEqual({
      otp_code: '[REDACTED]',
      otpCode: '[REDACTED]',
      password: '[REDACTED]',
      refresh_token: '[REDACTED]',
      access_token: '[REDACTED]',
      secret: '[REDACTED]',
      bank_account: '[REDACTED]',
      card_number: '[REDACTED]',
      cvv: '[REDACTED]',
      pin: '[REDACTED]',
      status: 'VERIFIED',
      user_id: 'user-1',
    });
  });

  it('redacts the bare "code" field name (OtpVerifyDto\'s actual wire field, not just "otp_code")', () => {
    const result = redactSensitiveFields({
      challenge_id: 'challenge-1',
      code: '482913',
    });

    expect(result).toEqual({
      challenge_id: 'challenge-1',
      code: '[REDACTED]',
    });
  });

  it('redacts nested objects and arrays without touching unrelated fields', () => {
    const result = redactSensitiveFields({
      order_id: 'order-1',
      payment: { card_number: '4111111111111111', amount_minor: 10000 },
      items: [
        { sku: 'A', token: 'nested-secret' },
        { sku: 'B', token: 'nested-secret-2' },
      ],
    });

    expect(result).toEqual({
      order_id: 'order-1',
      payment: { card_number: '[REDACTED]', amount_minor: 10000 },
      items: [
        { sku: 'A', token: '[REDACTED]' },
        { sku: 'B', token: '[REDACTED]' },
      ],
    });
  });

  it('accepts call-site-specific extra field names without mutating the shared default list', () => {
    const withExtra = redactSensitiveFields({ tax_id: '123456789' }, ['tax_id']);
    const withoutExtra = redactSensitiveFields({ tax_id: '123456789' });

    expect(withExtra).toEqual({ tax_id: '[REDACTED]' });
    expect(withoutExtra).toEqual({ tax_id: '123456789' });
  });

  it('passes through null/undefined without throwing', () => {
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields(undefined)).toBeUndefined();
  });
});
