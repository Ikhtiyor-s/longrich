# T-G0-6 observability evidence

Per T-G0-6's acceptance criteria ("OpenTelemetry trace spans are visible
end-to-end for a sample request... screenshot or exported trace JSON as
evidence") and the resource-awareness note preferring a lightweight proof
over a persistent Grafana/Loki/Prometheus stack on a dev machine already
running many other Compose projects.

## `otel-sample-trace.ndjson`

One JSON object per line, written by
`apps/api/src/common/telemetry/file-span-exporter.ts` (a custom OTel
`SpanExporter`) while the `api` container (rebuilt with this ticket's code)
served real requests: `GET /health` (warm-up), `GET
/v1/admin/rbac-demo/test-read` with no `Authorization` header, and `GET
/metrics`.

The `/v1/admin/rbac-demo/test-read` span (`trace_id
9fefee6e363d276b65070999a45171ee`) carries a `request_id` attribute
(`c9ce0dcf-a506-497b-abe1-07b96821a152`) set by
`RequestIdMiddleware`/`tagActiveSpan` — the same `request_id` is in that
response's `X-Request-ID` header and its `{error:{...},request_id}` JSON
body, demonstrating the request_id/trace_id correlation TZ §19 and this
ticket ask for.

Regenerate with the dev stack up (`pnpm dev:up`):

```sh
curl -s http://localhost:<API_PORT>/v1/admin/rbac-demo/test-read
docker compose -f docker-compose.dev.yml exec api cat /repo/var/telemetry/traces.ndjson
```

No secret, token, OTP, or card/bank value appears in this file — the spans
captured only carry HTTP method/path/status/network metadata, never request
bodies.
