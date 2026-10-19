# T-G1-3 — KYB document upload: signed URLs, MIME/size validation, swappable malware-scan adapter

**Requirement refs:** TZ §06 (`SEL-002` KYB document upload), §28 ("docs signed upload with file MIME+size validation and malware scan... historical versions kept"), §03/ADR-001 (S3/MinIO object storage, signed URLs, malware scan on upload). Requirement ID: `SEL-002`. Milestone: G1.

**Migration:** None. Uses `seller_documents` from `T-G1-1`.

## Goal
Let a seller applicant upload KYB documents via a signed URL with MIME/size validation, routed through a swappable malware-scan hook, recording a verification status per document.

## Files likely touched
- `apps/api/src/modules/sellers/documents/` — controller, service, DTOs
- `apps/api/src/modules/sellers/documents/malware-scan.adapter.ts` — interface `MalwareScanAdapter { scan(objectKey: string, mimeType: string): Promise<{ clean: boolean; scannedAt: Date }> }`, DI token `MALWARE_SCAN_ADAPTER`, mirroring G0's `SmsSenderAdapter` swappable-provider pattern (`apps/api/src/modules/identity/auth/sms-sender.adapter.ts`) exactly. No AV vendor is named anywhere in the TZ — this ticket must not hardcode one. Ships a `MockMalwareScanAdapter` that always reports `clean: true`, clearly logged as a mock, for dev/CI only.

## How we'll know it's done
- `POST /v1/seller/documents {type, filename, mime_type, size_bytes}` returns a signed upload URL + `object_key` and creates a `seller_documents` row with `verification_status = PENDING`; disallowed MIME types or oversized files are rejected `422` **before** a URL is issued. The allowed MIME list and size cap live in config (not hardcoded as an unchangeable business rule) — TZ §28 names the requirement, not the exact list/limit.
- After upload, a confirm step runs the `MalwareScanAdapter`; a test double simulating an infected result flips `verification_status` to `REJECTED` and that document cannot satisfy `T-G1-2`'s submit-completeness gate; a clean result moves it to `VERIFIED` (or leaves it for manual review per `T-G1-5`'s reviewer decision — implementer's choice, documented in the PR).
- Cross-seller `403`: uploading or listing documents for a seller the caller doesn't belong to is rejected.
- Re-uploading the same document `type` creates a new row rather than overwriting — "historical versions kept" per TZ §28.
- No malware-scan vendor name, API key, or product-specific config appears anywhere in code — only the generic adapter interface + mock (new open question logged, see `docs/open-questions.md` #27).

## Owner role
`backend-dev`

## Depends on
T-G1-1, T-G1-2
