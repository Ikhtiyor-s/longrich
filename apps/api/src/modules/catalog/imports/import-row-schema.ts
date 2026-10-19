import { parsePositivePriceMinor } from '../../offers/price-minor';
import { OFFER_CURRENCIES, OFFER_FULFILLMENT_MODES } from '../../offers/offers.constants';
import { isValidGtinChecksum } from '../identifiers/gtin-checksum';
import { CsvParseError } from './csv-parser';

// --------------------------------------------------------------------------
// CSV column schema — a gap-fill, not a frozen contract shape.
//
// Neither the ticket nor api-contract-g2.md/docs/open-questions.md states a
// literal CSV column schema for a bulk-import row (only the *outcome* shape
// — catalog_import_rows/catalog_import_errors — is frozen). This is the
// architect-equivalent gap this file fills, flagged loudly in the
// implementation report, not guessed silently:
//
//   identifier_type        GTIN|EAN|UPC|MXIK — always required
//   identifier_value       always required
//   classification_version required only when identifier_type=MXIK
//   seller_sku             always required (per-seller SKU dedup, both
//                          within-file and against existing offers)
//   price_minor            required only when the row matches an existing
//                          identifier (CREATE_OFFER path)
//   currency                "
//   fulfillment_mode         "
//   category_id            required only when the row has no match
//                          (CREATE_DRAFT_PRODUCT path)
//   title                    "
//
// A row's new ProductVariant.options (required, non-empty per
// variants/variants.service.ts's assertWellFormedOptions) is not something
// the CSV schema above carries at all — no column here maps to a flat
// attribute-combination object, and inventing one unasked would be a second
// guess on top of the first. The deliberate, flagged simplification: a
// CREATE_DRAFT_PRODUCT row's variant is created with
// `options = { sku: <seller_sku> }` (a single scalar key, satisfying
// assertWellFormedOptions's "non-empty flat object of scalars" rule) rather
// than fabricating a multi-attribute catalog shape the file was never
// specified to carry.
export const REQUIRED_CSV_HEADERS = ['identifier_type', 'identifier_value', 'seller_sku'] as const;

export function assertRequiredHeadersPresent(headers: string[]): void {
  const missing = REQUIRED_CSV_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new CsvParseError(`Missing required column(s): ${missing.join(', ')}`);
  }
}

export interface RawImportRow {
  identifierType: string;
  identifierValue: string;
  classificationVersion: string;
  sellerSku: string;
  priceMinor: string;
  currency: string;
  fulfillmentMode: string;
  categoryId: string;
  title: string;
}

function cell(headers: string[], rawRow: string[], name: string): string {
  const index = headers.indexOf(name);
  if (index === -1 || index >= rawRow.length) {
    return '';
  }
  return (rawRow[index] ?? '').trim();
}

export function extractRawRow(headers: string[], rawRow: string[]): RawImportRow {
  return {
    identifierType: cell(headers, rawRow, 'identifier_type').toUpperCase(),
    identifierValue: cell(headers, rawRow, 'identifier_value'),
    classificationVersion: cell(headers, rawRow, 'classification_version'),
    sellerSku: cell(headers, rawRow, 'seller_sku'),
    priceMinor: cell(headers, rawRow, 'price_minor'),
    currency: cell(headers, rawRow, 'currency').toUpperCase(),
    fulfillmentMode: cell(headers, rawRow, 'fulfillment_mode').toUpperCase(),
    categoryId: cell(headers, rawRow, 'category_id'),
    title: cell(headers, rawRow, 'title'),
  };
}

export interface RowFieldError {
  field: string;
  message: string;
}

const IDENTIFIER_TYPES = ['GTIN', 'EAN', 'UPC', 'MXIK'] as const;

export interface MatchedRowData {
  action: 'CREATE_OFFER';
  identifierType: (typeof IDENTIFIER_TYPES)[number];
  identifierValue: string;
  variantId: string;
  sellerSku: string;
  priceMinor: string;
  currency: string;
  fulfillmentMode: string;
}

export interface UnmatchedRowData {
  action: 'CREATE_DRAFT_PRODUCT';
  identifierType: (typeof IDENTIFIER_TYPES)[number];
  identifierValue: string;
  classificationVersion: string | null;
  sellerSku: string;
  categoryId: string;
  title: string;
}

export type RowValidationResult =
  | { ok: true; data: MatchedRowData | UnmatchedRowData }
  | { ok: false; errors: RowFieldError[] };

export interface RowValidationDeps {
  // Identifier lookup — IdentifiersService.findByTypeValue via DI at the call
  // site (import-row-processor.ts), kept as a plain callback here so this
  // function stays pure/unit-testable without a real Prisma/DB dependency.
  findVariantIdByIdentifier(
    type: (typeof IDENTIFIER_TYPES)[number],
    value: string,
  ): Promise<string | null>;
  categoryExists(categoryId: string): Promise<boolean>;
}

// Per-row validation shared by both the VALIDATING step (dry run — classify
// + surface errors, never touches seller_offers/products) and the commit
// step (re-run defensively, since "a SKU collision introduced by a
// concurrent request after validation" per api-contract-g2.md means state
// can legitimately change between the two steps).
export async function validateRow(
  raw: RawImportRow,
  seenSkus: Set<string>,
  deps: RowValidationDeps,
): Promise<RowValidationResult> {
  const errors: RowFieldError[] = [];

  if (!raw.identifierType || !IDENTIFIER_TYPES.includes(raw.identifierType as never)) {
    errors.push({
      field: 'identifier_type',
      message: `identifier_type must be one of: ${IDENTIFIER_TYPES.join(', ')}.`,
    });
  }
  if (!raw.identifierValue) {
    errors.push({ field: 'identifier_value', message: 'identifier_value is required.' });
  }
  if (!raw.sellerSku) {
    errors.push({ field: 'seller_sku', message: 'seller_sku is required.' });
  } else if (raw.sellerSku.length > 128) {
    errors.push({ field: 'seller_sku', message: 'seller_sku must be at most 128 characters.' });
  } else if (seenSkus.has(raw.sellerSku)) {
    errors.push({ field: 'seller_sku', message: 'duplicate seller_sku within this file.' });
  }
  if (raw.identifierType === 'MXIK' && !raw.classificationVersion) {
    errors.push({
      field: 'classification_version',
      message: 'classification_version is required for type MXIK.',
    });
  }
  // Reuses identifiers/gtin-checksum.ts (the same GS1 mod-10 rule
  // IdentifiersService.create enforces for a single-item POST) so a bad
  // checksum surfaces here at VALIDATING time rather than only being
  // discovered as a commit-time failure.
  if (
    raw.identifierType &&
    ['GTIN', 'EAN', 'UPC'].includes(raw.identifierType) &&
    raw.identifierValue &&
    !isValidGtinChecksum(raw.identifierValue)
  ) {
    errors.push({
      field: 'identifier_value',
      message: 'identifier_value failed GS1 check-digit validation.',
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  seenSkus.add(raw.sellerSku);

  const identifierType = raw.identifierType as (typeof IDENTIFIER_TYPES)[number];
  const variantId = await deps.findVariantIdByIdentifier(identifierType, raw.identifierValue);

  if (variantId) {
    if (!raw.priceMinor) {
      errors.push({ field: 'price_minor', message: 'price_minor is required.' });
    } else {
      try {
        parsePositivePriceMinor(raw.priceMinor, 'price_minor');
      } catch {
        errors.push({
          field: 'price_minor',
          message: 'price_minor must be a positive integer digit string.',
        });
      }
    }
    if (!OFFER_CURRENCIES.includes(raw.currency as never)) {
      errors.push({
        field: 'currency',
        message: `currency must be one of: ${OFFER_CURRENCIES.join(', ')}.`,
      });
    }
    if (!OFFER_FULFILLMENT_MODES.includes(raw.fulfillmentMode as never)) {
      errors.push({
        field: 'fulfillment_mode',
        message: `fulfillment_mode must be one of: ${OFFER_FULFILLMENT_MODES.join(', ')}.`,
      });
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }
    return {
      ok: true,
      data: {
        action: 'CREATE_OFFER',
        identifierType,
        identifierValue: raw.identifierValue,
        variantId,
        sellerSku: raw.sellerSku,
        priceMinor: raw.priceMinor,
        currency: raw.currency,
        fulfillmentMode: raw.fulfillmentMode,
      },
    };
  }

  if (!raw.categoryId) {
    errors.push({ field: 'category_id', message: 'category_id is required for a new product.' });
  } else if (!(await deps.categoryExists(raw.categoryId))) {
    errors.push({ field: 'category_id', message: 'category_id does not reference an existing category.' });
  }
  if (!raw.title || raw.title.length < 3 || raw.title.length > 255) {
    errors.push({ field: 'title', message: 'title must be between 3 and 255 characters.' });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    data: {
      action: 'CREATE_DRAFT_PRODUCT',
      identifierType,
      identifierValue: raw.identifierValue,
      classificationVersion: raw.classificationVersion || null,
      sellerSku: raw.sellerSku,
      categoryId: raw.categoryId,
      title: raw.title,
    },
  };
}
