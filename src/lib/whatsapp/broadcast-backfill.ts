// ============================================================
// Rebuild the outbound broadcast message when the customer replies.
//
// Broadcasts are recorded only in `broadcast_recipients`: no
// `messages` row is written and, most of the time, no conversation
// exists yet. The first reply therefore opened an empty thread — the
// customer's answer floating with no context of what we sent.
//
// This helper inserts the template message the customer is replying
// to, timestamped at `sent_at` so it sorts before the reply. It runs
// from the Meta inbound webhook, after the conversation is resolved.
//
// Idempotent: the unique (conversation_id, message_id) index added in
// migration 037 makes a replay (or a second reply) a no-op.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  resolveTemplateRow,
  templateContentText,
  templateHeaderMediaUrl,
} from './template-body';

export type BackfillResult = 'inserted' | 'skipped' | 'error';

interface RecipientRow {
  id: string;
  status: string;
  whatsapp_message_id: string | null;
  sent_at: string | null;
  template_params: unknown;
  broadcasts:
    | {
        account_id: string;
        template_name: string;
        template_language: string;
      }
    | null;
}

/** Broadcast recipient statuses map onto the narrower `messages` set. */
function messageStatusFromRecipient(
  status: string
): 'sent' | 'delivered' | 'read' {
  if (status === 'read' || status === 'replied') return 'read';
  if (status === 'delivered') return 'delivered';
  return 'sent';
}

export interface BackfillInput {
  accountId: string;
  contactId: string;
  conversationId: string;
  /**
   * Alvo exato — usado quando o cliente *reage* a um disparo e sabemos
   * qual mensagem foi reagida. Sem ele, vale o disparo mais recente.
   */
  whatsappMessageId?: string;
}

/**
 * Best-effort: callers swallow failures — a missing history entry must
 * never break inbound processing.
 */
export async function backfillBroadcastMessage(
  db: SupabaseClient,
  input: BackfillInput
): Promise<BackfillResult> {
  const { accountId, contactId, conversationId, whatsappMessageId } = input;
  if (!accountId || !contactId || !conversationId) return 'skipped';

  // Latest broadcast actually delivered to this contact — or the exact
  // message the customer reacted to.
  let query = db
    .from('broadcast_recipients')
    .select(
      'id, status, whatsapp_message_id, sent_at, template_params, broadcasts!inner(account_id, template_name, template_language)'
    )
    .eq('contact_id', contactId)
    .eq('broadcasts.account_id', accountId);

  query = whatsappMessageId
    ? query.eq('whatsapp_message_id', whatsappMessageId)
    : query
        .not('whatsapp_message_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('[broadcast-backfill] recipient lookup failed:', error);
    return 'error';
  }

  const row = data as RecipientRow | null;
  if (!row?.whatsapp_message_id || !row.broadcasts) return 'skipped';

  // Template body/media live in `message_templates`; without the row the
  // message still gets stored (name only) instead of losing the history.
  const resolved = await resolveTemplateRow(
    db,
    accountId,
    row.broadcasts.template_name,
    row.broadcasts.template_language
  );
  const template = resolved.row;

  const params = Array.isArray(row.template_params)
    ? row.template_params.filter((v): v is string => typeof v === 'string')
    : [];

  const contentText = templateContentText(template, params, null);
  const createdAt = row.sent_at ?? new Date().toISOString();

  const { error: insertError } = await db.from('messages').upsert(
    {
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: 'template',
      content_text: contentText,
      media_url: templateHeaderMediaUrl(template, null),
      template_name: row.broadcasts.template_name,
      message_id: row.whatsapp_message_id,
      status: messageStatusFromRecipient(row.status),
      created_at: createdAt,
    },
    { onConflict: 'conversation_id,message_id', ignoreDuplicates: true }
  );

  if (insertError) {
    console.error('[broadcast-backfill] message insert failed:', insertError);
    return 'error';
  }

  // A lista da inbox lê o preview da conversa, não a tabela messages —
  // sem isso a thread mostra o disparo e o item continua "Nenhuma
  // mensagem ainda". Só sobrescreve preview mais antigo.
  const { data: convRow } = await db
    .from('conversations')
    .select('last_message_at')
    .eq('id', conversationId)
    .maybeSingle();
  const lastAt = (convRow as { last_message_at: string | null } | null)
    ?.last_message_at;
  if (!lastAt || new Date(lastAt).getTime() < new Date(createdAt).getTime()) {
    const { error: previewError } = await db
      .from('conversations')
      .update({
        last_message_text: contentText ?? row.broadcasts.template_name,
        last_message_at: createdAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
    if (previewError) {
      console.error(
        '[broadcast-backfill] conversation preview update failed:',
        previewError
      );
    }
  }

  return 'inserted';
}