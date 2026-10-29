// ============================================================
// The chats that are NOT a person.
//
// WhatsApp delivers everything through the same webhook: a direct
// chat, a group, a channel (a one-way broadcast feed), a status
// broadcast. The provider tells them apart by the JID suffix:
//
//   5511999988888@s.whatsapp.net   a person
//   120363000000000000@g.us         a group
//   120363025246005890@newsletter  a channel
//   status@broadcast                a status broadcast
//
// A channel has an ID, not a phone number, and nobody can answer it.
// Its ID is a long numeric string, so letting one through creates a
// "contact" whose phone is an 18-digit id that can never receive a
// message — and a conversation nobody asked for.
//
// The provider has NO flag to suppress them (`groupsIgnore` covers
// groups only), so the filter lives here and the account decides, per
// instance, whether channels reach the inbox at all.
// ============================================================

/** The JID suffix of a direct chat — the only one that carries a phone. */
export const PERSON_JID_SUFFIX = 's.whatsapp.net';

/** The JID suffix of a group. */
export const GROUP_JID_SUFFIX = 'g.us';

/** The JID suffixes the provider uses for the broadcast feeds. */
export const CHANNEL_JID_SUFFIXES = ['newsletter', 'broadcast'] as const;

/**
 * The part of a JID after the `@` — `s.whatsapp.net`, `g.us`,
 * `newsletter`… Empty when the JID carries no suffix.
 */
export function jidSuffix(jid: string): string {
  if (!jid) return '';
  const at = jid.lastIndexOf('@');
  if (at < 0) return '';
  return jid.slice(at + 1).trim().toLowerCase();
}

/** Is this jid a group? */
export function isGroupJid(jid: string): boolean {
  return jidSuffix(jid) === GROUP_JID_SUFFIX;
}

/**
 * Is this jid a channel — a chat that is neither a person nor a group?
 *
 * The catch-all is deliberate: `@newsletter` and `@broadcast` are the
 * feeds we know today, but a suffix we do not recognise is just as
 * much "not a person" as those two. Naming it here keeps the inbox
 * from ever growing a contact whose phone is a broadcast id.
 */
export function isChannelJid(jid: string): boolean {
  const suffix = jidSuffix(jid);
  if (!suffix) return false;
  return suffix !== PERSON_JID_SUFFIX && suffix !== GROUP_JID_SUFFIX;
}
