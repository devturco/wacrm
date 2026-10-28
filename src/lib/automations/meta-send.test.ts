import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConnection } from '@/lib/whatsapp/providers/types'

const state = vi.hoisted(() => ({
  templateRows: [] as unknown[],
  insertedMessage: null as Record<string, unknown> | null,
}))

// The engine resolves the ACTIVE provider through the dispatcher.
// Only the resolution is mocked here — the dispatcher itself (and the
// Meta adapter behind it) stays real, so these tests keep asserting
// the exact Graph payload that leaves the app.
const providerMocks = vi.hoisted(() => ({
  resolveProviderConnection: vi.fn(async (): Promise<ProviderConnection> => ({
    provider: 'meta',
    phoneNumberId: 'pn-1',
    accessToken: 'token',
  })),
}))

vi.mock('@/lib/whatsapp/providers', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/providers')>()
  return {
    ...actual,
    resolveProviderConnection: providerMocks.resolveProviderConnection,
  }
})

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        update: () => builder,
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') state.insertedMessage = row
          return builder
        },
        maybeSingle: async () => {
          if (table === 'contacts') {
            return { data: { id: 'ct-1', phone: '15551234567', wa_user_id: null }, error: null }
          }
          if (table === 'conversations') return { data: { id: 'cv-1' }, error: null }
          return { data: null, error: null }
        },
        single: async () => {
          if (table === 'whatsapp_config') {
            return { data: { phone_number_id: 'pn-1', access_token: 'token' }, error: null }
          }
          return { data: null, error: null }
        },
        then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
          resolve({
            data: table === 'message_templates' ? state.templateRows : null,
            error: null,
          }),
      }
      return builder
    },
  }),
}))

import { engineSendTemplate, engineSendText } from './meta-send'

type FetchResult = { ok: boolean; json: () => Promise<unknown> }

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<FetchResult>>(
  async () => ({
    ok: true,
    json: async () => ({ messages: [{ id: 'wamid.auto' }] }),
  }),
)

function sentTemplate(): Record<string, unknown> {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const init = fetchMock.mock.calls[0][1]
  return JSON.parse(String(init?.body)).template
}

const BASE_ROW = {
  id: 'tpl-1',
  user_id: 'u-1',
  name: 'order_update',
  category: 'Utility',
  language: 'en_US',
  body_text: 'Your order {{1}} ships on {{2}}',
  created_at: '2026-01-01T00:00:00Z',
}

const SEND_ARGS = {
  accountId: 'acct-1',
  userId: 'u-1',
  conversationId: 'cv-1',
  contactId: 'ct-1',
  templateName: 'order_update',
  language: 'en_US',
  params: ['A123', 'Friday'],
}

const BODY_COMPONENT = {
  type: 'body',
  parameters: [
    { type: 'text', text: 'A123' },
    { type: 'text', text: 'Friday' },
  ],
}

beforeEach(() => {
  state.templateRows = []
  state.insertedMessage = null
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('engineSendTemplate — header component', () => {
  it.each(['image', 'video', 'document'] as const)(
    'sends the stored %s header as a header parameter',
    async (headerType) => {
      state.templateRows = [
        {
          ...BASE_ROW,
          header_type: headerType,
          header_media_url: `https://cdn.example.com/header.${headerType}`,
        },
      ]

      await engineSendTemplate(SEND_ARGS)

      expect(sentTemplate()).toEqual({
        name: 'order_update',
        language: { code: 'en_US' },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: headerType,
                [headerType]: { link: `https://cdn.example.com/header.${headerType}` },
              },
            ],
          },
          BODY_COMPONENT,
        ],
      })
      expect(state.insertedMessage?.media_url).toBe(
        `https://cdn.example.com/header.${headerType}`,
      )
    },
  )

  it('fails before calling Meta when a text header variable has no value', async () => {
    state.templateRows = [
      { ...BASE_ROW, header_type: 'text', header_content: 'Hi {{1}}' },
    ]

    await expect(engineSendTemplate(SEND_ARGS)).rejects.toThrow(
      /Header text variable \{\{1\}\} requires a value/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends no header component for a static text header', async () => {
    state.templateRows = [
      { ...BASE_ROW, header_type: 'text', header_content: 'Order update' },
    ]

    await engineSendTemplate(SEND_ARGS)

    expect(sentTemplate().components).toEqual([BODY_COMPONENT])
  })
})

describe('engineSendTemplate — templates without a header keep their payload', () => {
  it('sends only the body component for a header-less template', async () => {
    state.templateRows = [BASE_ROW]

    await engineSendTemplate(SEND_ARGS)

    expect(sentTemplate()).toEqual({
      name: 'order_update',
      language: { code: 'en_US' },
      components: [BODY_COMPONENT],
    })
  })

  it('sends no components for a fully static template', async () => {
    state.templateRows = [{ ...BASE_ROW, body_text: 'Thanks for your order' }]

    await engineSendTemplate({ ...SEND_ARGS, params: [] })

    expect(sentTemplate()).toEqual({
      name: 'order_update',
      language: { code: 'en_US' },
    })
  })

  it('falls back to the body-only payload when the account has no local row', async () => {
    await engineSendTemplate(SEND_ARGS)

    expect(sentTemplate()).toEqual({
      name: 'order_update',
      language: { code: 'en_US' },
      components: [BODY_COMPONENT],
    })
  })
})

describe('engineSendText — provider dispatch', () => {
  it('resolves the provider connection instead of the Meta credentials', async () => {
    await engineSendText({
      accountId: 'acct-1',
      userId: 'user-1',
      conversationId: 'cv-1',
      contactId: 'ct-1',
      text: 'hi',
    })

    expect(providerMocks.resolveProviderConnection).toHaveBeenCalled()
    // The dispatcher handed the resolved connection to Meta: the Graph
    // call went out with the phone number id it carries.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/pn-1/messages')
  })
})

describe('engineSendTemplate — the CRMBR provider has no templates', () => {
  it('refuses the send instead of degrading it to plain text', async () => {
    providerMocks.resolveProviderConnection.mockResolvedValueOnce({
      provider: 'whatsmiau',
      instanceName: 'Atendimento01',
      apiKey: 'key-1',
      baseUrl: 'https://api.whatsmiau.dev/v2',
    })

    await expect(engineSendTemplate(SEND_ARGS)).rejects.toThrow(
      /does not support message templates/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
