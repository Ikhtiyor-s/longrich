import {
  assertRequiredHeadersPresent,
  extractRawRow,
  validateRow,
  type RowValidationDeps,
} from './import-row-schema';
import { CsvParseError } from './csv-parser';

const HEADERS = [
  'identifier_type',
  'identifier_value',
  'classification_version',
  'seller_sku',
  'price_minor',
  'currency',
  'fulfillment_mode',
  'category_id',
  'title',
];

function row(overrides: Record<string, string> = {}): string[] {
  const base: Record<string, string> = {
    identifier_type: 'GTIN',
    identifier_value: '04006381333931',
    classification_version: '',
    seller_sku: 'SKU-1',
    price_minor: '4500000',
    currency: 'UZS',
    fulfillment_mode: 'SELLER_WAREHOUSE',
    category_id: '',
    title: '',
    ...overrides,
  };
  return HEADERS.map((h) => base[h] as string);
}

function depsMatching(variantId: string | null): RowValidationDeps {
  return {
    findVariantIdByIdentifier: jest.fn().mockResolvedValue(variantId),
    categoryExists: jest.fn().mockResolvedValue(true),
  };
}

describe('assertRequiredHeadersPresent', () => {
  it('passes when identifier_type/identifier_value/seller_sku are all present', () => {
    expect(() => assertRequiredHeadersPresent(HEADERS)).not.toThrow();
  });

  it('throws CsvParseError naming the missing column(s)', () => {
    expect(() => assertRequiredHeadersPresent(['identifier_type'])).toThrow(CsvParseError);
  });
});

describe('validateRow', () => {
  it('classifies a matched identifier as CREATE_OFFER with a valid price/currency/fulfillment_mode', async () => {
    const raw = extractRawRow(HEADERS, row());
    const result = await validateRow(raw, new Set(), depsMatching('variant-1'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.action).toBe('CREATE_OFFER');
      if (result.data.action === 'CREATE_OFFER') {
        expect(result.data.variantId).toBe('variant-1');
        expect(result.data.sellerSku).toBe('SKU-1');
      }
    }
  });

  it('classifies an unmatched identifier as CREATE_DRAFT_PRODUCT given category_id + title', async () => {
    const raw = extractRawRow(
      HEADERS,
      row({ category_id: '11111111-1111-1111-1111-111111111111', title: 'New Widget' }),
    );
    const result = await validateRow(raw, new Set(), depsMatching(null));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.action).toBe('CREATE_DRAFT_PRODUCT');
    }
  });

  it('rejects a bad GTIN checksum regardless of match status', async () => {
    const raw = extractRawRow(HEADERS, row({ identifier_value: '04006381333930' }));
    const result = await validateRow(raw, new Set(), depsMatching(null));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'identifier_value')).toBe(true);
    }
  });

  it('requires classification_version for MXIK', async () => {
    const raw = extractRawRow(
      HEADERS,
      row({ identifier_type: 'MXIK', identifier_value: 'ANY-CODE', classification_version: '' }),
    );
    const result = await validateRow(raw, new Set(), depsMatching(null));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'classification_version')).toBe(true);
    }
  });

  it('flags a duplicate seller_sku within the same file (second occurrence)', async () => {
    const seen = new Set<string>();
    const first = await validateRow(extractRawRow(HEADERS, row()), seen, depsMatching('variant-1'));
    expect(first.ok).toBe(true);

    const second = await validateRow(
      extractRawRow(HEADERS, row({ identifier_value: '1234567890128' })),
      seen,
      depsMatching('variant-2'),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.errors.some((e) => e.field === 'seller_sku')).toBe(true);
    }
  });

  it('requires price_minor/currency/fulfillment_mode only on the matched (CREATE_OFFER) path', async () => {
    const raw = extractRawRow(HEADERS, row({ price_minor: '', currency: '', fulfillment_mode: '' }));
    const result = await validateRow(raw, new Set(), depsMatching('variant-1'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.field).sort()).toEqual([
        'currency',
        'fulfillment_mode',
        'price_minor',
      ]);
    }
  });

  it('requires category_id/title only on the unmatched (CREATE_DRAFT_PRODUCT) path', async () => {
    const raw = extractRawRow(HEADERS, row({ category_id: '', title: '' }));
    const result = await validateRow(raw, new Set(), depsMatching(null));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.field).sort()).toEqual(['category_id', 'title']);
    }
  });

  it('rejects an unknown category_id', async () => {
    const deps: RowValidationDeps = {
      findVariantIdByIdentifier: jest.fn().mockResolvedValue(null),
      categoryExists: jest.fn().mockResolvedValue(false),
    };
    const raw = extractRawRow(
      HEADERS,
      row({ category_id: '11111111-1111-1111-1111-111111111111', title: 'New Widget' }),
    );
    const result = await validateRow(raw, new Set(), deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'category_id')).toBe(true);
    }
  });
});
