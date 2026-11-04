import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { backfillBroadcastMessage } from './broadcast-backfill';

interface FakeOptions {
  recipient?: Record<string, unknown> | null;
  recipientError?: { message: string } | null;
  templates?: Record<string, unknown>[];
  insertError?: { message: string } | null;
}

function makeDb(options: FakeOptions = {}) {
  const upserts: { row: Record<string, unknown>; options: unknown }[] = [];
  const filters: [string, unknown][] = [];

  const db = {
    from(table: string) {
      if (table === 'broadcast_recipients') {
        const chain = {
          select: () => chain,
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return chain;
          },
          not: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: options.recipient ?? null,
              error: options.recipientError ?? null,
            }),
        };
        return chain;
      }

      if (table === 'message_templates') {
        const chain = {
          eq: () => chain,
          then: (resolve: (value: { data: unknown; error: null }) => void) =>
            resolve({ data: options.templates ?? [], error: null }),
        };
        return { select: () => chain };
      }

      if (table === 'messages') {
        return {
          upsert: (row: Record<string, unknown>, opts: unknown) => {
            upserts.push({ row, options: opts });
            return Promise.resolve({ error: options.insertError ?? null });
          },
        };
      }

      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;

  return { db, upserts, filters };
}

const RECIPIENT = {
  id: 'rec-1',
  status: 'read',
  whatsapp_message_id: 'wamid.abc',
  sent_at: '2026-11-01T10:00:00.000Z',
  template_params: ['Thiago'],
  broadcasts: {
    account_id: 'acc-1',
    template_name: 'disp_convite_grupo_fem',
    template_language: 'pt_BR',
  },
};

const TEMPLATE = {
  id: 'tpl-1',
  user_id: 'user-1',
  name: 'disp_convite_grupo_fem',
  language: 'pt_BR',
  body_text: 'Olá, {{1}}! Tudo bem?',
  header_type: 'video',
  header_media_url: 'https://assets.test/video.mp4',
};

const INPUT = {
  accountId: 'acc-1',
  contactId: 'contact-1',
  conversationId: 'conv-1',
};

describe('backfillBroadcastMessage', () => {
  it('filters by the exact message when the target is a reaction', async () => {
    const { db, upserts, filters } = makeDb({
      recipient: RECIPIENT,
      templates: [TEMPLATE],
    });

    await backfillBroadcastMessage(db, {
      ...INPUT,
      whatsappMessageId: 'wamid.abc',
    });

    expect(filters).toContainEqual(['whatsapp_message_id', 'wamid.abc']);
    expect(upserts[0].row.message_id).toBe('wamid.abc');
  });

  it('inserts the broadcast template at the original send time', async () => {
    const { db, upserts } = makeDb({
      recipient: RECIPIENT,
      templates: [TEMPLATE],
    });

    await expect(backfillBroadcastMessage(db, INPUT)).resolves.toBe('inserted');

    expect(upserts).toHaveLength(1);
    expect(upserts[0].row).toEqual({
      conversation_id: 'conv-1',
      sender_type: 'agent',
      content_type: 'template',
      content_text: 'Olá, Thiago! Tudo bem?',
      media_url: 'https://assets.test/video.mp4',
      template_name: 'disp_convite_grupo_fem',
      message_id: 'wamid.abc',
      status: 'read',
      created_at: '2026-11-01T10:00:00.000Z',
    });
    expect(upserts[0].options).toEqual({
      onConflict: 'conversation_id,message_id',
      ignoreDuplicates: true,
    });
  });

  it('maps a delivered recipient to a delivered message', async () => {
    const { db, upserts } = makeDb({
      recipient: { ...RECIPIENT, status: 'delivered' },
      templates: [TEMPLATE],
    });

    await backfillBroadcastMessage(db, INPUT);

    expect(upserts[0].row.status).toBe('delivered');
  });

  it('falls back to sent for statuses the messages table does not share', async () => {
    const { db, upserts } = makeDb({
      recipient: { ...RECIPIENT, status: 'pending' },
      templates: [TEMPLATE],
    });

    await backfillBroadcastMessage(db, INPUT);

    expect(upserts[0].row.status).toBe('sent');
  });

  it('skips when the contact never received a broadcast', async () => {
    const { db, upserts } = makeDb({ recipient: null });

    await expect(backfillBroadcastMessage(db, INPUT)).resolves.toBe('skipped');
    expect(upserts).toHaveLength(0);
  });

  it('skips a recipient row without a WhatsApp message id', async () => {
    const { db, upserts } = makeDb({
      recipient: { ...RECIPIENT, whatsapp_message_id: null },
      templates: [TEMPLATE],
    });

    await expect(backfillBroadcastMessage(db, INPUT)).resolves.toBe('skipped');
    expect(upserts).toHaveLength(0);
  });

  it('still stores the message when the template row is gone', async () => {
    const { db, upserts } = makeDb({ recipient: RECIPIENT, templates: [] });

    await expect(backfillBroadcastMessage(db, INPUT)).resolves.toBe('inserted');

    expect(upserts[0].row.content_text).toBeNull();
    expect(upserts[0].row.media_url).toBeNull();
    expect(upserts[0].row.template_name).toBe('disp_convite_grupo_fem');
  });

  it('reports an error when the lookup fails', async () => {
    const { db, upserts } = makeDb({
      recipientError: { message: 'boom' },
    });

    await expect(backfillBroadcastMessage(db, INPUT)).resolves.toBe('error');
    expect(upserts).toHaveLength(0);
  });

  it('reports an error when the insert fails', async () => {
    const { db } = makeDb({
      recipient: RECIPIENT,
      templates: [TEMPLATE],
      insertError: { message: 'insert boom' },
    });

    await expect(backfillBroadcastMessage(db, INPUT)).resolves.toBe('error');
  });
});