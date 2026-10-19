# T-G0-6 — Observability/tracing scaffold + JSON envelope + audit log write path

**Requirement refs:** TZ §03 ("OpenTelemetry + Prometheus/Grafana/Loki; GitHub Actions CI"), §04 ("JSON envelope {data,meta:{request_id}}; error {error:{code,message,details},request_id}... Codes: 401/403/404/409/422/429/503"), §19 ("Log actor/request/trace_id but redact tokens, OTP, card, bank secrets"), §12/M08 (`audit_logs` immutable). Requirement ID: `ADM-008` (Audit log). Milestone: G0.

## Goal
Wire OpenTelemetry tracing + Prometheus metrics + structured log correlation (`request_id`/`trace_id` on every request) into the NestJS app from T-G0-1, enforce the standard JSON success/error envelope and error-code table platform-wide, and implement the actual write path into `audit_logs` (schema from T-G0-3) so later tickets just call an `AuditService` instead of reinventing logging.

## Files likely touched
- `apps/api/src/common/interceptors/response-envelope.interceptor.ts`
- `apps/api/src/common/filters/http-exception.filter.ts` (maps to TZ §04/§19 error codes: 401/403/404/409/422/429/503, plus TZ §19's custom codes `STALE_QUOTE`, `INSUFFICIENT_STOCK`, etc. registered as an extensible enum even though nothing emits them yet)
- `apps/api/src/common/telemetry/otel.setup.ts`
- `apps/api/src/common/audit/audit.service.ts` (writes to `audit_logs`, redacts configured sensitive field names before persisting)
- `docker-compose.dev.yml` update — add Grafana/Loki/Prometheus services (extends T-G0-2's file)
- `apps/api/src/common/audit/audit.service.spec.ts`, redaction unit tests

## How we'll know it's done
- Every API response (success or error) includes `meta.request_id` (success) or top-level `request_id` (error), generated server-side even if the client didn't send `X-Request-ID`, per TZ §19.
- A deliberately-triggered `403` from T-G0-5's guard test comes back in the exact `{error:{code,message,details},request_id}` shape with `code` matching the documented table.
- OpenTelemetry trace spans are visible end-to-end for a sample request (prove via local Grafana/Loki/Prometheus stack brought up through the updated compose file — screenshot or exported trace JSON as evidence).
- `AuditService.record(...)` call writes an immutable row to `audit_logs` with actor, action, entity, before/after JSON, and `request_id`; a unit test proves a known sensitive field name (e.g. `otp_code`, `password`, `token`) passed into the before/after payload is redacted before persistence, not just before logging.
- No secret, token, OTP, or card/bank field appears in any log line or trace attribute emitted during the test run (grep-based CI check, can be a follow-up script added to `.github/workflows/ci.yml`).

## Owner role
`architect`

## Depends on
T-G0-2, T-G0-3
