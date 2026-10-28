import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConnection } from '@/lib/whatsapp/providers/types'

// ============================================================
// The Flows engine talks to whichever provider the account has
// active. These tests drive the real engine against a fake Supabase
// and a mocked dispatcher, so the assertion is "the send went out
// through the dispatcher with the resolved connection" — no network.
// ============================================================

const providerMocks = vi.hoisted(() => ({
  resolveProviderConnection: vi.fn(async (): Promise<ProviderConnection> => ({
    provider: 'meta',
    phoneNumberId: 'pn-1',
    accessToken: 'tok-1',
  })),
  assertProviderSupportsMessageType: vi.fn(),
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid.text' })),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid.media' })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid.btn' })),
  sendInteractiveList: vi.fn(async () => ({ messageId: 'wamid.list' })),
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid.tpl' })),
  sendTypingIndicator: vi.fn(async () => undefined),
}))

vi.mock('@/lib/whatsapp/providers', () => providerMocks)

const state = vi.hoisted(() => ({
  inserted: [] as { table: string; row: Record<string, unknown> }[],
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        update: () => builder,
        insert: (row: Record<string, unknown>) => {
          state.inserted.push({ table, row })
          return builder
        },
        maybeSingle: async () => {
          if (table === 'contacts') {
            return {
              data: { id: 'ct-1', phone: '15551234567', wa_user_id: null },
              error: null,
            }
          }
          if (table === 'conversations') {
            return { data: { id: 'cv-1' }, error: null }
          }
          return { data: null, error: null }
        },
        then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
          resolve({ data: null, error: null }),
      }
      return builder
    },
  }),
}))

import {
  engineSendInteractiveButtons,
  engineSendText,
} from './meta-send'

const TEXT_ARGS = {
  accountId: 'acct-1',
  userId: 'user-1',
  conversationId: 'cv-1',
  contactId: 'ct-1',
  text: 'hi',
}

const BUTTONS_ARGS = {
  accountId: 'acct-1',
  userId: 'user-1',
  conversationId: 'cv-1',
  contactId: 'ct-1',
  bodyText: 'Pick one',
  buttons: [{ id: 'a', title: 'A' }],
}

beforeEach(() => {
  state.inserted = []
  providerMocks.resolveProviderConnection.mockResolvedValue({
    provider: 'meta',
    phoneNumberId: 'pn-1',
    accessToken: 'tok-1',
  })
})

describe('engineSendText — provider dispatch', () => {
  it('resolves the provider connection instead of the Meta credentials', async () => {
    await engineSendText(TEXT_ARGS)

    expect(providerMocks.resolveProviderConnection).toHaveBeenCalled()
    expect(providerMocks.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'meta' }),
      expect.objectContaining({ to: '15551234567', text: 'hi' })
    )
  })

  it('sends through the CRMBR provider when it is the active one', async () => {
    providerMocks.resolveProviderConnection.mockResolvedValue({
      provider: 'whatsmiau',
      instanceName: 'Atendimento01',
      apiKey: 'key-1',
      baseUrl: 'https://api.whatsmiau.dev/v2',
    })

    await engineSendText(TEXT_ARGS)

    expect(providerMocks.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'whatsmiau' }),
      expect.objectContaining({ to: '15551234567', text: 'hi' })
    )
  })

  it('persists the sent message with the provider message id', async () => {
    await engineSendText(TEXT_ARGS)

    const message = state.inserted.find((i) => i.table === 'messages')
    expect(message?.row).toMatchObject({
      conversation_id: 'cv-1',
      sender_type: 'bot',
      content_type: 'text',
      message_id: 'wamid.text',
      status: 'sent',
    })
  })
})

describe('engineSendInteractiveButtons — provider dispatch', () => {
  it('sends the buttons through the dispatcher', async () => {
    await engineSendInteractiveButtons(BUTTONS_ARGS)

    expect(providerMocks.sendInteractiveButtons).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'meta' }),
      expect.objectContaining({ to: '15551234567', bodyText: 'Pick one' })
    )
  })
})
