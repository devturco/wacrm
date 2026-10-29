import { describe, expect, it, vi } from 'vitest'

import { TRACK_SCRIPT } from './track-script'

/**
 * The script runs in the browser, on the CLIENT's site — not on the
 * CRM. These tests give it just enough of a DOM to run and then check
 * what it does: no jsdom, no new dependency.
 */

class FakeElement {
  tagName: string
  parentNode: FakeElement | null = null
  private readonly attributes: Record<string, string>

  constructor(tagName: string, attributes: Record<string, string> = {}) {
    this.tagName = tagName
    this.attributes = { ...attributes }
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value
  }
}

interface FakeEvent {
  target: FakeElement
  defaultPrevented: boolean
  preventDefault(): void
}

interface Harness {
  document: { cookie: string; referrer: string }
  window: { location: { href: string }; open: ReturnType<typeof vi.fn> }
  fetch: ReturnType<typeof vi.fn>
  click(link: FakeElement): FakeEvent
  blur(input: FakeElement): void
  submit(): void
}

/** Where the CRM lives — the site that serves the script. */
const CRM = 'https://crm.example.com'
/** Where the visitor is — the client's own site. */
const SITE = 'https://site.example.com'
const TOKEN = 'ABCD2345'

function runScript(
  options: {
    key?: string | null
    src?: string
    referrer?: string
    search?: string
    fetch?: ReturnType<typeof vi.fn>
  } = {}
): Harness {
  const script = new FakeElement('script', {
    ...(options.src === undefined ? { src: `${CRM}/api/leads/track.js` } : { src: options.src }),
    ...(options.key === null ? {} : { 'data-key': options.key ?? 'pk_abc' }),
  })

  const listeners: Record<string, (event: FakeEvent) => void> = {}

  const document = {
    cookie: '',
    referrer: options.referrer ?? '',
    currentScript: script,
    getElementsByTagName: () => [script],
    querySelectorAll: () => [] as FakeElement[],
    querySelector: () => null as FakeElement | null,
    addEventListener: (type: string, handler: (event: FakeEvent) => void) => {
      listeners[type] = handler
    },
  }

  const location = {
    origin: SITE,
    search: options.search ?? '?utm_source=instagram&utm_campaign=verao',
    pathname: '/promo',
  }

  const window = {
    location: { href: '' },
    open: vi.fn(() => ({ opener: {} })),
  }

  const fetchMock =
    options.fetch ??
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ leadToken: TOKEN }),
    }))

  const run = new Function(
    'document',
    'window',
    'location',
    'fetch',
    TRACK_SCRIPT
  )
  run(document, window, location, fetchMock)

  return {
    document,
    window,
    fetch: fetchMock,
    click(link: FakeElement): FakeEvent {
      const event: FakeEvent = {
        target: link,
        defaultPrevented: false,
        preventDefault(): void {
          this.defaultPrevented = true
        },
      }
      listeners.click?.(event)
      return event
    },
    blur(input: FakeElement): void {
      listeners.blur?.({
        target: input,
        defaultPrevented: false,
        preventDefault(): void {},
      })
    },
    submit(): void {
      listeners.submit?.({
        target: new FakeElement('form'),
        defaultPrevented: false,
        preventDefault(): void {},
      })
    },
  }
}

/** Let the promise chain inside the script settle. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('the track script', () => {
  it('posts to the CRM, not to the site of the client', async () => {
    const harness = runScript()
    harness.submit()
    await settle()

    expect(harness.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = harness.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${CRM}/api/leads/capture`)
    expect((init.headers as Record<string, string>)['x-capture-key']).toBe(
      'pk_abc'
    )
  })

  it('does nothing without the capture key', async () => {
    const harness = runScript({ key: null })
    harness.submit()
    await settle()

    expect(harness.fetch).not.toHaveBeenCalled()
  })

  it('sends the first touch and the touch of the moment', async () => {
    const harness = runScript()
    harness.submit()
    await settle()

    const [, init] = harness.fetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as {
      action: string
      first: { utm_source: string }
      now: { utm_source: string }
    }
    expect(body.action).toBe('form_submit')
    expect(body.first.utm_source).toBe('instagram')
    expect(body.now.utm_source).toBe('instagram')
  })

  it('puts the code inside the prefilled message', async () => {
    const harness = runScript()
    const link = new FakeElement('a', {
      href: 'https://wa.me/5511999999999?text=Ol%C3%A1',
    })

    const event = harness.click(link)
    await settle()

    expect(event.defaultPrevented).toBe(true)
    expect(harness.window.location.href).toBe(
      `https://wa.me/5511999999999?text=Ol%C3%A1%20ref%20${TOKEN}`
    )
  })

  it('adds the message when the link has none', async () => {
    const harness = runScript()
    const link = new FakeElement('a', { href: 'https://wa.me/5511999999999' })

    harness.click(link)
    await settle()

    expect(harness.window.location.href).toBe(
      `https://wa.me/5511999999999?text=ref%20${TOKEN}`
    )
  })

  it('carries the code in a wa: link', async () => {
    const harness = runScript()
    const link = new FakeElement('a', { href: 'wa:5511999999999' })

    harness.click(link)
    await settle()

    expect(harness.window.location.href).toBe(`wa:5511999999999?text=ref%20${TOKEN}`)
  })

  it('keeps the hash of the link', async () => {
    const harness = runScript()
    const link = new FakeElement('a', {
      href: 'https://wa.me/5511999999999?text=Oi#falas',
    })

    harness.click(link)
    await settle()

    expect(harness.window.location.href).toBe(
      `https://wa.me/5511999999999?text=Oi%20ref%20${TOKEN}#falas`
    )
  })

  it('leaves an Instagram link alone — the ad referral does the job', async () => {
    const harness = runScript()
    const link = new FakeElement('a', {
      href: 'https://instagram.com/seuperfil',
    })

    const event = harness.click(link)
    await settle()

    expect(event.defaultPrevented).toBe(false)
    expect(harness.window.location.href).toBe('')
    expect(harness.fetch).toHaveBeenCalledTimes(1)
  })

  it('goes to the original link when the capture fails', async () => {
    const harness = runScript({
      fetch: vi.fn(async () => {
        throw new Error('offline')
      }),
    })
    const link = new FakeElement('a', { href: 'https://wa.me/5511999999999' })

    harness.click(link)
    await settle()

    expect(harness.window.location.href).toBe('https://wa.me/5511999999999')
  })
})
