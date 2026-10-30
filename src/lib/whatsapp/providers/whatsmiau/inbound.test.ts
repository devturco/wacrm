import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({
  events: [] as { event: string; data: unknown }[],
  flows: [] as unknown[],
  automations: [] as { triggerType: string }[],
  aiReplies: [] as unknown[],
  statusUpdates: [] as { wamid: string; status: string }[],
  broadcastFlags: [] as unknown[],
  firstInbound: true,
  resumed: false,
}));

vi.mock('@/lib/api/v1/contacts', () => ({
  resolveAuditUserId: vi.fn(async () => 'user-1'),
}));

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn(async () => null),
  isUniqueViolation: vi.fn(() => false),
}));

vi.mock('@/lib/conversations/first-inbound', () => ({
  claimFirstInboundMessage: vi.fn(async () => h.firstInbound),
}));

vi.mock('@/lib/conversations/reopen', () => ({
  reopenClosedConversation: vi.fn(async () => true),
}));

vi.mock('@/lib/whatsapp/message-status-sync', () => ({
  applyMessageStatus: vi.fn(async (_db: unknown, _accountId: string, incoming: { wamid: string; status: string }) => {
    h.statusUpdates.push({ wamid: incoming.wamid, status: incoming.status });
    return [];
  }),
}));

vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: vi.fn(async (input: unknown) => {
    h.flows.push(input);
    return { consumed: false };
  }),
}));

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: vi.fn(async (input: unknown) => {
    h.aiReplies.push(input);
  }),
}));

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(async (input: { triggerType: string }) => {
    h.automations.push({ triggerType: input.triggerType });
  }),
  resumeAwaitingReply: vi.fn(async () => {
    h.resumed = true;
    return false;
  }),
}));

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: vi.fn(async (_db: unknown, _accountId: string, event: string, data: unknown) => {
    h.events.push({ event, data });
  }),
}));

vi.mock('@/lib/whatsapp/broadcast-recipient-webhook', () => ({
  flagBroadcastReply: vi.fn(async () => {
    h.broadcastFlags.push(true);
    return 'skipped';
  }),
}));

vi.mock('./mirror-media', () => ({
  mirrorWhatsmiauMedia: vi.fn(async () => 'https://cdn.test/mirrored.png'),
}));

// The contact's picture — a separate concern, exercised in
// `avatar.test.ts`. Here it only has to stay out of the way.
vi.mock('./avatar', () => ({
  refreshContactAvatar: vi.fn(async () => undefined),
}));

import {
  handleWhatsmiauInboundMessage,
  type WhatsmiauInboundContext,
} from './inbound';
import { findExistingContact } from '@/lib/contacts/dedupe';
import { fakeMediaStorage } from '@/lib/media/storage/fake-storage.test-helper';
import type { NormalizedInboundMessage } from './normalize';

type Row = Record<string, unknown>;
type Queued = { data?: unknown; error?: unknown };

interface Call {
  table: string;
  op: string;
  payload?: Row;
}

/**
 * Chainable Supabase double. Each table has a QUEUE of terminal
 * responses, consumed in order, so a test can say "the contact lookup
 * finds nothing, the contact insert returns contact-1".
 */
function scriptedDb(queues: Record<string, Queued[]>) {
  const calls: Call[] = [];
  const remaining: Record<string, Queued[]> = {};
  for (const [table, list] of Object.entries(queues)) remaining[table] = [...list];

  const next = (table: string): Queued => {
    const list = remaining[table];
    if (!list || list.length === 0) return { data: null, error: null };
    return list.shift()!;
  };

  const from = (table: string) => {
    let op = 'select';
    let payload: Row | undefined;
    const api = {
      select: () => api,
      insert: (row: Row) => { op = 'insert'; payload = row; return api; },
      update: (row: Row) => { op = 'update'; payload = row; return api; },
      upsert: (row: Row) => { op = 'upsert'; payload = row; return api; },
      delete: () => { op = 'delete'; return api; },
      eq: () => api,
      in: () => api,
      order: () => api,
      limit: () => api,
      single: async () => { calls.push({ table, op, payload }); return next(table); },
      maybeSingle: async () => { calls.push({ table, op, payload }); return next(table); },
      then: (resolve: (value: unknown) => unknown) => {
        calls.push({ table, op, payload });
        return Promise.resolve(resolve(next(table)));
      },
    };
    return api;
  };

  const db = {
    from,
    rpc: async (name: string) => {
      calls.push({ table: `rpc:${name}`, op: 'rpc' });
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;

  return { db, calls };
}

function context(db: SupabaseClient): WhatsmiauInboundContext {
  return {
    db,
    accountId: 'acc-1',
    ownerUserId: 'user-1',
    configId: 'wm-1',
    providerInstanceName: 'acme_lojista',
    instanceSettings: {
      alwaysOnline: false,
      readMessages: false,
      rejectCall: true,
      msgCall: '',
      groupsIgnore: true,
      saveMedia: true,
      channelsEnabled: false,
      webhook: {
        enabled: true,
        url: 'https://app.test/api/whatsmiau/webhook',
        headers: {},
        events: [],
        base64: false,
      },
    },
    storage: fakeMediaStorage().storage,
  };
}

function textMessage(overrides: Partial<NormalizedInboundMessage> = {}): NormalizedInboundMessage {
  return {
    messageId: 'MSG_001',
    remoteJid: '5511999988888@s.whatsapp.net',
    fromMe: false,
    phone: '5511999988888',
    timestamp: 1793113200,
    kind: 'text',
    text: 'Preciso de suporte.',
    ...overrides,
  };
}

describe('handleWhatsmiauInboundMessage', () => {
  beforeEach(() => {
    h.events.length = 0;
    h.flows.length = 0;
    h.automations.length = 0;
    h.aiReplies.length = 0;
    h.statusUpdates.length = 0;
    h.broadcastFlags.length = 0;
    h.firstInbound = true;
    h.resumed = false;
  });

  it('ignores group messages without touching the database', async () => {
    const { db, calls } = scriptedDb({});
    const outcome = await handleWhatsmiauInboundMessage(
      context(db),
      textMessage({ remoteJid: '12345@g.us', phone: '12345' }),
    );

    expect(outcome.disposition).toBe('skipped');
    expect(calls).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it('does not create a contact or a conversation for our own outbound message', async () => {
    const { db, calls } = scriptedDb({});
    const outcome = await handleWhatsmiauInboundMessage(
      context(db),
      textMessage({ fromMe: true }),
    );

    expect(outcome.disposition).toBe('skipped');
    expect(calls.filter((c) => c.table === 'contacts')).toHaveLength(0);
    expect(calls.filter((c) => c.table === 'conversations')).toHaveLength(0);
  });

  it('drops a channel message by default', async () => {
    const { db, calls } = scriptedDb({});
    const outcome = await handleWhatsmiauInboundMessage(
      context(db),
      textMessage({
        remoteJid: '120363025246005890@newsletter',
        phone: '120363025246005890',
      }),
    );

    expect(outcome.disposition).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('lets a channel message through when the instance asks for it', async () => {
    const { db } = scriptedDb({
      contacts: [{ data: { id: 'contact-1', phone: '120363025246005890' } }],
      conversations: [{ data: [] }, { data: { id: 'conv-1', status: 'open' } }],
      messages: [{ data: [{ id: 'msg-1' }] }],
    });

    const ctx = context(db);
    ctx.instanceSettings = { ...ctx.instanceSettings, channelsEnabled: true };

    const outcome = await handleWhatsmiauInboundMessage(
      ctx,
      textMessage({
        remoteJid: '120363025246005890@newsletter',
        phone: '120363025246005890',
      }),
    );

    expect(outcome.disposition).toBe('inserted');
  });

  it('stores a message we sent from the phone, without fanning it out', async () => {
    vi.mocked(findExistingContact).mockResolvedValueOnce({
      id: 'contact-1',
      phone: '5511999988888',
    });

    const { db, calls } = scriptedDb({
      // The lookup of our own message finds nothing — the CRM never
      // wrote a row for a message typed on the phone.
      messages: [{ data: null }, { data: [{ id: 'msg-1' }] }],
      conversations: [{ data: [{ id: 'conv-1', status: 'open', last_message_at: null }] }],
    });

    const outcome = await handleWhatsmiauInboundMessage(
      context(db),
      textMessage({ fromMe: true, text: 'Já te respondi pelo celular.' }),
    );

    expect(outcome.disposition).toBe('inserted');
    expect(outcome.conversationId).toBe('conv-1');

    const stored = calls.find((c) => c.table === 'messages' && c.op === 'upsert');
    expect(stored?.payload).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'agent',
      status: 'sent',
      message_id: 'MSG_001',
      content_text: 'Já te respondi pelo celular.',
    });

    // It is OUR message: no unread bump, no automation, no AI reply and
    // no inbound webhook event.
    expect(calls.some((c) => c.table.startsWith('rpc:'))).toBe(false);
    expect(h.automations).toHaveLength(0);
    expect(h.aiReplies).toHaveLength(0);
    expect(h.events.map((e) => e.event)).not.toContain('message.received');
  });

  it('only reconciles the status when the CRM already stored the message', async () => {
    const { db, calls } = scriptedDb({
      messages: [{ data: { id: 'msg-1' } }],
    });

    const outcome = await handleWhatsmiauInboundMessage(
      context(db),
      textMessage({ fromMe: true }),
    );

    expect(outcome.disposition).toBe('skipped');
    expect(h.statusUpdates).toEqual([{ wamid: 'MSG_001', status: 'sent' }]);
    expect(calls.filter((c) => c.table === 'messages' && c.op === 'upsert')).toHaveLength(0);
  });

  it('creates the contact and the conversation, stores the message and fans out', async () => {
    const { db, calls } = scriptedDb({
      conversations: [{ data: [] }, { data: { id: 'conv-1', status: 'open' } }],
      contacts: [{ data: { id: 'contact-1', phone: '5511999988888' } }],
      messages: [{ data: [{ id: 'msg-1' }] }],
    });

    const outcome = await handleWhatsmiauInboundMessage(context(db), textMessage());

    expect(outcome.disposition).toBe('inserted');
    expect(outcome.contactId).toBe('contact-1');
    expect(outcome.conversationId).toBe('conv-1');

    const insert = calls.find((c) => c.table === 'messages' && c.op === 'upsert');
    expect(insert?.payload).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'Preciso de suporte.',
      message_id: 'MSG_001',
      status: 'delivered',
    });

    // conversation.created fires before message.received.
    const eventNames = h.events.map((e) => e.event);
    expect(eventNames).toContain('conversation.created');
    expect(eventNames).toContain('message.received');
    expect(eventNames.indexOf('conversation.created')).toBeLessThan(
      eventNames.indexOf('message.received'),
    );

    expect(h.flows).toHaveLength(1);
    expect(h.automations.map((a) => a.triggerType)).toEqual(
      expect.arrayContaining(['new_message_received', 'keyword_match']),
    );
    expect(h.aiReplies).toHaveLength(1);
    expect(h.broadcastFlags).toHaveLength(1);
  });

  it('treats a redelivery as a replay and does not fan out twice', async () => {
    const { db } = scriptedDb({
      conversations: [{ data: [] }, { data: { id: 'conv-1', status: 'open' } }],
      contacts: [{ data: { id: 'contact-1', phone: '5511999988888' } }],
      messages: [{ data: [] }],
    });

    const outcome = await handleWhatsmiauInboundMessage(context(db), textMessage());

    expect(outcome.disposition).toBe('replay');
    expect(h.events.map((e) => e.event)).not.toContain('message.received');
    expect(h.flows).toHaveLength(0);
    expect(h.aiReplies).toHaveLength(0);
  });

  it('stores a reaction on the target message instead of a new message row', async () => {
    const { db, calls } = scriptedDb({
      conversations: [{ data: [{ id: 'conv-1', status: 'open' }] }],
      contacts: [{ data: { id: 'contact-1', phone: '5511999988888' } }],
      messages: [{ data: { id: 'msg-1' } }],
    });

    const outcome = await handleWhatsmiauInboundMessage(
      context(db),
      textMessage({
        kind: 'reaction',
        reactionEmoji: '👍',
        reactedToMessageId: 'MSG_000',
        text: undefined,
      }),
    );

    expect(outcome.disposition).toBe('skipped');
    expect(calls.filter((c) => c.table === 'messages' && c.op === 'upsert')).toHaveLength(0);
  });
});
