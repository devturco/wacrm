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
  })

  it('agrupa os codigos de limite de envio', () => {
    for (const code of [130429, 131056, 80007, 4]) {
      expect(explainSendError(`[${code}] Rate limit hit`)?.kind).toBe(
        'rateLimited',
      )
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