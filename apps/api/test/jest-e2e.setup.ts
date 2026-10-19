// auth.e2e-spec.ts (T-G0-4) and rbac.e2e-spec.ts (T-G0-5) both call
// POST /v1/auth/otp/request several times from the same loopback test-runner
// IP. auth.e2e-spec.ts alone already uses most of the default
// OTP_RATE_LIMIT_IP_HOUR=20 production headroom; adding rbac.e2e-spec.ts's
// required real-login calls tips it over, causing unrelated auth tests to
// flake with 429 depending on run order. This only raises the limit for the
// jest e2e *test process* env — apps/api/src/modules/identity/config/auth.config.ts's
// default of 20 (the real/prod value) is untouched.
process.env.OTP_RATE_LIMIT_IP_HOUR = process.env.OTP_RATE_LIMIT_IP_HOUR ?? '200';

// T-G1-5's seller-moderation.e2e-spec.ts/seller-suspension.e2e-spec.ts log
// in as the same seeded SUPER_ADMIN/SUPPORT_AGENT phones rbac.e2e-spec.ts
// already uses (plus the new seeded MODERATOR phone), to assert real
// seller:moderate/seller:suspend allow/deny behavior. Jest runs e2e spec
// files in separate parallel worker processes by default, all sharing one
// Redis instance; the per-phone OTP resend cooldown
// (otp:resend:phone:<hash>, a 60s Redis SET NX lock) is keyed only by phone
// number, so two different spec files logging in to the *same* seeded phone
// within 60 seconds of each other — now a real possibility now that more
// than one file touches these phones — causes a false-positive 429 on
// whichever request loses the race, unrelated to any real rate-limit bug.
// Shortening the cooldown for the jest e2e *test process* env only (not
// auth.config.ts's real 60s default) removes that cross-file race without
// weakening any production rate limit.
process.env.OTP_RESEND_COOLDOWN_SECONDS = process.env.OTP_RESEND_COOLDOWN_SECONDS ?? '1';
