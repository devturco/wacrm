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
  | 'sendingRestricted'
  | 'recipientBlocked'
  | 'optedOut'
  | 'countryRestricted'
  | 'payment'
  | 'permission'
  | 'registration'
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
  // Autenticacao e permissao
  0: 'token',
  3: 'permission',
  10: 'permission',
  190: 'token',
  200: 'token',
  131005: 'permission',
  // Parametros e configuracao
  33: 'invalidParameter',
  100: 'invalidParameter',
  131008: 'invalidParameter',
  131009: 'invalidParameter',
  131021: 'invalidParameter',
  131037: 'invalidParameter',
  // Conta e politica
  368: 'accountRestricted',
  130403: 'recipientBlocked',
  130497: 'countryRestricted',
  131031: 'accountRestricted',
  131042: 'payment',
  131045: 'registration',
  131048: 'sendingRestricted',
  131050: 'optedOut',
  131063: 'templatePaused',
  131064: 'sendingRestricted',
  // Entrega e janela de conversa
  131026: 'undeliverable',
  131030: 'notAllowedList',
  131047: 'reengagement',
  131049: 'ecosystemDecline',
  // Midia
  131051: 'media',
  131052: 'media',
  131053: 'media',
  // Limites
  4: 'rateLimited',
  17: 'rateLimited',
  32: 'rateLimited',
  613: 'rateLimited',
  80007: 'rateLimited',
  130429: 'rateLimited',
  131056: 'rateLimited',
  // Templates
  132000: 'templateParams',
  132001: 'templateNotFound',
  132005: 'templateParams',
  132007: 'templatePaused',
  132012: 'templateParams',
  132015: 'templatePaused',
  132016: 'templatePaused',
  132018: 'templateParams',
  // Registro do numero
  133000: 'registration',
  133005: 'registration',
  133006: 'registration',
  133008: 'registration',
  133009: 'registration',
  133010: 'registration',
  133015: 'registration',
  133016: 'registration',
  // Transitorios
  1: 'temporary',
  2: 'temporary',
  131000: 'temporary',
  131016: 'temporary',
  131057: 'temporary',
  133004: 'temporary',
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