import { describe, expect, it } from 'vitest';
import { parseContactCsv, parseTagCell } from './parse-contact-csv';

describe('parseTagCell', () => {
  it('splits comma-separated tags and trims whitespace', () => {
    expect(parseTagCell(' VIP , Lead ,  ')).toEqual(['VIP', 'Lead']);
  });

  it('splits semicolon-separated tags', () => {
    expect(parseTagCell('VIP; Lead; Customer')).toEqual([
      'VIP',
      'Lead',
      'Customer',
    ]);
  });

  it('de-dupes case-insensitively', () => {
    expect(parseTagCell('vip, VIP, Lead')).toEqual(['vip', 'Lead']);
  });

  it('returns empty for blank values', () => {
    expect(parseTagCell('')).toEqual([]);
    expect(parseTagCell(undefined)).toEqual([]);
  });
});

describe('parseContactCsv', () => {
  it('parses optional tags column', () => {
    const csv = `phone,name,tags
+15551234567,Alice,"VIP, Lead"
+15559876543,Bob,Customer`;

    expect(parseContactCsv(csv)).toEqual({
      hasPhoneColumn: true,
      hasTagsColumn: true,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: ['VIP', 'Lead'],
        },
        {
          phone: '+15559876543',
          name: 'Bob',
          email: undefined,
          company: undefined,
          tagNames: ['Customer'],
        },
      ],
    });
  });

  it('keeps a row with an empty phone cell instead of dropping it silently', () => {
    const csv = `phone,name
+15551234567,Alice
,Bob`;

    const { rows } = parseContactCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      phone: '',
      name: 'Bob',
      email: undefined,
      company: undefined,
      tagNames: [],
    });
  });

  it('returns empty tagNames when tags column is absent', () => {
    const csv = `phone,name
+15551234567,Alice`;

    expect(parseContactCsv(csv)).toEqual({
      hasPhoneColumn: true,
      hasTagsColumn: false,
      hasCompanyColumn: false,
      rows: [
        {
          phone: '+15551234567',
          name: 'Alice',
          email: undefined,
          company: undefined,
          tagNames: [],
        },
      ],
    });
  });

  it('accepts `tag` as an alias of the `tags` column', () => {
    const csv = `name,phone,tag
Alice,+15551234567,VIP`;

    const result = parseContactCsv(csv);
    expect(result.hasTagsColumn).toBe(true);
    expect(result.rows[0].tagNames).toEqual(['VIP']);
  });

  it('prefers `tags` over `tag` when both are present', () => {
    const csv = `phone,tags,tag
+15551234567,VIP,Ignored`;

    const result = parseContactCsv(csv);
    expect(result.rows[0].tagNames).toEqual(['VIP']);
  });

  it('ignores comment lines above the header and between the rows', () => {
    const csv = `# Contacts import template
# phone is required
phone,name,tags
+15551234567,Alice,VIP
# a comment in the middle
+15559876543,Bob,Customer
# a trailing comment`;

    const result = parseContactCsv(csv);
    expect(result.hasPhoneColumn).toBe(true);
    expect(result.hasTagsColumn).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      phone: '+15551234567',
      name: 'Alice',
      email: undefined,
      company: undefined,
      tagNames: ['VIP'],
    });
    expect(result.rows[1].tagNames).toEqual(['Customer']);
  });

  it('strips a leading UTF-8 BOM so the first header is still found', () => {
    const bom = String.fromCharCode(0xfeff);
    const csv = `${bom}phone,name
+15551234567,Alice`;

    const result = parseContactCsv(csv);
    expect(result.hasPhoneColumn).toBe(true);
    expect(result.rows[0].name).toBe('Alice');
  });

  it('reports no phone column when the file holds only comments', () => {
    const csv = `# just a note
# and another one`;

    expect(parseContactCsv(csv)).toEqual({
      hasPhoneColumn: false,
      hasTagsColumn: false,
      hasCompanyColumn: false,
      rows: [],
    });
  });
});
