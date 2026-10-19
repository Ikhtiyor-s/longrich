// Minimal RFC4180-ish CSV parser, hand-rolled rather than a new npm
// dependency — same lean-dependency precedent as gtin-checksum.ts/
// options-hash.ts elsewhere in this module. Handles double-quote-escaped
// fields (including embedded commas/newlines/doubled "" escapes), CRLF or
// LF line endings, and a header row. No XLSX (binary OOXML/zip) support:
// hand-rolling a binary spreadsheet parser is out of this ticket's "Done
// means" bar (no acceptance line exercises an .xlsx file; EXT-005's own QA
// identifiers EXT-005-AC-01..06 never name a format) — flagged loudly in the
// implementation report as a deliberate scope boundary, not a silent gap.
// Widening to real XLSX support later is additive (a second parser branch
// keyed off mime_type), not a schema/architecture change.
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export class CsvParseError extends Error {}

function parseLines(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < len) {
    const char = text[i] as string;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (inQuotes) {
    throw new CsvParseError('Unterminated quoted field.');
  }
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }
  return rows;
}

export function parseCsv(text: string): ParsedCsv {
  // Strip a UTF-8 BOM if present (0xFEFF), expressed via charCodeAt rather
  // than a literal BOM character in a regex, which some lint configs flag
  // as "irregular whitespace."
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = parseLines(stripped).filter(
    (line) => !(line.length === 1 && line[0] === ''),
  );
  if (lines.length === 0) {
    throw new CsvParseError('File has no header row.');
  }
  const [headerLine, ...rest] = lines;
  const headers = (headerLine as string[]).map((h) => h.trim().toLowerCase());
  return { headers, rows: rest };
}
