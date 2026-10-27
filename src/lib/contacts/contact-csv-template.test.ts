import { describe, expect, it } from 'vitest';
import {
  buildContactCsvTemplate,
  CONTACT_CSV_TEMPLATE_HEADERS,
} from './contact-csv-template';
import { parseContactCsv } from './parse-contact-csv';

describe('buildContactCsvTemplate', () => {
  it('lists every supported column in the header', () => {
    expect([...CONTACT_CSV_TEMPLATE_HEADERS]).toEqual([
      'phone',
      'name',
      'email',
      'company',
      'tags',
    ]);
  });

  it('turns the notes into comment lines above the header', () => {
    const csv = buildContactCsvTemplate({
      notes: ['first note', 'second note'],
      exampleRows: ['+5511999990000,Maria Souza'],
    });

    expect(csv.split('\r\n')).toEqual([
      '# first note',
      '# second note',
      'phone,name,email,company,tags',
      '+5511999990000,Maria Souza',
      '',
    ]);
  });

  it('parses back into exactly the rows it documents', () => {
    const csv = buildContactCsvTemplate({
      notes: ['phone: required'],
      exampleRows: [
        '+5511999990000,Maria Souza,maria.souza@example.com,Empresa Exemplo,"VIP, Novo"',
        '+5511888880000',
      ],
    });

    const { rows, hasPhoneColumn, hasTagsColumn } = parseContactCsv(csv);
    expect(hasPhoneColumn).toBe(true);
    expect(hasTagsColumn).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      phone: '+5511999990000',
      name: 'Maria Souza',
      email: 'maria.souza@example.com',
      company: 'Empresa Exemplo',
      tagNames: ['VIP', 'Novo'],
    });
    expect(rows[1]).toEqual({
      phone: '+5511888880000',
      name: undefined,
      email: undefined,
      company: undefined,
      tagNames: [],
    });
  });
});
