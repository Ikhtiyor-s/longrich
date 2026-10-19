import { CsvParseError, parseCsv } from './csv-parser';

describe('parseCsv', () => {
  it('parses a simple header + rows file, lowercasing header names', () => {
    const text = 'Identifier_Type,identifier_value,seller_sku\nGTIN,04006381333931,SKU-1\n';
    const result = parseCsv(text);
    expect(result.headers).toEqual(['identifier_type', 'identifier_value', 'seller_sku']);
    expect(result.rows).toEqual([['GTIN', '04006381333931', 'SKU-1']]);
  });

  it('handles CRLF line endings', () => {
    const text = 'a,b\r\n1,2\r\n3,4\r\n';
    const result = parseCsv(text);
    expect(result.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles double-quote-escaped fields with embedded commas and doubled quotes', () => {
    const text = 'title,notes\n"Widget, Deluxe","Says ""hello"""\n';
    const result = parseCsv(text);
    expect(result.rows).toEqual([['Widget, Deluxe', 'Says "hello"']]);
  });

  it('strips a UTF-8 BOM if present', () => {
    const text = `${String.fromCharCode(0xfeff)}a,b\n1,2\n`;
    const result = parseCsv(text);
    expect(result.headers).toEqual(['a', 'b']);
  });

  it('throws CsvParseError for a file with no rows at all', () => {
    expect(() => parseCsv('')).toThrow(CsvParseError);
  });

  it('throws CsvParseError for an unterminated quoted field', () => {
    expect(() => parseCsv('a,b\n"unterminated,2\n')).toThrow(CsvParseError);
  });

  it('parses a header-only file as zero data rows (not an error)', () => {
    const result = parseCsv('a,b\n');
    expect(result.headers).toEqual(['a', 'b']);
    expect(result.rows).toEqual([]);
  });
});
