// ============================================================
// Provider-layer error.
//
// Separate from `SendMessageError` (src/lib/whatsapp/send-message.ts)
// on purpose: the provider layer must not import the send core — the
// core imports the provider layer, and a cycle would break the
// bundler. The core translates a ProviderError into a SendMessageError
// at its boundary.
// ============================================================

export class ProviderError extends Error {
  readonly code: string;
  readonly status: number;
  readonly raw?: unknown;

  constructor(code: string, message: string, status: number, raw?: unknown) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
    this.raw = raw;
  }
}
