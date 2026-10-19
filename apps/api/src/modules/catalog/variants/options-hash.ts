import { createHash } from 'node:crypto';

// Postgres has no reliable native unique-index semantics over raw JSON, so
// `product_variants.options_hash` is what actually enforces "two variants of
// the same product cannot share the same options combination" (see
// prisma/schema.prisma's ProductVariant comment + api-contract-g2.md's
// Prisma field reference). Key order in the input JSON must never affect the
// hash, hence the recursive key-sort below before hashing.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function computeOptionsHash(options: Record<string, unknown>): string {
  const canonicalJson = JSON.stringify(canonicalize(options));
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}
