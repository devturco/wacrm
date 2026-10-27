/**
 * The downloadable contact-import CSV template.
 *
 * Self-documenting on purpose: every guidance line is a `#` comment,
 * and the importer ignores comment lines (see parse-contact-csv.ts).
 * That keeps the format documentation in one place — inside the file
 * the user actually downloads — instead of a second page that drifts
 * out of sync with the parser.
 */

/** Every column the importer understands, in template order. */
export const CONTACT_CSV_TEMPLATE_HEADERS = [
  'phone',
  'name',
  'email',
  'company',
  'tags',
] as const;

export interface ContactCsvTemplateOptions {
  /**
   * One guidance line per comment row. Keep them comma-free: a comma
   * in an unquoted comment line is split by spreadsheet apps into
   * separate cells, which turns the instructions into visual noise.
   */
  notes: string[];
  /** Ready-made CSV rows (already quoted where needed). */
  exampleRows: string[];
}

/**
 * Build the template file content.
 *
 * Layout: comment lines first (so the instructions are read before
 * anything is typed), then the header row, then the example rows the
 * user is expected to delete before importing.
 */
export function buildContactCsvTemplate({
  notes,
  exampleRows,
}: ContactCsvTemplateOptions): string {
  return (
    [
      ...notes.map((note) => `# ${note}`),
      CONTACT_CSV_TEMPLATE_HEADERS.join(','),
      ...exampleRows,
    ].join('\r\n') + '\r\n'
  );
}
