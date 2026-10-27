/**
 * CSV parsing for the contacts import modal. Shared + unit-tested so
 * tag-column handling stays aligned with phone/name/email/company.
 */

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  /**
   * True when the CSV header includes the required `phone` column.
   * `rows` is empty both when the column is missing and when the file
   * simply has no usable data rows; callers that need to tell those
   * apart (to pick the right error message) read this flag.
   */
  hasPhoneColumn: boolean;
  /** True when the CSV header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the CSV header includes a `company` column. */
  hasCompanyColumn: boolean;
}

/**
 * A line whose first non-blank character is `#` is a comment: the
 * importer ignores it, wherever it sits (above the header, between
 * data rows, at the end of the file). That is what lets the
 * downloadable template explain itself without the explanations being
 * mistaken for contacts — a comment line used to reach the dedupe
 * step as a contact with an unusable phone number.
 */
function isCommentLine(line: string): boolean {
  return line.trimStart().startsWith('#');
}

export function parseContactCsv(text: string): ParseContactCsvResult {
  // Strip a leading UTF-8 BOM. `File.text()` already removes it, but a
  // file that round-tripped through a script may still carry one, and
  // it would glue itself to the first header name — "\uFEFFname" is not
  // "name", so the column would silently disappear.
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  // Blank and comment lines carry no data: the header is the first
  // remaining line and the rows are the rest.
  const dataLines = lines.filter(
    (line) => line.trim() !== '' && !isCommentLine(line)
  );

  if (dataLines.length < 2) {
    return {
      rows: [],
      hasPhoneColumn: false,
      hasTagsColumn: false,
      hasCompanyColumn: false,
    };
  }

  const headers = dataLines[0]
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/["']/g, ''));

  const phoneIdx = headers.indexOf('phone');
  if (phoneIdx === -1) {
    return {
      rows: [],
      hasPhoneColumn: false,
      hasTagsColumn: false,
      hasCompanyColumn: false,
    };
  }

  const nameIdx = headers.indexOf('name');
  const emailIdx = headers.indexOf('email');
  const companyIdx = headers.indexOf('company');
  // `tag` (singular) is accepted as an alias of `tags`. A header that
  // misses the plural imports the whole base with no tags at all, and
  // nothing in the preview warns about it — the column is simply not
  // there. When both spellings are present, `tags` wins.
  const tagsIdx =
    headers.indexOf('tags') !== -1
      ? headers.indexOf('tags')
      : headers.indexOf('tag');

  const rows: ParsedContactRow[] = [];

  for (const line of dataLines.slice(1)) {
    const values = parseCsvLine(line.trim());
    // A row with no usable phone is pushed through rather than dropped
    // here — dedupeByPhone (shared with the webhook/manual-form paths)
    // already treats an empty normalized key as invalid, and counting
    // it there means the import result can tell the user "N contacts
    // had no phone" instead of the row just vanishing with the total
    // row count silently short of what's actually in the file.
    const phone = values[phoneIdx]?.replace(/["']/g, '').trim() ?? '';

    rows.push({
      phone,
      name:
        nameIdx >= 0
          ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      email:
        emailIdx >= 0
          ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      company:
        companyIdx >= 0
          ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      tagNames:
        tagsIdx >= 0 ? parseTagCell(values[tagsIdx]?.replace(/["']/g, '')) : [],
    });
  }

  return {
    rows,
    hasPhoneColumn: true,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
  };
}

/** Simple CSV line parse (handles quoted fields). */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}
