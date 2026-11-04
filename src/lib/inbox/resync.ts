/**
 * Tempo mínimo com a aba escondida para aceitar um refetch ao voltar.
 * Abas em background podem perder eventos de Realtime, mas um alt-tab
 * de segundos não justifica recarregar lista e thread inteiras.
 */
export const RESYNC_AFTER_HIDDEN_MS = 60_000;

export function shouldResyncOnVisible(hiddenForMs: number): boolean {
  return hiddenForMs >= RESYNC_AFTER_HIDDEN_MS;
}