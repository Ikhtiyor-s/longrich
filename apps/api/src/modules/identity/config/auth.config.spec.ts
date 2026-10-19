import { loadAuthConfig } from './auth.config';

describe('loadAuthConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('throws a hard startup error when JWT_SECRET is unset outside development/test', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    process.env.OTP_HMAC_SECRET = 'some-otp-secret';

    expect(() => loadAuthConfig()).toThrow(/JWT_SECRET is not set/);
  });

  it('throws a hard startup error when OTP_HMAC_SECRET is unset outside development/test', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'some-jwt-secret';
    delete process.env.OTP_HMAC_SECRET;

    expect(() => loadAuthConfig()).toThrow(/OTP_HMAC_SECRET is not set/);
  });

  it('throws for an unset secret even when NODE_ENV is some other non-dev/test value (e.g. "staging")', () => {
    process.env.NODE_ENV = 'staging';
    delete process.env.JWT_SECRET;
    process.env.OTP_HMAC_SECRET = 'some-otp-secret';

    expect(() => loadAuthConfig()).toThrow(/JWT_SECRET is not set/);
  });

  it('treats a blank/whitespace-only secret the same as unset outside development/test', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = '   ';
    process.env.OTP_HMAC_SECRET = 'some-otp-secret';

    expect(() => loadAuthConfig()).toThrow(/JWT_SECRET is not set/);
  });

  it('does NOT throw, logs a loud warning, and uses the dev-only fallback when NODE_ENV=development and secrets are unset', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    delete process.env.OTP_HMAC_SECRET;
    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    let config: ReturnType<typeof loadAuthConfig> | undefined;
    try {
      expect(() => {
        config = loadAuthConfig();
      }).not.toThrow();

      expect(config?.jwtSecret).toBe('dev-only-insecure-jwt-secret');
      expect(config?.otpHmacSecret).toBe('dev-only-insecure-otp-hmac-secret');

      const loggedOutput = [...outSpy.mock.calls, ...errSpy.mock.calls]
        .map((call) => String(call[0]))
        .join('\n');
      expect(loggedOutput).toMatch(/JWT_SECRET is not set/);
      expect(loggedOutput).toMatch(/OTP_HMAC_SECRET is not set/);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('does NOT throw and uses the dev-only fallback when NODE_ENV is unset at all (defaults to development)', () => {
    delete process.env.NODE_ENV;
    delete process.env.JWT_SECRET;
    delete process.env.OTP_HMAC_SECRET;
    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(() => loadAuthConfig()).not.toThrow();
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("does NOT throw when NODE_ENV=test and secrets are unset (jest's own default NODE_ENV)", () => {
    process.env.NODE_ENV = 'test';
    delete process.env.JWT_SECRET;
    delete process.env.OTP_HMAC_SECRET;
    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(() => loadAuthConfig()).not.toThrow();
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('uses the real env-provided secret (not the fallback) whenever one is actually set, regardless of NODE_ENV', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'a-real-dev-secret';
    process.env.OTP_HMAC_SECRET = 'a-real-dev-otp-secret';

    const config = loadAuthConfig();

    expect(config.jwtSecret).toBe('a-real-dev-secret');
    expect(config.otpHmacSecret).toBe('a-real-dev-otp-secret');
  });
});
