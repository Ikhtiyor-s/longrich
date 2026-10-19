// TZ §28: "description stored sanitized, never stored raw HTML" — no HTML
// sanitizer library is a dependency of this codebase yet, so this strips
// every tag rather than pulling in a new third-party package for one field.
// Entities (e.g. &amp;) are left as-is; only literal `<...>` tag markup is
// removed.
// Known simplification: this is a naive regex strip, not a real HTML
// parser — revisit with a real sanitizer library before this field is ever
// rendered as HTML anywhere (today it is plain text everywhere it's read).
export function sanitizeDescription(raw: string): string {
  return raw.replace(/<[^>]*>/g, '').trim();
}
