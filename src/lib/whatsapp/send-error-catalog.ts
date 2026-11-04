/**
 * Catalogo dos erros de envio que a Meta devolve em disparos.
 *
 * `broadcast_recipients.error_message` guarda o texto cru, em dois
 * formatos: `[131026] Titulo: detalhe` (webhook) e `(#131026) ...`
 * (Graph API). Aqui so identificamos o codigo e o tipo; o texto que o
 * usuario le vem das traducoes (`Broadcasts.errors`).
 *
 * Codigos: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */

export type SendErrorKind =
  | 'undeliverable'
  | 'notAllowedList'
  | 'accountRestricted'
  | 'reengagement'
  | 'ecosystemDecline'
  | 'rateLimited'
  | 'templateNotFound'
  | 'templatePaused'
  | 'templateParams'
  | 'media'
  | 'token'
  | 'invalidParameter'
  | 'temporary'
  | 'unknown'

export interface SendErrorInfo {
  kind: SendErrorKind
  code: number | null
  /** Texto original, preservado para suporte e exportacao. */
  raw: string
}

const CODE_KIND: Record<number, SendErrorKind> = {
  1: 'temporary',
  2: 'temporary',
  100: 'invalidParameter',
  190: 'token',
  131000: 'temporary',
  131026: 'undeliverable',
  131030: 'notAllowedList',
  131031: 'accountRestricted',
  131047: 'reengagement',
  131049: 'ecosystemDecline',
  131051: 'media',
  131052: 'media',
  131053: 'media',
  130429: 'rateLimited',
  131048: 'rateLimited',
  131056: 'rateLimited',
  80007: 'rateLimited',
  4: 'rateLimited',
  17: 'rateLimited',
  32: 'rateLimited',
  613: 'rateLimited',
  132000: 'templateParams',
  132005: 'templateParams',
  132012: 'templateParams',
  132001: 'templateNotFound',
  132007: 'templatePaused',
  132015: 'templatePaused',
  132016: 'templatePaused',
  133004: 'temporary',
  133016: 'temporary',
}

const BRACKET_FORMAT = /^\s*\[(\d+)\]/
const PAREN_FORMAT = /^\s*\(#(\d+)\)/

function parseCode(raw: string): number | null {
  const match = BRACKET_FORMAT.exec(raw) ?? PAREN_FORMAT.exec(raw)
  return match ? Number(match[1]) : null
}

export function explainSendError(
  raw: string | null | undefined,
): SendErrorInfo | null {
  const text = raw?.trim()
  if (!text) return null
  const code = parseCode(text)
  return {
    kind: code !== null ? (CODE_KIND[code] ?? 'unknown') : 'unknown',
    code,
    raw: text,
  }
}