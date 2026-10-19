// EXT-005's full state machine (docs/source/longrich-tz-extensions-v2.4.txt,
// api-contract-g2.md T-G2-8): UPLOADED -> VALIDATING -> READY -> IMPORTING ->
// COMPLETED/PARTIAL/FAILED. Kept as a plain array (not re-deriving from the
// Prisma enum) so the status-filter query DTO can validate against it
// without importing @prisma/client into a DTO file, same precedent as
// offers/offers.constants.ts's OFFER_STATUSES.
export const IMPORT_JOB_STATUSES = [
  'UPLOADED',
  'VALIDATING',
  'READY',
  'IMPORTING',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
] as const;
export type ImportJobStatusValue = (typeof IMPORT_JOB_STATUSES)[number];
