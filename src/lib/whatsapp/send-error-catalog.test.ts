import { describe, expect, it } from 'vitest'
import { explainSendError } from './send-error-catalog'

describe('explainSendError', () => {
  it('le o formato gravado pelo webhook', () => {
    const info = explainSendError(
      '[131026] Message undeliverable: Message Undeliverable.',
    )
    expect(info).toEqual({
      kind: 'undeliverable',
      code: 131026,
      raw: '[131026] Message undeliverable: Message Undeliverable.',
    })
  })

  it('le o formato entre parenteses da Graph API', () => {
    const info = explainSendError(
      '(#131030) Recipient phone number not in allowed list',
    )
    expect(info?.kind).toBe('notAllowedList')
    expect(info?.code).toBe(131030)
  })

  it('agrupa os codigos de template', () => {
    expect(explainSendError('[132001] Template does not exist')?.kind).toBe(
      'templateNotFound',
    )
    expect(explainSendError('[132015] Template paused')?.kind).toBe(
      'templatePaused',
    )
    expect(explainSendError('[132012] Parameter format mismatch')?.kind).toBe(
      'templateParams',
    )
    expect(explainSendError('[132018] Template validation error')?.kind).toBe(
      'templateParams',
    )
  })

  it('agrupa os codigos de limite de envio', () => {
    for (const code of [130429, 131056, 80007, 4]) {
      expect(explainSendError(`[${code}] Rate limit hit`)?.kind).toBe(
        'rateLimited',
      )
    }
  })

  it('cobre os bloqueios de conta e de destinatario', () => {
    expect(explainSendError('[130403] Recipient blocked')?.kind).toBe(
      'recipientBlocked',
    )
    expect(explainSendError('[131050] Opted out')?.kind).toBe('optedOut')
    expect(explainSendError('[131042] Payment problem')?.kind).toBe('payment')
    expect(explainSendError('[130497] Country restriction')?.kind).toBe(
      'countryRestricted',
    )
    expect(explainSendError('[131048] Sending restrictions')?.kind).toBe(
      'sendingRestricted',
    )
    expect(explainSendError('[131064] Template classification')?.kind).toBe(
      'sendingRestricted',
    )
    expect(explainSendError('[368] Blocked')?.kind).toBe('accountRestricted')
  })

  it('separa permissao de token invalido', () => {
    expect(explainSendError('[131005] Permission missing')?.kind).toBe(
      'permission',
    )
    expect(explainSendError('[10] Permission missing')?.kind).toBe('permission')
    expect(explainSendError('[0] Authentication failure')?.kind).toBe('token')
    expect(explainSendError('[200] No access token')?.kind).toBe('token')
  })

  it('agrupa os erros de registro do numero', () => {
    for (const code of [131045, 133006, 133010, 133016]) {
      expect(explainSendError(`[${code}] Registration issue`)?.kind).toBe(
        'registration',
      )
    }
  })

  it('cobre os transitorios que a Meta lista', () => {
    for (const code of [1, 2, 131000, 131016, 131057]) {
      expect(explainSendError(`[${code}] Temporary`)?.kind).toBe('temporary')
    }
  })

  it('mantem o codigo quando ele nao esta no catalogo', () => {
    const info = explainSendError('[999999] Something new')
    expect(info).toEqual({
      kind: 'unknown',
      code: 999999,
      raw: '[999999] Something new',
    })
  })

  it('deixa passar erros locais ja traduzidos', () => {
    const info = explainSendError('Telefone inválido')
    expect(info).toEqual({
      kind: 'unknown',
      code: null,
      raw: 'Telefone inválido',
    })
  })

  it('devolve null para erro vazio', () => {
    expect(explainSendError(null)).toBeNull()
    expect(explainSendError('')).toBeNull()
    expect(explainSendError('   ')).toBeNull()
  })
})