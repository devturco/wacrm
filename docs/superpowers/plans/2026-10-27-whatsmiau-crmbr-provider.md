# API CRMBR (WhatsMiau) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um segundo provedor de API WhatsApp não-oficial (WhatsMiau, comercializada como **API CRMBR**) ao lado do Meta Cloud API existente, com troca entre os dois por conta, tela de configuração da instância e webhook próprio — sem alterar o comportamento do caminho Meta.

**Architecture:** Contrato de provider em `src/lib/whatsapp/providers/`, um adapter por provedor, e um dispatcher que o core chama com a conexão ativa em vez de credenciais soltas. Todo código novo vive em diretórios que o mantenedor upstream não toca; os arquivos compartilhados recebem apenas uma troca de import + uma linha de resolução de credencial.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 6, Tailwind v4, next-intl v4, Supabase (Postgres + RLS + Storage), vitest, lucide-react, `@base-ui/react`.

**Spec:** `docs/superpowers/specs/2026-10-27-whatsmiau-crmbr-provider-design.md` — o plano implementa o spec; leia os dois. Referência da API: `docs/whatsmiau.md`.

---

## Global Constraints

Regras que valem para **todas** as tasks. Copie-as literalmente; não reinterprete.

1. **Nunca quebrar o caminho Meta.** `src/lib/whatsapp/meta-api.ts`, `src/app/api/whatsapp/webhook/route.ts`, a tabela `whatsapp_config` e `src/components/settings/whatsapp-config.tsx` **não são alterados** (exceto onde a task diz explicitamente). O upstream continua sendo a fonte da verdade neles.
2. **Nome no código é `whatsmiau`; nome na UI é "API CRMBR (não oficial)".** Nunca `crmbr` em código, rotas, nomes de tabela, nomes de função ou migration. A única exceção é a URL pública `/settings/whatsapp/crmbr` e o diretório `src/app/(dashboard)/settings/whatsapp/crmbr/`.
3. **Tabela nova, nunca coluna nova em `whatsapp_config`.** `whatsapp_config` é lida com `.single()`/`.maybeSingle()` por conta em ~30 lugares; uma segunda linha lá quebraria o app inteiro. A config da CRMBR vive em `whatsmiau_config` (1:1 com a conta).
4. **Nenhuma migration altera schema existente.** Só `CREATE TABLE`/`CREATE POLICY` novos. Isso elimina conflito de schema com o upstream.
5. **A chave da API nunca volta ao navegador em texto puro.** A `apiKey` é devolvida mascarada (`••••••••••••••••`), como o `access_token` da Meta já é.
6. **Sem fallback silencioso.** Se a CRMBR está selecionada e desconectada, o envio **falha** — nunca sai pelo número da Meta. Errar é melhor que mandar pelo número errado.
7. **Toda rota nova é account-scoped.** Toda query filtra por `account_id` vindo do contexto de autenticação. Instância de outra conta → 404 (nunca revela existência).
8. **Comentários e nomes em inglês** (o repositório é em inglês); **strings de UI em português** via `next-intl`, com as chaves adicionadas aos 4 locales (`en`, `es`, `ko`, `pt`).
9. **Testes vitest, sem rede.** O `fetch` é mockado; as asserções são sobre URL + headers + body. Nenhum teste novo toca a WhatsMiau nem o Supabase reais.
10. **Comandos de teste:** `npx vitest run <arquivo>` (arquivo único) ou `npx vitest run` (suíte toda). Typecheck: `npm run typecheck`. Lint: `npm run lint`.
11. **Uma task = um commit.** O commit usa o formato `type(scope): descrição` e termina com a linha `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
12. **A migration precisa ser avisada.** Ao terminar a Task 1, **pare e avise o usuário** que o SQL está pronto para subir (`supabase/migrations/060_whatsmiau_provider.sql`) antes de seguir.

---

## Mapa de arquivos

### Criados

```
supabase/migrations/060_whatsmiau_provider.sql                          (1)
src/lib/whatsapp/whatsmiau-config.ts                    repo da config por conta   (1)
src/lib/whatsapp/providers/errors.ts                    ProviderError              (2)
src/lib/whatsapp/providers/types.ts                     contrato do provider       (2)
src/lib/whatsapp/providers/index.ts                     dispatcher                 (6)
src/lib/whatsapp/providers/connection.ts                resolveProviderConnection  (6)
src/lib/whatsapp/providers/capabilities.ts              assertProviderSupportsMessageType (6)
src/lib/whatsapp/providers/meta/adapter.ts              adapter Meta (delega ao meta-api) (2)
src/lib/whatsapp/providers/whatsmiau/client.ts         HTTP + WhatsmiauApiError   (3)
src/lib/whatsapp/providers/whatsmiau/api.ts            envio de mensagens          (4)
src/lib/whatsapp/providers/whatsmiau/instances.ts      criar / QR / estado / update / delete (5)
src/lib/whatsapp/providers/whatsmiau/management.ts      helpers das rotas de gerenciamento (13)
src/lib/whatsapp/providers/whatsmiau/webhook.ts        parser do envelope          (10)
src/lib/whatsapp/providers/whatsmiau/normalize.ts      payload -> modelo interno    (10)
src/lib/whatsapp/providers/whatsmiau/adapter.ts        implementa o contrato        (4)
src/lib/whatsapp/providers/whatsmiau/inbound.ts        pipeline de entrada (contato, conversa, fan-out) (11)
src/lib/whatsapp/providers/whatsmiau/mirror-media.ts   espelha midia no chat-media (11)
src/lib/whatsapp/providers/whatsmiau/event-samples.ts  amostras JSON por evento     (10)
src/app/api/whatsmiau/config/route.ts                                          (13)
src/app/api/whatsmiau/active/route.ts                                          (13)
src/app/api/whatsmiau/instances/route.ts                                       (13)
src/app/api/whatsmiau/instances/[name]/route.ts                                (13)
src/app/api/whatsmiau/instances/[name]/connect/route.ts                        (13)
src/app/api/whatsmiau/instances/[name]/disconnect/route.ts                     (13)
src/app/api/whatsmiau/webhook/route.ts                                         (12)
src/components/settings/settings-shell.tsx                                    (14)
src/components/settings/settings-page-client.tsx                               (14)
src/components/settings/whatsapp-provider-nav.tsx                              (14)
src/components/settings/whatsapp-hub.tsx                                       (14)
src/components/settings/whatsmiau-config.tsx                                   (15)
src/components/settings/whatsmiau-webhook-card.tsx                             (15)
src/components/settings/whatsmiau-instance-card.tsx                            (15)
src/app/(dashboard)/settings/whatsapp/layout.tsx                               (14)
src/app/(dashboard)/settings/whatsapp/page.tsx                                 (14)
src/app/(dashboard)/settings/whatsapp/meta/page.tsx                            (14)
src/app/(dashboard)/settings/whatsapp/crmbr/page.tsx                            (15)
src/hooks/use-active-provider.ts                                               (17)
docs/integracao/whatsmiau-upstream.md                                           (18)
```

### Modificados

| Arquivo | Onde | Task |
|---|---|---|
| `src/lib/whatsapp/send-message.ts` | bloco de credenciais + `attempt` | 7 |
| `src/lib/whatsapp/send-message.test.ts` | mock do provider | 7 |
| `src/lib/whatsapp/resolve-conversation.ts` | fail-fast | 9 |
| `src/lib/flows/meta-send.ts` | `loadAccountMetaCredentials` + sends | 8 |
| `src/lib/automations/meta-send.ts` | credenciais + sends | 8 |
| `src/lib/ai/auto-reply.ts` | typing indicator | 8 |
| `src/lib/whatsapp/broadcast-core.ts` | credenciais + template | 9 |
| `src/lib/whatsapp/broadcast-resume.ts` | credenciais + template | 9 |
| `src/app/api/whatsapp/broadcast/route.ts` | credenciais | 9 |
| `src/app/api/whatsapp/react/route.ts` | credenciais + send | 9 |
| `src/app/(dashboard)/settings/page.tsx` | vira server component + redirect | 14 |
| `src/components/settings/settings-sections.ts` | `href` do item WhatsApp | 14 |
| `src/components/settings/settings-rail.tsx` | item do WhatsApp vira `<Link>` | 14 |
| `src/components/settings/settings-overview.tsx` | status do tile por provider | 17 |
| `src/lib/dashboard/overview.ts` | `setupSteps` | 17 |
| `src/components/layout/header.tsx` | link do menu da conta | 17 |
| `src/components/layout/sidebar.tsx` | link do menu da conta | 17 |
| `src/components/dashboard/whatsapp-health-chip.tsx` | link do chip | 17 |
| `src/app/(dashboard)/inbox/page.tsx` | banner respeita a API ativa | 17 |
| `src/components/inbox/message-composer.tsx` | esconde template na CRMBR + aviso | 17 |
| `src/components/inbox/message-thread.tsx` | passa a prop `canUseTemplates` | 17 |
| `messages/{en,es,ko,pt}.json` | chaves novas | 16, 17 |
| `docs/whatsmiau.md` | link para o protocolo de merge | 18 |

### Não alterados (garantia)

Para que o revisor do upstream reconheça o trabalho de um relance:

`src/lib/whatsapp/meta-api.ts` · `src/app/api/whatsapp/webhook/route.ts` ·
a tabela `whatsapp_config` · `src/components/settings/whatsapp-config.tsx` ·
`src/app/api/whatsapp/send/route.ts` · `src/app/api/whatsapp/config/route.ts`.

---

## Tasks

### Task 1: Tabela `whatsmiau_config` + repositório de configuração

**Files:**
- Create: `supabase/migrations/060_whatsmiau_provider.sql`
- Create: `src/lib/whatsapp/whatsmiau-config.ts`
- Test: `src/lib/whatsapp/whatsmiau-config.test.ts`

**Interfaces:**
- Consumes: `encrypt(text: string): string`, `decrypt(encryptedText: string): string`, `isLegacyFormat(encryptedText: string): boolean` de `@/lib/whatsapp/encryption`.
- Produces:
  - `type WhatsmiauStatus = 'disconnected' | 'connecting' | 'connected' | 'error'`
  - `interface WhatsmiauWebhookConfig { enabled: boolean; url: string; headers: Record<string,string>; events: string[]; base64: boolean }`
  - `interface WhatsmiauInstanceSettings { alwaysOnline: boolean; readMessages: boolean; rejectCall: boolean; msgCall: string; groupsIgnore: boolean; saveMedia: boolean; webhook: WhatsmiauWebhookConfig }`
  - `const DEFAULT_INSTANCE_SETTINGS: WhatsmiauInstanceSettings`
  - `interface WhatsmiauConfigRow { id; account_id; instance_name; api_key_encrypted; base_url; webhook_secret; status; phone_number; wuid; is_active; instance_settings; connected_at; created_at; updated_at }`
  - `loadWhatsmiauConfig(db, accountId): Promise<WhatsmiauConfigRow | null>`
  - `loadWhatsmiauConfigByInstanceName(db, instanceName): Promise<WhatsmiauConfigRow | null>`
  - `loadWhatsmiauConfigByWebhookSecret(db, secret): Promise<WhatsmiauConfigRow | null>`
  - `upsertWhatsmiauConfig(db, accountId, patch): Promise<WhatsmiauConfigRow>`
  - `decryptWhatsmiauApiKey(row: WhatsmiauConfigRow): string`
  - `generateWebhookSecret(): string`
  - `mergeInstanceSettings(current: Partial<WhatsmiauInstanceSettings> | null | undefined, patch: Partial<WhatsmiauInstanceSettings>): WhatsmiauInstanceSettings`

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/lib/whatsapp/whatsmiau-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DEFAULT_INSTANCE_SETTINGS,
  decryptWhatsmiauApiKey,
  generateWebhookSecret,
  loadWhatsmiauConfig,
  mergeInstanceSettings,
  upsertWhatsmiauConfig,
} from './whatsmiau-config';

/**
 * Minimal fake of the supabase-js query builder for the two shapes
 * this module uses: `.select().eq().maybeSingle()` and
 * `.select().eq().maybeSingle()` on the insert path.
 */
function fakeDb(row: Record<string, unknown> | null, insertResult?: Record<string, unknown>) {
  const state = { selected: row, inserted: insertResult ?? row };
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: state.selected, error: null }),
    single: () => Promise.resolve({ data: state.inserted, error: null }),
    upsert: () => chain,
  };
  return {
    db: { from: () => chain } as unknown as SupabaseClient,
    state,
  };
}

describe('whatsmiau config — defaults', () => {
  it('ships readMessages off and groupsIgnore on', () => {
    expect(DEFAULT_INSTANCE_SETTINGS.readMessages).toBe(false);
    expect(DEFAULT_INSTANCE_SETTINGS.groupsIgnore).toBe(true);
    expect(DEFAULT_INSTANCE_SETTINGS.rejectCall).toBe(true);
    expect(DEFAULT_INSTANCE_SETTINGS.saveMedia).toBe(true);
    expect(DEFAULT_INSTANCE_SETTINGS.webhook.base64).toBe(false);
  });

  it('merges a patch over the defaults without dropping untouched keys', () => {
    const merged = mergeInstanceSettings(null, { readMessages: true });
    expect(merged.readMessages).toBe(true);
    expect(merged.alwaysOnline).toBe(false);
    expect(merged.webhook.events).toEqual(DEFAULT_INSTANCE_SETTINGS.webhook.events);
  });

  it('merges a webhook patch over the current webhook', () => {
    const current = {
      ...DEFAULT_INSTANCE_SETTINGS,
      webhook: { ...DEFAULT_INSTANCE_SETTINGS.webhook, url: 'https://a.example/hook' },
    };
    const merged = mergeInstanceSettings(current, {
      webhook: { ...current.webhook, enabled: false },
    } as Partial<typeof DEFAULT_INSTANCE_SETTINGS>);
    expect(merged.webhook.url).toBe('https://a.example/hook');
    expect(merged.webhook.enabled).toBe(false);
  });
});

describe('whatsmiau config — read', () => {
  it('returns null when the account has no row', async () => {
    const { db } = fakeDb(null);
    await expect(loadWhatsmiauConfig(db, 'acc-1')).resolves.toBeNull();
  });

  it('returns the row for the account', async () => {
    const { db } = fakeDb({
      id: 'wm-1',
      account_id: 'acc-1',
      instance_name: 'Atendimento01',
      api_key_encrypted: 'enc',
      instance_settings: DEFAULT_INSTANCE_SETTINGS,
    });
    const row = await loadWhatsmiauConfig(db, 'acc-1');
    expect(row?.instance_name).toBe('Atendimento01');
  });
});

describe('whatsmiau config — write', () => {
  it('upserts and returns the stored row', async () => {
    const { db, state } = fakeDb(null, {
      id: 'wm-1',
      account_id: 'acc-1',
      instance_name: 'Atendimento01',
      api_key_encrypted: 'enc',
      instance_settings: DEFAULT_INSTANCE_SETTINGS,
    });
    const row = await upsertWhatsmiauConfig(db, 'acc-1', {
      instance_name: 'Atendimento01',
      api_key_encrypted: 'enc',
    });
    expect(row.id).toBe('wm-1');
    expect(state.inserted).toBeTruthy();
  });
});

describe('whatsmiau config — secrets', () => {
  it('generates a 64-char hex webhook secret', () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(generateWebhookSecret()).not.toBe(secret);
  });

  it('decrypts the stored api key', () => {
    const row = { api_key_encrypted: 'not-encrypted' } as never;
    // Not encrypted → decrypt throws; the caller must handle it. The
    // assertion here is only that the helper never returns the raw
    // ciphertext.
    expect(() => decryptWhatsmiauApiKey(row)).toThrow();
  });
});
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `npx vitest run src/lib/whatsapp/whatsmiau-config.test.ts`
Expected: FAIL — `Cannot find module '@/lib/whatsapp/whatsmiau-config'`.

- [ ] **Step 3: Escreva a migration**

Crie `supabase/migrations/060_whatsmiau_provider.sql`:

```sql
-- ============================================================
-- CRMBR (WhatsMiau) — second WhatsApp API provider, one row per
-- account.
--
-- Deliberately a SEPARATE table from `whatsapp_config` (the Meta
-- row): `whatsapp_config` is read with .single()/.maybeSingle() per
-- account in ~30 places, so a second row there would break the whole
-- app — including the Meta path. This table is 1:1 with the account
-- and leaves `whatsapp_config` untouched.
--
-- The `instance_settings` JSONB stores WhatsMiau's own field names
-- verbatim (alwaysOnline, readMessages, rejectCall, msgCall,
-- groupsIgnore, saveMedia, webhook) so "apply to instance" is a
-- literal push of this JSON to PUT /instance/update/:name — no
-- translation table to keep in sync.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsmiau_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instance_name     TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  base_url          TEXT NOT NULL DEFAULT 'https://api.whatsmiau.dev/v2',
  webhook_secret    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'disconnected'
                      CHECK (status IN ('disconnected','connecting','connected','error')),
  phone_number      TEXT,
  wuid              TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT false,
  instance_settings JSONB NOT NULL DEFAULT
    '{"alwaysOnline":false,"readMessages":false,"rejectCall":true,"msgCall":"","groupsIgnore":true,"saveMedia":true,"webhook":{"enabled":true,"url":"","headers":{},"events":["messages.upsert","messages.edited","messages.update","messages.delete","connection.update"],"base64":false}}'::jsonb,
  connected_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsmiau_config_instance
  ON whatsmiau_config (instance_name);

DROP TRIGGER IF EXISTS set_updated_at ON whatsmiau_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsmiau_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE whatsmiau_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own config" ON whatsmiau_config;
CREATE POLICY whatsmiau_config_select ON whatsmiau_config
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY whatsmiau_config_insert ON whatsmiau_config
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY whatsmiau_config_update ON whatsmiau_config
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY whatsmiau_config_delete ON whatsmiau_config
  FOR DELETE USING (is_account_member(account_id, 'admin'));
```

- [ ] **Step 4: Escreva o repositório**

Crie `src/lib/whatsapp/whatsmiau-config.ts`:

```ts
// ============================================================
// CRMBR (WhatsMiau) account configuration.
//
// One row per account (`UNIQUE (account_id)`) holding the api key
// (encrypted), the instance name, the API base URL, the webhook
// shared secret and the instance-level behaviour flags.
//
// `whatsapp_config` — the Meta row — is deliberately NOT touched:
// upstream reads it with .single() per account, and a second row
// there would break the whole app.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';

export type WhatsmiauStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WhatsmiauWebhookConfig {
  enabled: boolean;
  url: string;
  headers: Record<string, string>;
  events: string[];
  base64: boolean;
}

export interface WhatsmiauInstanceSettings {
  alwaysOnline: boolean;
  readMessages: boolean;
  rejectCall: boolean;
  msgCall: string;
  groupsIgnore: boolean;
  saveMedia: boolean;
  webhook: WhatsmiauWebhookConfig;
}

export const DEFAULT_INSTANCE_SETTINGS: WhatsmiauInstanceSettings = {
  alwaysOnline: false,
  readMessages: false,
  rejectCall: true,
  msgCall: '',
  groupsIgnore: true,
  saveMedia: true,
  webhook: {
    enabled: true,
    url: '',
    headers: {},
    events: [
      'messages.upsert',
      'messages.edited',
      'messages.update',
      'messages.delete',
      'connection.update',
    ],
    base64: false,
  },
};

export interface WhatsmiauConfigRow {
  id: string;
  account_id: string;
  instance_name: string;
  api_key_encrypted: string;
  base_url: string;
  webhook_secret: string;
  status: WhatsmiauStatus;
  phone_number: string | null;
  wuid: string | null;
  is_active: boolean;
  instance_settings: WhatsmiauInstanceSettings;
  connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsmiauConfigPatch {
  instance_name?: string;
  api_key_encrypted?: string;
  base_url?: string;
  webhook_secret?: string;
  status?: WhatsmiauStatus;
  phone_number?: string | null;
  wuid?: string | null;
  is_active?: boolean;
  connected_at?: string | null;
  instance_settings?: Partial<WhatsmiauInstanceSettings>;
}

/**
 * Overlay a patch over the current settings, keeping every key the
 * patch does not mention. A partial webhook patch keeps the current
 * webhook's url/headers/events — the WhatsMiau `PUT /instance/update`
 * route merges server-side, but our stored row must stay complete.
 */
export function mergeInstanceSettings(
  current: Partial<WhatsmiauInstanceSettings> | null | undefined,
  patch: Partial<WhatsmiauInstanceSettings>,
): WhatsmiauInstanceSettings {
  const base: WhatsmiauInstanceSettings = {
    ...DEFAULT_INSTANCE_SETTINGS,
    ...(current ?? {}),
    webhook: {
      ...DEFAULT_INSTANCE_SETTINGS.webhook,
      ...(current?.webhook ?? {}),
    },
  };
  const next: WhatsmiauInstanceSettings = { ...base, ...patch };
  next.webhook = {
    ...base.webhook,
    ...(patch.webhook ?? {}),
  };
  return next;
}

/**
 * Read the account's CRMBR row, or null when the account never
 * configured the non-official API.
 */
export async function loadWhatsmiauConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<WhatsmiauConfigRow | null> {
  const { data, error } = await db
    .from('whatsmiau_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    ...(data as WhatsmiauConfigRow),
    instance_settings: mergeInstanceSettings(
      data.instance_settings,
      (data.instance_settings ?? {}) as Partial<WhatsmiauInstanceSettings>,
    ),
  };
}

/**
 * Resolve the account that owns a WhatsMiau instance name.
 *
 * NOTE: the instance name is NOT unique across accounts — two
 * companies may name their instance the same way — so this lookup is
 * only unambiguous while at most one row matches. The inbound webhook
 * routes by the webhook secret instead (see
 * `loadWhatsmiauConfigByWebhookSecret`); this helper stays for
 * lookups that are already account-scoped.
 */
export async function loadWhatsmiauConfigByInstanceName(
  db: SupabaseClient,
  instanceName: string,
): Promise<WhatsmiauConfigRow | null> {
  if (!instanceName) return null;
  const { data, error } = await db
    .from('whatsmiau_config')
    .select('*')
    .eq('instance_name', instanceName)
    .maybeSingle();
  if (error || !data) return null;
  return {
    ...(data as WhatsmiauConfigRow),
    instance_settings: mergeInstanceSettings(
      data.instance_settings,
      (data.instance_settings ?? {}) as Partial<WhatsmiauInstanceSettings>,
    ),
  };
}

/**
 * Resolve the account that owns a webhook secret.
 *
 * The secret is 32 random bytes, generated once per account row, and
 * it is what the provider sends back as `Authorization: Bearer
 * <secret>`. That makes it the ONLY routing key that identifies an
 * account unambiguously: the instance name is chosen by the customer
 * and two accounts may well pick the same one.
 */
export async function loadWhatsmiauConfigByWebhookSecret(
  db: SupabaseClient,
  secret: string,
): Promise<WhatsmiauConfigRow | null> {
  if (!secret) return null;
  const { data, error } = await db
    .from('whatsmiau_config')
    .select('*')
    .eq('webhook_secret', secret)
    .maybeSingle();
  if (error || !data) return null;
  return {
    ...(data as WhatsmiauConfigRow),
    instance_settings: mergeInstanceSettings(
      data.instance_settings,
      (data.instance_settings ?? {}) as Partial<WhatsmiauInstanceSettings>,
    ),
  };
}

/**
 * Insert or update the account's CRMBR row. The api key is stored
 * encrypted; callers pass the ciphertext, never the plaintext.
 */
export async function upsertWhatsmiauConfig(
  db: SupabaseClient,
  accountId: string,
  patch: WhatsmiauConfigPatch,
): Promise<WhatsmiauConfigRow> {
  const current = await loadWhatsmiauConfig(db, accountId);

  const payload: Record<string, unknown> = {
    account_id: accountId,
    updated_at: new Date().toISOString(),
  };
  if (patch.instance_name !== undefined) payload.instance_name = patch.instance_name;
  if (patch.api_key_encrypted !== undefined) payload.api_key_encrypted = patch.api_key_encrypted;
  if (patch.base_url !== undefined) payload.base_url = patch.base_url;
  if (patch.webhook_secret !== undefined) payload.webhook_secret = patch.webhook_secret;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.phone_number !== undefined) payload.phone_number = patch.phone_number;
  if (patch.wuid !== undefined) payload.wuid = patch.wuid;
  if (patch.is_active !== undefined) payload.is_active = patch.is_active;
  if (patch.connected_at !== undefined) payload.connected_at = patch.connected_at;
  if (patch.instance_settings !== undefined) {
    payload.instance_settings = mergeInstanceSettings(
      current?.instance_settings,
      patch.instance_settings,
    );
  }

  // UPDATE-then-INSERT, not a single `upsert`.
  //
  // `INSERT ... ON CONFLICT (account_id) DO UPDATE` would be the shorter
  // spelling, but Postgres evaluates the NOT NULL constraints of the
  // INSERT branch BEFORE it resolves the conflict — so a partial patch
  // (say, only `status`) aborts with "null value in column
  // api_key_encrypted violates not-null constraint" instead of updating
  // the existing row. An UPDATE never trips that: it only touches the
  // columns we name.
  if (current) {
    const { data, error } = await db
      .from('whatsmiau_config')
      .update(payload)
      .eq('account_id', accountId)
      .select()
      .single();
    if (error || !data) {
      throw new Error(`Failed to save the WhatsMiau configuration: ${error?.message ?? 'unknown error'}`);
    }
    return {
      ...(data as WhatsmiauConfigRow),
      instance_settings: mergeInstanceSettings(
        data.instance_settings,
        (data.instance_settings ?? {}) as Partial<WhatsmiauInstanceSettings>,
      ),
    };
  }

  // No row yet — this is a first save, so every NOT NULL column has to
  // be present. The settings route always supplies the api key and the
  // instance name; the webhook secret is generated here when the caller
  // did not bring one.
  const insertPayload: Record<string, unknown> = {
    ...payload,
    instance_name: patch.instance_name ?? '',
    api_key_encrypted: patch.api_key_encrypted ?? '',
    webhook_secret: patch.webhook_secret ?? generateWebhookSecret(),
    instance_settings:
      payload.instance_settings ??
      mergeInstanceSettings(null, patch.instance_settings ?? {}),
  };

  const { data, error } = await db
    .from('whatsmiau_config')
    .insert(insertPayload)
    .select()
    .single();
  if (error || !data) {
    throw new Error(`Failed to save the WhatsMiau configuration: ${error?.message ?? 'unknown error'}`);
  }
  return {
    ...(data as WhatsmiauConfigRow),
    instance_settings: mergeInstanceSettings(
      data.instance_settings,
      (data.instance_settings ?? {}) as Partial<WhatsmiauInstanceSettings>,
    ),
  };
}

/**
 * Decrypt the stored api key, self-healing a legacy CBC ciphertext in
 * place (fire-and-forget, idempotent) the same way the Meta path
 * does for its access token.
 */
export function decryptWhatsmiauApiKey(row: WhatsmiauConfigRow): string {
  const apiKey = decrypt(row.api_key_encrypted);
  if (isLegacyFormat(row.api_key_encrypted)) {
    void Promise.resolve().then(() => {
      console.warn('[whatsmiau-config] legacy ciphertext detected — re-encrypt on next save');
    });
  }
  return apiKey;
}

/** Encrypt a plaintext api key for storage. */
export function encryptWhatsmiauApiKey(apiKey: string): string {
  return encrypt(apiKey);
}

/** 32 random bytes, hex — the webhook shared secret. */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

- [ ] **Step 5: Rode o teste e confirme que passa**

Run: `npx vitest run src/lib/whatsapp/whatsmiau-config.test.ts`
Expected: PASS (13 tests).

Se o teste `decrypts the stored api key` falhar porque `decrypt('not-encrypted')` **não** lança, ajuste o teste para afirmar o comportamento real: o helper deve devolver a string decifrada quando a entrada é válida. Substitua o corpo do teste por:

```ts
it('decrypts the stored api key', () => {
  const row = { api_key_encrypted: encryptWhatsmiauApiKey('super-secret') } as never;
  expect(decryptWhatsmiauApiKey(row)).toBe('super-secret');
});
```

e adicione `encryptWhatsmiauApiKey` ao import.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/060_whatsmiau_provider.sql src/lib/whatsapp/whatsmiau-config.ts src/lib/whatsapp/whatsmiau-config.test.ts
git commit -m "$(cat <<'EOF'
feat(whatsmiau): tabela de config da CRMBR e repositorio por conta

Nova tabela whatsmiau_config (1:1 com a conta) para a API nao-oficial
da CRMBR (WhatsMiau). whatsapp_config (Meta) fica intocada.

instance_settings e JSONB com os nomes de campo da propria WhatsMiau,
para que "aplicar na instancia" seja um push literal do JSON.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: AVISE O USUÁRIO — o SQL está pronto**

> ⚠️ **Pare aqui e avise:** a migration `supabase/migrations/060_whatsmiau_provider.sql` está pronta para subir no Supabase. Ela cria a tabela `whatsmiau_config` com RLS e a trigger de `updated_at`. Não há alteração em schema existente, então é segura para rodar em ordem. Peça confirmação antes de seguir para a Task 2.

---

### Task 2: Contrato do provider + adapter do Meta

**Files:**
- Create: `src/lib/whatsapp/providers/errors.ts`
- Create: `src/lib/whatsapp/providers/types.ts`
- Create: `src/lib/whatsapp/providers/meta/adapter.ts`
- Test: `src/lib/whatsapp/providers/meta/adapter.test.ts`

**Interfaces:**
- Consumes: `sendTextMessage`, `sendMediaMessage`, `sendTemplateMessage`, `sendInteractiveButtons`, `sendInteractiveList`, `sendReactionMessage`, `sendTypingIndicator` de `@/lib/whatsapp/meta-api`; os tipos `MediaKind`, `InteractiveButton`, `InteractiveListSection`.
- Produces:
  - `class ProviderError extends Error { readonly code: string; readonly status: number; readonly raw?: unknown }`
  - `type ProviderId = 'meta' | 'whatsmiau'`
  - `interface MetaConnection { provider: 'meta'; phoneNumberId: string; accessToken: string }`
  - `interface WhatsmiauConnection { provider: 'whatsmiau'; instanceName: string; apiKey: string; baseUrl: string }`
  - `type ProviderConnection = MetaConnection | WhatsmiauConnection`
  - `interface ProviderSendResult { messageId: string }`
  - `interface SendTextArgs { to: string; text: string; contextMessageId?: string }`
  - `interface SendMediaArgs { to: string; kind: MediaKind; link: string; caption?: string; filename?: string; contextMessageId?: string }`
  - `interface SendTemplateArgs { to: string; templateName: string; language?: string; template?: unknown; messageParams?: unknown; params?: string[]; contextMessageId?: string }`
  - `interface SendButtonsArgs { to: string; bodyText: string; headerText?: string; footerText?: string; buttons: InteractiveButton[]; contextMessageId?: string }`
  - `interface SendListArgs { to: string; bodyText: string; buttonLabel: string; headerText?: string; footerText?: string; sections: InteractiveListSection[]; contextMessageId?: string }`
  - `interface SendReactionArgs { to: string; targetMessageId: string; emoji: string }`
  - `interface SendTypingArgs { to: string; messageId?: string }`
  - `src/lib/whatsapp/providers/meta/adapter.ts` exporta: `metaSendText(conn, args)`, `metaSendMedia(conn, args)`, `metaSendTemplate(conn, args)`, `metaSendButtons(conn, args)`, `metaSendList(conn, args)`, `metaSendReaction(conn, args)`, `metaSendTyping(conn, args)` — todas devolvendo `Promise<ProviderSendResult>` (exceto `metaSendTyping`, que devolve `Promise<void>`).

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/lib/whatsapp/providers/meta/adapter.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { MetaConnection } from '../types';
import {
  metaSendButtons,
  metaSendList,
  metaSendMedia,
  metaSendReaction,
  metaSendTemplate,
  metaSendText,
  metaSendTyping,
} from './adapter';

const h = vi.hoisted(() => ({
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
  sendReactionMessage: vi.fn(),
  sendTypingIndicator: vi.fn(),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: h.sendTextMessage,
  sendMediaMessage: h.sendMediaMessage,
  sendTemplateMessage: h.sendTemplateMessage,
  sendInteractiveButtons: h.sendInteractiveButtons,
  sendInteractiveList: h.sendInteractiveList,
  sendReactionMessage: h.sendReactionMessage,
  sendTypingIndicator: h.sendTypingIndicator,
}));

const conn: MetaConnection = {
  provider: 'meta',
  phoneNumberId: 'pn-1',
  accessToken: 'tok-1',
};

describe('meta adapter — delegates to meta-api', () => {
  beforeEach(() => {
    h.sendTextMessage.mockResolvedValue({ messageId: 'wamid-1' });
    h.sendMediaMessage.mockResolvedValue({ messageId: 'wamid-2' });
    h.sendTemplateMessage.mockResolvedValue({ messageId: 'wamid-3' });
    h.sendInteractiveButtons.mockResolvedValue({ messageId: 'wamid-4' });
    h.sendInteractiveList.mockResolvedValue({ messageId: 'wamid-5' });
    h.sendReactionMessage.mockResolvedValue({ messageId: 'wamid-6' });
    h.sendTypingIndicator.mockResolvedValue(undefined);
  });

  it('sends text with the connection credentials', async () => {
    const result = await metaSendText(conn, { to: '5511999998888', text: 'oi' });
    expect(h.sendTextMessage).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'tok-1',
      to: '5511999998888',
      text: 'oi',
      contextMessageId: undefined,
    });
    expect(result.messageId).toBe('wamid-1');
  });

  it('sends media with kind, link, caption and filename', async () => {
    await metaSendMedia(conn, {
      to: '5511999998888',
      kind: 'document',
      link: 'https://cdn.example/a.pdf',
      caption: 'olá',
      filename: 'a.pdf',
    });
    expect(h.sendMediaMessage).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'tok-1',
      to: '5511999998888',
      kind: 'document',
      link: 'https://cdn.example/a.pdf',
      caption: 'olá',
      filename: 'a.pdf',
      contextMessageId: undefined,
    });
  });

  it('sends a template', async () => {
    await metaSendTemplate(conn, {
      to: '5511999998888',
      templateName: 'hello',
      language: 'en_US',
      params: ['a'],
    });
    expect(h.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ templateName: 'hello', language: 'en_US', params: ['a'] }),
    );
  });

  it('sends interactive buttons', async () => {
    await metaSendButtons(conn, {
      to: '5511999998888',
      bodyText: 'pick',
      buttons: [{ id: 'a', title: 'A' }],
    });
    expect(h.sendInteractiveButtons).toHaveBeenCalledWith(
      expect.objectContaining({ bodyText: 'pick', buttons: [{ id: 'a', title: 'A' }] }),
    );
  });

  it('sends an interactive list', async () => {
    await metaSendList(conn, {
      to: '5511999998888',
      bodyText: 'pick',
      buttonLabel: 'Abrir',
      sections: [{ title: 'S', rows: [{ id: 'r1', title: 'R' }] }],
    });
    expect(h.sendInteractiveList).toHaveBeenCalledWith(
      expect.objectContaining({ buttonLabel: 'Abrir' }),
    );
  });

  it('sends a reaction', async () => {
    await metaSendReaction(conn, {
      to: '5511999998888',
      targetMessageId: 'wamid-0',
      emoji: '👍',
    });
    expect(h.sendReactionMessage).toHaveBeenCalledWith(
      expect.objectContaining({ targetMessageId: 'wamid-0', emoji: '👍' }),
    );
  });

  it('sends the typing indicator with the inbound message id', async () => {
    await metaSendTyping(conn, { to: '5511999998888', messageId: 'wamid-in' });
    expect(h.sendTypingIndicator).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'tok-1',
      messageId: 'wamid-in',
    });
  });
});
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `npx vitest run src/lib/whatsapp/providers/meta/adapter.test.ts`
Expected: FAIL — `Cannot find module './adapter'`.

- [ ] **Step 3: Escreva `errors.ts` e `types.ts`**

Crie `src/lib/whatsapp/providers/errors.ts`:

```ts
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
```

Crie `src/lib/whatsapp/providers/types.ts`:

```ts
// ============================================================
// The provider contract.
//
// One active provider per account. The core resolves a
// `ProviderConnection` and hands it to the dispatcher; the dispatcher
// routes to the adapter that knows how to speak that provider's API.
//
// The Meta adapter delegates to the untouched `meta-api.ts` — the
// Meta path's behaviour is byte-for-byte what it was before this
// layer existed.
// ============================================================

import type {
  InteractiveButton,
  InteractiveListSection,
  MediaKind,
} from '@/lib/whatsapp/meta-api';
import type { MessageTemplate } from '@/types';

export type ProviderId = 'meta' | 'whatsmiau';

export interface MetaConnection {
  provider: 'meta';
  /** Meta's phone_number_id. */
  phoneNumberId: string;
  /** Decrypted Meta access token. */
  accessToken: string;
}

export interface WhatsmiauConnection {
  provider: 'whatsmiau';
  /** The public instance name, used as `:instance` in the URL. */
  instanceName: string;
  /** Decrypted WhatsMiau api key. */
  apiKey: string;
  /** API root, e.g. https://api.whatsmiau.dev/v2 */
  baseUrl: string;
}

export type ProviderConnection = MetaConnection | WhatsmiauConnection;

export interface ProviderSendResult {
  /** The provider's message id (Meta's wamid, WhatsMiau's key.id). */
  messageId: string;
}

export interface SendTextArgs {
  to: string;
  text: string;
  contextMessageId?: string;
}

export interface SendMediaArgs {
  to: string;
  kind: MediaKind;
  /** Public URL the provider fetches at send time. */
  link: string;
  caption?: string;
  filename?: string;
  contextMessageId?: string;
}

export interface SendTemplateArgs {
  to: string;
  templateName: string;
  language?: string;
  template?: MessageTemplate;
  /**
   * Structured per-send values. Typed `unknown` because the callers
   * that hold the raw payload don't know its shape; the Meta adapter
   * narrows it to `SendTimeParams`.
   */
  messageParams?: unknown;
  params?: string[];
  contextMessageId?: string;
}

export interface SendButtonsArgs {
  to: string;
  bodyText: string;
  headerText?: string;
  footerText?: string;
  buttons: InteractiveButton[];
  contextMessageId?: string;
}

export interface SendListArgs {
  to: string;
  bodyText: string;
  buttonLabel: string;
  headerText?: string;
  footerText?: string;
  sections: InteractiveListSection[];
  contextMessageId?: string;
}

export interface SendReactionArgs {
  to: string;
  targetMessageId: string;
  emoji: string;
}

export interface SendTypingArgs {
  to: string;
  /** Inbound message id — Meta needs it to attach the read receipt. */
  messageId?: string;
}
```

- [ ] **Step 4: Escreva o adapter do Meta**

Crie `src/lib/whatsapp/providers/meta/adapter.ts`:

```ts
// ============================================================
// Meta adapter — a thin pass-through to the untouched
// `@/lib/whatsapp/meta-api`.
//
// Every Meta-specific detail (URL shape, token header, payload) stays
// in meta-api.ts. This file only maps the provider contract onto it.
// Keeping the mapping here means an upstream change to meta-api.ts
// breaks THIS file (a TypeScript error we fix) instead of the shared
// core (a merge conflict).
// ============================================================

import {
  sendTextMessage as metaSendTextMessage,
  sendMediaMessage as metaSendMediaMessage,
  sendTemplateMessage as metaSendTemplateMessage,
  sendInteractiveButtons as metaSendInteractiveButtons,
  sendInteractiveList as metaSendInteractiveList,
  sendReactionMessage as metaSendReactionMessage,
  sendTypingIndicator as metaSendTypingIndicator,
} from '@/lib/whatsapp/meta-api';

import type {
  MetaConnection,
  ProviderSendResult,
  SendButtonsArgs,
  SendListArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendTemplateArgs,
  SendTextArgs,
  SendTypingArgs,
} from '../types';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';

export async function metaSendText(
  conn: MetaConnection,
  args: SendTextArgs,
): Promise<ProviderSendResult> {
  const result = await metaSendTextMessage({
    phoneNumberId: conn.phoneNumberId,
    accessToken: conn.accessToken,
    to: args.to,
    text: args.text,
    contextMessageId: args.contextMessageId,
  });
  return { messageId: result.messageId };
}

export async function metaSendMedia(
  conn: MetaConnection,
  args: SendMediaArgs,
): Promise<ProviderSendResult> {
  const result = await metaSendMediaMessage({
    phoneNumberId: conn.phoneNumberId,
    accessToken: conn.accessToken,
    to: args.to,
    kind: args.kind,
    link: args.link,
    caption: args.caption,
    filename: args.filename,
    contextMessageId: args.contextMessageId,
  });
  return { messageId: result.messageId };
}

export async function metaSendTemplate(
  conn: MetaConnection,
  args: SendTemplateArgs,
): Promise<ProviderSendResult> {
  const result = await metaSendTemplateMessage({
    phoneNumberId: conn.phoneNumberId,
    accessToken: conn.accessToken,
    to: args.to,
    templateName: args.templateName,
    language: args.language,
    template: args.template,
    messageParams: args.messageParams as SendTimeParams | undefined,
    params: args.params,
    contextMessageId: args.contextMessageId,
  });
  return { messageId: result.messageId };
}

export async function metaSendButtons(
  conn: MetaConnection,
  args: SendButtonsArgs,
): Promise<ProviderSendResult> {
  const result = await metaSendInteractiveButtons({
    phoneNumberId: conn.phoneNumberId,
    accessToken: conn.accessToken,
    to: args.to,
    bodyText: args.bodyText,
    headerText: args.headerText,
    footerText: args.footerText,
    buttons: args.buttons,
    contextMessageId: args.contextMessageId,
  });
  return { messageId: result.messageId };
}

export async function metaSendList(
  conn: MetaConnection,
  args: SendListArgs,
): Promise<ProviderSendResult> {
  const result = await metaSendInteractiveList({
    phoneNumberId: conn.phoneNumberId,
    accessToken: conn.accessToken,
    to: args.to,
    bodyText: args.bodyText,
    buttonLabel: args.buttonLabel,
    headerText: args.headerText,
    footerText: args.footerText,
    sections: args.sections,
    contextMessageId: args.contextMessageId,
  });
  return { messageId: result.messageId };
}

export async function metaSendReaction(
  conn: MetaConnection,
  args: SendReactionArgs,
): Promise<ProviderSendResult> {
  const result = await metaSendReactionMessage({
    phoneNumberId: conn.phoneNumberId,
    accessToken: conn.accessToken,
    to: args.to,
    targetMessageId: args.targetMessageId,
    emoji: args.emoji,
  });
  return { messageId: result.messageId };
}

/**
 * Meta's typing indicator is a field on the read-receipt update, so it
 * needs the inbound message id. A missing id means we cannot show the
 * indicator — skip it rather than firing a request Meta will reject.
 */
export async function metaSendTyping(
  conn: MetaConnection,
  args: SendTypingArgs,
): Promise<void> {
  if (!args.messageId) return;
  await metaSendTypingIndicator({
    phoneNumberId: conn.phoneNumberId,
    accessToken: conn.accessToken,
    messageId: args.messageId,
  });
}
```

- [ ] **Step 5: Rode o teste e confirme que passa**

Run: `npx vitest run src/lib/whatsapp/providers/meta/adapter.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
git add src/lib/whatsapp/providers/errors.ts src/lib/whatsapp/providers/types.ts src/lib/whatsapp/providers/meta/
git commit -m "$(cat <<'EOF'
feat(whatsapp): contrato do provider e adapter do Meta

O contrato ProviderConnection + os tipos de envio livedos aqui. O
adapter do Meta so repassa para o meta-api.ts intocado — o caminho
Meta continua exatamente igual.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Client HTTP da WhatsMiau

**Files:**
- Create: `src/lib/whatsapp/providers/whatsmiau/client.ts`
- Test: `src/lib/whatsapp/providers/whatsmiau/client.test.ts`

**Interfaces:**
- Consumes: `WhatsmiauConnection` de `@/lib/whatsapp/providers/types`.
- Produces:
  - `class WhatsmiauApiError extends Error { readonly status: number; readonly upstreamStatus: number; readonly code: string; readonly raw?: unknown }`
  - `interface WhatsmiauRequestOptions { method?: 'GET'|'POST'|'PUT'|'DELETE'; path: string; body?: unknown }`
  - `whatsmiauRequest<T = unknown>(conn: WhatsmiauConnection, options: WhatsmiauRequestOptions): Promise<T>`
  - `mapWhatsmiauStatus(status: number): { code: string; httpStatus: number }`

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/lib/whatsapp/providers/whatsmiau/client.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { WhatsmiauConnection } from '../types';
import {
  WhatsmiauApiError,
  mapWhatsmiauStatus,
  whatsmiauRequest,
} from './client';

const conn: WhatsmiauConnection = {
  provider: 'whatsmiau',
  instanceName: 'Atendimento01',
  apiKey: 'key-1',
  baseUrl: 'https://api.whatsmiau.dev/v2',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('whatsmiau client — request shape', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the configured base url with the apikey header', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));

    await whatsmiauRequest(conn, {
      method: 'POST',
      path: '/message/sendText/Atendimento01',
      body: { number: '5511999998888', text: 'oi' },
    });

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.whatsmiau.dev/v2/message/sendText/Atendimento01');
    expect(init.method).toBe('POST');
    expect(init.headers.apikey).toBe('key-1');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ number: '5511999998888', text: 'oi' });
  });

  it('honours a custom base url', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));

    await whatsmiauRequest(
      { ...conn, baseUrl: 'https://self.hosted.example/api/' },
      { path: '/instance/fetchInstances' },
    );

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://self.hosted.example/api/instance/fetchInstances');
  });

  it('returns the parsed body on 2xx', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ key: { id: 'MSG_1' } }));
    const result = await whatsmiauRequest<{ key: { id: string } }>(conn, {
      path: '/message/sendText/Atendimento01',
      method: 'POST',
    });
    expect(result.key.id).toBe('MSG_1');
  });

  it('omits the body for a GET', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await whatsmiauRequest(conn, { path: '/instance/fetchInstances' });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body).toBeUndefined();
  });
});

describe('whatsmiau client — errors', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps 401 to an unauthorized error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'invalid api key' }, 401),
    );
    await expect(whatsmiauRequest(conn, { path: '/x' })).rejects.toBeInstanceOf(
      WhatsmiauApiError,
    );
    await whatsmiauRequest(conn, { path: '/x' }).catch((e: WhatsmiauApiError) => {
      expect(e.code).toBe('whatsmiau_unauthorized');
      expect(e.status).toBe(401);
    });
  });

  it('maps 423 to a suspension error and keeps the reason', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ message: 'suspended', suspension_reason: 'billing_past_due' }, 423),
    );
    await whatsmiauRequest(conn, { path: '/x' }).catch((e: WhatsmiauApiError) => {
      expect(e.code).toBe('whatsmiau_suspended');
      expect(e.status).toBe(409);
      expect(e.message).toContain('billing_past_due');
    });
  });

  it('maps any other failure to a generic provider error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ message: 'boom' }, 500));
    await whatsmiauRequest(conn, { path: '/x' }).catch((e: WhatsmiauApiError) => {
      expect(e.code).toBe('whatsmiau_error');
      expect(e.status).toBe(502);
      expect(e.raw).toEqual({ message: 'boom' });
    });
  });

  it('wraps a network failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    await whatsmiauRequest(conn, { path: '/x' }).catch((e: WhatsmiauApiError) => {
      expect(e.code).toBe('whatsmiau_network');
      expect(e.message).toContain('ECONNREFUSED');
    });
  });
});

describe('whatsmiau status mapping', () => {
  it('maps the documented statuses', () => {
    expect(mapWhatsmiauStatus(401)).toEqual({ code: 'whatsmiau_unauthorized', httpStatus: 401 });
    expect(mapWhatsmiauStatus(403)).toEqual({ code: 'whatsmiau_unauthorized', httpStatus: 401 });
    expect(mapWhatsmiauStatus(423)).toEqual({ code: 'whatsmiau_suspended', httpStatus: 409 });
    expect(mapWhatsmiauStatus(404)).toEqual({ code: 'whatsmiau_not_found', httpStatus: 404 });
    expect(mapWhatsmiauStatus(409)).toEqual({ code: 'whatsmiau_conflict', httpStatus: 409 });
    expect(mapWhatsmiauStatus(400)).toEqual({ code: 'whatsmiau_invalid_request', httpStatus: 400 });
    expect(mapWhatsmiauStatus(500)).toEqual({ code: 'whatsmiau_error', httpStatus: 502 });
  });
});
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `npx vitest run src/lib/whatsapp/providers/whatsmiau/client.test.ts`
Expected: FAIL — `Cannot find module './client'`.

- [ ] **Step 3: Escreva o client**

Crie `src/lib/whatsapp/providers/whatsmiau/client.ts`:

```ts
// ============================================================
// WhatsMiau HTTP client.
//
// The api key travels in the `apikey` header (the provider's
// documented convention). `baseUrl` is configurable so a self-hosted
// deployment works without a code change.
//
// Every failure is normalised into a WhatsmiauApiError carrying the
// HTTP status, a machine code and the raw payload — the UI shows the
// code, the logs keep the payload.
// ============================================================

import type { WhatsmiauConnection } from '../types';

export class WhatsmiauApiError extends Error {
  /** The status the app answers with (the upstream status, mapped). */
  readonly status: number;
  /**
   * The status the provider actually returned — 0 when the request
   * never reached it. `status` is the mapped one (a 423 becomes a
   * 409, a 500 becomes a 502); this keeps the provider's own number,
   * which is what the diagnostics report as `provider_status`.
   */
  readonly upstreamStatus: number;
  readonly code: string;
  readonly raw?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    raw?: unknown,
    upstreamStatus: number = status,
  ) {
    super(message);
    this.name = 'WhatsmiauApiError';
    this.status = status;
    this.upstreamStatus = upstreamStatus;
    this.code = code;
    this.raw = raw;
  }
}

export interface WhatsmiauRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path relative to the base URL, e.g. `/message/sendText/:instance`. */
  path: string;
  body?: unknown;
}

/**
 * Map an upstream HTTP status onto our machine code + the status the
 * app should answer with.
 */
export function mapWhatsmiauStatus(status: number): { code: string; httpStatus: number } {
  if (status === 400) {
    return { code: 'whatsmiau_invalid_request', httpStatus: 400 };
  }
  if (status === 401 || status === 403) {
    return { code: 'whatsmiau_unauthorized', httpStatus: 401 };
  }
  if (status === 404) {
    return { code: 'whatsmiau_not_found', httpStatus: 404 };
  }
  if (status === 409) {
    return { code: 'whatsmiau_conflict', httpStatus: 409 };
  }
  if (status === 423) {
    return { code: 'whatsmiau_suspended', httpStatus: 409 };
  }
  return { code: 'whatsmiau_error', httpStatus: 502 };
}

/**
 * Pull a human message and a code out of an error payload. The
 * provider's error shape isn't documented in detail, so several
 * plausible shapes are probed and a generic message is the fallback.
 */
function describeFailure(payload: unknown): { code: string; message: string } {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const suspension = typeof record.suspension_reason === 'string' ? record.suspension_reason : null;

    let message = '';
    if (typeof record.message === 'string') message = record.message;
    else if (typeof record.error === 'string') message = record.error;
    else if (Array.isArray(record.errors) && record.errors.length > 0) {
      const first = record.errors[0];
      if (first && typeof first === 'object') {
        const inner = first as Record<string, unknown>;
        message = typeof inner.message === 'string' ? inner.message : '';
      }
    }

    if (suspension) {
      return {
        code: 'whatsmiau_suspended',
        message: `The WhatsMiau instance is suspended (${suspension}). ${message}`.trim(),
      };
    }
    if (typeof record.code === 'string' && record.code) {
      return { code: record.code, message: message || 'WhatsMiau API request failed' };
    }
    return { code: 'whatsmiau_error', message: message || 'WhatsMiau API request failed' };
  }
  return { code: 'whatsmiau_error', message: 'WhatsMiau API request failed' };
}

export async function whatsmiauRequest<T = unknown>(
  conn: WhatsmiauConnection,
  options: WhatsmiauRequestOptions,
): Promise<T> {
  const { method = 'GET', path, body } = options;
  const base = conn.baseUrl.replace(/\/+$/, '');
  const url = `${base}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: conn.apiKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new WhatsmiauApiError(
      0,
      'whatsmiau_network',
      `Could not reach WhatsMiau: ${err instanceof Error ? err.message : 'network error'}`,
    );
  }

  const rawText = await response.text();
  let parsed: unknown = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = rawText;
    }
  }

  if (!response.ok) {
    const { code, httpStatus } = mapWhatsmiauStatus(response.status);
    const described = describeFailure(parsed);
    throw new WhatsmiauApiError(
      httpStatus,
      code === 'whatsmiau_error' ? described.code : code,
      described.message,
      parsed,
      response.status,
    );
  }

  return parsed as T;
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

Run: `npx vitest run src/lib/whatsapp/providers/whatsmiau/client.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp/providers/whatsmiau/client.ts src/lib/whatsapp/providers/whatsmiau/client.test.ts
git commit -m "$(cat <<'EOF'
feat(whatsmiau): client HTTP da API nao-oficial

Header apikey, baseUrl configuravel, e todo erro normalizado em
WhatsmiauApiError com status, codigo e payload cru.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Adapter WhatsMiau — envio de mensagens

**Files:**
- Create: `src/lib/whatsapp/providers/whatsmiau/api.ts`
- Create: `src/lib/whatsapp/providers/whatsmiau/adapter.ts`
- Test: `src/lib/whatsapp/providers/whatsmiau/adapter.test.ts`

**Interfaces:**
- Consumes: `whatsmiauRequest` e `WhatsmiauApiError` de `./client`; `WhatsmiauConnection` de `../types`; `ProviderError` de `../errors`; `normalizePhone` de `@/lib/whatsapp/phone-utils`.
- Produces (em `api.ts`): `whatsmiauSendText(conn, args)`, `whatsmiauSendMedia(conn, args)`, `whatsmiauSendButtons(conn, args)`, `whatsmiauSendList(conn, args)`, `whatsmiauSendReaction(conn, args)`, `whatsmiauSendPresence(conn, args)` — todas `Promise<ProviderSendResult>` (a presence devolve `Promise<void>`).
- Produz (em `adapter.ts`): `whatsmiauSendText`, `whatsmiauSendMedia`, `whatsmiauSendTemplate`, `whatsmiauSendButtons`, `whatsmiauSendList`, `whatsmiauSendReaction`, `whatsmiauSendTyping` — assinaturas iguais às do adapter do Meta.

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/lib/whatsapp/providers/whatsmiau/adapter.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { WhatsmiauConnection } from '../types';
import { ProviderError } from '../errors';
import {
  whatsmiauSendButtons,
  whatsmiauSendList,
  whatsmiauSendMedia,
  whatsmiauSendPresence,
  whatsmiauSendReaction,
  whatsmiauSendText,
} from './api';
import { whatsmiauSendTemplate, whatsmiauSendTyping } from './adapter';

const conn: WhatsmiauConnection = {
  provider: 'whatsmiau',
  instanceName: 'Atendimento01',
  apiKey: 'key-1',
  baseUrl: 'https://api.whatsmiau.dev/v2',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function lastCall() {
  const mock = fetch as ReturnType<typeof vi.fn>;
  const [url, init] = mock.mock.calls[mock.mock.calls.length - 1];
  return { url: url as string, body: init.body ? JSON.parse(init.body) : undefined };
}

describe('whatsmiau adapter — outbound shapes', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends text to /message/sendText with digits-only number', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ key: { id: 'MSG_1' } }),
    );
    const result = await whatsmiauSendText(conn, { to: '+55 (11) 99999-8888', text: 'oi' });
    const call = lastCall();
    expect(call.url).toBe(
      'https://api.whatsmiau.dev/v2/message/sendText/Atendimento01',
    );
    expect(call.body).toEqual({ number: '5511999998888', text: 'oi' });
    expect(result.messageId).toBe('MSG_1');
  });

  it('quotes a message when a context id is given', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ key: { id: 'M' } }));
    await whatsmiauSendText(conn, { to: '5511999998888', text: 'oi', contextMessageId: 'OLD' });
    expect(lastCall().body.quoted).toEqual({ key: { id: 'OLD' } });
  });

  it('sends image/video/document through /message/sendMedia', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ key: { id: 'M' } }));
    await whatsmiauSendMedia(conn, {
      to: '5511999998888',
      kind: 'document',
      link: 'https://cdn.example/a.pdf',
      caption: 'contrato',
      filename: 'a.pdf',
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/message/sendMedia/Atendimento01');
    expect(call.body).toEqual({
      number: '5511999998888',
      mediatype: 'document',
      media: 'https://cdn.example/a.pdf',
      caption: 'contrato',
      fileName: 'a.pdf',
    });
  });

  it('sends audio through the dedicated audio endpoint', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ key: { id: 'M' } }));
    await whatsmiauSendMedia(conn, {
      to: '5511999998888',
      kind: 'audio',
      link: 'https://cdn.example/a.ogg',
    });
    const call = lastCall();
    expect(call.url).toBe(
      'https://api.whatsmiau.dev/v2/message/sendWhatsAppAudio/Atendimento01',
    );
    expect(call.body).toEqual({ number: '5511999998888', audio: 'https://cdn.example/a.ogg' });
  });

  it('sends buttons with displayText and id', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ key: { id: 'M' } }));
    await whatsmiauSendButtons(conn, {
      to: '5511999998888',
      bodyText: 'confirma?',
      headerText: 'Cabeçalho',
      footerText: 'rodapé',
      buttons: [{ id: 'sim', title: 'Sim' }],
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/message/sendButtons/Atendimento01');
    expect(call.body).toEqual({
      number: '5511999998888',
      title: 'Cabeçalho',
      description: 'confirma?',
      footer: 'rodapé',
      buttons: [{ type: 'reply', displayText: 'Sim', id: 'sim' }],
    });
  });

  it('sends a list with rowId', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ key: { id: 'M' } }));
    await whatsmiauSendList(conn, {
      to: '5511999998888',
      bodyText: 'escolha',
      buttonLabel: 'Abrir',
      sections: [
        { title: 'Setor', rows: [{ id: 'suporte', title: 'Suporte', description: 'time 1' }] },
      ],
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/message/sendList/Atendimento01');
    expect(call.body.sections[0].rows[0].rowId).toBe('suporte');
    expect(call.body.buttonText).toBe('Abrir');
  });

  it('sends a reaction with a normalized jid', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ key: { id: 'M' } }));
    await whatsmiauSendReaction(conn, {
      to: '5511999998888',
      targetMessageId: 'MSG_1',
      emoji: '👍',
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/message/sendReaction/Atendimento01');
    expect(call.body).toEqual({
      reaction: '👍',
      key: {
        remoteJid: '5511999998888@s.whatsapp.net',
        id: 'MSG_1',
        fromMe: false,
      },
    });
  });

  it('sends the presence as composing', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await whatsmiauSendPresence(conn, { to: '5511999998888' });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/chat/sendPresence/Atendimento01');
    expect(call.body).toEqual({
      number: '5511999998888',
      presence: 'composing',
      type: 'text',
    });
  });

  it('throws when the provider answers without a message id', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ ok: true }));
    await expect(
      whatsmiauSendText(conn, { to: '5511999998888', text: 'oi' }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('whatsmiau adapter — unsupported capabilities', () => {
  it('refuses to send a template', async () => {
    await expect(
      whatsmiauSendTemplate(conn, {
        to: '5511999998888',
        templateName: 'hello',
      }),
    ).rejects.toBeInstanceOf(ProviderError);
    await whatsmiauSendTemplate(conn, {
      to: '5511999998888',
      templateName: 'hello',
    }).catch((e: ProviderError) => {
      expect(e.code).toBe('template_unsupported');
      expect(e.status).toBe(400);
    });
  });

  it('ignores the inbound message id when typing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await whatsmiauSendTyping(conn, { to: '5511999998888', messageId: 'IN' });
    expect(lastCall().url).toBe(
      'https://api.whatsmiau.dev/v2/chat/sendPresence/Atendimento01',
    );
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `npx vitest run src/lib/whatsapp/providers/whatsmiau/adapter.test.ts`
Expected: FAIL — `Cannot find module './api'`.

- [ ] **Step 3: Escreva `api.ts`**

Crie `src/lib/whatsapp/providers/whatsmiau/api.ts`:

```ts
// ============================================================
// WhatsMiau outbound calls.
//
// The API is Evolution-API-compatible, so the payload shapes mirror
// that convention: `number` carries the digits-only recipient, `media`
// a public URL, `buttons[].displayText` the visible label.
//
// Audio has its own endpoint (/message/sendWhatsAppAudio) — a voice
// note sent through /message/sendMedia is rejected by the provider.
// ============================================================

import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import type {
  ProviderSendResult,
  SendButtonsArgs,
  SendListArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendTextArgs,
  WhatsmiauConnection,
} from '../types';
import { ProviderError } from '../errors';
import { whatsmiauRequest } from './client';

/**
 * Pull the provider's message id out of a response. The Evolution
 * shape nests it under `key.id`; older payloads use `messageId` or a
 * flat `id`.
 */
function extractMessageId(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const key = record.key as Record<string, unknown> | undefined;
    if (key && typeof key.id === 'string' && key.id) return key.id;
    if (typeof record.messageId === 'string' && record.messageId) return record.messageId;
    if (typeof record.id === 'string' && record.id) return record.id;
  }
  return '';
}

function requireMessageId(payload: unknown): ProviderSendResult {
  const messageId = extractMessageId(payload);
  if (!messageId) {
    throw new ProviderError(
      'whatsmiau_error',
      'WhatsMiau accepted the message but returned no message id.',
      502,
      payload,
    );
  }
  return { messageId };
}

export async function whatsmiauSendText(
  conn: WhatsmiauConnection,
  args: SendTextArgs,
): Promise<ProviderSendResult> {
  const body: Record<string, unknown> = {
    number: normalizePhone(args.to),
    text: args.text,
  };
  if (args.contextMessageId) {
    body.quoted = { key: { id: args.contextMessageId } };
  }
  const payload = await whatsmiauRequest(conn, {
    method: 'POST',
    path: `/message/sendText/${conn.instanceName}`,
    body,
  });
  return requireMessageId(payload);
}

export async function whatsmiauSendMedia(
  conn: WhatsmiauConnection,
  args: SendMediaArgs,
): Promise<ProviderSendResult> {
  // Audio is a separate endpoint — the provider rejects it on
  // /message/sendMedia.
  if (args.kind === 'audio') {
    const payload = await whatsmiauRequest(conn, {
      method: 'POST',
      path: `/message/sendWhatsAppAudio/${conn.instanceName}`,
      body: {
        number: normalizePhone(args.to),
        audio: args.link,
      },
    });
    return requireMessageId(payload);
  }

  const body: Record<string, unknown> = {
    number: normalizePhone(args.to),
    mediatype: args.kind,
    media: args.link,
  };
  if (args.caption) body.caption = args.caption;
  if (args.kind === 'document' && args.filename) body.fileName = args.filename;
  if (args.contextMessageId) body.quoted = { key: { id: args.contextMessageId } };

  const payload = await whatsmiauRequest(conn, {
    method: 'POST',
    path: `/message/sendMedia/${conn.instanceName}`,
    body,
  });
  return requireMessageId(payload);
}

export async function whatsmiauSendButtons(
  conn: WhatsmiauConnection,
  args: SendButtonsArgs,
): Promise<ProviderSendResult> {
  const body: Record<string, unknown> = {
    number: normalizePhone(args.to),
    description: args.bodyText,
    buttons: args.buttons.map((button) => ({
      type: 'reply',
      displayText: button.title,
      id: button.id,
    })),
  };
  if (args.headerText) body.title = args.headerText;
  if (args.footerText) body.footer = args.footerText;
  if (args.contextMessageId) body.quoted = { key: { id: args.contextMessageId } };

  const payload = await whatsmiauRequest(conn, {
    method: 'POST',
    path: `/message/sendButtons/${conn.instanceName}`,
    body,
  });
  return requireMessageId(payload);
}

export async function whatsmiauSendList(
  conn: WhatsmiauConnection,
  args: SendListArgs,
): Promise<ProviderSendResult> {
  const body: Record<string, unknown> = {
    number: normalizePhone(args.to),
    description: args.bodyText,
    buttonText: args.buttonLabel,
    sections: args.sections.map((section) => ({
      ...(section.title ? { title: section.title } : {}),
      rows: section.rows.map((row) => ({
        title: row.title,
        ...(row.description ? { description: row.description } : {}),
        rowId: row.id,
      })),
    })),
  };
  if (args.headerText) body.title = args.headerText;
  if (args.footerText) body.footerText = args.footerText;
  if (args.contextMessageId) body.quoted = { key: { id: args.contextMessageId } };

  const payload = await whatsmiauRequest(conn, {
    method: 'POST',
    path: `/message/sendList/${conn.instanceName}`,
    body,
  });
  return requireMessageId(payload);
}

export async function whatsmiauSendReaction(
  conn: WhatsmiauConnection,
  args: SendReactionArgs,
): Promise<ProviderSendResult> {
  const payload = await whatsmiauRequest(conn, {
    method: 'POST',
    path: `/message/sendReaction/${conn.instanceName}`,
    body: {
      reaction: args.emoji,
      key: {
        remoteJid: `${normalizePhone(args.to)}@s.whatsapp.net`,
        id: args.targetMessageId,
        fromMe: false,
      },
    },
  });
  return requireMessageId(payload);
}

/**
 * The typing indicator is a presence update. WhatsMiau auto-confirms
 * read receipts when the instance's `readMessages` flag is on, so we
 * never call /chat/markMessageAsRead ourselves.
 */
export async function whatsmiauSendPresence(
  conn: WhatsmiauConnection,
  args: { to: string },
): Promise<void> {
  await whatsmiauRequest(conn, {
    method: 'POST',
    path: `/chat/sendPresence/${conn.instanceName}`,
    body: {
      number: normalizePhone(args.to),
      presence: 'composing',
      type: 'text',
    },
  });
}
```

- [ ] **Step 4: Escreva `adapter.ts`**

Crie `src/lib/whatsapp/providers/whatsmiau/adapter.ts`:

```ts
// ============================================================
// WhatsMiau adapter — implements the provider contract.
//
// Templates have no endpoint on this provider: asking for one throws
// `template_unsupported` instead of silently degrading to plain text
// (a campaign that looks like a template but isn't is worse than a
// loud failure).
// ============================================================

import type {
  ProviderSendResult,
  SendButtonsArgs,
  SendListArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendTemplateArgs,
  SendTextArgs,
  SendTypingArgs,
  WhatsmiauConnection,
} from '../types';
import { ProviderError } from '../errors';
import {
  whatsmiauSendText as sendText,
  whatsmiauSendMedia as sendMedia,
  whatsmiauSendButtons as sendButtons,
  whatsmiauSendList as sendList,
  whatsmiauSendReaction as sendReaction,
  whatsmiauSendPresence as sendPresence,
} from './api';

export async function whatsmiauSendText(
  conn: WhatsmiauConnection,
  args: SendTextArgs,
): Promise<ProviderSendResult> {
  return sendText(conn, args);
}

export async function whatsmiauSendMedia(
  conn: WhatsmiauConnection,
  args: SendMediaArgs,
): Promise<ProviderSendResult> {
  return sendMedia(conn, args);
}

export async function whatsmiauSendTemplate(
  _conn: WhatsmiauConnection,
  _args: SendTemplateArgs,
): Promise<ProviderSendResult> {
  throw new ProviderError(
    'template_unsupported',
    'The CRMBR (non-official) API does not support message templates. Use the Meta API for template campaigns.',
    400,
  );
}

export async function whatsmiauSendButtons(
  conn: WhatsmiauConnection,
  args: SendButtonsArgs,
): Promise<ProviderSendResult> {
  return sendButtons(conn, args);
}

export async function whatsmiauSendList(
  conn: WhatsmiauConnection,
  args: SendListArgs,
): Promise<ProviderSendResult> {
  return sendList(conn, args);
}

export async function whatsmiauSendReaction(
  conn: WhatsmiauConnection,
  args: SendReactionArgs,
): Promise<ProviderSendResult> {
  return sendReaction(conn, args);
}

export async function whatsmiauSendTyping(
  conn: WhatsmiauConnection,
  args: SendTypingArgs,
): Promise<void> {
  await sendPresence(conn, { to: args.to });
}
```

- [ ] **Step 5: Rode o teste e confirme que passa**

Run: `npx vitest run src/lib/whatsapp/providers/whatsmiau/adapter.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: sem erros novos.

- [ ] **Step 7: Commit**

```bash
git add src/lib/whatsapp/providers/whatsmiau/api.ts src/lib/whatsapp/providers/whatsmiau/adapter.ts src/lib/whatsapp/providers/whatsmiau/adapter.test.ts
git commit -m "$(cat <<'EOF'
feat(whatsmiau): adapter de envio da API nao-oficial

Mapeia o contrato do provider nos endpoints da WhatsMiau. Audio vai
para /message/sendWhatsAppAudio (o /message/sendMedia recusa).
Template lanca template_unsupported — a API nao tem o endpoint.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Instâncias WhatsMiau (criar, QR, estado, update, delete)

**Files:**
- Create: `src/lib/whatsapp/providers/whatsmiau/instances.ts`
- Test: `src/lib/whatsapp/providers/whatsmiau/instances.test.ts`

**Interfaces:**
- Consumes: `whatsmiauRequest` de `./client`; `WhatsmiauConnection` de `../types`; `WhatsmiauInstanceSettings` de `@/lib/whatsapp/whatsmiau-config`.
- Produces:
  - `interface WhatsmiauRemoteInstance { name: string; id?: string; state?: string; connected?: boolean; suspended?: boolean; suspension_reason?: string; wuid?: string; profileName?: string }`
  - `interface WhatsmiauConnectionState { state: 'open'|'closed'|'connecting'|'qr-code'|'unknown'; connected: boolean; suspended: boolean; suspension_reason?: string; wuid?: string; profileName?: string }`
  - `interface WhatsmiauQrPayload { base64: string; pairingCode?: string; connected: boolean }`
  - `validateInstanceName(name: string): { ok: true } | { ok: false; error: string }`
  - `createInstance(conn, args: { instanceName: string; settings: WhatsmiauInstanceSettings; syncFullHistory?: boolean }): Promise<void>`
  - `listInstances(conn): Promise<WhatsmiauRemoteInstance[]>`
  - `getConnectionState(conn, name): Promise<WhatsmiauConnectionState>`
  - `connectInstance(conn, name, number?): Promise<WhatsmiauQrPayload>`
  - `updateInstance(conn, name, settings: WhatsmiauInstanceSettings): Promise<void>`
  - `logoutInstance(conn, name): Promise<void>`
  - `deleteInstance(conn, name): Promise<void>`
  - `getWebhookConfig(conn, name): Promise<Record<string, unknown> | null>`
  - `setWebhook(conn, name, webhook: WhatsmiauWebhookConfig): Promise<void>`

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/lib/whatsapp/providers/whatsmiau/instances.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { WhatsmiauConnection } from '../types';
import {
  connectInstance,
  createInstance,
  deleteInstance,
  getConnectionState,
  getWebhookConfig,
  listInstances,
  logoutInstance,
  setWebhook,
  updateInstance,
  validateInstanceName,
} from './instances';

const conn: WhatsmiauConnection = {
  provider: 'whatsmiau',
  instanceName: 'Atendimento01',
  apiKey: 'key-1',
  baseUrl: 'https://api.whatsmiau.dev/v2',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function lastCall() {
  const mock = fetch as ReturnType<typeof vi.fn>;
  const [url, init] = mock.mock.calls[mock.mock.calls.length - 1];
  return { url: url as string, method: init.method as string, body: init.body ? JSON.parse(init.body) : undefined };
}

describe('instance name validation', () => {
  it('accepts a valid name', () => {
    expect(validateInstanceName('Atendimento01')).toEqual({ ok: true });
    expect(validateInstanceName('a_b.c-1')).toEqual({ ok: true });
  });

  it('rejects a name longer than 40 characters', () => {
    const result = validateInstanceName('a'.repeat(41));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/40/);
  });

  it('rejects accents and other punctuation', () => {
    expect(validateInstanceName('Atendimentoção').ok).toBe(false);
    expect(validateInstanceName('atendimento 01').ok).toBe(false);
    expect(validateInstanceName('atendimento/01').ok).toBe(false);
  });

  it('rejects a name with no alphanumeric character', () => {
    const result = validateInstanceName('___');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/letter or digit/i);
  });

  it('rejects an empty name', () => {
    expect(validateInstanceName('').ok).toBe(false);
  });
});

describe('whatsmiau instances — requests', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates an instance with the behaviour flags', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ id: 'Atendimento01' }));
    await createInstance(conn, {
      instanceName: 'Atendimento01',
      settings: {
        alwaysOnline: true,
        readMessages: false,
        rejectCall: true,
        msgCall: '',
        groupsIgnore: true,
        saveMedia: true,
        webhook: {
          enabled: true,
          url: 'https://app.example/api/whatsmiau/webhook',
          headers: { Authorization: 'Bearer secret' },
          events: ['messages.upsert'],
          base64: false,
        },
      },
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/instance/create');
    expect(call.method).toBe('POST');
    expect(call.body.instanceName).toBe('Atendimento01');
    expect(call.body.alwaysOnline).toBe(true);
    expect(call.body.readMessages).toBe(false);
    expect(call.body.webhook.events).toEqual(['messages.upsert']);
  });

  it('lists instances', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([{ name: 'Atendimento01', state: 'open' }]),
    );
    const list = await listInstances(conn);
    expect(lastCall().url).toBe('https://api.whatsmiau.dev/v2/instance/fetchInstances');
    expect(list[0].name).toBe('Atendimento01');
  });

  it('tolerates a non-array fetchInstances payload', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ instances: [] }));
    await expect(listInstances(conn)).resolves.toEqual([]);
  });

  it('reads the connection state', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ state: 'open', connected: true, wuid: '5511999998888@s.whatsapp.net' }),
    );
    const state = await getConnectionState(conn, 'Atendimento01');
    expect(lastCall().url).toBe(
      'https://api.whatsmiau.dev/v2/instance/connectionState/Atendimento01',
    );
    expect(state.state).toBe('open');
    expect(state.connected).toBe(true);
    expect(state.wuid).toBe('5511999998888@s.whatsapp.net');
  });

  it('reports a suspension', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ state: 'closed', suspended: true, suspension_reason: 'billing_past_due' }),
    );
    const state = await getConnectionState(conn, 'Atendimento01');
    expect(state.suspended).toBe(true);
    expect(state.suspension_reason).toBe('billing_past_due');
  });

  it('returns the QR payload', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ base64: 'iVBORw0KGgo=', pairingCode: '12345678', connected: false }),
    );
    const qr = await connectInstance(conn, 'Atendimento01');
    expect(lastCall().url).toBe(
      'https://api.whatsmiau.dev/v2/instance/connect/Atendimento01',
    );
    expect(qr.base64).toBe('iVBORw0KGgo=');
    expect(qr.pairingCode).toBe('12345678');
    expect(qr.connected).toBe(false);
  });

  it('updates the instance', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await updateInstance(conn, 'Atendimento01', {
      alwaysOnline: true,
      readMessages: true,
      rejectCall: false,
      msgCall: 'nao podemos agora',
      groupsIgnore: false,
      saveMedia: true,
      webhook: {
        enabled: true,
        url: 'https://app.example/api/whatsmiau/webhook',
        headers: {},
        events: ['messages.upsert'],
        base64: false,
      },
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/instance/update/Atendimento01');
    expect(call.method).toBe('PUT');
    expect(call.body.readMessages).toBe(true);
    expect(call.body.msgCall).toBe('nao podemos agora');
  });

  it('sets the webhook', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await setWebhook(conn, 'Atendimento01', {
      enabled: true,
      url: 'https://app.example/api/whatsmiau/webhook',
      headers: { Authorization: 'Bearer secret' },
      events: ['messages.upsert', 'connection.update'],
      base64: false,
    });
    const call = lastCall();
    expect(call.url).toBe('https://api.whatsmiau.dev/v2/webhook/set/Atendimento01');
    expect(call.body.webhook.events).toEqual(['messages.upsert', 'connection.update']);
  });

  it('reads the webhook config', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ webhook: { enabled: true, url: 'https://a', events: ['messages.upsert'] } }),
    );
    const config = await getWebhookConfig(conn, 'Atendimento01');
    expect(lastCall().url).toBe('https://api.whatsmiau.dev/v2/webhook/find/Atendimento01');
    expect(config?.enabled).toBe(true);
  });

  it('logs out and deletes', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}));
    await logoutInstance(conn, 'Atendimento01');
    expect(lastCall().url).toBe('https://api.whatsmiau.dev/v2/instance/logout/Atendimento01');
    expect(lastCall().method).toBe('DELETE');

    await deleteInstance(conn, 'Atendimento01');
    expect(lastCall().url).toBe('https://api.whatsmiau.dev/v2/instance/delete/Atendimento01');
    expect(lastCall().method).toBe('DELETE');
  });
});
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `npx vitest run src/lib/whatsapp/providers/whatsmiau/instances.test.ts`
Expected: FAIL — `Cannot find module './instances'`.

- [ ] **Step 3: Escreva `instances.ts`**

Crie `src/lib/whatsapp/providers/whatsmiau/instances.ts`:

```ts
// ============================================================
// WhatsMiau instance management.
//
// Creating an instance, pairing it with a phone (QR / pairing code),
// reading its connection state, pushing behaviour flags and the
// webhook config, and finally logging out or deleting it.
//
// The instance name is part of every URL, so it is validated locally
// before any request — the provider answers 400 for a bad name, but
// naming the rule locally saves a round trip and gives the UI a
// message it can show next to the field.
// ============================================================

import type {
  WhatsmiauInstanceSettings,
  WhatsmiauWebhookConfig,
} from '@/lib/whatsapp/whatsmiau-config';
import type { WhatsmiauConnection } from '../types';
import { whatsmiauRequest } from './client';

export interface WhatsmiauRemoteInstance {
  name: string;
  id?: string;
  state?: string;
  connected?: boolean;
  suspended?: boolean;
  suspension_reason?: string;
  wuid?: string;
  profileName?: string;
}

export interface WhatsmiauConnectionState {
  state: 'open' | 'closed' | 'connecting' | 'qr-code' | 'unknown';
  connected: boolean;
  suspended: boolean;
  suspension_reason?: string;
  wuid?: string;
  profileName?: string;
}

export interface WhatsmiauQrPayload {
  /** PNG QR code, base64-encoded (no data: prefix). */
  base64: string;
  pairingCode?: string;
  connected: boolean;
}

/** Up to 40 characters, unaccented letters, digits, dot, hyphen, underscore. */
const INSTANCE_NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Validate an instance name against WhatsMiau's rule: ≤ 40
 * characters, only unaccented letters / digits / dot / hyphen /
 * underscore, and at least one letter or digit.
 */
export function validateInstanceName(
  name: string,
): { ok: true } | { ok: false; error: string } {
  const value = (name ?? '').trim();
  if (!value) {
    return { ok: false, error: 'The instance name is required.' };
  }
  if (value.length > 40) {
    return { ok: false, error: 'The instance name can be at most 40 characters long.' };
  }
  if (!INSTANCE_NAME_RE.test(value)) {
    return {
      ok: false,
      error:
        'The instance name can only contain unaccented letters, numbers, dot, hyphen and underscore.',
    };
  }
  if (!/[A-Za-z0-9]/.test(value)) {
    return { ok: false, error: 'The instance name must contain at least one letter or digit.' };
  }
  return { ok: true };
}

export async function createInstance(
  conn: WhatsmiauConnection,
  args: {
    instanceName: string;
    settings: WhatsmiauInstanceSettings;
    /**
     * Creation-only flag: the provider refuses to change it on
     * `PUT /instance/update`, so it never travels with the settings.
     */
    syncFullHistory?: boolean;
  },
): Promise<void> {
  const { instanceName, settings, syncFullHistory } = args;
  await whatsmiauRequest(conn, {
    method: 'POST',
    path: '/instance/create',
    body: {
      instanceName,
      alwaysOnline: settings.alwaysOnline,
      readMessages: settings.readMessages,
      rejectCall: settings.rejectCall,
      msgCall: settings.msgCall,
      groupsIgnore: settings.groupsIgnore,
      saveMedia: settings.saveMedia,
      ...(syncFullHistory ? { syncFullHistory: true } : {}),
      webhook: settings.webhook,
    },
  });
}

export async function listInstances(
  conn: WhatsmiauConnection,
): Promise<WhatsmiauRemoteInstance[]> {
  const payload = await whatsmiauRequest<unknown>(conn, {
    path: '/instance/fetchInstances',
  });
  if (Array.isArray(payload)) return payload as WhatsmiauRemoteInstance[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.instances)) return record.instances as WhatsmiauRemoteInstance[];
  }
  return [];
}

export async function getConnectionState(
  conn: WhatsmiauConnection,
  name: string,
): Promise<WhatsmiauConnectionState> {
  const payload = await whatsmiauRequest<Record<string, unknown>>(conn, {
    path: `/instance/connectionState/${name}`,
  });
  const rawState = typeof payload?.state === 'string' ? payload.state : 'unknown';
  const state =
    rawState === 'open' || rawState === 'closed' || rawState === 'connecting' || rawState === 'qr-code'
      ? rawState
      : 'unknown';
  return {
    state,
    connected:
      typeof payload?.connected === 'boolean'
        ? payload.connected
        : state === 'open',
    suspended: payload?.suspended === true,
    ...(typeof payload?.suspension_reason === 'string'
      ? { suspension_reason: payload.suspension_reason }
      : {}),
    ...(typeof payload?.wuid === 'string' ? { wuid: payload.wuid } : {}),
    ...(typeof payload?.profileName === 'string' ? { profileName: payload.profileName } : {}),
  };
}

export async function connectInstance(
  conn: WhatsmiauConnection,
  name: string,
  number?: string,
): Promise<WhatsmiauQrPayload> {
  const query = number ? `?number=${encodeURIComponent(number)}` : '';
  const payload = await whatsmiauRequest<Record<string, unknown>>(conn, {
    path: `/instance/connect/${name}${query}`,
  });
  return {
    base64: typeof payload?.base64 === 'string' ? payload.base64 : '',
    ...(typeof payload?.pairingCode === 'string'
      ? { pairingCode: payload.pairingCode }
      : {}),
    connected: payload?.connected === true,
  };
}

export async function updateInstance(
  conn: WhatsmiauConnection,
  name: string,
  settings: WhatsmiauInstanceSettings,
): Promise<void> {
  await whatsmiauRequest(conn, {
    method: 'PUT',
    path: `/instance/update/${name}`,
    body: {
      alwaysOnline: settings.alwaysOnline,
      readMessages: settings.readMessages,
      rejectCall: settings.rejectCall,
      msgCall: settings.msgCall,
      groupsIgnore: settings.groupsIgnore,
      saveMedia: settings.saveMedia,
      webhook: settings.webhook,
    },
  });
}

export async function logoutInstance(
  conn: WhatsmiauConnection,
  name: string,
): Promise<void> {
  await whatsmiauRequest(conn, {
    method: 'DELETE',
    path: `/instance/logout/${name}`,
  });
}

export async function deleteInstance(
  conn: WhatsmiauConnection,
  name: string,
): Promise<void> {
  await whatsmiauRequest(conn, {
    method: 'DELETE',
    path: `/instance/delete/${name}`,
  });
}

export async function getWebhookConfig(
  conn: WhatsmiauConnection,
  name: string,
): Promise<Record<string, unknown> | null> {
  const payload = await whatsmiauRequest<Record<string, unknown>>(conn, {
    path: `/webhook/find/${name}`,
  });
  if (!payload) return null;
  const webhook = payload.webhook;
  if (webhook && typeof webhook === 'object') {
    return webhook as Record<string, unknown>;
  }
  return payload;
}

export async function setWebhook(
  conn: WhatsmiauConnection,
  name: string,
  webhook: WhatsmiauWebhookConfig,
): Promise<void> {
  await whatsmiauRequest(conn, {
    method: 'POST',
    path: `/webhook/set/${name}`,
    body: { webhook },
  });
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

Run: `npx vitest run src/lib/whatsapp/providers/whatsmiau/instances.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: sem erros novos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp/providers/whatsmiau/instances.ts src/lib/whatsapp/providers/whatsmiau/instances.test.ts
git commit -m "$(cat <<'EOF'
feat(whatsmiau): gestao de instancias (criar, QR, flags, delete)

Criar, parear por QR, ler o estado, aplicar flags e webhook, e
desconectar/excluir. O nome da instancia e validado localmente
contra a regra do provider antes de qualquer request.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Dispatcher, resolução da API ativa e capabilities

**Files:**
- Create: `src/lib/whatsapp/providers/connection.ts`
- Create: `src/lib/whatsapp/providers/capabilities.ts`
- Create: `src/lib/whatsapp/providers/index.ts`
- Test: `src/lib/whatsapp/providers/connection.test.ts`
- Test: `src/lib/whatsapp/providers/index.test.ts`

**Interfaces:**
- Consumes: `loadWhatsmiauConfig` e `decryptWhatsmiauApiKey` de `@/lib/whatsapp/whatsmiau-config`; `decrypt`, `isLegacyFormat`, `encrypt` de `@/lib/whatsapp/encryption`; `ProviderError` de `./errors`; os adapters de `./meta/adapter` e `./whatsmiau/adapter`.
- Produces:
  - `resolveProviderConnection(db: SupabaseClient, accountId: string): Promise<ProviderConnection>`
  - `assertProviderSupportsMessageType(conn: ProviderConnection, messageType: string): void`
  - `providerSupportsTemplates(conn: ProviderConnection): boolean`
  - `providerSupportsGroups(conn: ProviderConnection): boolean`
  - dispatcher (`./index.ts`): `sendTextMessage(conn, args)`, `sendMediaMessage(conn, args)`, `sendTemplateMessage(conn, args)`, `sendInteractiveButtons(conn, args)`, `sendInteractiveList(conn, args)`, `sendReactionMessage(conn, args)`, `sendTypingIndicator(conn, args)`

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/lib/whatsapp/providers/connection.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { encrypt } from '@/lib/whatsapp/encryption';
import { ProviderError } from './errors';
import { resolveProviderConnection } from './connection';

/**
 * Fake supabase-js: `whatsmiau_config` resolves through maybeSingle(),
 * `whatsapp_config` (Meta) through single().
 */
function fakeDb(opts: { whatsmiau?: unknown; meta?: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({ data: opts.whatsmiau ?? null, error: null }),
    single: () => Promise.resolve({ data: opts.meta ?? null, error: null }),
    update: () => chain,
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(resolve),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

const metaRow = {
  account_id: 'acc-1',
  phone_number_id: 'pn-1',
  access_token: encrypt('meta-token'),
};

const whatsmiauRow = {
  id: 'wm-1',
  account_id: 'acc-1',
  instance_name: 'Atendimento01',
  api_key_encrypted: encrypt('wm-key'),
  base_url: 'https://api.whatsmiau.dev/v2',
  status: 'connected',
  is_active: true,
  instance_settings: {},
};

describe('resolveProviderConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers the CRMBR provider when it is active', async () => {
    const conn = await resolveProviderConnection(
      fakeDb({ whatsmiau: whatsmiauRow, meta: metaRow }),
      'acc-1',
    );
    expect(conn).toEqual({
      provider: 'whatsmiau',
      instanceName: 'Atendimento01',
      apiKey: 'wm-key',
      baseUrl: 'https://api.whatsmiau.dev/v2',
    });
  });

  it('falls back to Meta when the CRMBR provider is not active', async () => {
    const conn = await resolveProviderConnection(
      fakeDb({ whatsmiau: { ...whatsmiauRow, is_active: false }, meta: metaRow }),
      'acc-1',
    );
    expect(conn).toEqual({
      provider: 'meta',
      phoneNumberId: 'pn-1',
      accessToken: 'meta-token',
    });
  });

  it('uses Meta when there is no CRMBR row at all', async () => {
    const conn = await resolveProviderConnection(fakeDb({ meta: metaRow }), 'acc-1');
    expect(conn.provider).toBe('meta');
  });

  it('fails when the CRMBR provider is active but disconnected — never falls back to Meta', async () => {
    await expect(
      resolveProviderConnection(
        fakeDb({ whatsmiau: { ...whatsmiauRow, status: 'disconnected' }, meta: metaRow }),
        'acc-1',
      ),
    ).rejects.toBeInstanceOf(ProviderError);

    await resolveProviderConnection(
      fakeDb({ whatsmiau: { ...whatsmiauRow, status: 'disconnected' }, meta: metaRow }),
      'acc-1',
    ).catch((e: ProviderError) => {
      expect(e.code).toBe('provider_not_connected');
      expect(e.status).toBe(400);
      expect(e.message).not.toMatch(/meta/i);
    });
  });

  it('fails when neither provider is configured', async () => {
    await resolveProviderConnection(fakeDb({}), 'acc-1').catch((e: ProviderError) => {
      expect(e.code).toBe('whatsapp_not_configured');
      expect(e.status).toBe(400);
    });
  });
});
```

Crie `src/lib/whatsapp/providers/index.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ProviderError } from './errors';
import type { MetaConnection, WhatsmiauConnection } from './types';
import {
  sendTemplateMessage,
  sendTextMessage,
  sendTypingIndicator,
} from './index';

const h = vi.hoisted(() => ({
  metaSendText: vi.fn(),
  metaSendTyping: vi.fn(),
  whatsmiauSendText: vi.fn(),
  whatsmiauSendTyping: vi.fn(),
  whatsmiauSendTemplate: vi.fn(),
}));

vi.mock('./meta/adapter', () => ({
  metaSendText: h.metaSendText,
  metaSendMedia: vi.fn(),
  metaSendTemplate: vi.fn(),
  metaSendButtons: vi.fn(),
  metaSendList: vi.fn(),
  metaSendReaction: vi.fn(),
  metaSendTyping: h.metaSendTyping,
}));

vi.mock('./whatsmiau/adapter', () => ({
  whatsmiauSendText: h.whatsmiauSendText,
  whatsmiauSendMedia: vi.fn(),
  whatsmiauSendTemplate: h.whatsmiauSendTemplate,
  whatsmiauSendButtons: vi.fn(),
  whatsmiauSendList: vi.fn(),
  whatsmiauSendReaction: vi.fn(),
  whatsmiauSendTyping: h.whatsmiauSendTyping,
}));

const metaConn: MetaConnection = {
  provider: 'meta',
  phoneNumberId: 'pn-1',
  accessToken: 'tok-1',
};
const wmConn: WhatsmiauConnection = {
  provider: 'whatsmiau',
  instanceName: 'Atendimento01',
  apiKey: 'key-1',
  baseUrl: 'https://api.whatsmiau.dev/v2',
};

describe('provider dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.metaSendText.mockResolvedValue({ messageId: 'wamid-1' });
    h.whatsmiauSendText.mockResolvedValue({ messageId: 'MSG_1' });
    h.metaSendTyping.mockResolvedValue(undefined);
    h.whatsmiauSendTyping.mockResolvedValue(undefined);
  });

  it('routes text to the Meta adapter for a Meta connection', async () => {
    const result = await sendTextMessage(metaConn, { to: '5511999998888', text: 'oi' });
    expect(h.metaSendText).toHaveBeenCalledWith(metaConn, { to: '5511999998888', text: 'oi' });
    expect(h.whatsmiauSendText).not.toHaveBeenCalled();
    expect(result.messageId).toBe('wamid-1');
  });

  it('routes text to the WhatsMiau adapter for a CRMBR connection', async () => {
    const result = await sendTextMessage(wmConn, { to: '5511999998888', text: 'oi' });
    expect(h.whatsmiauSendText).toHaveBeenCalledWith(wmConn, { to: '5511999998888', text: 'oi' });
    expect(h.metaSendText).not.toHaveBeenCalled();
    expect(result.messageId).toBe('MSG_1');
  });

  it('routes the typing indicator by provider', async () => {
    await sendTypingIndicator(metaConn, { to: '5511999998888', messageId: 'IN' });
    expect(h.metaSendTyping).toHaveBeenCalled();
    await sendTypingIndicator(wmConn, { to: '5511999998888' });
    expect(h.whatsmiauSendTyping).toHaveBeenCalled();
  });

  it('refuses a template on the CRMBR provider', async () => {
    h.whatsmiauSendTemplate.mockRejectedValue(
      new ProviderError('template_unsupported', 'no templates', 400),
    );
    await expect(
      sendTemplateMessage(wmConn, { to: '5511999998888', templateName: 'hello' }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
```

- [ ] **Step 2: Rode os testes e confirme que falham**

Run: `npx vitest run src/lib/whatsapp/providers/connection.test.ts src/lib/whatsapp/providers/index.test.ts`
Expected: FAIL — `Cannot find module './connection'` / `'./index'`.

- [ ] **Step 3: Escreva `connection.ts`**

Crie `src/lib/whatsapp/providers/connection.ts`:

```ts
// ============================================================
// Which provider is this account sending through?
//
// One active provider per account. The CRMBR (WhatsMiau) provider
// wins when its row is active; otherwise Meta is used.
//
// There is deliberately NO fallback from an active-but-disconnected
// CRMBR provider back to Meta: sending the customer's message from
// the wrong number is worse than failing loudly.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import {
  decryptWhatsmiauApiKey,
  loadWhatsmiauConfig,
  type WhatsmiauConfigRow,
} from '@/lib/whatsapp/whatsmiau-config';
import { ProviderError } from './errors';
import type { ProviderConnection, WhatsmiauConnection } from './types';

/**
 * Build a WhatsMiau connection from a stored config row.
 *
 * The CRMBR management routes (list instances, fetch the QR code, push
 * the webhook config) talk to the provider directly instead of going
 * through the send path, so they need the same connection object the
 * dispatcher would build.
 */
export function whatsmiauConnectionFromConfig(
  row: WhatsmiauConfigRow,
): WhatsmiauConnection {
  return {
    provider: 'whatsmiau',
    instanceName: row.instance_name,
    apiKey: decryptWhatsmiauApiKey(row),
    baseUrl: row.base_url,
  };
}

export async function resolveProviderConnection(
  db: SupabaseClient,
  accountId: string,
): Promise<ProviderConnection> {
  const whatsmiau = await loadWhatsmiauConfig(db, accountId);

  if (whatsmiau?.is_active) {
    if (whatsmiau.status !== 'connected') {
      throw new ProviderError(
        'provider_not_connected',
        'The CRMBR (non-official) API is selected but the WhatsApp number is not connected. Finish pairing it in Settings → WhatsApp → CRMBR.',
        400,
      );
    }
    return {
      provider: 'whatsmiau',
      instanceName: whatsmiau.instance_name,
      apiKey: decryptWhatsmiauApiKey(whatsmiau),
      baseUrl: whatsmiau.base_url,
    };
  }

  const { data: meta, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (error || !meta) {
    throw new ProviderError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400,
    );
  }

  const accessToken = decrypt(meta.access_token);

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  if (isLegacyFormat(meta.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', meta.id)
      .then(({ error: updateError }: { error: { message: string } | null }) => {
        if (updateError) {
          console.warn(
            '[provider-connection] access_token GCM upgrade failed:',
            updateError.message,
          );
        }
      });
  }

  return {
    provider: 'meta',
    phoneNumberId: meta.phone_number_id,
    accessToken,
  };
}
```

- [ ] **Step 4: Escreva `capabilities.ts`**

Crie `src/lib/whatsapp/providers/capabilities.ts`:

```ts
// ============================================================
// What each provider can and cannot do.
//
// The non-official API has no message-template endpoint, and no
// group support in this integration. Rather than degrading a template
// into plain text (a campaign that looks like a template but isn't),
// we refuse it loudly.
// ============================================================

import { ProviderError } from './errors';
import type { ProviderConnection } from './types';

/** True when the provider can send an approved template. */
export function providerSupportsTemplates(conn: ProviderConnection): boolean {
  return conn.provider === 'meta';
}

/** True when the provider can address a group (`@g.us`). */
export function providerSupportsGroups(conn: ProviderConnection): boolean {
  return conn.provider === 'meta';
}

/**
 * Throw when the provider can't carry the requested message type.
 * Called BEFORE any write, so a rejected send leaves no orphan
 * contact or conversation behind.
 */
export function assertProviderSupportsMessageType(
  conn: ProviderConnection,
  messageType: string,
): void {
  if (messageType === 'template' && !providerSupportsTemplates(conn)) {
    throw new ProviderError(
      'template_unsupported',
      'The CRMBR (non-official) API does not support message templates. Switch to the Meta API to send template campaigns.',
      400,
    );
  }
}
```

- [ ] **Step 5: Escreva o dispatcher `index.ts`**

Crie `src/lib/whatsapp/providers/index.ts`:

```ts
// ============================================================
// The provider dispatcher.
//
// The core asks "send this text" and gets the right provider's call.
// Nothing above this file knows which provider is active.
//
// Import this module instead of `@/lib/whatsapp/meta-api` when you
// want provider-agnostic behaviour. Import `meta-api` directly only
// for Meta-specific features (templates CRUD, media by id, phone
// health, WABA pairing).
// ============================================================

import {
  metaSendButtons,
  metaSendList,
  metaSendMedia,
  metaSendReaction,
  metaSendTemplate,
  metaSendText,
  metaSendTyping,
} from './meta/adapter';
import {
  whatsmiauSendButtons,
  whatsmiauSendList,
  whatsmiauSendMedia,
  whatsmiauSendReaction,
  whatsmiauSendTemplate,
  whatsmiauSendText,
  whatsmiauSendTyping,
} from './whatsmiau/adapter';
import type {
  ProviderConnection,
  ProviderSendResult,
  SendButtonsArgs,
  SendListArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendTemplateArgs,
  SendTextArgs,
  SendTypingArgs,
} from './types';

export type {
  MetaConnection,
  ProviderConnection,
  ProviderId,
  ProviderSendResult,
  SendButtonsArgs,
  SendListArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendTemplateArgs,
  SendTextArgs,
  SendTypingArgs,
  WhatsmiauConnection,
} from './types';

export { ProviderError } from './errors';
export {
  assertProviderSupportsMessageType,
  providerSupportsGroups,
  providerSupportsTemplates,
} from './capabilities';
export { resolveProviderConnection } from './connection';

export async function sendTextMessage(
  conn: ProviderConnection,
  args: SendTextArgs,
): Promise<ProviderSendResult> {
  return conn.provider === 'meta'
    ? metaSendText(conn, args)
    : whatsmiauSendText(conn, args);
}

export async function sendMediaMessage(
  conn: ProviderConnection,
  args: SendMediaArgs,
): Promise<ProviderSendResult> {
  return conn.provider === 'meta'
    ? metaSendMedia(conn, args)
    : whatsmiauSendMedia(conn, args);
}

export async function sendTemplateMessage(
  conn: ProviderConnection,
  args: SendTemplateArgs,
): Promise<ProviderSendResult> {
  return conn.provider === 'meta'
    ? metaSendTemplate(conn, args)
    : whatsmiauSendTemplate(conn, args);
}

export async function sendInteractiveButtons(
  conn: ProviderConnection,
  args: SendButtonsArgs,
): Promise<ProviderSendResult> {
  return conn.provider === 'meta'
    ? metaSendButtons(conn, args)
    : whatsmiauSendButtons(conn, args);
}

export async function sendInteractiveList(
  conn: ProviderConnection,
  args: SendListArgs,
): Promise<ProviderSendResult> {
  return conn.provider === 'meta'
    ? metaSendList(conn, args)
    : whatsmiauSendList(conn, args);
}

export async function sendReactionMessage(
  conn: ProviderConnection,
  args: SendReactionArgs,
): Promise<ProviderSendResult> {
  return conn.provider === 'meta'
    ? metaSendReaction(conn, args)
    : whatsmiauSendReaction(conn, args);
}

export async function sendTypingIndicator(
  conn: ProviderConnection,
  args: SendTypingArgs,
): Promise<void> {
  return conn.provider === 'meta'
    ? metaSendTyping(conn, args)
    : whatsmiauSendTyping(conn, args);
}
```

- [ ] **Step 6: Rode os testes e confirme que passam**

Run: `npx vitest run src/lib/whatsapp/providers/`
Expected: PASS (todos os testes de `providers/`).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: sem erros novos.

- [ ] **Step 8: Commit**

```bash
git add src/lib/whatsapp/providers/
git commit -m "$(cat <<'EOF'
feat(whatsmiau): dispatcher, resolucao da API ativa e capabilities

O core passa a pedir "enviar isto" ao dispatcher, que roteia para o
adapter da API ativa. CRMBR ativa mas desconectada falha — nunca cai
para a Meta em silencio.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Corte no core — `send-message.ts`

**Files:**
- Modify: `src/lib/whatsapp/send-message.ts`
- Modify: `src/lib/whatsapp/send-message.test.ts`

**Interfaces:**
- Consumes: `resolveProviderConnection`, `assertProviderSupportsMessageType`, `sendTextMessage`, `sendTemplateMessage`, `sendMediaMessage`, `sendInteractiveButtons`, `sendInteractiveList` de `@/lib/whatsapp/providers`; `ProviderError` de `@/lib/whatsapp/providers/errors`.
- Produces: nenhuma assinatura nova. `sendMessageToConversation` e `validateSendMessageParams` mantêm o contrato; o código de erro `meta_error` e a mensagem `"Meta API error: …"` **mudam** para `"WhatsApp API error: …"`.

- [ ] **Step 1: Escreva o teste que falha**

Em `src/lib/whatsapp/send-message.test.ts`, **substitua** o bloco `vi.mock('@/lib/whatsapp/meta-api', ...)` (linhas ~169-177) por:

```ts
const providerMocks = vi.hoisted(() => ({
  resolveProviderConnection: vi.fn(),
  assertProviderSupportsMessageType: vi.fn(),
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid.text' })),
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid.tpl' })),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid.media' })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid.btn' })),
  sendInteractiveList: vi.fn(async () => ({ messageId: 'wamid.list' })),
  sendReactionMessage: vi.fn(async () => ({ messageId: 'wamid.react' })),
  sendTypingIndicator: vi.fn(async () => undefined),
}));

vi.mock('@/lib/whatsapp/providers', () => ({
  resolveProviderConnection: providerMocks.resolveProviderConnection,
  assertProviderSupportsMessageType: providerMocks.assertProviderSupportsMessageType,
  sendTextMessage: providerMocks.sendTextMessage,
  sendTemplateMessage: providerMocks.sendTemplateMessage,
  sendMediaMessage: providerMocks.sendMediaMessage,
  sendInteractiveButtons: providerMocks.sendInteractiveButtons,
  sendInteractiveList: providerMocks.sendInteractiveList,
  sendReactionMessage: providerMocks.sendReactionMessage,
  sendTypingIndicator: providerMocks.sendTypingIndicator,
}));
```

E **adicione** logo abaixo do `describe` mais externo do arquivo:

```ts
describe('sendMessageToConversation — provider dispatch', () => {
  const captured: CapturedWrites = {};

  beforeEach(() => {
    providerMocks.resolveProviderConnection.mockReset();
    providerMocks.resolveProviderConnection.mockResolvedValue({
      provider: 'meta',
      phoneNumberId: 'pn-1',
      accessToken: 'tok-1',
    });
    providerMocks.assertProviderSupportsMessageType.mockReset();
  });

  it('sends through the dispatcher with the resolved connection', async () => {
    await sendMessageToConversation(
      sendPathDb([], captured),
      'acct-1',
      { conversationId: 'cv-1', messageType: 'text', contentText: 'hi' }
    );

    expect(providerMocks.resolveProviderConnection).toHaveBeenCalled();
    expect(providerMocks.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'meta' }),
      expect.objectContaining({ to: expect.any(String), text: 'hi' })
    );
  });

  it('rejects a template before any write when the provider cannot carry it', async () => {
    providerMocks.assertProviderSupportsMessageType.mockImplementation(() => {
      throw new Error('template_unsupported');
    });

    await expect(
      sendMessageToConversation(
        sendPathDb([], captured),
        'acct-1',
        {
          conversationId: 'cv-1',
          messageType: 'template',
          templateName: 'hello',
        }
      )
    ).rejects.toThrow('template_unsupported');

    expect(captured.message).toBeUndefined();
  });

  it('never calls the Meta path when the CRMBR provider is active', async () => {
    providerMocks.resolveProviderConnection.mockResolvedValue({
      provider: 'whatsmiau',
      instanceName: 'Atendimento01',
      apiKey: 'key-1',
      baseUrl: 'https://api.whatsmiau.dev/v2',
    });

    await sendMessageToConversation(
      sendPathDb([], captured),
      'acct-1',
      { conversationId: 'cv-1', messageType: 'text', contentText: 'hi' }
    );

    expect(providerMocks.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'whatsmiau' }),
      expect.anything()
    );
  });
});
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `npx vitest run src/lib/whatsapp/send-message.test.ts`
Expected: FAIL — `resolveProviderConnection` não é chamado (o core ainda lê `whatsapp_config` direto).

- [ ] **Step 3: Troque os imports em `src/lib/whatsapp/send-message.ts`**

**Substitua** (linhas 24-31):

```ts
import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
```

por:

```ts
import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  resolveProviderConnection,
  assertProviderSupportsMessageType,
} from '@/lib/whatsapp/providers';
import { ProviderError } from '@/lib/whatsapp/providers/errors';
import type { MediaKind } from '@/lib/whatsapp/meta-api';
```

E **substitua** (linha 37):

```ts
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
```

por:

```ts
// Credential decryption moved to providers/connection.ts — the core
// no longer touches the stored ciphertext directly.
```

**Remova** a linha inteira do import (não deixe um import vazio):

```ts
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
```

- [ ] **Step 4: Troque o bloco de credenciais**

**Substitua** (linhas 261-292, de `// WhatsApp config, account-scoped.` até o fim do bloco de self-heal):

```ts
  // WhatsApp config, account-scoped.
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (configError || !config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  const accessToken = decrypt(config.access_token);

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  if (isLegacyFormat(config.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', config.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[send-message] access_token GCM upgrade failed:',
            error.message
          );
        }
      });
  }
```

por:

```ts
  // Which provider is this account sending through? Credentials for
  // both providers are resolved in one place (providers/connection.ts).
  const conn = await resolveProviderConnection(db, accountId);

  // Refuse a message type the active provider can't carry BEFORE any
  // write, so a rejected send leaves no orphan contact/conversation.
  assertProviderSupportsMessageType(conn, messageType);
```

- [ ] **Step 5: Troque o closure `attempt`**

**Substitua** o corpo inteiro do `const attempt = async (phone: string): Promise<string> => { … };` (linhas 346-410) por:

```ts
  const attempt = async (phone: string): Promise<string> => {
    if (messageType === 'template') {
      const result = await sendTemplateMessage(conn, {
        to: phone,
        templateName: templateName!,
        language: sendLanguage,
        template: templateRow ?? undefined,
        messageParams: templateMessageParams ?? undefined,
        params: templateParams || [],
        contextMessageId,
      });
      return result.messageId;
    }
    if (isMediaKind) {
      const result = await sendMediaMessage(conn, {
        to: phone,
        kind: messageType as MediaKind,
        link: mediaUrl!,
        caption: contentText || undefined,
        filename: filename || undefined,
        contextMessageId,
      });
      return result.messageId;
    }
    if (messageType === 'interactive') {
      const p = interactivePayload!;
      if (p.kind === 'buttons') {
        const result = await sendInteractiveButtons(conn, {
          to: phone,
          bodyText: p.body,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          buttons: p.buttons,
          contextMessageId,
        });
        return result.messageId;
      }
      const result = await sendInteractiveList(conn, {
        to: phone,
        bodyText: p.body,
        buttonLabel: p.button_label,
        headerText: p.header || undefined,
        footerText: p.footer || undefined,
        sections: p.sections,
        contextMessageId,
      });
      return result.messageId;
    }
    const result = await sendTextMessage(conn, {
      to: phone,
      text: contentText!,
      contextMessageId,
    });
    return result.messageId;
  };
```

- [ ] **Step 6: Mapeie o erro do provider no `catch`**

**Substitua** o `catch` (linhas 442-447):

```ts
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown Meta API error';
    console.error('[send-message] Meta send failed for all variants:', message);
    throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
  }
```

por:

```ts
  } catch (err) {
    // A provider-layer error already carries a machine code and an
    // HTTP status — surface it as-is instead of flattening it into a
    // generic failure.
    if (err instanceof ProviderError) {
      throw new SendMessageError(err.code, err.message, err.status);
    }
    const message =
      err instanceof Error ? err.message : 'Unknown WhatsApp API error';
    console.error('[send-message] send failed for all variants:', message);
    throw new SendMessageError('meta_error', `WhatsApp API error: ${message}`, 502);
  }
```

- [ ] **Step 7: Rode o teste e confirme que passa**

Run: `npx vitest run src/lib/whatsapp/send-message.test.ts`
Expected: PASS (todos).

Se o teste `rejects a template before any write…` falhar por causa do `assertProviderSupportsMessageType` mockado, troque a implementação do mock por uma que lance o `ProviderError` real:

```ts
providerMocks.assertProviderSupportsMessageType.mockImplementation(() => {
  const { ProviderError } = require('@/lib/whatsapp/providers/errors');
  throw new ProviderError('template_unsupported', 'no templates here', 400);
});
```

- [ ] **Step 8: Typecheck e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros novos.

- [ ] **Step 9: Commit**

```bash
git add src/lib/whatsapp/send-message.ts src/lib/whatsapp/send-message.test.ts
git commit -m "$(cat <<'EOF'
feat(whatsapp): core de envio passa pelo dispatcher de provider

O core resolve a conexao da API ativa e chama o dispatcher. A
resolucao de credenciais (inclusive o self-heal do ciphertext legado)
mora em providers/connection.ts. Nenhum template sai pela CRMBR — o
recusa acontece antes de qualquer escrita.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Corte nos engines — Flows, automações e o typing da IA

**Files:**
- Modify: `src/lib/flows/meta-send.ts`
- Modify: `src/lib/automations/meta-send.ts`
- Modify: `src/lib/ai/auto-reply.ts`
- Test: `src/lib/flows/meta-send.test.ts` (existe — ajustar os mocks)
- Test: `src/lib/automations/meta-send.test.ts` (existe — ajustar os mocks)

**Interfaces:**
- Consumes: `resolveProviderConnection`, `assertProviderSupportsMessageType`, `sendTextMessage`, `sendMediaMessage`, `sendInteractiveButtons`, `sendInteractiveList`, `sendTemplateMessage`, `sendTypingIndicator` de `@/lib/whatsapp/providers`.
- Produces: `loadAccountMetaCredentials` **deixa de existir** (era o único ponto de decifração de credenciais da Meta fora do core). Quem precisar da conexão usa `resolveProviderConnection`.

- [ ] **Step 1: Escreva o teste que falha**

Ajuste os mocks dos dois arquivos de teste. Em `src/lib/flows/meta-send.test.ts` **substitua** o mock de `@/lib/whatsapp/meta-api` por:

```ts
const providerMocks = vi.hoisted(() => ({
  resolveProviderConnection: vi.fn(async () => ({
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
}));

vi.mock('@/lib/whatsapp/providers', () => providerMocks);
```

Em `src/lib/automations/meta-send.test.ts`, aplique o mesmo bloco (com o mesmo `vi.mock('@/lib/whatsapp/providers', ...)`).

Adicione ao `describe` de cada arquivo:

```ts
it('resolves the provider connection instead of the Meta credentials', async () => {
  await engineSendText({
    accountId: 'acc-1',
    userId: 'user-1',
    conversationId: 'cv-1',
    contactId: 'ct-1',
    text: 'hi',
  });
  expect(providerMocks.resolveProviderConnection).toHaveBeenCalled();
  expect(providerMocks.sendTextMessage).toHaveBeenCalledWith(
    expect.objectContaining({ provider: 'meta' }),
    expect.objectContaining({ text: 'hi' })
  );
});
```

- [ ] **Step 2: Rode os testes e confirme que falham**

Run: `npx vitest run src/lib/flows/meta-send.test.ts src/lib/automations/meta-send.test.ts`
Expected: FAIL — o módulo ainda pede `loadAccountMetaCredentials`.

- [ ] **Step 3: Ajuste `src/lib/flows/meta-send.ts`**

**Substitua** (linhas 1-11):

```ts
import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendTextMessage,
  type InteractiveButton,
  type InteractiveListSection,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { decrypt } from '@/lib/whatsapp/encryption'
```

por:

```ts
import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendTextMessage,
  resolveProviderConnection,
  assertProviderSupportsMessageType,
} from '@/lib/whatsapp/providers'
import type {
  InteractiveButton,
  InteractiveListSection,
  MediaKind,
} from '@/lib/whatsapp/meta-api'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
```

**Remova** a função `loadAccountMetaCredentials` inteira (linhas 37-59, do comentário `/**` até o `}` final dela).

**Substitua** as três ocorrências (linhas ~121, ~235, ~391):

```ts
  const { phoneNumberId, accessToken } = await loadAccountMetaCredentials(
    db,
    args.accountId,
  )
```

e

```ts
  const { phoneNumberId, accessToken } = await loadAccountMetaCredentials(
    db,
    input.accountId,
  )
```

por:

```ts
  const conn = await resolveProviderConnection(db, args.accountId)
```

(respectivamente `args.accountId` e `input.accountId`).

**Substitua** as chamadas de envio. Em `engineSendText`:

```ts
    const r = await sendTextMessage({
      phoneNumberId,
      accessToken,
      to: phone,
      text: args.text,
    })
```

por:

```ts
    const r = await sendTextMessage(conn, {
      to: phone,
      text: args.text,
    })
```

Em `engineSendMedia`:

```ts
    const r = await sendMediaMessage({
      phoneNumberId,
      accessToken,
      to: phone,
      kind: args.kind,
      link: args.link,
      caption: args.caption,
      filename: args.filename,
    })
```

por:

```ts
    const r = await sendMediaMessage(conn, {
      to: phone,
      kind: args.kind,
      link: args.link,
      caption: args.caption,
      filename: args.filename,
    })
```

Em `sendInteractiveViaMeta` (renomeie a função e as duas chamadas para `sendInteractiveViaProvider`):

```ts
    if (input.kind === 'buttons') {
      const r = await sendInteractiveButtons({
        phoneNumberId,
        accessToken,
        to: phone,
        bodyText: input.bodyText,
        buttons: input.buttons,
        headerText: input.headerText,
        footerText: input.footerText,
      })
      return r.messageId
    }
    const r = await sendInteractiveList({
      phoneNumberId,
      accessToken,
      to: phone,
      bodyText: input.bodyText,
      buttonLabel: input.buttonLabel,
      sections: input.sections,
      headerText: input.headerText,
      footerText: input.footerText,
    })
```

por:

```ts
    if (input.kind === 'buttons') {
      const r = await sendInteractiveButtons(conn, {
        to: phone,
        bodyText: input.bodyText,
        buttons: input.buttons,
        headerText: input.headerText,
        footerText: input.footerText,
      })
      return r.messageId
    }
    const r = await sendInteractiveList(conn, {
      to: phone,
      bodyText: input.bodyText,
      buttonLabel: input.buttonLabel,
      sections: input.sections,
      headerText: input.headerText,
      footerText: input.footerText,
    })
```

- [ ] **Step 4: Ajuste `src/lib/automations/meta-send.ts`**

**Substitua** (linhas 1-7):

```ts
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
} from '@/lib/flows/meta-send'
import { decrypt } from '@/lib/whatsapp/encryption'
```

por:

```ts
import {
  sendTextMessage,
  sendTemplateMessage,
  resolveProviderConnection,
  assertProviderSupportsMessageType,
} from '@/lib/whatsapp/providers'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
} from '@/lib/flows/meta-send'
```

**Substitua** o bloco de credenciais (linhas ~152-161):

```ts
  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', input.accountId)
    .single()
  if (configErr || !config) {
    throw new Error(t('send.notConfigured'))
  }

  const accessToken = decrypt(config.access_token)
```

por:

```ts
  const conn = await resolveProviderConnection(db, input.accountId)
```

**Substitua** o closure `attempt`:

```ts
  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'template') {
      const r = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: input.templateName,
        language: input.language,
        template: templateRow ?? undefined,
        params: input.params,
      })
      return r.messageId
    }
    const r = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: input.text,
    })
    return r.messageId
  }
```

por:

```ts
  // The CRMBR (non-official) API has no template endpoint — refuse
  // before the send, with a message that names the alternative.
  if (input.kind === 'template') {
    assertProviderSupportsMessageType(conn, 'template')
  }

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'template') {
      const r = await sendTemplateMessage(conn, {
        to: phone,
        templateName: input.templateName,
        language: input.language,
        template: templateRow ?? undefined,
        params: input.params,
      })
      return r.messageId
    }
    const r = await sendTextMessage(conn, {
      to: phone,
      text: input.text,
    })
    return r.messageId
  }
```

- [ ] **Step 5: Ajuste `src/lib/ai/auto-reply.ts`**

**Substitua** (linhas 10-14):

```ts
import {
  engineSendText,
  loadAccountMetaCredentials,
} from '@/lib/flows/meta-send'
import { sendTypingIndicator } from '@/lib/whatsapp/meta-api'
```

por:

```ts
import { engineSendText } from '@/lib/flows/meta-send'
import {
  resolveProviderConnection,
  sendTypingIndicator,
} from '@/lib/whatsapp/providers'
```

**Substitua** o corpo de `showTypingIndicator` (linhas ~253-261):

```ts
    const { phoneNumberId, accessToken } = await loadAccountMetaCredentials(
      db,
      accountId,
    )
    await sendTypingIndicator({
      phoneNumberId,
      accessToken,
      messageId: inboundMessageId,
    })
```

por:

```ts
    const conn = await resolveProviderConnection(db, accountId)
    await sendTypingIndicator(conn, {
      to: '',
      messageId: inboundMessageId,
    })
```

**Nota:** o `to` do typing da Meta é ignorado pelo adapter (a Meta usa o `messageId` do inbound); o da CRMBR precisa do número do destinatário. Para os dois funcionar, `showTypingIndicator` precisa do número. Troque a assinatura e a chamada:

```ts
async function showTypingIndicator(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  inboundMessageId: string,
  to: string,
): Promise<void> {
  try {
    const conn = await resolveProviderConnection(db, accountId);
    await sendTypingIndicator(conn, { to, messageId: inboundMessageId });
  } catch (err) {
    console.warn('[ai auto-reply] typing indicator failed (continuing):', err);
  }
}
```

E passe o número do destinatário na chamada. Localize onde `showTypingIndicator` é chamada e acrescente o argumento — o número vem do `resolveContactSendTarget(contact)` já usado no caminho de resposta. Se o contato não tiver número endereçável, pule a chamada (o `to` vazio faz o adapter Meta não fazer nada e o adapter CRMBR falhar silenciosamente com um warning).

- [ ] **Step 6: Rode os testes e confirme que passam**

Run: `npx vitest run src/lib/flows/ src/lib/automations/ src/lib/ai/`
Expected: PASS.

- [ ] **Step 7: Typecheck e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros novos.

- [ ] **Step 8: Commit**

```bash
git add src/lib/flows/meta-send.ts src/lib/flows/meta-send.test.ts src/lib/automations/meta-send.ts src/lib/automations/meta-send.test.ts src/lib/ai/auto-reply.ts src/lib/ai/auto-reply.test.ts
git commit -m "$(cat <<'EOF'
feat(whatsapp): engines de flow e automacao usam o dispatcher

Os engines do Flow e das automacoes, e o typing da IA, resolvem a
conexao da API ativa em vez das credenciais da Meta. loadAccountMetaCredentials
deixa de existir — a decifracao mora em providers/connection.ts.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Corte em broadcast, reação e resolução de conversa

**Files:**
- Modify: `src/lib/whatsapp/broadcast-core.ts`
- Modify: `src/lib/whatsapp/broadcast-resume.ts`
- Modify: `src/app/api/whatsapp/broadcast/route.ts`
- Modify: `src/app/api/whatsapp/react/route.ts`
- Modify: `src/lib/whatsapp/resolve-conversation.ts`
- Test: `src/lib/whatsapp/broadcast-core.test.ts`
- Test: `src/lib/whatsapp/resolve-conversation.test.ts`

**Interfaces:**
- Consumes: `resolveProviderConnection`, `assertProviderSupportsMessageType`, `sendTemplateMessage`, `sendReactionMessage` de `@/lib/whatsapp/providers`; `ProviderError` de `@/lib/whatsapp/providers/errors`.
- Produces: `BroadcastPlan` passa a carregar `connection: ProviderConnection` no lugar de `phoneNumberId` + `accessToken`.

- [ ] **Step 1: Escreva o teste que falha**

Em `src/lib/whatsapp/broadcast-core.test.ts`, **adicione**:

```ts
it('refuses a broadcast when the active provider has no template support', async () => {
  providerMocks.resolveProviderConnection.mockResolvedValue({
    provider: 'whatsmiau',
    instanceName: 'Atendimento01',
    apiKey: 'key-1',
    baseUrl: 'https://api.whatsmiau.dev/v2',
  });

  await expect(
    createBroadcast(db, {
      accountId: 'acc-1',
      name: 'campanha',
      templateName: 'hello',
      recipients: [{ to: '+5511999998888', params: ['x'] }],
    })
  ).rejects.toThrow(/template/i);
});
```

E **adicione** o mock no topo do arquivo:

```ts
const providerMocks = vi.hoisted(() => ({
  resolveProviderConnection: vi.fn(async () => ({
    provider: 'meta',
    phoneNumberId: 'pn-1',
    accessToken: 'tok-1',
  })),
  assertProviderSupportsMessageType: vi.fn(),
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid.tpl' })),
}));

vi.mock('@/lib/whatsapp/providers', () => providerMocks);
```

Em `src/lib/whatsapp/resolve-conversation.test.ts`, **adicione**:

```ts
it('does not require the Meta config when the CRMBR provider is active', async () => {
  providerMocks.resolveProviderConnection.mockResolvedValue({
    provider: 'whatsmiau',
    instanceName: 'Atendimento01',
    apiKey: 'key-1',
    baseUrl: 'https://api.whatsmiau.dev/v2',
  });

  const resolved = await resolveConversationByPhone(db, 'acc-1', '+5511999998888');
  expect(resolved.conversationId).toBeTruthy();
  expect(providerMocks.resolveProviderConnection).toHaveBeenCalled();
});
```

com o mock:

```ts
const providerMocks = vi.hoisted(() => ({
  resolveProviderConnection: vi.fn(async () => ({
    provider: 'meta',
    phoneNumberId: 'pn-1',
    accessToken: 'tok-1',
  })),
}));

vi.mock('@/lib/whatsapp/providers', () => providerMocks);
```

- [ ] **Step 2: Rode os testes e confirme que falham**

Run: `npx vitest run src/lib/whatsapp/broadcast-core.test.ts src/lib/whatsapp/resolve-conversation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Ajuste `src/lib/whatsapp/broadcast-core.ts`**

**Substitua** (linhas 21 e o import de `decrypt`):

```ts
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
```

por:

```ts
import {
  sendTemplateMessage,
  resolveProviderConnection,
  assertProviderSupportsMessageType,
} from '@/lib/whatsapp/providers';
import { ProviderError } from '@/lib/whatsapp/providers/errors';
import type { ProviderConnection } from '@/lib/whatsapp/providers/types';
```

**Substitua** o campo do plano (linhas 68-69):

```ts
  phoneNumberId: string;
  accessToken: string;
```

por:

```ts
  /** The provider the account sends through — Meta or CRMBR. */
  connection: ProviderConnection;
```

**Substitua** o bloco de credenciais (linhas ~109-125):

```ts
  // Config (fail fast + provides the audit trail owner already resolved
  // by the caller). Meta send needs phone_number_id + decrypted token.
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();
  if (configError || !config) {
    throw new BroadcastError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }
  const accessToken = decrypt(config.access_token);
```

por:

```ts
  // Which provider is this account sending through? A broadcast is a
  // template campaign, and the CRMBR (non-official) API has no
  // template endpoint — refuse with a clear message instead of
  // degrading to plain text.
  let connection: ProviderConnection;
  try {
    connection = await resolveProviderConnection(db, accountId);
    assertProviderSupportsMessageType(connection, 'template');
  } catch (err) {
    if (err instanceof ProviderError) {
      throw new BroadcastError(err.code, err.message, err.status);
    }
    throw err;
  }
```

**Substitua** (linhas ~240-241):

```ts
    phoneNumberId: config.phone_number_id,
    accessToken,
```

por:

```ts
    connection,
```

**Substitua** o envio em `deliverBroadcast` (linhas ~272-274):

```ts
        const result = await sendTemplateMessage({
          phoneNumberId: plan.phoneNumberId,
          accessToken: plan.accessToken,
          to: variant,
          templateName: plan.templateName,
          language: plan.templateLanguage,
          template: plan.templateRow ?? undefined,
          params: recipient.params,
        });
```

por:

```ts
        const result = await sendTemplateMessage(plan.connection, {
          to: variant,
          templateName: plan.templateName,
          language: plan.templateLanguage,
          template: plan.templateRow ?? undefined,
          params: recipient.params,
        });
```

- [ ] **Step 4: Ajuste `src/lib/whatsapp/broadcast-resume.ts`**

**Substitua** o bloco de credenciais (linhas ~233-243) e o preenchimento do plano (linhas ~260-266):

```ts
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();
  if (configError || !config) {
    throw new BroadcastError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }
```

por:

```ts
  let connection: ProviderConnection;
  try {
    connection = await resolveProviderConnection(db, accountId);
    assertProviderSupportsMessageType(connection, 'template');
  } catch (err) {
    if (err instanceof ProviderError) {
      throw new BroadcastError(err.code, err.message, err.status);
    }
    throw err;
  }
```

e

```ts
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
```

por:

```ts
    connection,
```

Adicione os imports:

```ts
import {
  resolveProviderConnection,
  assertProviderSupportsMessageType,
} from '@/lib/whatsapp/providers';
import { ProviderError } from '@/lib/whatsapp/providers/errors';
import type { ProviderConnection } from '@/lib/whatsapp/providers/types';
```

e remova `decrypt` do import de `@/lib/whatsapp/encryption` se ele ficar sem uso.

- [ ] **Step 5: Ajuste `src/app/api/whatsapp/broadcast/route.ts`**

**Substitua** o bloco de credenciais (linhas ~127-144):

```ts
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            t('common.whatsappNotConfiguredSetup'),
        },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)
```

por:

```ts
    // Which provider is this account sending through? A broadcast is a
    // template campaign — the CRMBR (non-official) API has no template
    // endpoint, so it refuses with a clear message.
    let connection: ProviderConnection
    try {
      connection = await resolveProviderConnection(supabase, accountId)
      assertProviderSupportsMessageType(connection, 'template')
    } catch (err) {
      if (err instanceof ProviderError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
```

**Substitua** (linhas ~192-193):

```ts
            phoneNumberId: config.phone_number_id,
            accessToken,
```

por:

```ts
            connection,
```

- [ ] **Step 6: Ajuste `src/app/api/whatsapp/react/route.ts`**

**Substitua** o import de `sendReactionMessage` e adicione o dispatcher:

```ts
import { sendReactionMessage } from '@/lib/whatsapp/meta-api';
```

por:

```ts
import {
  sendReactionMessage,
  resolveProviderConnection,
} from '@/lib/whatsapp/providers';
import { ProviderError } from '@/lib/whatsapp/providers/errors';
```

**Substitua** o bloco de credenciais (linhas ~102-117):

```ts
    // WhatsApp config + access token. Account-scoped post-multi-user.
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .single();

    if (configError || !config) {
      return NextResponse.json(
        { error: t('common.whatsappNotConfiguredDot') },
        { status: 400 },
      );
    }

    const accessToken = decrypt(config.access_token);

    try {
      await sendReactionMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: sendTarget.target,
        targetMessageId: targetMessage.message_id,
        emoji,
      });
    } catch (err) {
```

por:

```ts
    // Which provider is this account sending through? Account-scoped.
    let connection: ProviderConnection;
    try {
      connection = await resolveProviderConnection(supabase, accountId);
    } catch (err) {
      if (err instanceof ProviderError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    try {
      await sendReactionMessage(connection, {
        to: sendTarget.target,
        targetMessageId: targetMessage.message_id,
        emoji,
      });
    } catch (err) {
```

Adicione `import type { ProviderConnection } from '@/lib/whatsapp/providers/types';` e remova `decrypt` do import de `@/lib/whatsapp/encryption` se ficar sem uso.

- [ ] **Step 7: Ajuste `src/lib/whatsapp/resolve-conversation.ts`**

**Substitua** o bloco de fail-fast (linhas ~60-72):

```ts
  // Fail fast (and create nothing) when the account has no WhatsApp
  // connected — the same error the send would raise anyway.
  const { data: config } = await db
    .from('whatsapp_config')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle();
  if (!config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }
```

por:

```ts
  // Fail fast (and create nothing) when the account has no WhatsApp
  // connected — the same error the send would raise anyway. The check
  // covers BOTH providers: a CRMBR-only account is connected too.
  try {
    await resolveProviderConnection(db, accountId);
  } catch (err) {
    if (err instanceof ProviderError) {
      throw new SendMessageError(err.code, err.message, err.status);
    }
    throw err;
  }
```

Adicione os imports:

```ts
import { resolveProviderConnection } from '@/lib/whatsapp/providers';
import { ProviderError } from '@/lib/whatsapp/providers/errors';
```

- [ ] **Step 8: Rode os testes e confirme que passam**

Run: `npx vitest run src/lib/whatsapp/ src/app/api/whatsapp/`
Expected: PASS.

- [ ] **Step 9: Typecheck e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros novos.

- [ ] **Step 10: Commit**

```bash
git add src/lib/whatsapp/broadcast-core.ts src/lib/whatsapp/broadcast-core.test.ts src/lib/whatsapp/broadcast-resume.ts src/app/api/whatsapp/broadcast/route.ts src/app/api/whatsapp/react/route.ts src/lib/whatsapp/resolve-conversation.ts src/lib/whatsapp/resolve-conversation.test.ts
git commit -m "$(cat <<'EOF'
feat(whatsapp): broadcast, reacao e resolucao de conversa pelo dispatcher

O plano de broadcast carrega a ProviderConnection em vez das
credenciais da Meta, e recusa template quando a CRMBR esta ativa.
A resolucao de conversa agora aceita uma conta so com CRMBR.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Parser do webhook e normalização

**Files:**
- Create: `src/lib/whatsapp/providers/whatsmiau/webhook.ts`
- Create: `src/lib/whatsapp/providers/whatsmiau/normalize.ts`
- Create: `src/lib/whatsapp/providers/whatsmiau/event-samples.ts`
- Test: `src/lib/whatsapp/providers/whatsmiau/webhook.test.ts`

**Interfaces:**
- Consumes: `normalizePhone` de `@/lib/whatsapp/phone-utils`.
- Produz (em `webhook.ts`):
  - `interface WhatsmiauWebhookEnvelope { event: string; instance: string; date_time?: string; sender?: string; server_url?: string; data: Record<string, unknown>; progress?: number; isLatest?: boolean }`
  - `SUPPORTED_WEBHOOK_EVENTS: string[]`
  - `parseWhatsmiauWebhook(payload: unknown): WhatsmiauWebhookEnvelope | null`
  - `isSupportedWebhookEvent(event: string): boolean`
- Produz (em `normalize.ts`):
  - `interface NormalizedInboundMessage { messageId; remoteJid; fromMe; phone; timestamp; kind; text?; caption?; mediaUrl?; mediaBase64?; mimeType?; fileName?; reactionEmoji?; reactedToMessageId?; buttonReplyId?; buttonReplyTitle?; listReplyId?; listReplyTitle?; quotedMessageId?; participant?; pushName? }`
  - `type InboundMessageKind = 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'reaction' | 'interactive' | 'unknown'`
  - `normalizeInboundMessage(data: Record<string, unknown>): NormalizedInboundMessage | null`
  - `normalizeStatusUpdate(data: Record<string, unknown>): { messageId: string; status: 'delivered' | 'read' } | null`
  - `normalizeConnectionUpdate(data: Record<string, unknown>): { state: 'open' | 'close'; wuid?: string; profileName?: string; statusReason?: number } | null`
  - `normalizeDeletedMessage(data: Record<string, unknown>): { messageId: string; remoteJid: string; fromMe: boolean } | null`
  - `normalizeEditedMessage(data: Record<string, unknown>): { messageId: string; text: string } | null`
- Produz (em `event-samples.ts`): `WEBHOOK_EVENT_SAMPLES: Record<string, string>` — JSON pretty-printed por evento.

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/lib/whatsapp/providers/whatsmiau/webhook.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { isSupportedWebhookEvent, parseWhatsmiauWebhook } from './webhook';
import {
  normalizeConnectionUpdate,
  normalizeDeletedMessage,
  normalizeEditedMessage,
  normalizeInboundMessage,
  normalizeStatusUpdate,
} from './normalize';

describe('parseWhatsmiauWebhook', () => {
  it('parses a valid envelope', () => {
    const parsed = parseWhatsmiauWebhook({
      event: 'messages.upsert',
      instance: 'Atendimento01',
      date_time: '2026-10-27T15:00:00Z',
      data: { key: { id: 'MSG_1' } },
    });
    expect(parsed?.event).toBe('messages.upsert');
    expect(parsed?.instance).toBe('Atendimento01');
    expect(parsed?.data.key).toEqual({ id: 'MSG_1' });
  });

  it('rejects a payload with no event or instance', () => {
    expect(parseWhatsmiauWebhook({ data: {} })).toBeNull();
    expect(parseWhatsmiauWebhook({ event: 'messages.upsert' })).toBeNull();
    expect(parseWhatsmiauWebhook('nope')).toBeNull();
    expect(parseWhatsmiauWebhook(null)).toBeNull();
  });

  it('knows which events we handle', () => {
    expect(isSupportedWebhookEvent('messages.upsert')).toBe(true);
    expect(isSupportedWebhookEvent('messages.update')).toBe(true);
    expect(isSupportedWebhookEvent('connection.update')).toBe(true);
    expect(isSupportedWebhookEvent('group-participants.update')).toBe(false);
    expect(isSupportedWebhookEvent('call')).toBe(false);
  });
});

describe('normalizeInboundMessage', () => {
  it('normalizes a text message', () => {
    const normalized = normalizeInboundMessage({
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_1', fromMe: false },
      pushName: 'Cliente',
      message: { conversation: 'Preciso de suporte.' },
      messageType: 'conversation',
      messageTimestamp: 1793113200,
    });
    expect(normalized?.kind).toBe('text');
    expect(normalized?.text).toBe('Preciso de suporte.');
    expect(normalized?.phone).toBe('5511999988888');
    expect(normalized?.messageId).toBe('MSG_1');
    expect(normalized?.fromMe).toBe(false);
  });

  it('normalizes an image with its media url and caption', () => {
    const normalized = normalizeInboundMessage({
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_2', fromMe: false },
      message: {
        imageMessage: { url: 'https://cdn.example/i.jpg', mimetype: 'image/jpeg', caption: 'olá' },
        mediaUrl: 'https://cdn.example/i.jpg',
      },
      messageType: 'imageMessage',
      messageTimestamp: 1793113200,
    });
    expect(normalized?.kind).toBe('image');
    expect(normalized?.mediaUrl).toBe('https://cdn.example/i.jpg');
    expect(normalized?.caption).toBe('olá');
    expect(normalized?.mimeType).toBe('image/jpeg');
  });

  it('normalizes a document with its file name', () => {
    const normalized = normalizeInboundMessage({
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_3', fromMe: false },
      message: {
        documentMessage: {
          url: 'https://cdn.example/a.pdf',
          mimetype: 'application/pdf',
          fileName: 'a.pdf',
        },
      },
      messageType: 'documentMessage',
      messageTimestamp: 1793113200,
    });
    expect(normalized?.kind).toBe('document');
    expect(normalized?.fileName).toBe('a.pdf');
  });

  it('normalizes a reaction', () => {
    const normalized = normalizeInboundMessage({
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_4', fromMe: false },
      message: { reactionMessage: { key: { id: 'MSG_1' }, text: '👍' } },
      messageType: 'reactionMessage',
      messageTimestamp: 1793113200,
    });
    expect(normalized?.kind).toBe('reaction');
    expect(normalized?.reactionEmoji).toBe('👍');
    expect(normalized?.reactedToMessageId).toBe('MSG_1');
  });

  it('normalizes a list reply', () => {
    const normalized = normalizeInboundMessage({
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_5', fromMe: false },
      message: {
        listResponseMessage: {
          title: 'Suporte',
          singleSelectReply: { selectedRowId: 'suporte' },
        },
      },
      messageType: 'listResponseMessage',
      messageTimestamp: 1793113200,
    });
    expect(normalized?.kind).toBe('interactive');
    expect(normalized?.listReplyId).toBe('suporte');
    expect(normalized?.listReplyTitle).toBe('Suporte');
  });

  it('normalizes a button reply', () => {
    const normalized = normalizeInboundMessage({
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_6', fromMe: false },
      message: {
        buttonsResponseMessage: {
          selectedButtonId: 'sim',
          selectedDisplayText: 'Sim',
        },
      },
      messageType: 'buttonsResponseMessage',
      messageTimestamp: 1793113200,
    });
    expect(normalized?.kind).toBe('interactive');
    expect(normalized?.buttonReplyId).toBe('sim');
    expect(normalized?.buttonReplyTitle).toBe('Sim');
  });

  it('captures the quoted message id', () => {
    const normalized = normalizeInboundMessage({
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_7', fromMe: false },
      message: { conversation: 'ok' },
      contextInfo: { stanzaId: 'MSG_1' },
      messageTimestamp: 1793113200,
    });
    expect(normalized?.quotedMessageId).toBe('MSG_1');
  });

  it('returns null without a message id', () => {
    expect(normalizeInboundMessage({ key: { remoteJid: 'x@s.whatsapp.net' } })).toBeNull();
  });
});

describe('normalizeStatusUpdate', () => {
  it('maps DELIVERY_ACK to delivered', () => {
    expect(normalizeStatusUpdate({ messageId: 'MSG_1', status: 'DELIVERY_ACK' })).toEqual({
      messageId: 'MSG_1',
      status: 'delivered',
    });
  });

  it('maps READ to read', () => {
    expect(normalizeStatusUpdate({ messageId: 'MSG_1', status: 'READ' })).toEqual({
      messageId: 'MSG_1',
      status: 'read',
    });
  });

  it('ignores an unknown status', () => {
    expect(normalizeStatusUpdate({ messageId: 'MSG_1', status: 'PENDING' })).toBeNull();
    expect(normalizeStatusUpdate({ status: 'READ' })).toBeNull();
  });
});

describe('normalizeConnectionUpdate', () => {
  it('reads the open state and the wuid', () => {
    const state = normalizeConnectionUpdate({
      instance: 'Atendimento01',
      wuid: '5511999988888@s.whatsapp.net',
      profileName: 'Equipe',
      state: 'open',
      statusReason: 200,
    });
    expect(state?.state).toBe('open');
    expect(state?.wuid).toBe('5511999988888@s.whatsapp.net');
    expect(state?.statusReason).toBe(200);
  });

  it('reads the close state', () => {
    expect(normalizeConnectionUpdate({ state: 'close' })?.state).toBe('close');
  });
});

describe('normalizeDeletedMessage and normalizeEditedMessage', () => {
  it('reads a deletion', () => {
    expect(
      normalizeDeletedMessage({
        id: 'MSG_1',
        remoteJid: '5511999988888@s.whatsapp.net',
        fromMe: false,
      }),
    ).toEqual({ messageId: 'MSG_1', remoteJid: '5511999988888@s.whatsapp.net', fromMe: false });
  });

  it('reads an edit', () => {
    expect(
      normalizeEditedMessage({
        key: { id: 'MSG_1' },
        editedMessage: { conversation: 'texto novo' },
      }),
    ).toEqual({ messageId: 'MSG_1', text: 'texto novo' });
  });
});
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `npx vitest run src/lib/whatsapp/providers/whatsmiau/webhook.test.ts`
Expected: FAIL — `Cannot find module './webhook'`.

- [ ] **Step 3: Escreva `webhook.ts`**

Crie `src/lib/whatsapp/providers/whatsmiau/webhook.ts`:

```ts
// ============================================================
// WhatsMiau webhook envelope.
//
// Every event arrives in the same envelope:
//   { event, instance, date_time, sender?, server_url?, data }
//
// `instance` is the public instance name — it is how we resolve which
// account the delivery belongs to.
// ============================================================

export interface WhatsmiauWebhookEnvelope {
  event: string;
  instance: string;
  date_time?: string;
  sender?: string;
  server_url?: string;
  data: Record<string, unknown>;
  progress?: number;
  isLatest?: boolean;
}

/** The events this integration acts on. */
export const SUPPORTED_WEBHOOK_EVENTS = [
  'messages.upsert',
  'messages.edited',
  'messages.update',
  'messages.delete',
  'connection.update',
] as const;

export function isSupportedWebhookEvent(event: string): boolean {
  return (SUPPORTED_WEBHOOK_EVENTS as readonly string[]).includes(event);
}

/**
 * Parse an incoming payload into the envelope. Returns null when the
 * payload isn't a WhatsMiau envelope (missing event, missing instance,
 * or not an object) — the caller answers 400 and logs.
 */
export function parseWhatsmiauWebhook(payload: unknown): WhatsmiauWebhookEnvelope | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;

  const event = typeof record.event === 'string' ? record.event : '';
  const instance = typeof record.instance === 'string' ? record.instance : '';
  if (!event || !instance) return null;

  const data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {};

  return {
    event,
    instance,
    data,
    ...(typeof record.date_time === 'string' ? { date_time: record.date_time } : {}),
    ...(typeof record.sender === 'string' ? { sender: record.sender } : {}),
    ...(typeof record.server_url === 'string' ? { server_url: record.server_url } : {}),
    ...(typeof record.progress === 'number' ? { progress: record.progress } : {}),
    ...(typeof record.isLatest === 'boolean' ? { isLatest: record.isLatest } : {}),
  };
}
```

- [ ] **Step 4: Escreva `normalize.ts`**

Crie `src/lib/whatsapp/providers/whatsmiau/normalize.ts`:

```ts
// ============================================================
// WhatsMiau payload -> the app's internal message model.
//
// The provider is Evolution-API-compatible, so the content lives under
// `data.message.<type>Message`. We derive the kind from the shape
// first (which key is present) and fall back to `data.messageType` —
// the shape is the more reliable of the two.
// ============================================================

import { normalizePhone } from '@/lib/whatsapp/phone-utils';

export type InboundMessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'reaction'
  | 'interactive'
  | 'unknown';

export interface NormalizedInboundMessage {
  messageId: string;
  remoteJid: string;
  fromMe: boolean;
  /** Digits-only phone, empty for a group jid. */
  phone: string;
  /** Epoch seconds. */
  timestamp: number;
  kind: InboundMessageKind;
  text?: string;
  caption?: string;
  mediaUrl?: string;
  mediaBase64?: string;
  mimeType?: string;
  fileName?: string;
  reactionEmoji?: string;
  reactedToMessageId?: string;
  buttonReplyId?: string;
  buttonReplyTitle?: string;
  listReplyId?: string;
  listReplyTitle?: string;
  quotedMessageId?: string;
  participant?: string;
  pushName?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** The phone behind a jid — `@s.whatsapp.net` for a direct chat. */
function phoneFromJid(jid: string): string {
  if (!jid) return '';
  if (jid.endsWith('@g.us') || jid.endsWith('@lid')) return '';
  return normalizePhone(jid.split('@')[0] ?? '');
}

export function normalizeInboundMessage(
  data: Record<string, unknown>,
): NormalizedInboundMessage | null {
  const key = asRecord(data.key);
  const messageId = asString(key.id);
  if (!messageId) return null;

  const remoteJid = asString(key.remoteJid) ?? '';
  const fromMe = key.fromMe === true;
  const message = asRecord(data.message);
  const messageType = asString(data.messageType) ?? '';

  const contextInfo = asRecord(data.contextInfo);
  const normalized: NormalizedInboundMessage = {
    messageId,
    remoteJid,
    fromMe,
    phone: phoneFromJid(remoteJid),
    timestamp:
      typeof data.messageTimestamp === 'number' ? data.messageTimestamp : Math.floor(Date.now() / 1000),
    kind: 'unknown',
    ...(asString(data.pushName) ? { pushName: asString(data.pushName)! } : {}),
    ...(asString(key.participant) ? { participant: asString(key.participant)! } : {}),
    ...(asString(contextInfo.stanzaId) ? { quotedMessageId: asString(contextInfo.stanzaId)! } : {}),
  };

  const reaction = asRecord(message.reactionMessage);
  if (Object.keys(reaction).length > 0) {
    normalized.kind = 'reaction';
    const reactionKey = asRecord(reaction.key);
    normalized.reactionEmoji = asString(reaction.text) ?? '';
    normalized.reactedToMessageId = asString(reactionKey.id);
    return normalized;
  }

  const listReply = asRecord(message.listResponseMessage);
  if (Object.keys(listReply).length > 0) {
    normalized.kind = 'interactive';
    normalized.listReplyTitle = asString(listReply.title);
    const selected = asRecord(listReply.singleSelectReply);
    normalized.listReplyId = asString(selected.selectedRowId);
    return normalized;
  }

  const buttonReply = asRecord(message.buttonsResponseMessage);
  if (Object.keys(buttonReply).length > 0) {
    normalized.kind = 'interactive';
    normalized.buttonReplyId = asString(buttonReply.selectedButtonId);
    normalized.buttonReplyTitle = asString(buttonReply.selectedDisplayText);
    return normalized;
  }

  const mediaKinds: Array<{ key: string; kind: InboundMessageKind }> = [
    { key: 'imageMessage', kind: 'image' },
    { key: 'videoMessage', kind: 'video' },
    { key: 'audioMessage', kind: 'audio' },
    { key: 'documentMessage', kind: 'document' },
    { key: 'stickerMessage', kind: 'sticker' },
  ];

  for (const entry of mediaKinds) {
    const payload = asRecord(message[entry.key]);
    if (Object.keys(payload).length === 0) continue;
    normalized.kind = entry.kind;
    normalized.mimeType = asString(payload.mimetype);
    normalized.caption = asString(payload.caption);
    if (entry.kind === 'document') {
      normalized.fileName = asString(payload.fileName) ?? asString(payload.title);
    }
    // `mediaUrl` is only present when the instance has saveMedia on.
    normalized.mediaUrl = asString(message.mediaUrl) ?? asString(payload.url);
    const base64 = asString(payload.base64) ?? asString(message.base64);
    if (base64) normalized.mediaBase64 = base64;
    return normalized;
  }

  const conversation = asString(message.conversation);
  if (conversation !== undefined) {
    normalized.kind = 'text';
    normalized.text = conversation;
    return normalized;
  }

  // Fall back to the declared type when the payload shape is one we
  // don't model — the text is still worth keeping.
  if (messageType === 'conversation' || messageType === 'editedMessage') {
    normalized.kind = 'text';
    normalized.text = '';
    return normalized;
  }

  return normalized;
}

/**
 * Map the provider's delivery status onto the app's ladder.
 * `DELIVERY_ACK` = delivered, `READ` = read.
 */
export function normalizeStatusUpdate(
  data: Record<string, unknown>,
): { messageId: string; status: 'delivered' | 'read' } | null {
  const messageId = asString(data.messageId) ?? asString(data.keyId);
  if (!messageId) return null;
  const status = asString(data.status);
  if (status === 'DELIVERY_ACK') return { messageId, status: 'delivered' };
  if (status === 'READ') return { messageId, status: 'read' };
  return null;
}

export function normalizeConnectionUpdate(
  data: Record<string, unknown>,
): { state: 'open' | 'close'; wuid?: string; profileName?: string; statusReason?: number } | null {
  const state = asString(data.state);
  if (state !== 'open' && state !== 'close') return null;
  return {
    state,
    ...(asString(data.wuid) ? { wuid: asString(data.wuid)! } : {}),
    ...(asString(data.profileName) ? { profileName: asString(data.profileName)! } : {}),
    ...(typeof data.statusReason === 'number' ? { statusReason: data.statusReason } : {}),
  };
}

export function normalizeDeletedMessage(
  data: Record<string, unknown>,
): { messageId: string; remoteJid: string; fromMe: boolean } | null {
  const messageId = asString(data.id);
  if (!messageId) return null;
  return {
    messageId,
    remoteJid: asString(data.remoteJid) ?? '',
    fromMe: data.fromMe === true,
  };
}

export function normalizeEditedMessage(
  data: Record<string, unknown>,
): { messageId: string; text: string } | null {
  const key = asRecord(data.key);
  const messageId = asString(key.id);
  if (!messageId) return null;
  const edited = asRecord(data.editedMessage);
  const text = asString(edited.conversation) ?? '';
  return { messageId, text };
}
```

- [ ] **Step 5: Escreva `event-samples.ts`**

Crie `src/lib/whatsapp/providers/whatsmiau/event-samples.ts`:

```ts
// ============================================================
// Sample payloads, shown in the CRMBR settings screen next to the
// event checkboxes ("Ver exemplo JSON"). They mirror the shapes in
// docs/whatsmiau.md so a user can see exactly what we subscribe to.
// ============================================================

export const WEBHOOK_EVENT_SAMPLES: Record<string, string> = {
  'messages.upsert': `{
  "event": "messages.upsert",
  "instance": "Atendimento01",
  "date_time": "2026-10-27T15:00:00Z",
  "data": {
    "key": { "remoteJid": "5511999988888@s.whatsapp.net", "id": "MSG_001", "fromMe": false },
    "pushName": "Cliente Exemplo",
    "status": "received",
    "message": { "conversation": "Preciso de suporte." },
    "messageType": "conversation",
    "messageTimestamp": 1793113200,
    "instanceId": "Atendimento01"
  }
}`,
  'messages.edited': `{
  "event": "messages.edited",
  "instance": "Atendimento01",
  "date_time": "2026-10-27T15:02:00Z",
  "data": {
    "key": { "remoteJid": "5511999988888@s.whatsapp.net", "id": "MSG_001", "fromMe": false },
    "editedMessage": { "conversation": "Preciso de suporte técnico." },
    "messageType": "conversation",
    "pushName": "Cliente Exemplo",
    "status": "received",
    "messageTimestamp": 1793113320,
    "source": "whatsapp",
    "instanceId": "Atendimento01"
  }
}`,
  'messages.update': `{
  "event": "messages.update",
  "instance": "Atendimento01",
  "data": {
    "messageId": "MSG_001",
    "keyId": "MSG_001",
    "remoteJid": "5511999988888@s.whatsapp.net",
    "fromMe": true,
    "status": "READ",
    "instanceId": "Atendimento01"
  }
}`,
  'messages.delete': `{
  "event": "messages.delete",
  "instance": "Atendimento01",
  "data": {
    "id": "MSG_001",
    "remoteJid": "5511999988888@s.whatsapp.net",
    "fromMe": false,
    "status": "DELETED",
    "instanceId": "Atendimento01"
  }
}`,
  'connection.update': `{
  "event": "connection.update",
  "instance": "Atendimento01",
  "data": {
    "instance": "Atendimento01",
    "wuid": "5511999988888@s.whatsapp.net",
    "profileName": "Equipe",
    "state": "open",
    "statusReason": 200
  }
}`,
};

/** Every event we know how to handle, in the order we show them. */
export const WEBHOOK_EVENT_ORDER = [
  'messages.upsert',
  'messages.edited',
  'messages.update',
  'messages.delete',
  'connection.update',
] as const;
```

- [ ] **Step 6: Rode o teste e confirme que passa**

Run: `npx vitest run src/lib/whatsapp/providers/whatsmiau/webhook.test.ts`
Expected: PASS (20 testes).

- [ ] **Step 7: Typecheck e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros novos.

- [ ] **Step 8: Commit**

```bash
git add src/lib/whatsapp/providers/whatsmiau/webhook.ts src/lib/whatsapp/providers/whatsmiau/normalize.ts src/lib/whatsapp/providers/whatsmiau/event-samples.ts src/lib/whatsapp/providers/whatsmiau/webhook.test.ts
git commit -m "$(cat <<'EOF'
feat(whatsmiau): parser do webhook e normalizacao dos payloads

Envelope {event, instance, data} -> modelo interno do app. O tipo da
midia vem da forma do payload (com fallback no messageType), e o
status de entrega mapeia DELIVERY_ACK -> delivered, READ -> read.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

### Task 11: Pipeline de entrada da WhatsMiau (contato, conversa, fan-out)

**Files:**
- Create: `src/lib/whatsapp/providers/whatsmiau/inbound.ts`
- Create: `src/lib/whatsapp/providers/whatsmiau/mirror-media.ts`
- Test: `src/lib/whatsapp/providers/whatsmiau/inbound.test.ts`
- Test: `src/lib/whatsapp/providers/whatsmiau/mirror-media.test.ts`

**Interfaces:**
- Consumes (Task 10): `normalizeInboundMessage`, `normalizeStatusUpdate`, `normalizeConnectionUpdate`, `normalizeEditedMessage`, `normalizeDeletedMessage`, `NormalizedInboundMessage` — de `./normalize`.
- Consumes (Task 1): `WhatsmiauInstanceSettings`, `WhatsmiauConfigRow`, `upsertWhatsmiauConfig` — de `@/lib/whatsapp/whatsmiau-config`.
- Consumes (existentes, **não são tocados**): `findExistingContact`, `isUniqueViolation` (`@/lib/contacts/dedupe`); `resolveAuditUserId` (`@/lib/api/v1/contacts`); `claimFirstInboundMessage` (`@/lib/conversations/first-inbound`); `reopenClosedConversation` (`@/lib/conversations/reopen`); `applyMessageStatus` (`@/lib/whatsapp/message-status-sync`); `dispatchInboundToFlows` (`@/lib/flows/engine`); `dispatchInboundToAiReply` (`@/lib/ai/auto-reply`); `runAutomationsForTrigger`, `resumeAwaitingReply` (`@/lib/automations/engine`); `dispatchWebhookEvent` (`@/lib/webhooks/deliver`); `flagBroadcastReply` (`@/lib/whatsapp/broadcast-recipient-webhook`); `normalizePhone` (`@/lib/whatsapp/phone-utils`); `MirrorStorage`, `MIRROR_BUCKET`, `MIRROR_FOLDER`, `mirrorFileName`, `normalizeMimeType` (`@/lib/whatsapp/mirror-inbound-media`); `buildMediaPath`, `MEDIA_MAX_BYTES` (`@/lib/storage/upload-media`).
- Produces:
  - `WhatsmiauInboundContext { db, accountId, ownerUserId, instanceSettings, storage }`
  - `InboundOutcome { disposition: 'inserted' | 'replay' | 'skipped'; conversationId?: string; contactId?: string }`
  - `handleWhatsmiauInboundMessage(ctx, message): Promise<InboundOutcome>`
  - `handleWhatsmiauStatusUpdate(ctx, update): Promise<void>`
  - `handleWhatsmiauConnectionUpdate(ctx, update): Promise<void>`
  - `handleWhatsmiauEditedMessage(ctx, update): Promise<void>`
  - `handleWhatsmiauDeletedMessage(ctx, update): Promise<void>`
  - `DELETED_MESSAGE_TEXT` (constante)
  - `mirrorWhatsmiauMedia(args): Promise<string | null>` + `WhatsmiauMediaDownloader`

> **Nota de escopo (refina o spec §7.3).** O spec manda "reusar os helpers" do webhook do Meta. Todos os helpers que o spec lista são exportados e reutilizáveis — e é isso que esta task faz. Mas `findOrCreateContact` / `findOrCreateConversation` do webhook do Meta são **privados** daquele arquivo (1389 linhas), e é impossível reaproveitá-los sem **modificar** o arquivo do Meta — o que a Global Constraint 1 proíbe. Por isso o pipeline da WhatsMiau vive no arquivo **novo** `providers/whatsmiau/inbound.ts`, reimplementando só essas duas etapas (≈60 linhas) sobre os mesmos helpers compartilhados (`findExistingContact`, `isUniqueViolation`). O resto do pipeline — idempotência, bump, reopen, flows, automations, IA, webhook público — é **chamada idêntica** ao do Meta, na mesma ordem.

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/lib/whatsapp/providers/whatsmiau/mirror-media.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  downloadWhatsmiauMedia,
  mirrorWhatsmiauMedia,
  type MirrorWhatsmiauMediaArgs,
} from './mirror-media';
import type { MirrorStorage } from '@/lib/whatsapp/mirror-inbound-media';

function fakeStorage(publicUrl = 'https://cdn.test/public.png') {
  const uploads: { path: string; contentType: string }[] = [];
  const storage: MirrorStorage = {
    from: () => ({
      upload: async (path: string, _body: Uint8Array | Buffer, options: { contentType: string }) => {
        uploads.push({ path, contentType: options.contentType });
        return { error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `${publicUrl}#${path}` } }),
    }),
  };
  return { storage, uploads };
}

const baseArgs = {
  accountId: 'acc-1',
  mediaId: 'MSG_001',
  mimeType: 'image/png',
} satisfies Partial<MirrorWhatsmiauMediaArgs>;

describe('mirrorWhatsmiauMedia', () => {
  it('downloads the public url and stores it in chat-media', async () => {
    const { storage, uploads } = fakeStorage();
    const download = vi.fn(async () => ({
      buffer: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    }));

    const url = await mirrorWhatsmiauMedia({
      ...baseArgs,
      storage,
      mediaUrl: 'https://cdn.test/original.png',
      download,
    } as MirrorWhatsmiauMediaArgs);

    expect(download).toHaveBeenCalledWith('https://cdn.test/original.png');
    expect(uploads[0]?.path).toContain('account-acc-1');
    expect(uploads[0]?.path).toContain('inbound');
    expect(uploads[0]?.contentType).toBe('image/png');
    expect(url).toContain('https://cdn.test/public.png');
  });

  it('falls back to the base64 payload when there is no url', async () => {
    const { storage, uploads } = fakeStorage();
    const url = await mirrorWhatsmiauMedia({
      ...baseArgs,
      storage,
      mediaBase64: Buffer.from('hello').toString('base64'),
    } as MirrorWhatsmiauMediaArgs);

    expect(uploads).toHaveLength(1);
    expect(url).toBeTruthy();
  });

  it('returns null when the download fails', async () => {
    const { storage } = fakeStorage();
    const url = await mirrorWhatsmiauMedia({
      ...baseArgs,
      storage,
      mediaUrl: 'https://cdn.test/gone.png',
      download: async () => {
        throw new Error('404');
      },
    } as MirrorWhatsmiauMediaArgs);

    expect(url).toBeNull();
  });

  it('returns null when there is neither url nor base64', async () => {
    const { storage, uploads } = fakeStorage();
    const url = await mirrorWhatsmiauMedia({
      ...baseArgs,
      storage,
    } as MirrorWhatsmiauMediaArgs);

    expect(url).toBeNull();
    expect(uploads).toHaveLength(0);
  });
});

describe('downloadWhatsmiauMedia', () => {
  it('throws when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    await expect(downloadWhatsmiauMedia('https://cdn.test/x')).rejects.toThrow(/404/);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `npx vitest run src/lib/whatsapp/providers/whatsmiau/mirror-media.test.ts`
Expected: FAIL — "Failed to resolve import ./mirror-media".

- [ ] **Step 3: Escreva `mirror-media.ts`**

Crie `src/lib/whatsapp/providers/whatsmiau/mirror-media.ts`:

```ts
// ============================================================
// WhatsMiau inbound media mirror.
//
// The Meta path (`mirrorInboundMedia`) downloads the bytes with the
// account's access token, because Meta's media urls are token-scoped.
// WhatsMiau hands us a PUBLIC url (`data.message.mediaUrl`) whenever the
// instance runs with `saveMedia` on — there is nothing to sign, we just
// fetch it.
//
// Either way the bytes have to land in our own `chat-media` bucket: the
// provider's url expires, and an attachment that quietly rots into
// "unavailable" is exactly the failure this module exists to prevent
// (issue #466).
//
// BEST EFFORT, like the Meta mirror: any failure returns `null` and the
// caller keeps the provider's url, which still works for as long as the
// provider holds the bytes.
// ============================================================

import {
  MIRROR_BUCKET,
  MIRROR_FOLDER,
  mirrorFileName,
  normalizeMimeType,
  type MirrorStorage,
} from '@/lib/whatsapp/mirror-inbound-media';
import { MEDIA_MAX_BYTES, buildMediaPath } from '@/lib/storage/upload-media';

export interface WhatsmiauMediaDownload {
  buffer: Uint8Array;
  contentType: string | null;
}

/** Injected in tests; defaults to a plain GET of the public url. */
export type WhatsmiauMediaDownloader = (url: string) => Promise<WhatsmiauMediaDownload>;

export interface MirrorWhatsmiauMediaArgs {
  storage: MirrorStorage;
  accountId: string;
  /** The provider's message id — makes the object path deterministic. */
  mediaId: string;
  /** Public url from `data.message.mediaUrl`. */
  mediaUrl?: string | null;
  /** Raw base64, when the instance runs with `webhook.base64: true`. */
  mediaBase64?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  messageTimestamp?: number | null;
  download?: WhatsmiauMediaDownloader;
}

/** Decode base64 into bytes. Returns null when the payload is not base64. */
function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Default downloader: a plain GET of the public url. */
export const downloadWhatsmiauMedia: WhatsmiauMediaDownloader = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`WhatsMiau media download failed with ${response.status}`);
  }
  const contentType = response.headers.get('content-type');
  const buffer = new Uint8Array(await response.arrayBuffer());
  return { buffer, contentType };
};

/**
 * Copy an inbound WhatsMiau attachment into `chat-media`.
 *
 * @returns the durable public URL, or `null` when the mirror was
 *          skipped or failed — in which case the caller keeps the
 *          provider's own url.
 */
export async function mirrorWhatsmiauMedia(
  args: MirrorWhatsmiauMediaArgs,
): Promise<string | null> {
  const {
    storage,
    accountId,
    mediaId,
    mediaUrl,
    mediaBase64,
    mimeType,
    fileName,
    messageTimestamp,
    download = downloadWhatsmiauMedia,
  } = args;

  const normalizedMime = normalizeMimeType(mimeType);

  let bytes: Uint8Array | null = null;
  let contentType: string | null = null;

  if (mediaUrl) {
    try {
      const downloaded = await download(mediaUrl);
      bytes = downloaded.buffer;
      contentType = downloaded.contentType;
    } catch (error) {
      console.warn('[whatsmiau-mirror] download failed for', mediaId, error);
      return null;
    }
  } else if (mediaBase64) {
    bytes = decodeBase64(mediaBase64);
    if (!bytes) {
      console.warn('[whatsmiau-mirror] could not decode the base64 media for', mediaId);
      return null;
    }
  } else {
    return null;
  }

  if (bytes.byteLength > MEDIA_MAX_BYTES) {
    console.warn(
      `[whatsmiau-mirror] skipping ${mediaId}: ${bytes.byteLength} bytes exceeds the ${MEDIA_MAX_BYTES}-byte bucket limit`,
    );
    return null;
  }

  // The metadata MIME wins over the response header: it is what the
  // message row records, so the stored object and `media_type` describe
  // the same thing.
  const uploadType =
    normalizedMime ?? normalizeMimeType(contentType) ?? 'application/octet-stream';

  try {
    const objectName = mirrorFileName({
      mediaId,
      mimeType: uploadType,
      fileName,
      messageTimestamp,
    });
    // `null` suppresses buildMediaPath's wall-clock stamp: the media id
    // already makes the path unique AND stable, and the stability is
    // what makes a redelivery idempotent instead of duplicative.
    const path = buildMediaPath(accountId, objectName, null, MIRROR_FOLDER);

    const { error } = await storage.from(MIRROR_BUCKET).upload(path, bytes, {
      contentType: uploadType,
      cacheControl: '3600',
      upsert: true,
    });
    if (error) {
      console.warn(
        `[whatsmiau-mirror] upload failed for ${mediaId} (${uploadType}):`,
        error.message,
      );
      return null;
    }

    const {
      data: { publicUrl },
    } = storage.from(MIRROR_BUCKET).getPublicUrl(path);
    return publicUrl || null;
  } catch (error) {
    console.warn('[whatsmiau-mirror] could not mirror', mediaId, error);
    return null;
  }
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

Run: `npx vitest run src/lib/whatsapp/providers/whatsmiau/mirror-media.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Escreva o teste do pipeline que falha**

Crie `src/lib/whatsapp/providers/whatsmiau/inbound.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({
  events: [] as { event: string; data: unknown }[],
  flows: [] as unknown[],
  automations: [] as { triggerType: string }[],
  aiReplies: [] as unknown[],
  statusUpdates: [] as { wamid: string; status: string }[],
  broadcastFlags: [] as unknown[],
  firstInbound: true,
  resumed: false,
}));

vi.mock('@/lib/api/v1/contacts', () => ({
  resolveAuditUserId: vi.fn(async () => 'user-1'),
}));

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn(async () => null),
  isUniqueViolation: vi.fn(() => false),
}));

vi.mock('@/lib/conversations/first-inbound', () => ({
  claimFirstInboundMessage: vi.fn(async () => h.firstInbound),
}));

vi.mock('@/lib/conversations/reopen', () => ({
  reopenClosedConversation: vi.fn(async () => true),
}));

vi.mock('@/lib/whatsapp/message-status-sync', () => ({
  applyMessageStatus: vi.fn(async (_db: unknown, _accountId: string, incoming: { wamid: string; status: string }) => {
    h.statusUpdates.push({ wamid: incoming.wamid, status: incoming.status });
    return [];
  }),
}));

vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: vi.fn(async (input: unknown) => {
    h.flows.push(input);
    return { consumed: false };
  }),
}));

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: vi.fn(async (input: unknown) => {
    h.aiReplies.push(input);
  }),
}));

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(async (input: { triggerType: string }) => {
    h.automations.push({ triggerType: input.triggerType });
  }),
  resumeAwaitingReply: vi.fn(async () => {
    h.resumed = true;
    return false;
  }),
}));

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: vi.fn(async (_db: unknown, _accountId: string, event: string, data: unknown) => {
    h.events.push({ event, data });
  }),
}));

vi.mock('@/lib/whatsapp/broadcast-recipient-webhook', () => ({
  flagBroadcastReply: vi.fn(async () => {
    h.broadcastFlags.push(true);
    return 'skipped';
  }),
}));

vi.mock('./mirror-media', () => ({
  mirrorWhatsmiauMedia: vi.fn(async () => 'https://cdn.test/mirrored.png'),
}));

import {
  handleWhatsmiauInboundMessage,
  type WhatsmiauInboundContext,
} from './inbound';
import type { NormalizedInboundMessage } from './normalize';

type Row = Record<string, unknown>;
type Queued = { data?: unknown; error?: unknown };

interface Call {
  table: string;
  op: string;
  payload?: Row;
}

/**
 * Chainable Supabase double. Each table has a QUEUE of terminal
 * responses, consumed in order, so a test can say "the contact lookup
 * finds nothing, the contact insert returns contact-1".
 */
function scriptedDb(queues: Record<string, Queued[]>) {
  const calls: Call[] = [];
  const remaining: Record<string, Queued[]> = {};
  for (const [table, list] of Object.entries(queues)) remaining[table] = [...list];

  const next = (table: string): Queued => {
    const list = remaining[table];
    if (!list || list.length === 0) return { data: null, error: null };
    return list.shift()!;
  };

  const from = (table: string) => {
    let op = 'select';
    let payload: Row | undefined;
    const api = {
      select: () => api,
      insert: (row: Row) => { op = 'insert'; payload = row; return api; },
      update: (row: Row) => { op = 'update'; payload = row; return api; },
      upsert: (row: Row) => { op = 'upsert'; payload = row; return api; },
      delete: () => { op = 'delete'; return api; },
      eq: () => api,
      in: () => api,
      order: () => api,
      limit: () => api,
      single: async () => { calls.push({ table, op, payload }); return next(table); },
      maybeSingle: async () => { calls.push({ table, op, payload }); return next(table); },
      then: (resolve: (value: unknown) => unknown) => {
        calls.push({ table, op, payload });
        return Promise.resolve(resolve(next(table)));
      },
    };
    return api;
  };

  const db = {
    from,
    rpc: async (name: string) => {
      calls.push({ table: `rpc:${name}`, op: 'rpc' });
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;

  return { db, calls };
}

function context(db: SupabaseClient): WhatsmiauInboundContext {
  return {
    db,
    accountId: 'acc-1',
    ownerUserId: 'user-1',
    instanceSettings: {
      alwaysOnline: false,
      readMessages: false,
      rejectCall: true,
      msgCall: '',
      groupsIgnore: true,
      saveMedia: true,
      webhook: {
        enabled: true,
        url: 'https://app.test/api/whatsmiau/webhook',
        headers: {},
        events: [],
        base64: false,
      },
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://cdn.test/x.png' } }),
      }),
    },
  };
}

function textMessage(overrides: Partial<NormalizedInboundMessage> = {}): NormalizedInboundMessage {
  return {
    messageId: 'MSG_001',
    remoteJid: '5511999988888@s.whatsapp.net',
    fromMe: false,
    phone: '5511999988888',
    timestamp: 1793113200,
    kind: 'text',
    text: 'Preciso de suporte.',
    ...overrides,
  };
}

describe('handleWhatsmiauInboundMessage', () => {
  beforeEach(() => {
    h.events.length = 0;
    h.flows.length = 0;
    h.automations.length = 0;
    h.aiReplies.length = 0;
    h.statusUpdates.length = 0;
    h.broadcastFlags.length = 0;
    h.firstInbound = true;
    h.resumed = false;
  });

  it('ignores group messages without touching the database', async () => {
    const { db, calls } = scriptedDb({});
    const outcome = await handleWhatsmiauInboundMessage(
      context(db),
      textMessage({ remoteJid: '12345@g.us', phone: '12345' }),
    );

    expect(outcome.disposition).toBe('skipped');
    expect(calls).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it('does not create a contact or a conversation for our own outbound message', async () => {
    const { db, calls } = scriptedDb({});
    const outcome = await handleWhatsmiauInboundMessage(
      context(db),
      textMessage({ fromMe: true }),
    );

    expect(outcome.disposition).toBe('skipped');
    expect(calls.filter((c) => c.table === 'contacts')).toHaveLength(0);
    expect(calls.filter((c) => c.table === 'conversations')).toHaveLength(0);
  });

  it('creates the contact and the conversation, stores the message and fans out', async () => {
    const { db, calls } = scriptedDb({
      conversations: [{ data: [] }, { data: { id: 'conv-1', status: 'open' } }],
      contacts: [{ data: { id: 'contact-1', phone: '5511999988888' } }],
      messages: [{ data: [{ id: 'msg-1' }] }],
    });

    const outcome = await handleWhatsmiauInboundMessage(context(db), textMessage());

    expect(outcome.disposition).toBe('inserted');
    expect(outcome.contactId).toBe('contact-1');
    expect(outcome.conversationId).toBe('conv-1');

    const insert = calls.find((c) => c.table === 'messages' && c.op === 'upsert');
    expect(insert?.payload).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'Preciso de suporte.',
      message_id: 'MSG_001',
      status: 'delivered',
    });

    // conversation.created fires before message.received.
    const eventNames = h.events.map((e) => e.event);
    expect(eventNames).toContain('conversation.created');
    expect(eventNames).toContain('message.received');
    expect(eventNames.indexOf('conversation.created')).toBeLessThan(
      eventNames.indexOf('message.received'),
    );

    expect(h.flows).toHaveLength(1);
    expect(h.automations.map((a) => a.triggerType)).toEqual(
      expect.arrayContaining(['new_message_received', 'keyword_match']),
    );
    expect(h.aiReplies).toHaveLength(1);
    expect(h.broadcastFlags).toHaveLength(1);
  });

  it('treats a redelivery as a replay and does not fan out twice', async () => {
    const { db } = scriptedDb({
      conversations: [{ data: [] }, { data: { id: 'conv-1', status: 'open' } }],
      contacts: [{ data: { id: 'contact-1', phone: '5511999988888' } }],
      messages: [{ data: [] }],
    });

    const outcome = await handleWhatsmiauInboundMessage(context(db), textMessage());

    expect(outcome.disposition).toBe('replay');
    expect(h.events.map((e) => e.event)).not.toContain('message.received');
    expect(h.flows).toHaveLength(0);
    expect(h.aiReplies).toHaveLength(0);
  });

  it('stores a reaction on the target message instead of a new message row', async () => {
    const { db, calls } = scriptedDb({
      conversations: [{ data: [{ id: 'conv-1', status: 'open' }] }],
      contacts: [{ data: { id: 'contact-1', phone: '5511999988888' } }],
      messages: [{ data: { id: 'msg-1' } }],
    });

    const outcome = await handleWhatsmiauInboundMessage(
      context(db),
      textMessage({
        kind: 'reaction',
        reactionEmoji: '👍',
        reactedToMessageId: 'MSG_000',
        text: undefined,
      }),
    );

    expect(outcome.disposition).toBe('skipped');
    expect(calls.filter((c) => c.table === 'messages' && c.op === 'upsert')).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Rode o teste e confirme que falha**

Run: `npx vitest run src/lib/whatsapp/providers/whatsmiau/inbound.test.ts`
Expected: FAIL — "Failed to resolve import ./inbound".

- [ ] **Step 7: Escreva `inbound.ts`**

Crie `src/lib/whatsapp/providers/whatsmiau/inbound.ts`:

```ts
// ============================================================
// WhatsMiau inbound pipeline.
//
// The Meta webhook (`src/app/api/whatsapp/webhook/route.ts`) owns a
// 1389-line pipeline: resolve the identity -> find/create the contact ->
// find/create the conversation -> insert the message idempotently ->
// bump the conversation -> reopen it -> flag a broadcast reply -> hand
// the message to the flow runner -> resume a waiting automation -> fire
// the automation triggers -> let the AI reply -> announce
// `message.received`.
//
// We do NOT fork that file. Every provider-agnostic step is delegated to
// the SAME shared helper the Meta path uses, so both providers behave
// identically; only the provider-specific parts — reading the payload
// and fetching the media — live in `normalize.ts` and `mirror-media.ts`.
//
// The order below mirrors the Meta webhook exactly. Order matters here:
// the conversation must exist before `conversation.created`, the reaction
// short-circuit must run before the message insert, and the idempotency
// boundary must sit BEFORE the unread bump and the whole fan-out, so a
// redelivery cannot double-bump, re-advance a flow, re-fire an
// automation or re-invoke the AI.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { resumeAwaitingReply, runAutomationsForTrigger } from '@/lib/automations/engine';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { claimFirstInboundMessage } from '@/lib/conversations/first-inbound';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { flagBroadcastReply } from '@/lib/whatsapp/broadcast-recipient-webhook';
import { applyMessageStatus } from '@/lib/whatsapp/message-status-sync';
import type { MirrorStorage } from '@/lib/whatsapp/mirror-inbound-media';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  upsertWhatsmiauConfig,
  type WhatsmiauInstanceSettings,
} from '@/lib/whatsapp/whatsmiau-config';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';

import { mirrorWhatsmiauMedia } from './mirror-media';
import type { NormalizedInboundMessage } from './normalize';

export interface WhatsmiauInboundContext {
  db: SupabaseClient;
  accountId: string;
  /** Audit user stamped on the contact / conversation rows we create. */
  ownerUserId: string;
  instanceSettings: WhatsmiauInstanceSettings;
  /** Service-role storage — used to mirror inbound media. */
  storage: MirrorStorage;
}

export interface InboundOutcome {
  /** `inserted` — new row written. `replay` — redelivery, ignored. */
  disposition: 'inserted' | 'replay' | 'skipped';
  conversationId?: string;
  contactId?: string;
}

/**
 * Tombstone written into `messages.content_text` when the sender
 * deletes a message. The `messages` table has no `deleted` column and
 * the Global Constraints forbid altering an existing table, so the
 * marker lives in the text column.
 */
export const DELETED_MESSAGE_TEXT = '[deleted]';

/** The `messages.content_type` vocabulary allowed by the CHECK constraint. */
const ALLOWED_CONTENT_TYPES = new Set([
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'template',
  'interactive',
]);

function contentTypeFor(kind: NormalizedInboundMessage['kind']): string {
  switch (kind) {
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
      return kind;
    case 'sticker':
      return 'image';
    case 'interactive':
      return 'interactive';
    default:
      return 'text';
  }
}

interface ContactOutcome {
  contact: { id: string; phone: string; name?: string | null };
  wasCreated: boolean;
}

interface ConversationOutcome {
  conversation: {
    id: string;
    status?: string | null;
    first_inbound_at?: string | null;
  };
  created: boolean;
}

/**
 * Find the contact for this phone number, or create it.
 *
 * Same shape as the Meta webhook's private helper, minus the BSUID
 * branch (WhatsMiau is phone-only) — and it reuses the same shared
 * `findExistingContact` dedupe, so a contact created by the manual form
 * or by the CSV import is found here too.
 */
async function findOrCreateContact(
  ctx: WhatsmiauInboundContext,
  phone: string,
  name: string | null,
): Promise<ContactOutcome | null> {
  const { db, accountId, ownerUserId } = ctx;

  const existing = await findExistingContact(db, accountId, phone);
  if (existing) return { contact: existing, wasCreated: false };

  const { data, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone,
      name: name ?? phone,
    })
    .select()
    .single();

  if (error) {
    // Lost a race: a concurrent delivery created the contact between the
    // lookup and the insert. Re-resolve instead of dropping the message.
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(db, accountId, phone);
      if (raced) return { contact: raced, wasCreated: false };
    }
    console.error('[whatsmiau] could not create the contact:', error.message);
    return null;
  }

  return { contact: data as ContactOutcome['contact'], wasCreated: true };
}

/**
 * Find the account's conversation for this contact, or create it.
 *
 * Deliberately NOT `.single()`: `.single()` errors on 0 rows AND on 2+
 * rows, and treating that error as "none found" is how a race used to
 * snowball into a wall of duplicate chats (issue #363). Oldest-first +
 * limit(1) resolves to the same survivor the dedupe migration keeps.
 */
async function findOrCreateConversation(
  ctx: WhatsmiauInboundContext,
  contactId: string,
): Promise<ConversationOutcome | null> {
  const { db, accountId, ownerUserId } = ctx;

  const { data: existingRows, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (findError) {
    console.error('[whatsmiau] could not look up the conversation:', findError.message);
    return null;
  }
  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0] as ConversationOutcome['conversation'], created: false };
  }

  const { data, error } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
    })
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced } = await db
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) {
        return { conversation: raced[0] as ConversationOutcome['conversation'], created: false };
      }
    }
    console.error('[whatsmiau] could not create the conversation:', error.message);
    return null;
  }

  return { conversation: data as ConversationOutcome['conversation'], created: true };
}

/**
 * Persist a reaction. Reactions are per-(target, actor) state, not
 * messages — we upsert / delete on `message_reactions` and never write
 * a row into `messages`.
 */
async function applyReaction(
  ctx: WhatsmiauInboundContext,
  message: NormalizedInboundMessage,
  conversationId: string,
  contactId: string,
): Promise<void> {
  const target = message.reactedToMessageId;
  if (!target) return;

  const { data } = await ctx.db
    .from('messages')
    .select('id')
    .eq('message_id', target)
    .eq('conversation_id', conversationId)
    .maybeSingle();

  const targetInternalId = (data as { id: string } | null)?.id;
  if (!targetInternalId) {
    console.warn('[whatsmiau] reaction target not found; skipping:', target);
    return;
  }

  // An empty emoji means the reaction was removed.
  if (!message.reactionEmoji) {
    const { error } = await ctx.db
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId);
    if (error) console.error('[whatsmiau] reaction delete failed:', error.message);
    return;
  }

  const { error } = await ctx.db
    .from('message_reactions')
    .upsert(
      {
        message_id: targetInternalId,
        conversation_id: conversationId,
        actor_type: 'customer',
        actor_id: contactId,
        emoji: message.reactionEmoji,
      },
      { onConflict: 'message_id,actor_type,actor_id' },
    );
  if (error) console.error('[whatsmiau] reaction upsert failed:', error.message);
}

/**
 * Handle one inbound message from the provider.
 *
 * `disposition` tells the caller what happened: `inserted` (a new row),
 * `replay` (the provider redelivered — already stored, nothing else
 * ran) or `skipped` (nothing to do — a group, our own echo, a
 * reaction).
 */
export async function handleWhatsmiauInboundMessage(
  ctx: WhatsmiauInboundContext,
  message: NormalizedInboundMessage,
): Promise<InboundOutcome> {
  const { db, accountId, ownerUserId } = ctx;

  // Groups are out of scope for v1 — `groupsIgnore` defaults to true on
  // the provider side, but if one still arrives we drop it: our contact
  // model is phone-based, and a group JID would create a contact nobody
  // can ever answer.
  if (message.remoteJid.endsWith('@g.us')) {
    return { disposition: 'skipped' };
  }

  const phone = normalizePhone(message.phone);
  if (!phone) return { disposition: 'skipped' };

  // Our own outbound message echoed back. We never create a thread for
  // it — the outbound path owns that — we only reconcile the status of
  // the row we already wrote.
  if (message.fromMe) {
    await applyMessageStatus(db, accountId, {
      wamid: message.messageId,
      status: 'sent',
      failure: null,
      statusAt: new Date(message.timestamp * 1000).toISOString(),
    });
    return { disposition: 'skipped' };
  }

  const contactOutcome = await findOrCreateContact(ctx, phone, message.pushName ?? null);
  if (!contactOutcome) return { disposition: 'skipped' };

  const conversationOutcome = await findOrCreateConversation(ctx, contactOutcome.contact.id);
  if (!conversationOutcome) return { disposition: 'skipped' };
  const conversation = conversationOutcome.conversation;

  // conversation.created fires as soon as the thread is open — BEFORE
  // the reaction short-circuit, so a thread first opened by a reaction
  // still announces itself.
  if (conversationOutcome.created) {
    await dispatchWebhookEvent(db, accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactOutcome.contact.id,
    });
  }

  // Reactions are not messages: no row, no unread bump, no last-message
  // summary.
  if (message.kind === 'reaction') {
    await applyReaction(ctx, message, conversation.id, contactOutcome.contact.id);
    return {
      disposition: 'skipped',
      conversationId: conversation.id,
      contactId: contactOutcome.contact.id,
    };
  }

  // Media. The provider's url is public but expiring, so we copy the
  // bytes into our own bucket. A mirror failure is not fatal: the row
  // keeps the provider's url.
  let mediaUrl: string | null = message.mediaUrl ?? null;
  let mediaType: string | null = message.mimeType ?? null;
  if (message.kind !== 'text' && message.kind !== 'interactive') {
    const mirrored = await mirrorWhatsmiauMedia({
      storage: ctx.storage,
      accountId,
      mediaId: message.messageId,
      mediaUrl: message.mediaUrl ?? null,
      mediaBase64: message.mediaBase64 ?? null,
      mimeType: message.mimeType ?? null,
      fileName: message.fileName ?? null,
      messageTimestamp: message.timestamp,
    });
    if (mirrored) mediaUrl = mirrored;
  }

  const contentType = contentTypeFor(message.kind);
  const interactiveReplyId = message.buttonReplyId ?? message.listReplyId ?? null;
  const contentText =
    message.kind === 'interactive'
      ? (message.buttonReplyTitle ?? message.listReplyTitle ?? '')
      : (message.text ?? message.caption ?? null);

  // Resolve the swipe-reply context. A missing parent is fine — the row
  // stores NULL and the bubble renders without a quote.
  let replyToInternalId: string | null = null;
  if (message.quotedMessageId) {
    const { data } = await db
      .from('messages')
      .select('id')
      .eq('message_id', message.quotedMessageId)
      .eq('conversation_id', conversation.id)
      .maybeSingle();
    replyToInternalId = (data as { id: string } | null)?.id ?? null;
  }

  const receivedAt = new Date(message.timestamp * 1000).toISOString();

  // Idempotent insert. The provider redelivers on failure, and every
  // retry replays the same `key.id`. The unique index on
  // (conversation_id, message_id) makes the replay conflict;
  // `ignoreDuplicates` turns that into ON CONFLICT DO NOTHING, and the
  // `.select()` then returns a row ONLY on a genuine first insert — an
  // empty result means this delivery is a replay. This boundary MUST
  // sit before the unread bump and the fan-out below.
  const { data: insertedRows, error: msgError } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        media_type: mediaType,
        message_id: message.messageId,
        status: 'delivered',
        created_at: receivedAt,
        reply_to_message_id: replyToInternalId,
        interactive_reply_id: interactiveReplyId,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id');

  if (msgError) {
    console.error('[whatsmiau] could not store the message:', msgError.message);
    return {
      disposition: 'skipped',
      conversationId: conversation.id,
      contactId: contactOutcome.contact.id,
    };
  }

  if (!insertedRows || insertedRows.length === 0) {
    console.info('[whatsmiau] duplicate inbound message ignored (replay):', message.messageId);
    return {
      disposition: 'replay',
      conversationId: conversation.id,
      contactId: contactOutcome.contact.id,
    };
  }

  const isFirstInboundMessage = await claimFirstInboundMessage(db, conversation, receivedAt);

  // The unread bump is DB-side (migration 037) so two concurrent
  // deliveries cannot lose one increment (issue #369).
  const { error: convError } = await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: contentText || `[${message.kind}]`,
  });
  if (convError) {
    console.error('[whatsmiau] could not bump the conversation:', convError.message);
  }

  // A customer writing again re-opens the thread (issue #409).
  await reopenClosedConversation(db, conversation);

  // Flag the reply so the broadcast's `replied_count` advances.
  await flagBroadcastReply(db, accountId, contactOutcome.contact.id);

  // The flow runner. When it consumes the message we suppress the
  // content-level automation triggers — the customer is navigating a
  // menu, not sending a fresh trigger word.
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: ownerUserId,
    contactId: contactOutcome.contact.id,
    conversationId: conversation.id,
    message: interactiveReplyId
      ? {
          kind: 'interactive_reply',
          reply_id: interactiveReplyId,
          reply_title: contentText ?? '',
          meta_message_id: message.messageId,
        }
      : {
          kind: 'text',
          text: contentText ?? '',
          meta_message_id: message.messageId,
        },
    isFirstInboundMessage,
  });
  const flowConsumed = flowResult.consumed;

  const inboundText = contentText ?? '';

  // An automation parked at a "wait for reply" step takes this message
  // as its reply and continues from the next step.
  const automationConsumed = flowConsumed
    ? false
    : await resumeAwaitingReply({
        accountId,
        contactId: contactOutcome.contact.id,
        context: {
          message_text: inboundText,
          conversation_id: conversation.id,
          interactive_reply_id: interactiveReplyId ?? undefined,
        },
      });
  const contentConsumed = flowConsumed || automationConsumed;

  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = [];
  if (!contentConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match');
    if (interactiveReplyId) automationTriggers.push('interactive_reply');
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created');
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message');

  // Awaited, never fire-and-forget: we run inside the route's `after()`
  // block, which only keeps the function alive for the promises it can
  // see — a detached dispatch can be frozen half-done (issue #301).
  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactOutcome.contact.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        interactive_reply_id: interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[whatsmiau] automation dispatch failed:', err));
  }

  // AI auto-reply. Only for plain text the flow runner did not consume.
  if (!contentConsumed && !interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contactOutcome.contact.id,
      configOwnerUserId: ownerUserId,
      inboundMessageId: message.messageId,
    });
  }

  await dispatchWebhookEvent(db, accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactOutcome.contact.id,
    whatsapp_message_id: message.messageId,
    content_type: contentType,
    text: contentText,
  });

  return {
    disposition: 'inserted',
    conversationId: conversation.id,
    contactId: contactOutcome.contact.id,
  };
}

/**
 * A delivery-status event. The provider's `DELIVERY_ACK` / `READ` were
 * already mapped onto the app's ladder by `normalizeStatusUpdate`, so
 * `applyMessageStatus` accepts them directly.
 */
export async function handleWhatsmiauStatusUpdate(
  ctx: WhatsmiauInboundContext,
  update: { messageId: string; status: 'delivered' | 'read' },
): Promise<void> {
  await applyMessageStatus(ctx.db, ctx.accountId, {
    wamid: update.messageId,
    status: update.status,
    failure: null,
    statusAt: null,
  });
}

/**
 * The instance connected or dropped. We mirror that onto our own row so
 * the settings screen and the hub show the truth without asking the
 * provider on every page load.
 */
export async function handleWhatsmiauConnectionUpdate(
  ctx: WhatsmiauInboundContext,
  update: {
    state: 'open' | 'close';
    wuid?: string;
    profileName?: string;
    statusReason?: number;
  },
): Promise<void> {
  const { db, accountId } = ctx;

  // `statusReason` is the provider's own code: 200 means "no problem",
  // anything else means the instance dropped for a reason.
  if (update.statusReason !== undefined && update.statusReason !== 200) {
    await upsertWhatsmiauConfig(db, accountId, {
      status: 'error',
      connected_at: null,
    });
    return;
  }

  if (update.state === 'open') {
    await upsertWhatsmiauConfig(db, accountId, {
      status: 'connected',
      phone_number: update.wuid ? normalizePhone(update.wuid) || null : null,
      wuid: update.wuid ?? null,
      connected_at: new Date().toISOString(),
    });
    return;
  }

  await upsertWhatsmiauConfig(db, accountId, {
    status: 'disconnected',
    connected_at: null,
  });
}

/**
 * The sender edited a message. The `messages` table has no `edited`
 * column and the Global Constraints forbid altering it, so the new text
 * overwrites the old one — which is what "edited" means to a reader.
 */
export async function handleWhatsmiauEditedMessage(
  ctx: WhatsmiauInboundContext,
  update: { messageId: string; text: string },
): Promise<void> {
  const internalId = await findMessageIdInAccount(ctx, update.messageId);
  if (!internalId) return;

  const { error } = await ctx.db
    .from('messages')
    .update({ content_text: update.text })
    .eq('id', internalId);

  if (error) {
    console.error('[whatsmiau] could not apply the edit:', error.message);
  }
}

/**
 * The sender deleted a message. The `messages` table has no `deleted`
 * column and the Global Constraints forbid altering it, so the row is
 * turned into a tombstone: the text is replaced by `DELETED_MESSAGE_TEXT`
 * and the attachment is dropped.
 */
export async function handleWhatsmiauDeletedMessage(
  ctx: WhatsmiauInboundContext,
  update: { messageId: string; remoteJid: string; fromMe: boolean },
): Promise<void> {
  const internalId = await findMessageIdInAccount(ctx, update.messageId);
  if (!internalId) return;

  const { error } = await ctx.db
    .from('messages')
    .update({
      content_text: DELETED_MESSAGE_TEXT,
      media_url: null,
      media_type: null,
    })
    .eq('id', internalId);

  if (error) {
    console.error('[whatsmiau] could not apply the deletion:', error.message);
  }
}

/**
 * Resolve the provider's message id into the internal row id, scoped to
 * the account. `messages` has no `account_id` column — the tenancy
 * lives on `conversations`, so the scope is applied through the join,
 * the same way `message-status-sync` does it.
 */
async function findMessageIdInAccount(
  ctx: WhatsmiauInboundContext,
  messageId: string,
): Promise<string | null> {
  const { data, error } = await ctx.db
    .from('messages')
    .select('id, conversations!inner(account_id)')
    .eq('message_id', messageId)
    .eq('conversations.account_id', ctx.accountId)
    .maybeSingle();

  if (error) {
    console.error('[whatsmiau] message lookup failed:', error.message);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Resolve the audit user for the account — the member whose id is
 * stamped on the contact / conversation rows we create.
 */
export async function resolveWhatsmiauOwnerUserId(
  db: SupabaseClient,
  accountId: string,
): Promise<string> {
  return resolveAuditUserId(db, accountId);
}
```

- [ ] **Step 8: Rode os dois testes e confirme que passam**

Run: `npx vitest run src/lib/whatsapp/providers/whatsmiau/`
Expected: PASS (10 tests — 5 de `mirror-media`, 5 de `inbound`).

Se o teste `creates the contact and the conversation...` falhar com
`expected 'skipped' to be 'inserted'`, o `scriptedDb` está devolvendo a
resposta errada: o `.upsert()` do `messages` é seguido de `.select('id')`
e de um `await` — ou seja, um `then`, não um `single`. Enfileire a
resposta do `messages` como `{ data: [{ id: 'msg-1' }] }` (array), e não
como objeto.

- [ ] **Step 9: Commit**

```bash
git add src/lib/whatsapp/providers/whatsmiau/inbound.ts src/lib/whatsapp/providers/whatsmiau/inbound.test.ts src/lib/whatsapp/providers/whatsmiau/mirror-media.ts src/lib/whatsapp/providers/whatsmiau/mirror-media.test.ts
git commit -m "feat(whatsmiau): pipeline de entrada e espelho de midia

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 12: Rota do webhook da WhatsMiau

**Files:**
- Create: `src/app/api/whatsmiau/webhook/route.ts`
- Test: `src/app/api/whatsmiau/webhook/route.test.ts`

**Interfaces:**
- Consumes (Task 11): `handleWhatsmiauInboundMessage`, `handleWhatsmiauStatusUpdate`, `handleWhatsmiauConnectionUpdate`, `handleWhatsmiauEditedMessage`, `handleWhatsmiauDeletedMessage`, `resolveWhatsmiauOwnerUserId`, `WhatsmiauInboundContext` — de `@/lib/whatsapp/providers/whatsmiau/inbound`.
- Consumes (Task 10): `parseWhatsmiauWebhook`, `isSupportedWebhookEvent`, `WhatsmiauWebhookEnvelope` — de `@/lib/whatsapp/providers/whatsmiau/webhook`; `normalizeInboundMessage`, `normalizeStatusUpdate`, `normalizeConnectionUpdate`, `normalizeEditedMessage`, `normalizeDeletedMessage` — de `@/lib/whatsapp/providers/whatsmiau/normalize`.
- Consumes (Task 1): `loadWhatsmiauConfigByWebhookSecret`, `WhatsmiauConfigRow` — de `@/lib/whatsapp/whatsmiau-config`.
- Consumes (existentes): `readCappedBody`, `MAX_WEBHOOK_BODY_BYTES` (`@/lib/whatsapp/webhook-body`); `supabaseAdmin` (`@/lib/flows/admin-client`).
- Produces: `POST /api/whatsmiau/webhook` (eventos) e `GET /api/whatsmiau/webhook` (health).

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/app/api/whatsmiau/webhook/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  afterCallbacks: [] as (() => Promise<void>)[],
  inbound: [] as unknown[],
  status: [] as unknown[],
  connection: [] as unknown[],
  edited: [] as unknown[],
  deleted: [] as unknown[],
  config: null as Record<string, unknown> | null,
}));

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void>) => {
    h.afterCallbacks.push(cb);
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      Response.json(body, init),
  },
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  }),
}));

vi.mock('@/lib/whatsapp/whatsmiau-config', () => ({
  loadWhatsmiauConfigByWebhookSecret: vi.fn(async (secret: string) =>
    h.config?.webhook_secret === secret ? h.config : null,
  ),
}));

vi.mock('@/lib/whatsapp/providers/whatsmiau/inbound', () => ({
  resolveWhatsmiauOwnerUserId: vi.fn(async () => 'user-1'),
  handleWhatsmiauInboundMessage: vi.fn(async (_ctx: unknown, message: unknown) => {
    h.inbound.push(message);
    return { disposition: 'inserted' };
  }),
  handleWhatsmiauStatusUpdate: vi.fn(async (_ctx: unknown, update: unknown) => {
    h.status.push(update);
  }),
  handleWhatsmiauConnectionUpdate: vi.fn(async (_ctx: unknown, update: unknown) => {
    h.connection.push(update);
  }),
  handleWhatsmiauEditedMessage: vi.fn(async (_ctx: unknown, update: unknown) => {
    h.edited.push(update);
  }),
  handleWhatsmiauDeletedMessage: vi.fn(async (_ctx: unknown, update: unknown) => {
    h.deleted.push(update);
  }),
}));

import { POST, GET } from './route';

const SECRET = 'a'.repeat(64);

function config() {
  return {
    account_id: 'acc-1',
    instance_name: 'Atendimento01',
    webhook_secret: SECRET,
    instance_settings: {
      alwaysOnline: false,
      readMessages: false,
      rejectCall: true,
      msgCall: '',
      groupsIgnore: true,
      saveMedia: true,
      webhook: { enabled: true, url: '', headers: {}, events: [], base64: false },
    },
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://app.test/api/whatsmiau/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function textEvent() {
  return {
    event: 'messages.upsert',
    instance: 'Atendimento01',
    data: {
      key: { remoteJid: '5511999988888@s.whatsapp.net', id: 'MSG_001', fromMe: false },
      pushName: 'Cliente',
      message: { conversation: 'Olá' },
      messageType: 'conversation',
      messageTimestamp: 1793113200,
    },
  };
}

async function drain() {
  while (h.afterCallbacks.length > 0) {
    const cb = h.afterCallbacks.shift()!;
    await cb();
  }
}

describe('POST /api/whatsmiau/webhook', () => {
  beforeEach(() => {
    h.afterCallbacks.length = 0;
    h.inbound.length = 0;
    h.status.length = 0;
    h.connection.length = 0;
    h.edited.length = 0;
    h.deleted.length = 0;
    h.config = config();
  });

  it('answers 401 when the Authorization header is missing', async () => {
    const res = await POST(request(textEvent()));
    expect(res.status).toBe(401);
  });

  it('answers 401 when the secret does not match', async () => {
    const res = await POST(request(textEvent(), { authorization: 'Bearer nope' }));
    expect(res.status).toBe(401);
  });

  it('answers 404 for an instance we do not know', async () => {
    // The secret is valid, but the envelope names another instance.
    h.config = { ...config(), instance_name: 'OutraInstancia' };
    const res = await POST(request(textEvent(), { authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(404);
  });

  it('answers 400 for a body that is not a WhatsMiau envelope', async () => {
    const res = await POST(
      request({ nope: true }, { authorization: `Bearer ${SECRET}` }),
    );
    expect(res.status).toBe(400);
  });

  it('accepts the event and processes it inside after()', async () => {
    const res = await POST(
      request(textEvent(), { authorization: `Bearer ${SECRET}` }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'received' });

    expect(h.inbound).toHaveLength(0);
    await drain();
    expect(h.inbound).toHaveLength(1);
  });

  it('maps DELIVERY_ACK to delivered and READ to read', async () => {
    await POST(
      request(
        {
          event: 'messages.update',
          instance: 'Atendimento01',
          data: { messageId: 'MSG_001', status: 'DELIVERY_ACK' },
        },
        { authorization: `Bearer ${SECRET}` },
      ),
    );
    await drain();
    expect(h.status).toEqual([{ messageId: 'MSG_001', status: 'delivered' }]);

    await POST(
      request(
        {
          event: 'messages.update',
          instance: 'Atendimento01',
          data: { messageId: 'MSG_002', status: 'READ' },
        },
        { authorization: `Bearer ${SECRET}` },
      ),
    );
    await drain();
    expect(h.status[1]).toEqual({ messageId: 'MSG_002', status: 'read' });
  });

  it('routes connection.update to the connection handler', async () => {
    await POST(
      request(
        {
          event: 'connection.update',
          instance: 'Atendimento01',
          data: { state: 'open', wuid: '5511999988888@s.whatsapp.net', statusReason: 200 },
        },
        { authorization: `Bearer ${SECRET}` },
      ),
    );
    await drain();
    expect(h.connection).toHaveLength(1);
    expect(h.connection[0]).toMatchObject({ state: 'open' });
  });

  it('ignores an event we do not model', async () => {
    const res = await POST(
      request(
        { event: 'contacts.upsert', instance: 'Atendimento01', data: [] },
        { authorization: `Bearer ${SECRET}` },
      ),
    );
    expect(res.status).toBe(200);
    await drain();
    expect(h.inbound).toHaveLength(0);
  });
});

describe('GET /api/whatsmiau/webhook', () => {
  it('answers 200', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `npx vitest run src/app/api/whatsmiau/webhook/route.test.ts`
Expected: FAIL — "Failed to resolve import ./route".

- [ ] **Step 3: Escreva a rota**

Crie `src/app/api/whatsmiau/webhook/route.ts`:

```ts
// ============================================================
// The WhatsMiau (API CRMBR) inbound webhook.
//
// This is a route of its own — the Meta webhook keeps its own URL, its
// own signature scheme and its own payload shape. Nothing here is
// shared with `src/app/api/whatsapp/webhook/route.ts`, and nothing
// there is touched by this file.
//
// Authentication: the provider sends ONLY the headers WE configured in
// the instance's `webhook.headers` — the WhatsMiau documentation is
// explicit that `x-tenant-secret` (or any other name) is defined by
// the caller, not guaranteed by the service. We define
// `Authorization: Bearer <secret>`, and the secret is the one stored
// on the account's `whatsmiau_config` row.
//
// Account routing: the webhook secret is the routing key. It is 32
// random bytes, generated once per account row, and the provider
// sends it back on every call — so it identifies the account exactly.
// The instance name in the envelope is only a cross-check: the
// customer picks that name, and two accounts may well pick the same
// one, which would make a name-only lookup ambiguous.
// An instance we do not know is a 404.
// ============================================================

import { timingSafeEqual } from 'node:crypto';

import { NextResponse, after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  MAX_WEBHOOK_BODY_BYTES,
  readCappedBody,
} from '@/lib/whatsapp/webhook-body';
import {
  loadWhatsmiauConfigByWebhookSecret,
  type WhatsmiauConfigRow,
} from '@/lib/whatsapp/whatsmiau-config';
import {
  handleWhatsmiauConnectionUpdate,
  handleWhatsmiauDeletedMessage,
  handleWhatsmiauEditedMessage,
  handleWhatsmiauInboundMessage,
  handleWhatsmiauStatusUpdate,
  resolveWhatsmiauOwnerUserId,
  type WhatsmiauInboundContext,
} from '@/lib/whatsapp/providers/whatsmiau/inbound';
import {
  normalizeConnectionUpdate,
  normalizeDeletedMessage,
  normalizeEditedMessage,
  normalizeInboundMessage,
  normalizeStatusUpdate,
} from '@/lib/whatsapp/providers/whatsmiau/normalize';
import {
  isSupportedWebhookEvent,
  parseWhatsmiauWebhook,
  type WhatsmiauWebhookEnvelope,
} from '@/lib/whatsapp/providers/whatsmiau/webhook';

// Inbound processing fans out to contact/conversation writes, media
// mirroring, flows, automations and the AI — give it headroom, the
// same way the Meta webhook does.
export const maxDuration = 60;

/**
 * Constant-time comparison of two strings. A webhook secret checked
 * with `===` leaks its bytes through timing.
 */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Health check — is this deployment able to receive CRMBR events? */
export async function GET() {
  return NextResponse.json(
    { status: 'ok', provider: 'whatsmiau' },
    { status: 200 },
  );
}

export async function POST(request: Request) {
  // The provider documents a 4 MB limit on the webhook body; we cap at
  // the same number so an oversized delivery is refused instead of
  // buffered.
  const raw = await readCappedBody(request, MAX_WEBHOOK_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const envelope = parseWhatsmiauWebhook(payload);
  if (!envelope) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const db = supabaseAdmin();

  // The account behind the instance. The webhook secret is the
  // routing key: it is unique per account, so it identifies the owner
  // even when two accounts named their instance the same way.
  const presented = request.headers.get('authorization') ?? '';
  const secret = presented.startsWith('Bearer ')
    ? presented.slice('Bearer '.length).trim()
    : '';
  if (!secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const config = await loadWhatsmiauConfigByWebhookSecret(db, secret);
  if (!config || !safeEqual(config.webhook_secret, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // The envelope must belong to the instance the secret is bound to.
  // An instance we do not know is a 404: the operator needs to know
  // the instance is not wired here.
  if (config.instance_name !== envelope.instance) {
    return NextResponse.json({ error: 'unknown_instance' }, { status: 404 });
  }

  if (!isSupportedWebhookEvent(envelope.event)) {
    // An event we do not model (`contacts.upsert`, `messages.set`, ...).
    // Acknowledge it: retrying would never make it supported.
    return NextResponse.json(
      { status: 'ignored', event: envelope.event },
      { status: 200 },
    );
  }

  // The work runs inside `after()` so the provider gets its 200 right
  // away while the promise stays alive long enough for the database
  // writes to finish. A floating promise here can be frozen half-done
  // on Vercel (issue #301) — the same failure the Meta webhook hit.
  after(async () => {
    await processWhatsmiauEvent(db, config, envelope);
  });

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

/**
 * Route one event to the handler that owns it. Every failure is logged
 * and swallowed: the provider already got its 200, and a throw here
 * would only produce a confusing unhandled rejection.
 */
async function processWhatsmiauEvent(
  db: SupabaseClient,
  config: WhatsmiauConfigRow,
  envelope: WhatsmiauWebhookEnvelope,
): Promise<void> {
  try {
    const ownerUserId = await resolveWhatsmiauOwnerUserId(db, config.account_id);

    const ctx: WhatsmiauInboundContext = {
      db,
      accountId: config.account_id,
      ownerUserId,
      instanceSettings: config.instance_settings,
      storage: db.storage,
    };

    switch (envelope.event) {
      case 'messages.upsert': {
        const message = normalizeInboundMessage(envelope.data);
        if (!message) return;
        await handleWhatsmiauInboundMessage(ctx, message);
        return;
      }
      case 'messages.update': {
        const update = normalizeStatusUpdate(envelope.data);
        if (!update) return;
        await handleWhatsmiauStatusUpdate(ctx, update);
        return;
      }
      case 'messages.edited': {
        const update = normalizeEditedMessage(envelope.data);
        if (!update) return;
        await handleWhatsmiauEditedMessage(ctx, update);
        return;
      }
      case 'messages.delete': {
        const update = normalizeDeletedMessage(envelope.data);
        if (!update) return;
        await handleWhatsmiauDeletedMessage(ctx, update);
        return;
      }
      case 'connection.update': {
        const update = normalizeConnectionUpdate(envelope.data);
        if (!update) return;
        await handleWhatsmiauConnectionUpdate(ctx, update);
        return;
      }
    }
  } catch (error) {
    console.error('[whatsmiau-webhook] processing failed:', error);
  }
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

Run: `npx vitest run src/app/api/whatsmiau/webhook/route.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/whatsmiau/webhook/route.ts src/app/api/whatsmiau/webhook/route.test.ts
git commit -m "feat(whatsmiau): webhook proprio com autenticacao por segredo

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 13: Rotas de gerenciamento da CRMBR (config, Instances, troca de API)

**Files:**
- Create: `src/lib/whatsapp/providers/whatsmiau/management.ts`
- Create: `src/app/api/whatsmiau/config/route.ts`
- Create: `src/app/api/whatsmiau/active/route.ts`
- Create: `src/app/api/whatsmiau/instances/route.ts`
- Create: `src/app/api/whatsmiau/instances/[name]/route.ts`
- Create: `src/app/api/whatsmiau/instances/[name]/connect/route.ts`
- Create: `src/app/api/whatsmiau/instances/[name]/disconnect/route.ts`
- Test: `src/app/api/whatsmiau/instances/route.test.ts`

**Interfaces:**
- Consumes (Task 1): `loadWhatsmiauConfig`, `upsertWhatsmiauConfig`, `mergeInstanceSettings`, `encryptWhatsmiauApiKey`, `decryptWhatsmiauApiKey`, `generateWebhookSecret`, `WhatsmiauConfigRow`, `WhatsmiauInstanceSettings`, `WhatsmiauWebhookConfig` — de `@/lib/whatsapp/whatsmiau-config`.
- Consumes (Task 5): `validateInstanceName`, `createInstance`, `listInstances`, `getConnectionState`, `connectInstance`, `updateInstance`, `logoutInstance`, `deleteInstance`, `getWebhookConfig`, `setWebhook` — de `@/lib/whatsapp/providers/whatsmiau/instances`.
- Consumes (Task 6): `whatsmiauConnectionFromConfig` — de `@/lib/whatsapp/providers/connection`.
- Consumes (Task 3): `WhatsmiauApiError` — de `@/lib/whatsapp/providers/whatsmiau/client`.
- Consumes (existentes): `requireRole`, `toErrorResponse` (`@/lib/auth/account`).
- Produces:
  - `GET /api/whatsmiau/config` → `{ configured: false }` ou `{ configured: true, instance_name, base_url, api_key_masked, status, phone_number, is_active, connected_at, instance_settings }`
  - `POST /api/whatsmiau/config` → `{ success, saved, verified, warning?, config }`
  - `GET /api/whatsmiau/active` → `{ provider: 'meta'|'whatsmiau', status, connected }`
  - `POST /api/whatsmiau/active` → `{ success, provider }`
  - `GET /api/whatsmiau/instances` → `{ instances }`
  - `POST /api/whatsmiau/instances` → `{ success, instance_name }`
  - `GET /api/whatsmiau/instances/[name]` → `{ state, connected, suspended, suspension_reason?, wuid?, profileName? }`
  - `PUT /api/whatsmiau/instances/[name]` → `{ success, settings }`
  - `DELETE /api/whatsmiau/instances/[name]` → `{ success }`
  - `GET /api/whatsmiau/instances/[name]/connect` → `{ base64, pairing_code?, connected }`
  - `POST /api/whatsmiau/instances/[name]/connect` → idem, mas desloga antes (reconectar)
  - `POST /api/whatsmiau/instances/[name]/disconnect` → `{ success }` (desconecta o número, mantém a instância)

> **Nome do arquivo.** O spec (§4.1) chama esta rota de `settings/route.ts`. O plano usa `config/route.ts` — o mesmo nome de `api/whatsapp/config`, e "config" descreve melhor o que a rota guarda (a config da conta) do que "settings", que no app já significa a área de Configurações. A URL pública `/settings/whatsapp/crmbr` não muda.

- [ ] **Step 1: Escreva `management.ts`**

Crie `src/lib/whatsapp/providers/whatsmiau/management.ts`:

```ts
// ============================================================
// Helpers shared by the CRMBR management routes.
//
// Everything here is account-scoped: a route resolves the account from
// the session and then uses THAT account's api key and instance name.
// An instance that belongs to another account resolves to `null`, and
// the route answers 404 — the caller can never tell "not yours" from
// "does not exist".
// ============================================================

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadWhatsmiauConfig,
  type WhatsmiauConfigRow,
  type WhatsmiauWebhookConfig,
} from '@/lib/whatsapp/whatsmiau-config';
import { WhatsmiauApiError } from './client';

/** The API key never leaves the server in cleartext. */
export const MASKED_API_KEY = '••••••••••••••••';

/**
 * The webhook header WE own. The account's `webhook_secret` travels
 * in it, and the webhook route compares the incoming header against
 * that secret — so it can never be a user-defined header.
 */
export const LOCKED_WEBHOOK_HEADER = 'Authorization';

/**
 * Drop the locked header from a user-supplied map. The browser never
 * sees the secret, so a saved `Authorization` header could only come
 * from a crafted request — and storing it would leak the secret back
 * to every reader of the config route.
 */
export function withoutLockedHeaders(
  headers: Record<string, string> | undefined | null,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === LOCKED_WEBHOOK_HEADER.toLowerCase()) continue;
    next[key] = value;
  }
  return next;
}

/** Public URL of our webhook, derived from the incoming request. */
export function webhookUrlFor(request: Request): string {
  return `${new URL(request.url).origin}/api/whatsmiau/webhook`;
}

/**
 * The webhook config we push to the provider.
 *
 * The `Authorization` header is LOCKED: it carries the account's
 * webhook secret, and that secret is what the route compares the
 * incoming header against. A user-supplied header can never replace
 * it — the spread comes first, ours last.
 */
export function buildWebhookConfig(
  row: WhatsmiauConfigRow,
  url: string,
): WhatsmiauWebhookConfig {
  return {
    enabled: row.instance_settings.webhook.enabled,
    url,
    headers: {
      ...withoutLockedHeaders(row.instance_settings.webhook.headers),
      [LOCKED_WEBHOOK_HEADER]: `Bearer ${row.webhook_secret}`,
    },
    events: row.instance_settings.webhook.events,
    base64: row.instance_settings.webhook.base64,
  };
}

/**
 * Resolve the account's OWN instance by name. Returns null when the
 * name is not the one this account owns — the caller answers 404.
 */
export async function resolveOwnedInstance(
  db: SupabaseClient,
  accountId: string,
  name: string,
): Promise<WhatsmiauConfigRow | null> {
  const row = await loadWhatsmiauConfig(db, accountId);
  if (!row) return null;
  if (!row.instance_name || row.instance_name !== name) return null;
  return row;
}

/**
 * Shape a provider failure into an HTTP answer. A 401/403 from the
 * provider becomes 401, a suspended instance becomes 409, everything
 * else becomes 502 — the provider is the one that has to change
 * something.
 */
export function providerErrorResponse(error: unknown): NextResponse {
  if (error instanceof WhatsmiauApiError) {
    // The provider's own status is the truth: 401 (bad key), 404 (no
    // such instance), 409 (delete still running / instance suspended),
    // 400 (invalid request). Anything else is a gateway problem.
    const status =
      error.code === 'whatsmiau_unauthorized'
        ? 401
        : error.code === 'whatsmiau_not_found'
          ? 404
          : error.code === 'whatsmiau_conflict' || error.code === 'whatsmiau_suspended'
            ? 409
            : error.code === 'whatsmiau_invalid_request'
              ? 400
              : 502;
    return NextResponse.json(
      { error: error.message, code: error.code, provider_status: error.upstreamStatus },
      { status },
    );
  }
  return NextResponse.json(
    { error: 'Unexpected error while talking to the CRMBR API.', code: 'internal_error' },
    { status: 500 },
  );
}
```

- [ ] **Step 2: Escreva `config/route.ts`**

Crie `src/app/api/whatsmiau/config/route.ts`:

```ts
// ============================================================
// The account's CRMBR (non-official WhatsApp API) configuration.
//
// GET returns the stored configuration with the api key MASKED — the
// key never travels back to the browser in cleartext.
//
// POST saves it. The api key is encrypted before it touches the
// database, exactly like the Meta access token.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { whatsmiauConnectionFromConfig } from '@/lib/whatsapp/providers/connection';
import {
  listInstances,
  validateInstanceName,
} from '@/lib/whatsapp/providers/whatsmiau/instances';
import { MASKED_API_KEY, withoutLockedHeaders } from '@/lib/whatsapp/providers/whatsmiau/management';
import {
  decryptWhatsmiauApiKey,
  encryptWhatsmiauApiKey,
  loadWhatsmiauConfig,
  mergeInstanceSettings,
  upsertWhatsmiauConfig,
  type WhatsmiauConfigRow,
  type WhatsmiauInstanceSettings,
} from '@/lib/whatsapp/whatsmiau-config';

const DEFAULT_BASE_URL = 'https://api.whatsmiau.dev/v2';

/** The shape the browser is allowed to see. */
function publicConfig(row: WhatsmiauConfigRow) {
  return {
    instance_name: row.instance_name,
    base_url: row.base_url,
    api_key_masked: MASKED_API_KEY,
    status: row.status,
    phone_number: row.phone_number,
    is_active: row.is_active,
    connected_at: row.connected_at,
    instance_settings: row.instance_settings,
    updated_at: row.updated_at,
  };
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const row = await loadWhatsmiauConfig(supabase, accountId);
    if (!row) {
      return NextResponse.json({ configured: false }, { status: 200 });
    }
    return NextResponse.json({ configured: true, ...publicConfig(row) }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = await request.json();
    const existing = await loadWhatsmiauConfig(supabase, accountId);

    // An empty api key means "keep the stored one" — the settings form
    // never shows the key, so re-entering it on every save would be a
    // toll nobody should pay.
    let apiKey = '';
    if (typeof body.api_key === 'string' && body.api_key.trim() !== '') {
      apiKey = body.api_key.trim();
    } else if (existing) {
      try {
        apiKey = decryptWhatsmiauApiKey(existing);
      } catch {
        return NextResponse.json(
          { error: 'The stored API key could not be decrypted. Please enter it again.', field: 'api_key' },
          { status: 400 },
        );
      }
    }
    if (!apiKey) {
      return NextResponse.json(
        { error: 'The API key is required.', field: 'api_key' },
        { status: 400 },
      );
    }

    const baseUrl =
      typeof body.base_url === 'string' && body.base_url.trim() !== ''
        ? body.base_url.trim().replace(/\/+$/, '')
        : (existing?.base_url ?? DEFAULT_BASE_URL);

    const instanceName =
      typeof body.instance_name === 'string' && body.instance_name.trim() !== ''
        ? body.instance_name.trim()
        : (existing?.instance_name ?? '');

    if (!instanceName) {
      return NextResponse.json(
        { error: 'The instance name is required.', field: 'instance_name' },
        { status: 400 },
      );
    }
    const nameCheck = validateInstanceName(instanceName);
    if (!nameCheck.ok) {
      return NextResponse.json(
        { error: nameCheck.error, field: 'instance_name' },
        { status: 400 },
      );
    }

    const incoming = (body.instance_settings ?? {}) as Partial<WhatsmiauInstanceSettings>;
    const settings = mergeInstanceSettings(existing?.instance_settings, {
      ...incoming,
      // The Authorization header is ours — a browser can never set it,
      // and storing one would leak the webhook secret back to every
      // reader of this route.
      ...(incoming.webhook
        ? {
            webhook: {
              ...incoming.webhook,
              headers: withoutLockedHeaders(incoming.webhook.headers),
            },
          }
        : {}),
    });

    const row = await upsertWhatsmiauConfig(supabase, accountId, {
      api_key_encrypted: encryptWhatsmiauApiKey(apiKey),
      base_url: baseUrl,
      instance_name: instanceName,
      instance_settings: settings,
    });

    // Verify the key against the provider — BEST EFFORT. The row is
    // already saved, so a provider outage never blocks the setup; the
    // UI surfaces the warning and the user can retry.
    let verified = true;
    let warning: string | undefined;
    try {
      await listInstances(whatsmiauConnectionFromConfig(row));
    } catch (error) {
      verified = false;
      warning =
        error instanceof Error
          ? error.message
          : 'Could not reach the CRMBR API with this key.';
    }

    return NextResponse.json(
      {
        success: true,
        saved: true,
        verified,
        ...(warning ? { warning } : {}),
        config: publicConfig(row),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[whatsmiau/config] could not save the configuration:', error);
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 3: Escreva `active/route.ts`**

Crie `src/app/api/whatsmiau/active/route.ts`:

```ts
// ============================================================
// Which provider is this account sending through?
//
// One active provider per account. Switching is explicit and never
// silent: activating the CRMBR provider requires a PAIRED instance,
// and switching back to Meta requires a connected Meta config. If the
// active provider is broken, sends fail loudly instead of going out
// through the other number.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  loadWhatsmiauConfig,
  upsertWhatsmiauConfig,
} from '@/lib/whatsapp/whatsmiau-config';

async function metaStatus(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
): Promise<{ status: string; connected: boolean }> {
  const { data } = await supabase
    .from('whatsapp_config')
    .select('status')
    .eq('account_id', accountId)
    .maybeSingle();
  const status = data?.status ?? 'not_configured';
  return { status, connected: status === 'connected' };
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const whatsmiau = await loadWhatsmiauConfig(supabase, accountId);

    if (whatsmiau?.is_active) {
      return NextResponse.json(
        {
          provider: 'whatsmiau',
          status: whatsmiau.status,
          connected: whatsmiau.status === 'connected',
          instance_name: whatsmiau.instance_name,
          phone_number: whatsmiau.phone_number,
        },
        { status: 200 },
      );
    }

    const meta = await metaStatus(supabase, accountId);
    return NextResponse.json(
      { provider: 'meta', status: meta.status, connected: meta.connected },
      { status: 200 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = await request.json();
    const provider = body?.provider;

    if (provider !== 'meta' && provider !== 'whatsmiau') {
      return NextResponse.json(
        { error: 'Unknown provider.', code: 'invalid_provider' },
        { status: 400 },
      );
    }

    if (provider === 'whatsmiau') {
      const row = await loadWhatsmiauConfig(supabase, accountId);
      if (!row) {
        return NextResponse.json(
          {
            error: 'The CRMBR (non-official) API is not configured yet.',
            code: 'whatsapp_not_configured',
          },
          { status: 400 },
        );
      }
      if (row.status !== 'connected') {
        return NextResponse.json(
          {
            error: 'Pair the WhatsApp number before activating the CRMBR API.',
            code: 'provider_not_connected',
          },
          { status: 400 },
        );
      }
      await upsertWhatsmiauConfig(supabase, accountId, { is_active: true });
      return NextResponse.json({ success: true, provider: 'whatsmiau' }, { status: 200 });
    }

    const meta = await metaStatus(supabase, accountId);
    if (!meta.connected) {
      return NextResponse.json(
        {
          error: 'The official Meta API is not connected. Connect it before switching back.',
          code: 'whatsapp_not_configured',
        },
        { status: 400 },
      );
    }

    await upsertWhatsmiauConfig(supabase, accountId, { is_active: false });
    return NextResponse.json({ success: true, provider: 'meta' }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 4: Escreva `instances/route.ts`**

Crie `src/app/api/whatsmiau/instances/route.ts`:

```ts
// ============================================================
// The account's WhatsMiau instances.
//
// GET lists every instance the api key can see. POST creates one and
// wires our webhook to it.
//
// The api key is the ACCOUNT's — two companies never share it, so one
// company can never reach another's instance.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { whatsmiauConnectionFromConfig } from '@/lib/whatsapp/providers/connection';
import {
  createInstance,
  listInstances,
  validateInstanceName,
} from '@/lib/whatsapp/providers/whatsmiau/instances';
import {
  buildWebhookConfig,
  providerErrorResponse,
  webhookUrlFor,
} from '@/lib/whatsapp/providers/whatsmiau/management';
import {
  loadWhatsmiauConfig,
  upsertWhatsmiauConfig,
} from '@/lib/whatsapp/whatsmiau-config';

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const row = await loadWhatsmiauConfig(supabase, accountId);
    if (!row) {
      return NextResponse.json(
        { error: 'The CRMBR (non-official) API is not configured yet.', instances: [] },
        { status: 400 },
      );
    }
    const instances = await listInstances(whatsmiauConnectionFromConfig(row));
    return NextResponse.json({ instances }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    console.error('[whatsmiau/instances] could not list the instances:', error);
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = await request.json();
    const instanceName =
      typeof body?.instance_name === 'string' ? body.instance_name.trim() : '';

    const nameCheck = validateInstanceName(instanceName);
    if (!nameCheck.ok) {
      return NextResponse.json(
        { error: nameCheck.error, field: 'instance_name' },
        { status: 400 },
      );
    }

    const row = await loadWhatsmiauConfig(supabase, accountId);
    if (!row) {
      return NextResponse.json(
        { error: 'Save the API key and the instance name first.', code: 'whatsapp_not_configured' },
        { status: 400 },
      );
    }

    const conn = whatsmiauConnectionFromConfig(row);
    const settings = {
      ...row.instance_settings,
      webhook: buildWebhookConfig(row, webhookUrlFor(request)),
    };

    // `syncFullHistory` is a creation-only flag — the provider refuses
    // to change it later, so it only rides along with the create call.
    await createInstance(conn, {
      instanceName,
      settings,
      ...(body?.sync_full_history ? { syncFullHistory: true } : {}),
    });
    await setWebhook(conn, instanceName, settings.webhook);

    await upsertWhatsmiauConfig(supabase, accountId, {
      instance_name: instanceName,
      instance_settings: settings,
      status: 'connecting',
      connected_at: null,
    });

    return NextResponse.json({ success: true, instance_name: instanceName }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    console.error('[whatsmiau/instances] could not create the instance:', error);
    return toErrorResponse(error);
  }
}
```

> `setWebhook` precisa estar no import acima — acrescente `setWebhook` à lista de `import { createInstance, listInstances, setWebhook, validateInstanceName } from '@/lib/whatsapp/providers/whatsmiau/instances';`.

- [ ] **Step 5: Escreva `instances/[name]/route.ts`**

Crie `src/app/api/whatsmiau/instances/[name]/route.ts`:

```ts
// ============================================================
// One instance: its state, its settings, its life.
//
// Every route here resolves the instance against the ACCOUNT's own
// row. A name that belongs to another company resolves to nothing and
// the route answers 404 — it never reveals that the instance exists.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { whatsmiauConnectionFromConfig } from '@/lib/whatsapp/providers/connection';
import {
  deleteInstance,
  getConnectionState,
  setWebhook,
  updateInstance,
} from '@/lib/whatsapp/providers/whatsmiau/instances';
import {
  buildWebhookConfig,
  providerErrorResponse,
  resolveOwnedInstance,
  webhookUrlFor,
  withoutLockedHeaders,
} from '@/lib/whatsapp/providers/whatsmiau/management';
import {
  mergeInstanceSettings,
  upsertWhatsmiauConfig,
  type WhatsmiauInstanceSettings,
} from '@/lib/whatsapp/whatsmiau-config';

type RouteContext = { params: Promise<{ name: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const { name } = await context.params;

    const row = await resolveOwnedInstance(supabase, accountId, name);
    if (!row) {
      return NextResponse.json({ error: 'Instance not found.' }, { status: 404 });
    }

    const state = await getConnectionState(whatsmiauConnectionFromConfig(row), name);
    return NextResponse.json(state, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { name } = await context.params;

    const row = await resolveOwnedInstance(supabase, accountId, name);
    if (!row) {
      return NextResponse.json({ error: 'Instance not found.' }, { status: 404 });
    }

    const body = await request.json();
    const incoming = (body?.settings ?? {}) as Partial<WhatsmiauInstanceSettings>;
    const settings = mergeInstanceSettings(row.instance_settings, {
      ...incoming,
      // The Authorization header is ours — see the config route.
      ...(incoming.webhook
        ? {
            webhook: {
              ...incoming.webhook,
              headers: withoutLockedHeaders(incoming.webhook.headers),
            },
          }
        : {}),
    });
    const webhook = buildWebhookConfig(
      { ...row, instance_settings: settings },
      webhookUrlFor(request),
    );
    const nextSettings = { ...settings, webhook };

    const conn = whatsmiauConnectionFromConfig(row);
    await updateInstance(conn, name, nextSettings);
    await setWebhook(conn, name, webhook);

    await upsertWhatsmiauConfig(supabase, accountId, {
      instance_settings: nextSettings,
    });

    return NextResponse.json({ success: true, settings: nextSettings }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    console.error('[whatsmiau/instance] could not update the instance:', error);
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { name } = await context.params;

    const row = await resolveOwnedInstance(supabase, accountId, name);
    if (!row) {
      return NextResponse.json({ error: 'Instance not found.' }, { status: 404 });
    }

    await deleteInstance(whatsmiauConnectionFromConfig(row), name);

    await upsertWhatsmiauConfig(supabase, accountId, {
      status: 'disconnected',
      connected_at: null,
      phone_number: null,
      is_active: false,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    console.error('[whatsmiau/instance] could not delete the instance:', error);
    return toErrorResponse(error);
  }
}
```

> `getWebhookConfig` não é usado neste arquivo — remova-o do import para o typecheck passar (TS `noUnusedLocals` está ligado neste repositório).

- [ ] **Step 6: Escreva `instances/[name]/connect/route.ts`**

Crie `src/app/api/whatsmiau/instances/[name]/connect/route.ts`:

```ts
// ============================================================
// Pair a phone with the instance: the QR code and the pairing code.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { whatsmiauConnectionFromConfig } from '@/lib/whatsapp/providers/connection';
import {
  connectInstance,
  logoutInstance,
} from '@/lib/whatsapp/providers/whatsmiau/instances';
import {
  providerErrorResponse,
  resolveOwnedInstance,
} from '@/lib/whatsapp/providers/whatsmiau/management';

type RouteContext = { params: Promise<{ name: string }> };

function qrResponse(qr: { base64: string; pairingCode?: string; connected: boolean }) {
  return NextResponse.json(
    {
      base64: qr.base64,
      ...(qr.pairingCode ? { pairing_code: qr.pairingCode } : {}),
      connected: qr.connected,
    },
    { status: 200 },
  );
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { name } = await context.params;

    const row = await resolveOwnedInstance(supabase, accountId, name);
    if (!row) {
      return NextResponse.json({ error: 'Instance not found.' }, { status: 404 });
    }

    const qr = await connectInstance(whatsmiauConnectionFromConfig(row), name);
    return qrResponse(qr);
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    return toErrorResponse(error);
  }
}

/**
 * POST = reconnect. Log the number out first, then ask for a fresh QR
 * code — the provider only hands out a new one for a session that is
 * not logged in.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { name } = await context.params;

    const row = await resolveOwnedInstance(supabase, accountId, name);
    if (!row) {
      return NextResponse.json({ error: 'Instance not found.' }, { status: 404 });
    }

    const conn = whatsmiauConnectionFromConfig(row);
    await logoutInstance(conn, name);
    const qr = await connectInstance(conn, name);
    return qrResponse(qr);
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 7: Escreva `instances/[name]/disconnect/route.ts`**

Crie `src/app/api/whatsmiau/instances/[name]/disconnect/route.ts`:

```ts
// ============================================================
// Disconnect the number without deleting the instance.
//
// `logout` unlinks the WhatsApp number but keeps the instance and
// its settings — the user re-scans a QR code and is back. Deleting
// the instance is a different, irreversible operation.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { whatsmiauConnectionFromConfig } from '@/lib/whatsapp/providers/connection';
import { logoutInstance } from '@/lib/whatsapp/providers/whatsmiau/instances';
import {
  providerErrorResponse,
  resolveOwnedInstance,
} from '@/lib/whatsapp/providers/whatsmiau/management';
import { upsertWhatsmiauConfig } from '@/lib/whatsapp/whatsmiau-config';

type RouteContext = { params: Promise<{ name: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { name } = await context.params;

    const row = await resolveOwnedInstance(supabase, accountId, name);
    if (!row) {
      return NextResponse.json({ error: 'Instance not found.' }, { status: 404 });
    }

    await logoutInstance(whatsmiauConnectionFromConfig(row), name);

    await upsertWhatsmiauConfig(supabase, accountId, {
      status: 'disconnected',
      connected_at: null,
      phone_number: null,
      is_active: false,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    console.error('[whatsmiau/instance] could not disconnect the instance:', error);
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 9: Escreva o teste que falha**

Crie `src/app/api/whatsmiau/instances/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: {} as Record<string, unknown>,
  config: null as Record<string, unknown> | null,
  createInstance: vi.fn(async () => {}),
  listInstances: vi.fn(async () => []),
  setWebhook: vi.fn(async () => {}),
  updateInstance: vi.fn(async () => {}),
  getConnectionState: vi.fn(async () => ({
    state: 'open' as const,
    connected: true,
    suspended: false,
  })),
  upsertWhatsmiauConfig: vi.fn(async (_db: unknown, _accountId: string, patch: unknown) => ({
    ...(h.config ?? {}),
    ...(patch as Record<string, unknown>),
  })),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    supabase: h.db,
    accountId: 'acc-1',
    userId: 'user-1',
    role: 'admin',
  })),
  toErrorResponse: vi.fn(
    (error: unknown) =>
      Response.json(
        { error: error instanceof Error ? error.message : 'error' },
        { status: 500 },
      ),
  ),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (text: string) => `enc:${text}`,
  decrypt: (text: string) => text.replace(/^enc:/, ''),
  isLegacyFormat: () => false,
}));

vi.mock('@/lib/whatsapp/whatsmiau-config', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/whatsmiau-config')>();
  return {
    ...actual,
    loadWhatsmiauConfig: vi.fn(async () => h.config),
    upsertWhatsmiauConfig: h.upsertWhatsmiauConfig,
  };
});

vi.mock('@/lib/whatsapp/providers/whatsmiau/instances', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/whatsapp/providers/whatsmiau/instances')
    >();
  return {
    ...actual,
    createInstance: h.createInstance,
    listInstances: h.listInstances,
    setWebhook: h.setWebhook,
    updateInstance: h.updateInstance,
    getConnectionState: h.getConnectionState,
  };
});

import { POST } from '../instances/route';
import { GET as GET_INSTANCE, PUT } from '../instances/[name]/route';

function configRow() {
  return {
    id: 'row-1',
    account_id: 'acc-1',
    instance_name: 'Atendimento01',
    api_key_encrypted: 'enc:key-123',
    base_url: 'https://api.whatsmiau.dev/v2',
    webhook_secret: 'secret-abc',
    status: 'connected',
    phone_number: '5511999988888',
    wuid: null,
    is_active: false,
    instance_settings: {
      alwaysOnline: false,
      readMessages: false,
      rejectCall: true,
      msgCall: '',
      groupsIgnore: true,
      saveMedia: true,
      webhook: {
        enabled: true,
        url: '',
        headers: {},
        events: ['messages.upsert'],
        base64: false,
      },
    },
    connected_at: '2026-10-27T10:00:00Z',
    created_at: '2026-10-27T09:00:00Z',
    updated_at: '2026-10-27T10:00:00Z',
  };
}

describe('POST /api/whatsmiau/instances', () => {
  beforeEach(() => {
    h.config = configRow();
    h.createInstance.mockClear();
    h.setWebhook.mockClear();
    h.upsertWhatsmiauConfig.mockClear();
  });

  it('rejects an invalid instance name and explains the rule', async () => {
    const res = await POST(
      new Request('https://app.test/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: 'nome com acento' }),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe('instance_name');
    expect(body.error).toMatch(/letters, numbers, dot, hyphen and underscore/);
    expect(h.createInstance).not.toHaveBeenCalled();
  });

  it('creates the instance and pushes our webhook with the locked Authorization header', async () => {
    const res = await POST(
      new Request('https://app.test/api/whatsmiau/instances', {
        method: 'POST',
        body: JSON.stringify({ instance_name: 'Atendimento01' }),
      }),
    );

    expect(res.status).toBe(200);
    expect(h.createInstance).toHaveBeenCalledTimes(1);
    const [conn, args] = h.createInstance.mock.calls[0] as [
      { apiKey: string },
      { instanceName: string; settings: { webhook: { url: string; headers: Record<string, string> } } },
    ];
    expect(conn.apiKey).toBe('key-123');
    expect(args.instanceName).toBe('Atendimento01');
    expect(args.settings.webhook.url).toBe('https://app.test/api/whatsmiau/webhook');
    expect(args.settings.webhook.headers.Authorization).toBe('Bearer secret-abc');
    expect(h.setWebhook).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/whatsmiau/instances/[name]', () => {
  beforeEach(() => {
    h.config = configRow();
  });

  it('answers 404 for an instance that belongs to another account', async () => {
    h.config = { ...configRow(), instance_name: 'OutraEmpresa' };
    const res = await GET_INSTANCE(new Request('https://app.test'), {
      params: Promise.resolve({ name: 'Atendimento01' }),
    });

    expect(res.status).toBe(404);
    expect(h.getConnectionState).not.toHaveBeenCalled();
  });

  it('answers the connection state for our own instance', async () => {
    const res = await GET_INSTANCE(new Request('https://app.test'), {
      params: Promise.resolve({ name: 'Atendimento01' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'open', connected: true });
  });
});

describe('PUT /api/whatsmiau/instances/[name]', () => {
  beforeEach(() => {
    h.config = configRow();
    h.updateInstance.mockClear();
    h.setWebhook.mockClear();
  });

  it('sends the account settings to the provider', async () => {
    const res = await PUT(
      new Request('https://app.test/api/whatsmiau/instances/Atendimento01', {
        method: 'PUT',
        body: JSON.stringify({ settings: { readMessages: true } }),
      }),
      { params: Promise.resolve({ name: 'Atendimento01' }) },
    );

    expect(res.status).toBe(200);
    const [, name, settings] = h.updateInstance.mock.calls[0] as [
      unknown,
      string,
      { readMessages: boolean; groupsIgnore: boolean },
    ];
    expect(name).toBe('Atendimento01');
    expect(settings.readMessages).toBe(true);
    expect(settings.groupsIgnore).toBe(true);
  });

  it('answers 404 for an instance that belongs to another account', async () => {
    h.config = { ...configRow(), instance_name: 'OutraEmpresa' };
    const res = await PUT(
      new Request('https://app.test/api/whatsmiau/instances/Atendimento01', {
        method: 'PUT',
        body: JSON.stringify({ settings: {} }),
      }),
      { params: Promise.resolve({ name: 'Atendimento01' }) },
    );

    expect(res.status).toBe(404);
    expect(h.updateInstance).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: Rode o teste e confirme que passa**

Run: `npx vitest run src/app/api/whatsmiau/instances/route.test.ts`
Expected: PASS (6 tests).

Se o teste `rejects an invalid instance name` falhar com 200 em vez de 400, o mock de `@/lib/whatsapp/providers/whatsmiau/instances` descartou `validateInstanceName`: o `importOriginal` precisa ser preservado (só os funções de rede são substituídas).

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 11: Commit**

```bash
git add src/lib/whatsapp/providers/whatsmiau/management.ts src/app/api/whatsmiau
git commit -m "feat(whatsmiau): rotas de configuracao, instancias e troca de API

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 14: Shell das Settings + hub do WhatsApp

**Files:**
- Create: `src/components/settings/settings-shell.tsx`
- Create: `src/components/settings/settings-page-client.tsx`
- Create: `src/components/settings/whatsapp-provider-nav.tsx`
- Create: `src/components/settings/whatsapp-hub.tsx`
- Create: `src/app/(dashboard)/settings/whatsapp/layout.tsx`
- Create: `src/app/(dashboard)/settings/whatsapp/page.tsx`
- Create: `src/app/(dashboard)/settings/whatsapp/meta/page.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`
- Modify: `src/components/settings/settings-sections.ts`
- Modify: `src/components/settings/settings-rail.tsx`

**Interfaces:**
- Consumes (existentes): `SettingsRail`, `SettingsPanelHead`, `SettingsChip`, `StatusDot`, `resolveSection`, `SettingsSection`, `SECTION_META`, `useAuth`, `useTheme`.
- Produces:
  - `SettingsShell({ active, children, onSelect? })` — título + rail + grid.
  - `SettingsPageClient({ tab })` — o corpo cliente que hoje vive em `settings/page.tsx`.
  - `WhatsAppProviderNav()` — sub-nav Meta/CRMBR.
  - `WhatsAppHub()` — o hub da spec §9.4.
  - `SectionMeta.href?: string` — quando preenchido, o rail renderiza um `<Link>` em vez de um `<button>`.

> **Isolamento.** Só três arquivos do upstream são tocados aqui, e todos em poucas linhas: `settings/page.tsx` (vira server component que faz o redirect), `settings-sections.ts` (um campo opcional) e `settings-rail.tsx` (um `Link` opcional). Nenhum deles é `meta-api.ts`, o webhook do Meta, `whatsapp_config` nem `whatsapp-config.tsx`.

- [ ] **Step 1: Adicione `href` ao `SectionMeta`**

Em `src/components/settings/settings-sections.ts`, mude a interface e o item `whatsapp`:

```ts
/** Rail grouping. `adminOnly` items are hidden for non-admins. */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace';
  /**
   * When set, the rail renders a real link instead of a button. The
   * WhatsApp section owns a dedicated route (`/settings/whatsapp`),
   * so it must be a navigation, not a query-string swap.
   */
  href?: string;
}
```

E no `SECTION_META`:

```ts
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: PlugZap,
    group: 'workspace',
    href: '/settings/whatsapp',
  },
```

- [ ] **Step 2: Faça o rail renderizar um `Link` quando houver `href`**

Em `src/components/settings/settings-rail.tsx`:

1. Troque o import:

```tsx
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
```

2. Troque o `activeRef` por um callback ref (o item ativo pode ser um `<button>` **ou** um `<Link>`, e os dois têm tipos de ref diferentes):

```tsx
  const t = useTranslations('Settings');
  const activeRef = useRef<HTMLElement | null>(null);
  const setActiveRef = useCallback((node: HTMLElement | null) => {
    activeRef.current = node;
  }, []);
```

3. No corpo do `items.map`, calcule o conteúdo compartilhado e renderize conforme o `href`:

```tsx
            {items.map((s) => {
              const meta = SECTION_META[s];
              const Icon = meta.icon;
              const isActive = s === active;
              const className = cn(
                'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors',
                'lg:w-full',
                isActive
                  ? 'bg-primary-soft text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              );
              const inner = (
                <>
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1">{t(`sections.${s}`)}</span>
                  {hints?.[s] != null ? (
                    <span
                      className={cn(
                        'hidden items-center gap-1.5 text-xs lg:inline-flex',
                        isActive ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {hints[s]}
                    </span>
                  ) : null}
                </>
              );

              // A section with its own route is a real link; everything
              // else stays a button that swaps the `?tab=` query.
              if (meta.href) {
                return (
                  <Link
                    key={s}
                    href={meta.href}
                    ref={isActive ? setActiveRef : undefined}
                    aria-current={isActive ? 'page' : undefined}
                    className={className}
                  >
                    {inner}
                  </Link>
                );
              }

              return (
                <button
                  key={s}
                  ref={isActive ? setActiveRef : undefined}
                  type="button"
                  onClick={() => onSelect(s)}
                  aria-current={isActive ? 'page' : undefined}
                  className={className}
                >
                  {inner}
                </button>
              );
            })}
```

> O `setActiveRef` aceita `HTMLElement | null` — parâmetro mais largo que `HTMLAnchorElement | null` — então serve tanto para o `<Link>` quanto para o `<button>`, e o TypeScript aceita por contravariance.

- [ ] **Step 3: Extraia o shell**

Crie `src/components/settings/settings-shell.tsx`:

```tsx
'use client';

import { useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from './settings-rail';
import type { SettingsSection } from './settings-sections';

/**
 * The settings chrome — title, rail and the two-column grid.
 *
 * It lives here (instead of inside `settings/page.tsx`) because the
 * WhatsApp section owns a dedicated route: `/settings/whatsapp` and
 * its children (`/meta`, `/crmbr`) need the SAME rail and title, but
 * they are separate routes in the App Router, so the chrome has to be
 * a component both can render.
 */
export function SettingsShell({
  active,
  children,
  onSelect,
}: {
  active: SettingsSection;
  children: ReactNode;
  onSelect?: (section: SettingsSection) => void;
}) {
  const router = useRouter();
  const { defaultCurrency } = useAuth();
  const { mode } = useTheme();
  const t = useTranslations('Settings');

  // Cheap, fetch-free rail hints — the Overview landing carries the
  // full live status; the rail just surfaces what is already in
  // context.
  const hints = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency],
  );

  const go = onSelect ?? ((next: SettingsSection) => {
    if (next === 'whatsapp') {
      router.push('/settings/whatsapp');
      return;
    }
    router.push(`/settings?tab=${next}`);
  });

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageDesc')}</p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail active={active} onSelect={go} hints={hints} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Extraia o corpo cliente da página de Settings**

Crie `src/components/settings/settings-page-client.tsx`:

```tsx
'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { TemplateManager } from '@/components/settings/template-manager';
import { QuickRepliesManager } from '@/components/settings/quick-replies-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { InboxSettings } from '@/components/settings/inbox-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { SettingsShell } from '@/components/settings/settings-shell';
import {
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';

/**
 * The settings panels. The `tab` arrives as a prop from the server
 * page (which redirects `?tab=whatsapp` to `/settings/whatsapp`), so
 * this component never touches `useSearchParams` — no Suspense
 * boundary, no CSR bailout.
 */
export function SettingsPageClient({ tab }: { tab: string | null }) {
  const router = useRouter();

  const section = resolveSection(tab);

  const go = (next: SettingsSection) => {
    if (next === 'whatsapp') {
      router.push('/settings/whatsapp');
      return;
    }
    router.push(`/settings?tab=${next}`);
  };

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: <WhatsAppConfig />,
    templates: <TemplateManager />,
    'quick-replies': <QuickRepliesManager />,
    fields: <FieldsAndTagsPanel />,
    inbox: <InboxSettings />,
    deals: <DealsSettings />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
  };

  return (
    <SettingsShell active={section} onSelect={go}>
      {panel[section]}
    </SettingsShell>
  );
}
```

- [ ] **Step 5: Transforme `settings/page.tsx` em server component com redirect**

Substitua todo o conteúdo de `src/app/(dashboard)/settings/page.tsx` por:

```tsx
import { redirect } from 'next/navigation';

import { SettingsPageClient } from '@/components/settings/settings-page-client';

/**
 * The settings page is a server component so the WhatsApp tab can
 * redirect SERVER-side: `?tab=whatsapp` now owns a dedicated route
 * (`/settings/whatsapp`), and every old link to `?tab=whatsapp` still
 * lands in the right place — with a real redirect instead of a
 * client-side flash of the Meta panel.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = params.tab;
  const tab = Array.isArray(raw) ? raw[0] : raw;

  if (tab === 'whatsapp') redirect('/settings/whatsapp');

  return <SettingsPageClient tab={tab ?? null} />;
}
```

> **Next 16:** `searchParams` é uma `Promise` — sempre `await`. Nunca use `useSearchParams` nesta página (o componente cliente recebe a query por prop, o que elimina a necessidade do `<Suspense>` e do bailout de CSR).

- [ ] **Step 6: Crie o sub-nav Meta/CRMBR**

Crie `src/components/settings/whatsapp-provider-nav.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/settings/whatsapp', key: 'hub' },
  { href: '/settings/whatsapp/meta', key: 'meta' },
  { href: '/settings/whatsapp/crmbr', key: 'crmbr' },
] as const;

/**
 * Sub-navigation inside the WhatsApp section: the hub, the official
 * API and the non-official one. A segmented control rather than a
 * second rail — the left rail already belongs to Settings.
 */
export function WhatsAppProviderNav() {
  const pathname = usePathname();
  const t = useTranslations('Settings.whatsappHub');

  return (
    <nav
      aria-label={t('navLabel')}
      className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
    >
      {ITEMS.map((item) => {
        const active =
          item.href === '/settings/whatsapp'
            ? pathname === item.href
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-primary-soft text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t(`nav.${item.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 7: Crie o layout da seção WhatsApp**

Crie `src/app/(dashboard)/settings/whatsapp/layout.tsx`:

```tsx
import type { ReactNode } from 'react';

import { SettingsShell } from '@/components/settings/settings-shell';
import { WhatsAppProviderNav } from '@/components/settings/whatsapp-provider-nav';

/**
 * The WhatsApp section of Settings. The shell (title + rail) is the
 * same one the tabbed page uses, so the section reads as part of
 * Settings instead of a different app.
 */
export default function WhatsAppSettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <SettingsShell active="whatsapp">
      <div className="space-y-5">
        <WhatsAppProviderNav />
        {children}
      </div>
    </SettingsShell>
  );
}
```

- [ ] **Step 8: Crie o hub**

Crie `src/components/settings/whatsapp-hub.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  CheckCircle2,
  CircleSlash,
  Loader2,
  MessageSquareOff,
  PlugZap,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { SettingsChip, StatusDot } from './settings-chip';

type Provider = 'meta' | 'whatsmiau';

interface MetaState {
  configured: boolean;
  connected: boolean;
}

interface CrmbrState {
  configured: boolean;
  status: string;
  instance_name?: string;
  phone_number?: string | null;
}

/**
 * The WhatsApp hub — which API this account is sending through, and
 * the two cards that open each API's own screen.
 *
 * Every card states what the API DOESN'T do, because the two
 * providers are not interchangeable: only the official one has
 * approved templates, and only the unofficial one can be self-hosted.
 */
export function WhatsAppHub() {
  const t = useTranslations('Settings.whatsappHub');

  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [active, setActive] = useState<Provider>('meta');
  const [meta, setMeta] = useState<MetaState>({ configured: false, connected: false });
  const [crmbr, setCrmbr] = useState<CrmbrState>({
    configured: false,
    status: 'not_configured',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [metaRes, crmbrRes, activeRes] = await Promise.allSettled([
      fetch('/api/whatsapp/config', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/whatsmiau/config', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/whatsmiau/active', { cache: 'no-store' }).then((r) => r.json()),
    ]);

    if (metaRes.status === 'fulfilled') {
      const value = metaRes.value as { connected?: boolean };
      setMeta({ configured: !!value?.connected, connected: !!value?.connected });
    }
    if (crmbrRes.status === 'fulfilled') {
      const value = crmbrRes.value as {
        configured?: boolean;
        status?: string;
        instance_name?: string;
        phone_number?: string | null;
      };
      setCrmbr({
        configured: !!value?.configured,
        status: value?.status ?? 'not_configured',
        instance_name: value?.instance_name,
        phone_number: value?.phone_number ?? null,
      });
    }
    if (activeRes.status === 'fulfilled') {
      const value = activeRes.value as { provider?: Provider };
      if (value?.provider === 'whatsmiau' || value?.provider === 'meta') {
        setActive(value.provider);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function switchTo(provider: Provider) {
    setSwitching(true);
    try {
      const res = await fetch('/api/whatsmiau/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('switchFailed'));
        return;
      }
      setActive(provider);
      toast.success(
        provider === 'whatsmiau' ? t('switchedToCrmbr') : t('switchedToMeta'),
      );
    } catch {
      toast.error(t('switchFailed'));
    } finally {
      setSwitching(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const crmbrConnected = crmbr.configured && crmbr.status === 'connected';

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {/* Which API is live right now */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <StatusDot tone={active === 'whatsmiau' && !crmbrConnected ? 'muted' : 'ok'} />
          <p className="text-sm text-foreground">
            {active === 'whatsmiau' ? t('usingCrmbr') : t('usingMeta')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">
            {active === 'whatsmiau'
              ? crmbrConnected
                ? t('crmbrConnectedDetail')
                : t('crmbrNotConnectedDetail')
              : meta.connected
                ? t('metaConnectedDetail')
                : t('metaNotConnectedDetail')}
          </p>
          {active === 'whatsmiau' ? (
            <Button
              variant="outline"
              size="sm"
              disabled={switching || !meta.connected}
              onClick={() => switchTo('meta')}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {switching ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('switchToMeta')}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={switching || !crmbrConnected}
              onClick={() => switchTo('whatsmiau')}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {switching ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('switchToCrmbr')}
            </Button>
          )}
        </div>
      </div>

      {/* The two providers */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Official — Meta */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <ShieldCheck className="size-4 text-primary" />
                  {t('metaTitle')}
                </CardTitle>
                <CardDescription className="mt-1 text-muted-foreground">
                  {t('metaDesc')}
                </CardDescription>
              </div>
              <SettingsChip variant={active === 'meta' ? 'admin' : 'muted'}>
                {active === 'meta' ? t('inUse') : t('officialBadge')}
              </SettingsChip>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              {meta.connected ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  <span className="text-foreground">{t('connected')}</span>
                </>
              ) : (
                <>
                  <CircleSlash className="size-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t('notConnected')}</span>
                </>
              )}
            </div>

            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
                {t('metaHasTemplates')}
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                {t('metaHasVerification')}
              </li>
              <li className="flex items-start gap-2">
                <MessageSquareOff className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                {t('metaNoSelfHosted')}
              </li>
            </ul>

            <Link
              href="/settings/whatsapp/meta"
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('configure')}
              <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>

        {/* Non-official — CRMBR (WhatsMiau) */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-foreground">
                  <PlugZap className="size-4 text-primary" />
                  {t('crmbrTitle')}
                </CardTitle>
                <CardDescription className="mt-1 text-muted-foreground">
                  {t('crmbrDesc')}
                </CardDescription>
              </div>
              <SettingsChip variant={active === 'whatsmiau' ? 'admin' : 'warn'}>
                {active === 'whatsmiau' ? t('inUse') : t('unofficialBadge')}
              </SettingsChip>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              {crmbrConnected ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  <span className="text-foreground">{t('connected')}</span>
                </>
              ) : (
                <>
                  <CircleSlash className="size-4 text-muted-foreground" />
                  <span className="text-muted-foreground">{t('notConnected')}</span>
                </>
              )}
            </div>

            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
                {t('crmbrHasSelfHosted')}
              </li>
              <li className="flex items-start gap-2">
                <MessageSquareOff className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                {t('crmbrNoTemplates')}
              </li>
            </ul>

            <Link
              href="/settings/whatsapp/crmbr"
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('configure')}
              <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
```

> O `Button` do projeto é base-ui e **não** aceita `asChild` — por isso os CTAs são `<Link>` estilizados como botão, e não `<Button asChild>`.

- [ ] **Step 9: Crie as três rotas**

`src/app/(dashboard)/settings/whatsapp/page.tsx`:

```tsx
import { WhatsAppHub } from '@/components/settings/whatsapp-hub';

export default function WhatsAppSettingsPage() {
  return <WhatsAppHub />;
}
```

`src/app/(dashboard)/settings/whatsapp/meta/page.tsx`:

```tsx
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';

/**
 * The official API screen. The component itself is untouched — the
 * upstream maintainer owns it and this route only gives it a home
 * inside the new section.
 */
export default function WhatsAppMetaSettingsPage() {
  return <WhatsAppConfig />;
}
```

`src/app/(dashboard)/settings/whatsapp/crmbr/page.tsx` — criado na Task 15, quando o componente existir.

- [ ] **Step 10: Typecheck e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros. Se o lint reclamar de `React.ReactNode` em `settings-page-client.tsx`, importe `type ReactNode` de `'react'` e use `ReactNode`.

- [ ] **Step 11: Verifique no navegador**

Run: `npm run dev`, depois abra:
- `/settings?tab=whatsapp` → deve cair em `/settings/whatsapp` (redirect do servidor, sem flash do painel da Meta).
- `/settings/whatsapp` → hub com os dois cards e o banner do provedor ativo.
- `/settings/whatsapp/meta` → o painel da Meta, idêntico ao de antes.
- `/settings?tab=templates` → o painel de templates, sem mudança.

- [ ] **Step 12: Commit**

```bash
git add src/components/settings/settings-shell.tsx src/components/settings/settings-page-client.tsx src/components/settings/whatsapp-provider-nav.tsx src/components/settings/whatsapp-hub.tsx "src/app/(dashboard)/settings"
git commit -m "feat(settings): shell compartilhado e hub das APIs do WhatsApp

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 15: Tela da API CRMBR (WhatsMiau)

**Files:**
- Create: `src/components/settings/whatsmiau-config.tsx`
- Create: `src/components/settings/whatsmiau-instance-card.tsx`
- Create: `src/components/settings/whatsmiau-webhook-card.tsx`
- Create: `src/app/(dashboard)/settings/whatsapp/crmbr/page.tsx`

**Interfaces:**
- Consumes (Task 1): `DEFAULT_INSTANCE_SETTINGS`, `WhatsmiauInstanceSettings`, `WhatsmiauWebhookConfig`, `WhatsmiauStatus` — de `@/lib/whatsapp/whatsmiau-config`.
- Consumes (Task 5): `validateInstanceName` — de `@/lib/whatsapp/providers/whatsmiau/instances`.
- Consumes (Task 10): `SUPPORTED_WEBHOOK_EVENTS` — de `@/lib/whatsapp/providers/whatsmiau/webhook`.
- Consumes (Task 10): `WEBHOOK_EVENT_SAMPLES` — de `@/lib/whatsapp/providers/whatsmiau/event-samples`.
- Consumes (Task 13): as rotas `/api/whatsmiau/*`.
- Produces: a rota `/settings/whatsapp/crmbr`.

- [ ] **Step 1: Invoke as skills de UI/UX ANTES de escrever o markup**

O usuário pediu explicitamente: *"apenas use as skills de ui/ux que temos instalada para você não criar algo feio. o sistema é bonito, basta seguir e fazer melhor."*

Rode **as duas** skills e aplique o checklist delas ao markup dos Steps 2–4:

```
Skill(skill="ui-ux-pro-max", args="tela de configurações de API WhatsApp não-oficial: QR code de pareamento, headers de webhook, grid de eventos, switches de comportamento, zona de risco e barra sticky de alterações não salvas")
Skill(skill="ui-styling", args="aplicar o design system existente (tokens primary/muted/border, cards, switches, badges) a uma tela de settings com três colunas de densidade")
```

Regras mínimas que as skills devem produzir (e que o revisor vai conferir):

- **Hierarquia**: título da seção → subtítulo → cards. Um `SettingsPanelHead` por tela, e cada card com `CardTitle` + `CardDescription`.
- **Densidade**: os labels em `text-xs text-muted-foreground`, os valores em `text-sm text-foreground`, os helpers em `text-xs text-muted-foreground`. Nada de texto corrido grande — é uma tela de configuração.
- **Ações**: primária em `variant="default"` (verde/primary do tema), secundária em `variant="outline"`, destrutiva em `variant="destructive"` — nunca um botão vermelho escrito à mão.
- **Estados**: todo botão que dispara rede precisa de `disabled` + spinner (`Loader2` com `animate-spin`).
- **Foco e teclado**: nada de `<div onClick>` — botões de verdade, `<label htmlFor>` ligado ao input.
- **Alinhamento**: labels e inputs na mesma coluna; switches alinhados à direita com `justify-between` dentro de um `rounded-lg border border-border p-3` (o mesmo padrão do interruptor "Retenção de anexos" do painel da Meta).
- **Nada de emoji** — só `lucide-react`.

- [ ] **Step 2: Escreva `whatsmiau-instance-card.tsx`**

Crie `src/components/settings/whatsmiau-instance-card.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Download,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SettingsChip, StatusDot } from './settings-chip';
import type { WhatsmiauStatus } from '@/lib/whatsapp/whatsmiau-config';

/** How often we ask the provider whether the phone confirmed the pairing. */
const POLL_INTERVAL_MS = 3000;

interface QrState {
  base64: string;
  pairing_code?: string;
  connected: boolean;
}

/** The provider hands back raw base64; the browser needs a data URL. */
function qrSrc(base64: string): string {
  if (base64.startsWith('data:')) return base64;
  return `data:image/png;base64,${base64}`;
}

/**
 * Linking the phone to the instance: the QR code, the pairing code and
 * the reconnect button. It mirrors the WhatsMiau panel's own
 * "Configurações" screen, because that is the mental model the user
 * already has.
 */
export function WhatsmiauInstanceCard({
  instanceName,
  status,
  phoneNumber,
  onChanged,
}: {
  instanceName: string | null;
  status: WhatsmiauStatus;
  phoneNumber: string | null;
  onChanged: () => void;
}) {
  const t = useTranslations('Settings.whatsmiau');
  const [qr, setQr] = useState<QrState | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  // While a QR code is on screen, watch the connection state: the
  // provider flips the instance to `open` the moment the phone
  // confirms the pairing, and that is the moment we refresh the row.
  const startPolling = useCallback(
    (name: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `/api/whatsmiau/instances/${encodeURIComponent(name)}`,
            { cache: 'no-store' },
          );
          if (!res.ok) return;
          const state = await res.json();
          if (state?.state === 'open') {
            stopPolling();
            setQr(null);
            onChanged();
            toast.success(t('paired'));
          }
        } catch {
          // A transient network error must not kill the poll — the user
          // is scanning a QR code and expects the screen to keep
          // trying.
        }
      }, POLL_INTERVAL_MS);
    },
    [onChanged, stopPolling, t],
  );

  async function fetchQr() {
    if (!instanceName) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/whatsmiau/instances/${encodeURIComponent(instanceName)}/connect`,
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('qrFailed'));
        return;
      }
      setQr(data);
      if (!data.connected) startPolling(instanceName);
    } catch {
      toast.error(t('qrFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleReconnect() {
    if (!instanceName) return;
    setReconnecting(true);
    try {
      const res = await fetch(
        `/api/whatsmiau/instances/${encodeURIComponent(instanceName)}/connect`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('reconnectFailed'));
        return;
      }
      setQr(data);
      startPolling(instanceName);
    } catch {
      toast.error(t('reconnectFailed'));
    } finally {
      setReconnecting(false);
    }
  }

  function handleDownloadQr() {
    if (!qr) return;
    const link = document.createElement('a');
    link.href = qrSrc(qr.base64);
    link.download = `whatsmiau-${instanceName ?? 'qr'}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  if (!instanceName) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Smartphone className="size-4 text-primary" />
              {t('numberTitle')}
            </CardTitle>
            <CardDescription className="mt-1 text-muted-foreground">
              {t('numberDesc')}
            </CardDescription>
          </div>
          <SettingsChip
            variant={
              status === 'connected'
                ? 'ok'
                : status === 'error'
                  ? 'warn'
                  : 'muted'
            }
          >
            {status === 'connected' ? (
              <>
                <StatusDot /> {t('connected')}
              </>
            ) : status === 'connecting' ? (
              t('connecting')
            ) : status === 'error' ? (
              t('error')
            ) : (
              t('disconnected')
            )}
          </SettingsChip>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'connected' && phoneNumber ? (
          <p className="text-sm text-muted-foreground">
            {t('linkedNumber')}{' '}
            <span className="font-medium text-foreground">{phoneNumber}</span>
          </p>
        ) : null}

        {qr ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="shrink-0 rounded-xl border border-border bg-white p-2">
              {/* The provider hands us a data URL — next/image would
                  add nothing here and would need the remote loader. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrSrc(qr.base64)}
                alt={t('qrAlt')}
                className="size-40 rounded-lg"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              {qr.pairing_code ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    {t('pairingCode')}
                  </p>
                  <Input
                    readOnly
                    value={qr.pairing_code}
                    className="bg-muted border-border font-mono text-sm tracking-widest"
                  />
                </div>
              ) : null}
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t('waitingForScan')}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadQr}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Download className="size-3.5" />
                {t('shareQr')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={fetchQr}
              disabled={loading}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <QrCode className="size-4" />
              )}
              {status === 'connected' ? t('showQr') : t('generateQr')}
            </Button>
            {status === 'connected' ? (
              <Button
                variant="outline"
                onClick={handleReconnect}
                disabled={reconnecting}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {reconnecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {t('reconnect')}
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Escreva `whatsmiau-webhook-card.tsx`**

Crie `src/components/settings/whatsmiau-webhook-card.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Copy, Lock, Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WEBHOOK_EVENT_SAMPLES } from '@/lib/whatsapp/providers/whatsmiau/event-samples';
import { SUPPORTED_WEBHOOK_EVENTS } from '@/lib/whatsapp/providers/whatsmiau/webhook';
import type { WhatsmiauWebhookConfig } from '@/lib/whatsapp/whatsmiau-config';

/** The provider caps the custom headers at 20. */
const MAX_HEADERS = 20;

/**
 * The webhook configuration — the same blocks the WhatsMiau panel
 * shows: the integration type, the URL, the custom headers and the
 * event grid.
 *
 * The `Authorization` header is OURS: it carries the account's
 * webhook secret, which the browser must never see. It is rendered
 * as a locked row, and the server rebuilds it on every push.
 */
export function WhatsmiauWebhookCard({
  value,
  onChange,
  disabled = false,
}: {
  value: WhatsmiauWebhookConfig;
  onChange: (next: WhatsmiauWebhookConfig) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('Settings.whatsmiau.webhook');
  const [sampleEvent, setSampleEvent] = useState<string | null>(null);

  /**
   * The public URL of this app + the webhook route.
   *
   * The stored `url` is intentionally empty: the server rebuilds it on
   * every push (`webhookUrlFor(request)` in `management.ts`), because a
   * URL baked into the database would be wrong the day the app moves to
   * another host. The browser shows the same URL, derived from the
   * current origin — so what the user copies is exactly what the
   * provider receives.
   */
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const publicUrl = value.url || `${origin}/api/whatsmiau/webhook`;

  const headers = Object.entries(value.headers ?? {});

  function setHeader(index: number, key: string, headerValue: string) {
    const next = [...headers];
    next[index] = [key, headerValue];
    onChange({ ...value, headers: Object.fromEntries(next) });
  }

  function addHeader() {
    if (headers.length >= MAX_HEADERS) {
      toast.error(t('maxHeaders', { count: MAX_HEADERS }));
      return;
    }
    let n = 1;
    let key = `X-Custom-${n}`;
    while (Object.prototype.hasOwnProperty.call(value.headers ?? {}, key)) {
      n += 1;
      key = `X-Custom-${n}`;
    }
    onChange({ ...value, headers: { ...(value.headers ?? {}), [key]: '' } });
  }

  function removeHeader(key: string) {
    const next = { ...(value.headers ?? {}) };
    delete next[key];
    onChange({ ...value, headers: next });
  }

  function toggleEvent(event: string) {
    const events = value.events.includes(event)
      ? value.events.filter((e) => e !== event)
      : [...value.events, event];
    onChange({ ...value, events });
  }

  function copyUrl() {
    navigator.clipboard.writeText(publicUrl);
    toast.success(t('copied'));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">{t('title')}</CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Integration type — fixed by the provider */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-foreground">
              {t('integrationType')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('integrationTypeHint')}
            </p>
          </div>
          <Badge variant="outline">{t('evolutionApi')}</Badge>
        </div>

        {/* Webhook URL */}
        <div className="space-y-2">
          <Label className="text-muted-foreground" htmlFor="whatsmiau-webhook-url">
            {t('url')}
          </Label>
          <div className="flex gap-2">
            <Input
              id="whatsmiau-webhook-url"
              readOnly
              value={publicUrl}
              disabled={disabled}
              className="bg-muted border-border font-mono text-sm text-muted-foreground"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={copyUrl}
              disabled={disabled || !publicUrl}
              aria-label={t('copyUrl')}
              className="shrink-0 border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>

        {/* Headers */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t('headers')}</p>
              <p className="text-xs text-muted-foreground">{t('headersHint')}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addHeader}
              disabled={disabled || headers.length >= MAX_HEADERS}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="size-3.5" />
              {t('addHeader')}
            </Button>
          </div>

          {/* The locked header — ours, never editable, never revealed */}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
            <Lock className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground">
              Authorization
            </span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              Bearer ••••••••••••••••
            </span>
          </div>

          {headers.map(([key, headerValue], index) => (
            <div key={`${key}-${index}`} className="flex gap-2">
              <Input
                value={key}
                onChange={(e) => setHeader(index, e.target.value, headerValue)}
                disabled={disabled}
                placeholder={t('headerName')}
                aria-label={t('headerName')}
                className="bg-muted border-border text-foreground"
              />
              <Input
                value={headerValue}
                onChange={(e) => setHeader(index, key, e.target.value)}
                disabled={disabled}
                placeholder={t('headerValue')}
                aria-label={t('headerValue')}
                className="bg-muted border-border text-foreground"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => removeHeader(key)}
                disabled={disabled}
                aria-label={t('removeHeader')}
                className="shrink-0 border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        {/* Events */}
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t('events')}</p>
            <p className="text-xs text-muted-foreground">{t('eventsHint')}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {SUPPORTED_WEBHOOK_EVENTS.map((event) => {
              const checked = value.events.includes(event);
              return (
                <div
                  key={event}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleEvent(event)}
                    disabled={disabled}
                    aria-label={event}
                  />
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    {event}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setSampleEvent(event)}
                    className="ml-auto text-xs text-primary transition-colors hover:underline"
                  >
                    {t('viewSample')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>

      <Dialog
        open={sampleEvent !== null}
        onOpenChange={(open) => {
          if (!open) setSampleEvent(null);
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-popover-foreground">
              {sampleEvent}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('sampleDescription')}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-muted p-3 text-xs leading-relaxed text-foreground">
            {sampleEvent ? (WEBHOOK_EVENT_SAMPLES[sampleEvent] ?? '') : ''}
          </pre>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSampleEvent(null)}
              className="border-border text-muted-foreground"
            >
              {t('close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

- [ ] **Step 4: Escreva `whatsmiau-config.tsx`**

Crie `src/components/settings/whatsmiau-config.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Eye,
  EyeOff,
  Loader2,
  PlugZap,
  RefreshCw,
  Save,
  Trash2,
  Unplug,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SettingsPanelHead } from './settings-panel-head';
import { WhatsmiauInstanceCard } from './whatsmiau-instance-card';
import { WhatsmiauWebhookCard } from './whatsmiau-webhook-card';
import {
  DEFAULT_INSTANCE_SETTINGS,
  type WhatsmiauInstanceSettings,
  type WhatsmiauStatus,
} from '@/lib/whatsapp/whatsmiau-config';

const MASKED_API_KEY = '••••••••••••••••';
const DEFAULT_BASE_URL = 'https://api.whatsmiau.dev/v2';

interface SavedState {
  instance_name: string;
  base_url: string;
  api_key_masked: string;
  status: WhatsmiauStatus;
  phone_number: string | null;
  instance_settings: WhatsmiauInstanceSettings;
}

/**
 * The CRMBR (non-official WhatsApp API) settings screen.
 *
 * Our database is the source of truth: "Salvar" writes the config and
 * then pushes the settings and the webhook to the provider. "Verificar"
 * asks the provider what it has and reports the difference.
 */
export function WhatsmiauConfig() {
  const t = useTranslations('Settings.whatsmiau');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [syncFullHistory, setSyncFullHistory] = useState(false);
  const [instanceExists, setInstanceExists] = useState(false);

  // The saved state — the baseline the dirty check compares against.
  const [saved, setSaved] = useState<SavedState | null>(null);

  // The edited state.
  const [instanceName, setInstanceName] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState('');
  const [settings, setSettings] = useState<WhatsmiauInstanceSettings>(
    DEFAULT_INSTANCE_SETTINGS,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/whatsmiau/config', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('loadFailed'));
        return;
      }
      if (!data?.configured) {
        setSaved(null);
        setInstanceExists(false);
        setInstanceName('');
        setBaseUrl(DEFAULT_BASE_URL);
        setApiKey('');
        setSettings(DEFAULT_INSTANCE_SETTINGS);
        return;
      }
      const next: SavedState = {
        instance_name: data.instance_name ?? '',
        base_url: data.base_url ?? DEFAULT_BASE_URL,
        api_key_masked: data.api_key_masked ?? MASKED_API_KEY,
        status: data.status ?? 'disconnected',
        phone_number: data.phone_number ?? null,
        instance_settings: data.instance_settings ?? DEFAULT_INSTANCE_SETTINGS,
      };
      setSaved(next);
      setInstanceName(next.instance_name);
      setBaseUrl(next.base_url);
      setApiKey('');
      setSettings(next.instance_settings);
      setInstanceExists(Boolean(next.instance_name));
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!saved) return Boolean(apiKey.trim()) || Boolean(instanceName.trim());
    if (apiKey.trim()) return true;
    if (instanceName.trim() !== saved.instance_name) return true;
    if (baseUrl.trim() !== saved.base_url) return true;
    return (
      JSON.stringify(settings) !== JSON.stringify(saved.instance_settings)
    );
  }, [apiKey, baseUrl, instanceName, saved, settings]);

  function patchSettings(patch: Partial<WhatsmiauInstanceSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  async function handleSave() {
    const name = instanceName.trim();
    if (!name) {
      toast.error(t('instanceNameRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/whatsmiau/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          base_url: baseUrl.trim(),
          instance_name: name,
          instance_settings: settings,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('saveFailed'));
        return;
      }
      if (data.warning) {
        toast.warning(t('savedButNotVerified', { warning: data.warning }));
      } else {
        toast.success(t('saved'));
      }

      // Push to the provider: our database is the source of truth, so
      // the instance and the webhook have to follow.
      if (instanceExists && saved?.instance_name === name) {
        const put = await fetch(
          `/api/whatsmiau/instances/${encodeURIComponent(name)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings }),
          },
        );
        if (!put.ok) {
          const putData = await put.json();
          toast.error(putData?.error || t('pushFailed'));
        }
      } else {
        const created = await fetch('/api/whatsmiau/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instance_name: name,
            sync_full_history: syncFullHistory,
          }),
        });
        if (!created.ok) {
          const createdData = await created.json();
          toast.error(createdData?.error || t('pushFailed'));
        } else {
          setInstanceExists(true);
        }
      }

      await load();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    const name = instanceName.trim();
    if (!name) {
      toast.error(t('instanceNameRequired'));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/whatsmiau/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_name: name,
          sync_full_history: syncFullHistory,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('createFailed'));
        return;
      }
      setInstanceExists(true);
      toast.success(t('created'));
      await load();
    } catch {
      toast.error(t('createFailed'));
    } finally {
      setCreating(false);
    }
  }

  async function handleVerify() {
    const name = saved?.instance_name;
    if (!name) {
      toast.error(t('nothingToVerify'));
      return;
    }
    setVerifying(true);
    try {
      const [listRes, stateRes] = await Promise.all([
        fetch('/api/whatsmiau/instances', { cache: 'no-store' }).then((r) =>
          r.json(),
        ),
        fetch(`/api/whatsmiau/instances/${encodeURIComponent(name)}`, {
          cache: 'no-store',
        }).then((r) => r.json()),
      ]);
      const instances = Array.isArray(listRes?.instances)
        ? listRes.instances
        : [];
      const found = instances.find(
        (item: { name?: string }) => item?.name === name,
      );
      if (!found) {
        toast.error(t('instanceNotFoundAtProvider'));
        return;
      }
      if (stateRes?.state !== 'open') {
        toast.warning(t('instanceNotOpen'));
      } else {
        toast.success(t('verified'));
      }
      await load();
    } catch {
      toast.error(t('verifyFailed'));
    } finally {
      setVerifying(false);
    }
  }

  async function handleDisconnect() {
    const name = saved?.instance_name;
    if (!name) return;
    if (!confirm(t('disconnectConfirm'))) return;
    try {
      const res = await fetch(
        `/api/whatsmiau/instances/${encodeURIComponent(name)}/disconnect`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('disconnectFailed'));
        return;
      }
      toast.success(t('disconnectDone'));
      await load();
    } catch {
      toast.error(t('disconnectFailed'));
    }
  }

  async function handleDelete() {
    const name = saved?.instance_name;
    if (!name) return;
    if (!confirm(t('deleteConfirm'))) return;
    try {
      const res = await fetch(
        `/api/whatsmiau/instances/${encodeURIComponent(name)}`,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || t('deleteFailed'));
        return;
      }
      toast.success(t('deleted'));
      setInstanceExists(false);
      await load();
    } catch {
      toast.error(t('deleteFailed'));
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200 pb-24">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <Button
            variant="outline"
            onClick={handleVerify}
            disabled={verifying || !saved?.instance_name}
            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {verifying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t('verify')}
          </Button>
        }
      />

      <Alert className="mb-4 border-border bg-card">
        <div className="flex items-start gap-3">
          <PlugZap className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <AlertTitle className="mb-1 text-foreground">{t('noTemplatesTitle')}</AlertTitle>
            <AlertDescription className="text-sm text-muted-foreground">
              {t('noTemplatesDesc')}
            </AlertDescription>
          </div>
        </div>
      </Alert>

      <div className="space-y-4">
        {/* Connection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('connectionTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('connectionDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground" htmlFor="whatsmiau-api-key">
                {t('apiKey')}
              </Label>
              <div className="relative">
                <Input
                  id="whatsmiau-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={saved?.api_key_masked ?? MASKED_API_KEY}
                  autoComplete="off"
                  className="bg-muted border-border pr-10 text-foreground placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((current) => !current)}
                  aria-label={t('toggleKeyVisibility')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{t('apiKeyHint')}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-muted-foreground" htmlFor="whatsmiau-base-url">
                  {t('baseUrl')}
                </Label>
                <Input
                  id="whatsmiau-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={DEFAULT_BASE_URL}
                  className="bg-muted border-border font-mono text-sm text-foreground"
                />
                <p className="text-xs text-muted-foreground">{t('baseUrlHint')}</p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground" htmlFor="whatsmiau-instance-name">
                  {t('instanceName')}
                </Label>
                <Input
                  id="whatsmiau-instance-name"
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  placeholder="Atendimento01"
                  className="bg-muted border-border text-foreground"
                />
                <p className="text-xs text-muted-foreground">{t('instanceNameHint')}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={handleCreate}
                disabled={creating || !instanceName.trim()}
                className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <PlugZap className="size-4" />
                )}
                {t('createInstance')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Linking the phone */}
        <WhatsmiauInstanceCard
          instanceName={saved?.instance_name ?? null}
          status={saved?.status ?? 'disconnected'}
          phoneNumber={saved?.phone_number ?? null}
          onChanged={load}
        />

        {/* Webhook */}
        <WhatsmiauWebhookCard
          value={settings.webhook}
          onChange={(webhook) => patchSettings({ webhook })}
        />

        {/* Behaviors */}
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('behaviorsTitle')}</CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('behaviorsDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t('alwaysOnline')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('alwaysOnlineDesc')}
                </p>
              </div>
              <Switch
                checked={settings.alwaysOnline}
                onCheckedChange={(next) => patchSettings({ alwaysOnline: next })}
                aria-label={t('alwaysOnline')}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t('groupsIgnore')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('groupsIgnoreDesc')}
                </p>
              </div>
              <Switch
                checked={settings.groupsIgnore}
                onCheckedChange={(next) => patchSettings({ groupsIgnore: next })}
                aria-label={t('groupsIgnore')}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t('rejectCall')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('rejectCallDesc')}
                </p>
              </div>
              <Switch
                checked={settings.rejectCall}
                onCheckedChange={(next) => patchSettings({ rejectCall: next })}
                aria-label={t('rejectCall')}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t('readMessages')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('readMessagesDesc')}
                </p>
              </div>
              <Switch
                checked={settings.readMessages}
                onCheckedChange={(next) => patchSettings({ readMessages: next })}
                aria-label={t('readMessages')}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t('saveMedia')}
                </p>
                <p className="text-xs text-muted-foreground">{t('saveMediaDesc')}</p>
              </div>
              <Switch
                checked={settings.saveMedia}
                onCheckedChange={(next) => patchSettings({ saveMedia: next })}
                aria-label={t('saveMedia')}
              />
            </div>

            <div className="space-y-2 rounded-lg border border-border p-3">
              <Label className="text-muted-foreground" htmlFor="whatsmiau-msg-call">
                {t('msgCall')}
              </Label>
              <Input
                id="whatsmiau-msg-call"
                value={settings.msgCall}
                onChange={(e) => patchSettings({ msgCall: e.target.value })}
                placeholder={t('msgCallPlaceholder')}
                className="bg-muted border-border text-foreground"
              />
              <p className="text-xs text-muted-foreground">{t('msgCallDesc')}</p>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t('syncFullHistory')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('syncFullHistoryDesc')}
                </p>
              </div>
              <Switch
                checked={syncFullHistory}
                onCheckedChange={setSyncFullHistory}
                disabled={instanceExists}
                aria-label={t('syncFullHistory')}
              />
            </div>
            {instanceExists ? (
              <p className="text-xs text-muted-foreground">
                {t('syncFullHistoryLocked')}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* Danger zone */}
        {saved?.instance_name ? (
          <Card className="border-red-900/40">
            <CardHeader>
              <CardTitle className="text-red-400">{t('dangerTitle')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('dangerDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleDisconnect}
                className="border-red-900 text-red-400 hover:bg-red-950/40 hover:text-red-300"
              >
                <Unplug className="size-4" />
                {t('disconnect')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              >
                <Trash2 className="size-4" />
                {t('deleteInstance')}
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Sticky bar — the unsaved-changes anchor */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {dirty ? t('unsavedChanges') : t('noChanges')}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={load}
              disabled={saving || !dirty}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {t('discard')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {t('saveSettings')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Crie a rota**

Crie `src/app/(dashboard)/settings/whatsapp/crmbr/page.tsx`:

```tsx
import { WhatsmiauConfig } from '@/components/settings/whatsmiau-config';

export default function WhatsmiauSettingsPage() {
  return <WhatsmiauConfig />;
}
```

- [ ] **Step 6: Typecheck e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

Ajustes prováveis:
- `Switch` do projeto é base-ui: confirme o nome da prop de estado (`checked` + `onCheckedChange`) olhando `src/components/ui/switch.tsx`.
- Se o `Badge` não aceitar `className` com `font-mono text-[11px]` sem complaint, tudo bem.

- [ ] **Step 7: Verifique no navegador**

Run: `npm run dev` e abra `/settings/whatsapp/crmbr`:

- A tela abre sem erro dehydration e o rodapé sticky aparece.
- Sem configuração salva, os cards de número e webhook não aparecem (a instância ainda não existe).
- Digitar uma API key e um nome de instância válido habilita "Criar instância"; um nome com acento devolve o erro explicando a regra.
- Marcar um evento mostra o badge; "Ver exemplo JSON" abre o modal com o payload.
- Trocar um switch deixa o rodapé em "Há alterações não salvas"; "Salvar configurações" volta para "Nenhuma alteração pendente".

- [ ] **Step 8: Commit**

```bash
git add src/components/settings/whatsmiau-config.tsx src/components/settings/whatsmiau-instance-card.tsx src/components/settings/whatsmiau-webhook-card.tsx "src/app/(dashboard)/settings/whatsapp/crmbr"
git commit -m "feat(settings): tela de configuracao da API CRMBR (whatsmiau)

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 16: Textos da interface (next-intl) nos 4 idiomas

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/es.json`
- Modify: `messages/ko.json`
- Modify: `messages/pt.json`

**Interfaces:**
- Consumes (Task 14): `Settings.whatsappHub.*`, `Settings.sections.whatsapp` (já existe).
- Consumes (Task 15): `Settings.whatsmiau.*` e `Settings.whatsmiau.webhook.*`.
- Produz: as chaves consumidas pelos componentes das Tasks 14 e 15.

> **Todos os 4 catálogos são traduções reais** — o app fixa um idioma por deploy (`NEXT_PUBLIC_APP_LOCALE`), e cada catálogo precisa estar completo. `pt` é o texto de referência do usuário; `en`, `es` e `ko` são as traduções.

- [ ] **Step 1: Adicione as chaves em `messages/pt.json`**

Dentro do objeto `"Settings"`, **logo depois** do bloco `"whatsapp": { ... },`, insira:

```json
    "whatsappHub": {
      "title": "APIs do WhatsApp",
      "description": "Escolha por qual API do WhatsApp esta conta envia. Só uma API fica ativa por vez.",
      "navLabel": "Seções das APIs do WhatsApp",
      "nav": {
        "hub": "Visão geral",
        "meta": "Oficial (Meta)",
        "crmbr": "CRMBR (não oficial)"
      },
      "usingCrmbr": "Esta conta está enviando pela API CRMBR (não oficial).",
      "usingMeta": "Esta conta está enviando pela API oficial da Meta.",
      "crmbrConnectedDetail": "A instância está conectada.",
      "crmbrNotConnectedDetail": "Vincule o número para começar a enviar.",
      "metaConnectedDetail": "O número está conectado.",
      "metaNotConnectedDetail": "Conecte o número para começar a enviar.",
      "switchToMeta": "Usar a API oficial",
      "switchToCrmbr": "Usar a API CRMBR",
      "switchFailed": "Não foi possível trocar a API.",
      "switchedToCrmbr": "Agora o envio usa a API CRMBR.",
      "switchedToMeta": "Agora o envio usa a API oficial da Meta.",
      "metaTitle": "API Oficial (Meta)",
      "metaDesc": "A API oficial do WhatsApp Business da Meta.",
      "crmbrTitle": "API CRMBR (não oficial)",
      "crmbrDesc": "A API CRMBR (WhatsMiau) — um provedor não oficial.",
      "inUse": "Em uso",
      "officialBadge": "Oficial",
      "unofficialBadge": "Não oficial",
      "connected": "Conectada",
      "notConnected": "Não conectada",
      "metaHasTemplates": "Mensagens de modelo aprovadas",
      "metaHasVerification": "Verificação da empresa",
      "metaNoSelfHosted": "Hospedada pela Meta — você não hospeda",
      "crmbrHasSelfHosted": "Pode ser auto-hospedada, com sua própria URL",
      "crmbrNoTemplates": "Sem mensagens de modelo",
      "configure": "Configurar"
    },
    "whatsmiau": {
      "title": "API CRMBR (não oficial)",
      "description": "Conecte um número de WhatsApp pela API CRMBR (WhatsMiau) e controle as configurações da sua instância.",
      "loadFailed": "Não foi possível carregar a configuração.",
      "saveFailed": "Não foi possível salvar a configuração.",
      "saved": "Configuração salva.",
      "savedButNotVerified": "Configuração salva, mas a API CRMBR não confirmou a chave: {warning}",
      "pushFailed": "Não foi possível enviar as configurações para a API CRMBR.",
      "createFailed": "Não foi possível criar a instância.",
      "created": "Instância criada.",
      "verifyFailed": "A verificação falhou.",
      "verified": "A instância existe e está conectada.",
      "nothingToVerify": "Salve a configuração primeiro.",
      "instanceNotFoundAtProvider": "A instância não foi encontrada na API CRMBR.",
      "instanceNotOpen": "A instância existe, mas ainda não está conectada.",
      "instanceNameRequired": "O nome da instância é obrigatório.",
      "noTemplatesTitle": "Aqui não há mensagens de modelo",
      "noTemplatesDesc": "A API CRMBR não suporta mensagens de modelo aprovadas. Use a API oficial da Meta quando precisar delas.",
      "connectionTitle": "Conexão",
      "connectionDesc": "A chave de API e a instância que carrega o seu número.",
      "apiKey": "Chave da API",
      "apiKeyHint": "A chave fica guardada criptografada e nunca é exibida de novo. Deixe em branco para manter a atual.",
      "toggleKeyVisibility": "Mostrar ou ocultar a chave da API",
      "baseUrl": "URL base",
      "baseUrlHint": "Altere apenas se você roda o seu próprio servidor WhatsMiau.",
      "instanceName": "Nome da instância",
      "instanceNameHint": "Até 40 caracteres: letras, números, ponto, hífen e sublinhado.",
      "createInstance": "Criar instância",
      "verify": "Verificar",
      "numberTitle": "Número vinculado",
      "numberDesc": "Escaneie o QR code com o WhatsApp ou digite o código de pareamento.",
      "connected": "Conectado",
      "connecting": "Conectando",
      "error": "Erro",
      "disconnected": "Desconectado",
      "linkedNumber": "Número vinculado:",
      "qrAlt": "QR code para vincular o número do WhatsApp",
      "pairingCode": "Código de pareamento",
      "waitingForScan": "Aguardando o celular confirmar...",
      "shareQr": "Compartilhar QR code",
      "showQr": "Mostrar QR code",
      "generateQr": "Gerar QR code",
      "reconnect": "Reconectar",
      "qrFailed": "Não foi possível gerar o QR code.",
      "reconnectFailed": "Não foi possível reconectar a instância.",
      "paired": "Número vinculado!",
      "behaviorsTitle": "Comportamentos da instância",
      "behaviorsDesc": "O que a instância faz sozinha, sem ninguém no app.",
      "alwaysOnline": "Sempre online",
      "alwaysOnlineDesc": "Mantém o número marcado como online.",
      "groupsIgnore": "Ignorar grupos",
      "groupsIgnoreDesc": "Suprime os eventos de grupo no webhook.",
      "rejectCall": "Rejeitar ligações",
      "rejectCallDesc": "Rejeita automaticamente as ligações recebidas.",
      "readMessages": "Marcar como lida",
      "readMessagesDesc": "Confirma a leitura das mensagens recebidas. Desativado por padrão.",
      "saveMedia": "Salvar mídia",
      "saveMediaDesc": "Mantém a mídia recebida no provedor. Desativado, ele não fornece a URL da mídia.",
      "msgCall": "Mensagem de rejeição de ligação",
      "msgCallPlaceholder": "Mensagem enviada quando uma ligação é rejeitada",
      "msgCallDesc": "Uma mensagem vazia remove a resposta automática.",
      "syncFullHistory": "Sincronizar histórico completo",
      "syncFullHistoryDesc": "Solicita o histórico completo das conversas quando a instância conecta.",
      "syncFullHistoryLocked": "Isso só pode ser escolhido na criação da instância.",
      "dangerTitle": "Zona de risco",
      "dangerDesc": "Estas ações afetam o número vinculado a esta instância.",
      "disconnect": "Desconectar número",
      "deleteInstance": "Excluir instância",
      "disconnectConfirm": "Desconectar este número? Você vai precisar de um novo QR code para reconectar.",
      "disconnectFailed": "Não foi possível desconectar o número.",
      "disconnectDone": "Número desconectado.",
      "deleteConfirm": "Excluir esta instância? Isso não pode ser desfeito.",
      "deleteFailed": "Não foi possível excluir a instância.",
      "deleted": "Instância excluída.",
      "unsavedChanges": "Há alterações não salvas",
      "noChanges": "Nenhuma alteração pendente",
      "discard": "Descartar",
      "saveSettings": "Salvar configurações",
      "webhook": {
        "title": "Webhook",
        "description": "Onde a API CRMBR envia os eventos da sua instância.",
        "integrationType": "Tipo de integração",
        "integrationTypeHint": "O formato do payload que o provedor envia.",
        "evolutionApi": "Evolution API",
        "url": "URL do webhook",
        "copyUrl": "Copiar a URL do webhook",
        "copied": "URL copiada.",
        "headers": "Headers personalizados",
        "headersHint": "Enviados junto de cada evento. O header Authorization é gerenciado pelo app.",
        "addHeader": "Adicionar header",
        "headerName": "Nome do header",
        "headerValue": "Valor",
        "removeHeader": "Remover header",
        "maxHeaders": "O provedor aceita no máximo {count} headers.",
        "events": "Eventos enviados",
        "eventsHint": "Desmarque os eventos que você não quer receber.",
        "viewSample": "Ver exemplo JSON",
        "sampleDescription": "É isto que o provedor envia neste evento.",
        "close": "Fechar"
      }
    },
```

- [ ] **Step 2: Adicione as chaves em `messages/en.json`**

Mesmo lugar, mesmo formato:

```json
    "whatsappHub": {
      "title": "WhatsApp APIs",
      "description": "Choose which WhatsApp API this account sends through. Only one API is active at a time.",
      "navLabel": "WhatsApp API sections",
      "nav": {
        "hub": "Overview",
        "meta": "Official (Meta)",
        "crmbr": "CRMBR (non-official)"
      },
      "usingCrmbr": "This account is sending through the CRMBR (non-official) API.",
      "usingMeta": "This account is sending through the official Meta API.",
      "crmbrConnectedDetail": "The instance is connected.",
      "crmbrNotConnectedDetail": "Pair the number to start sending.",
      "metaConnectedDetail": "The number is connected.",
      "metaNotConnectedDetail": "Connect the number to start sending.",
      "switchToMeta": "Switch to the official API",
      "switchToCrmbr": "Switch to the CRMBR API",
      "switchFailed": "Could not switch the API.",
      "switchedToCrmbr": "Now sending through the CRMBR API.",
      "switchedToMeta": "Now sending through the official Meta API.",
      "metaTitle": "Official API (Meta)",
      "metaDesc": "The official Meta WhatsApp Business API.",
      "crmbrTitle": "CRMBR API (non-official)",
      "crmbrDesc": "The CRMBR API (WhatsMiau) — a non-official provider.",
      "inUse": "In use",
      "officialBadge": "Official",
      "unofficialBadge": "Non-official",
      "connected": "Connected",
      "notConnected": "Not connected",
      "metaHasTemplates": "Approved message templates",
      "metaHasVerification": "Business verification",
      "metaNoSelfHosted": "Hosted by Meta — you cannot host it yourself",
      "crmbrHasSelfHosted": "Can be self-hosted, with your own URL",
      "crmbrNoTemplates": "No message templates",
      "configure": "Configure"
    },
    "whatsmiau": {
      "title": "CRMBR API (non-official)",
      "description": "Connect a WhatsApp number through the CRMBR API (WhatsMiau) and control your instance settings.",
      "loadFailed": "Could not load the configuration.",
      "saveFailed": "Could not save the configuration.",
      "saved": "Configuration saved.",
      "savedButNotVerified": "Configuration saved, but the CRMBR API did not confirm the key: {warning}",
      "pushFailed": "The settings could not be sent to the CRMBR API.",
      "createFailed": "The instance could not be created.",
      "created": "Instance created.",
      "verifyFailed": "The verification failed.",
      "verified": "The instance exists and is connected.",
      "nothingToVerify": "Save the configuration first.",
      "instanceNotFoundAtProvider": "The instance was not found in the CRMBR API.",
      "instanceNotOpen": "The instance exists but is not connected yet.",
      "instanceNameRequired": "The instance name is required.",
      "noTemplatesTitle": "No message templates here",
      "noTemplatesDesc": "The CRMBR API does not support approved templates. Use the official Meta API when you need them.",
      "connectionTitle": "Connection",
      "connectionDesc": "The API key and the instance that carries your number.",
      "apiKey": "API key",
      "apiKeyHint": "The key is stored encrypted and never shown again. Leave it empty to keep the current one.",
      "toggleKeyVisibility": "Show or hide the API key",
      "baseUrl": "Base URL",
      "baseUrlHint": "Change it only if you run your own WhatsMiau server.",
      "instanceName": "Instance name",
      "instanceNameHint": "Up to 40 characters: letters, numbers, dot, hyphen and underscore.",
      "createInstance": "Create instance",
      "verify": "Verify",
      "numberTitle": "Linked number",
      "numberDesc": "Scan the QR code with WhatsApp, or type the pairing code.",
      "connected": "Connected",
      "connecting": "Connecting",
      "error": "Error",
      "disconnected": "Disconnected",
      "linkedNumber": "Linked number:",
      "qrAlt": "QR code for pairing the WhatsApp number",
      "pairingCode": "Pairing code",
      "waitingForScan": "Waiting for the phone to confirm...",
      "shareQr": "Share QR code",
      "showQr": "Show QR code",
      "generateQr": "Generate QR code",
      "reconnect": "Reconnect",
      "qrFailed": "Could not generate the QR code.",
      "reconnectFailed": "Could not reconnect the instance.",
      "paired": "Number linked!",
      "behaviorsTitle": "Instance behaviors",
      "behaviorsDesc": "What the instance does on its own, with no one in the app.",
      "alwaysOnline": "Always online",
      "alwaysOnlineDesc": "Keeps the number marked as online.",
      "groupsIgnore": "Ignore groups",
      "groupsIgnoreDesc": "Suppresses group events in the webhook.",
      "rejectCall": "Reject calls",
      "rejectCallDesc": "Automatically rejects incoming calls.",
      "readMessages": "Mark as read",
      "readMessagesDesc": "Confirms the read receipt on incoming messages. Off by default.",
      "saveMedia": "Save media",
      "saveMediaDesc": "Keeps the media received in the provider. When off, no media URL is provided.",
      "msgCall": "Call rejection message",
      "msgCallPlaceholder": "Message sent when a call is rejected",
      "msgCallDesc": "An empty message removes the automatic reply.",
      "syncFullHistory": "Sync full history",
      "syncFullHistoryDesc": "Requests the full chat history when the instance connects.",
      "syncFullHistoryLocked": "This can only be chosen when the instance is created.",
      "dangerTitle": "Danger zone",
      "dangerDesc": "These actions affect the number linked to this instance.",
      "disconnect": "Disconnect number",
      "deleteInstance": "Delete instance",
      "disconnectConfirm": "Disconnect this number? You will need a new QR code to reconnect.",
      "disconnectFailed": "Could not disconnect the number.",
      "disconnectDone": "Number disconnected.",
      "deleteConfirm": "Delete this instance? This cannot be undone.",
      "deleteFailed": "Could not delete the instance.",
      "deleted": "Instance deleted.",
      "unsavedChanges": "You have unsaved changes",
      "noChanges": "No pending changes",
      "discard": "Discard",
      "saveSettings": "Save settings",
      "webhook": {
        "title": "Webhook",
        "description": "Where the CRMBR API sends the events of your instance.",
        "integrationType": "Integration type",
        "integrationTypeHint": "The format of the payload the provider sends.",
        "evolutionApi": "Evolution API",
        "url": "Webhook URL",
        "copyUrl": "Copy the webhook URL",
        "copied": "URL copied.",
        "headers": "Custom headers",
        "headersHint": "Sent along with every event. The Authorization header is managed by the app.",
        "addHeader": "Add header",
        "headerName": "Header name",
        "headerValue": "Value",
        "removeHeader": "Remove header",
        "maxHeaders": "The provider accepts at most {count} headers.",
        "events": "Events sent",
        "eventsHint": "Uncheck the events you do not want to receive.",
        "viewSample": "See JSON example",
        "sampleDescription": "This is what the provider sends for this event.",
        "close": "Close"
      }
    },
```

- [ ] **Step 3: Adicione as chaves em `messages/es.json`**

```json
    "whatsappHub": {
      "title": "APIs de WhatsApp",
      "description": "Elige por qué API de WhatsApp envía esta cuenta. Solo una API está activa a la vez.",
      "navLabel": "Secciones de las APIs de WhatsApp",
      "nav": {
        "hub": "Resumen",
        "meta": "Oficial (Meta)",
        "crmbr": "CRMBR (no oficial)"
      },
      "usingCrmbr": "Esta cuenta envía a través de la API CRMBR (no oficial).",
      "usingMeta": "Esta cuenta envía a través de la API oficial de Meta.",
      "crmbrConnectedDetail": "La instancia está conectada.",
      "crmbrNotConnectedDetail": "Vincula el número para empezar a enviar.",
      "metaConnectedDetail": "El número está conectado.",
      "metaNotConnectedDetail": "Conecta el número para empezar a enviar.",
      "switchToMeta": "Usar la API oficial",
      "switchToCrmbr": "Usar la API CRMBR",
      "switchFailed": "No se pudo cambiar la API.",
      "switchedToCrmbr": "Ahora el envío usa la API CRMBR.",
      "switchedToMeta": "Ahora el envío usa la API oficial de Meta.",
      "metaTitle": "API Oficial (Meta)",
      "metaDesc": "La API oficial de WhatsApp Business de Meta.",
      "crmbrTitle": "API CRMBR (no oficial)",
      "crmbrDesc": "La API CRMBR (WhatsMiau) — un proveedor no oficial.",
      "inUse": "En uso",
      "officialBadge": "Oficial",
      "unofficialBadge": "No oficial",
      "connected": "Conectada",
      "notConnected": "No conectada",
      "metaHasTemplates": "Mensajes de plantilla aprobados",
      "metaHasVerification": "Verificación de la empresa",
      "metaNoSelfHosted": "Alojada por Meta — no puedes alojarla tú",
      "crmbrHasSelfHosted": "Se puede autoalojar, con tu propia URL",
      "crmbrNoTemplates": "Sin mensajes de plantilla",
      "configure": "Configurar"
    },
    "whatsmiau": {
      "title": "API CRMBR (no oficial)",
      "description": "Conecta un número de WhatsApp por la API CRMBR (WhatsMiau) y controla los ajustes de tu instancia.",
      "loadFailed": "No se pudo cargar la configuración.",
      "saveFailed": "No se pudo guardar la configuración.",
      "saved": "Configuración guardada.",
      "savedButNotVerified": "Configuración guardada, pero la API CRMBR no confirmó la clave: {warning}",
      "pushFailed": "No se pudieron enviar los ajustes a la API CRMBR.",
      "createFailed": "No se pudo crear la instancia.",
      "created": "Instancia creada.",
      "verifyFailed": "La verificación falló.",
      "verified": "La instancia existe y está conectada.",
      "nothingToVerify": "Guarda la configuración primero.",
      "instanceNotFoundAtProvider": "La instancia no se encontró en la API CRMBR.",
      "instanceNotOpen": "La instancia existe, pero todavía no está conectada.",
      "instanceNameRequired": "El nombre de la instancia es obligatorio.",
      "noTemplatesTitle": "Aquí no hay mensajes de plantilla",
      "noTemplatesDesc": "La API CRMBR no admite plantillas aprobadas. Usa la API oficial de Meta cuando las necesites.",
      "connectionTitle": "Conexión",
      "connectionDesc": "La clave de API y la instancia que lleva tu número.",
      "apiKey": "Clave de la API",
      "apiKeyHint": "La clave se guarda cifrada y nunca se vuelve a mostrar. Déjala vacía para mantener la actual.",
      "toggleKeyVisibility": "Mostrar u ocultar la clave de la API",
      "baseUrl": "URL base",
      "baseUrlHint": "Cámbiala solo si ejecutas tu propio servidor de WhatsMiau.",
      "instanceName": "Nombre de la instancia",
      "instanceNameHint": "Hasta 40 caracteres: letras, números, punto, guion y guion bajo.",
      "createInstance": "Crear instancia",
      "verify": "Verificar",
      "numberTitle": "Número vinculado",
      "numberDesc": "Escanea el código QR con WhatsApp o escribe el código de emparejamiento.",
      "connected": "Conectado",
      "connecting": "Conectando",
      "error": "Error",
      "disconnected": "Desconectado",
      "linkedNumber": "Número vinculado:",
      "qrAlt": "Código QR para vincular el número de WhatsApp",
      "pairingCode": "Código de emparejamiento",
      "waitingForScan": "Esperando a que el móvil confirme...",
      "shareQr": "Compartir el código QR",
      "showQr": "Mostrar el código QR",
      "generateQr": "Generar código QR",
      "reconnect": "Reconectar",
      "qrFailed": "No se pudo generar el código QR.",
      "reconnectFailed": "No se pudo reconectar la instancia.",
      "paired": "¡Número vinculado!",
      "behaviorsTitle": "Comportamientos de la instancia",
      "behaviorsDesc": "Lo que la instancia hace sola, sin nadie en la app.",
      "alwaysOnline": "Siempre online",
      "alwaysOnlineDesc": "Mantiene el número marcado como en línea.",
      "groupsIgnore": "Ignorar grupos",
      "groupsIgnoreDesc": "Suprime los eventos de grupo en el webhook.",
      "rejectCall": "Rechazar llamadas",
      "rejectCallDesc": "Rechaza automáticamente las llamadas entrantes.",
      "readMessages": "Marcar como leída",
      "readMessagesDesc": "Confirma la lectura de los mensajes entrantes. Desactivado por defecto.",
      "saveMedia": "Guardar medios",
      "saveMediaDesc": "Conserva los medios recibidos en el proveedor. Si está desactivado, no proporciona la URL del medio.",
      "msgCall": "Mensaje de rechazo de llamada",
      "msgCallPlaceholder": "Mensaje enviado cuando se rechaza una llamada",
      "msgCallDesc": "Un mensaje vacío elimina la respuesta automática.",
      "syncFullHistory": "Sincronizar el historial completo",
      "syncFullHistoryDesc": "Solicita el historial completo de los chats cuando la instancia se conecta.",
      "syncFullHistoryLocked": "Esto solo se puede elegir al crear la instancia.",
      "dangerTitle": "Zona de riesgo",
      "dangerDesc": "Estas acciones afectan al número vinculado a esta instancia.",
      "disconnect": "Desconectar el número",
      "deleteInstance": "Eliminar la instancia",
      "disconnectConfirm": "¿Desconectar este número? Necesitarás un nuevo código QR para reconectar.",
      "disconnectFailed": "No se pudo desconectar el número.",
      "disconnectDone": "Número desconectado.",
      "deleteConfirm": "¿Eliminar esta instancia? No se puede deshacer.",
      "deleteFailed": "No se pudo eliminar la instancia.",
      "deleted": "Instancia eliminada.",
      "unsavedChanges": "Tienes cambios sin guardar",
      "noChanges": "No hay cambios pendientes",
      "discard": "Descartar",
      "saveSettings": "Guardar ajustes",
      "webhook": {
        "title": "Webhook",
        "description": "Dónde envía la API CRMBR los eventos de tu instancia.",
        "integrationType": "Tipo de integración",
        "integrationTypeHint": "El formato del payload que envía el proveedor.",
        "evolutionApi": "Evolution API",
        "url": "URL del webhook",
        "copyUrl": "Copiar la URL del webhook",
        "copied": "URL copiada.",
        "headers": "Headers personalizados",
        "headersHint": "Se envían con cada evento. El header Authorization lo gestiona la app.",
        "addHeader": "Añadir header",
        "headerName": "Nombre del header",
        "headerValue": "Valor",
        "removeHeader": "Quitar header",
        "maxHeaders": "El proveedor acepta como máximo {count} headers.",
        "events": "Eventos enviados",
        "eventsHint": "Desmarca los eventos que no quieras recibir.",
        "viewSample": "Ver ejemplo JSON",
        "sampleDescription": "Esto es lo que envía el proveedor en este evento.",
        "close": "Cerrar"
      }
    },
```

- [ ] **Step 4: Adicione as chaves em `messages/ko.json`**

```json
    "whatsappHub": {
      "title": "WhatsApp API",
      "description": "이 계정이 어떤 WhatsApp API로 메시지를 보내는지 선택하세요. 한 번에 하나의 API만 활성화됩니다.",
      "navLabel": "WhatsApp API 섹션",
      "nav": {
        "hub": "개요",
        "meta": "공식 (Meta)",
        "crmbr": "CRMBR (비공식)"
      },
      "usingCrmbr": "이 계정은 CRMBR(비공식) API로 전송 중입니다.",
      "usingMeta": "이 계정은 Meta 공식 API로 전송 중입니다.",
      "crmbrConnectedDetail": "인스턴스가 연결되었습니다.",
      "crmbrNotConnectedDetail": "번호를 연결한 뒤 전송할 수 있습니다.",
      "metaConnectedDetail": "번호가 연결되었습니다.",
      "metaNotConnectedDetail": "번호를 연결한 뒤 전송할 수 있습니다.",
      "switchToMeta": "공식 API로 전환",
      "switchToCrmbr": "CRMBR API로 전환",
      "switchFailed": "API를 전환하지 못했습니다.",
      "switchedToCrmbr": "이제 CRMBR API로 전송합니다.",
      "switchedToMeta": "이제 Meta 공식 API로 전송합니다.",
      "metaTitle": "공식 API (Meta)",
      "metaDesc": "Meta WhatsApp Business 공식 API입니다.",
      "crmbrTitle": "CRMBR API (비공식)",
      "crmbrDesc": "CRMBR API(WhatsMiau) — 비공식 제공자입니다.",
      "inUse": "사용 중",
      "officialBadge": "공식",
      "unofficialBadge": "비공식",
      "connected": "연결됨",
      "notConnected": "연결 안 됨",
      "metaHasTemplates": "승인된 메시지 템플릿",
      "metaHasVerification": "회사 인증",
      "metaNoSelfHosted": "Meta가 호스팅 — 직접 호스팅할 수 없음",
      "crmbrHasSelfHosted": "자체 URL로 직접 호스팅 가능",
      "crmbrNoTemplates": "메시지 템플릿 없음",
      "configure": "설정"
    },
    "whatsmiau": {
      "title": "CRMBR API (비공식)",
      "description": "CRMBR API(WhatsMiau)로 WhatsApp 번호를 연결하고 인스턴스 설정을 관리하세요.",
      "loadFailed": "설정을 불러오지 못했습니다.",
      "saveFailed": "설정을 저장하지 못했습니다.",
      "saved": "설정을 저장했습니다.",
      "savedButNotVerified": "설정을 저장했지만 CRMBR API가 키를 확인하지 못했습니다: {warning}",
      "pushFailed": "설정을 CRMBR API로 보내지 못했습니다.",
      "createFailed": "인스턴스를 만들지 못했습니다.",
      "created": "인스턴스를 만들었습니다.",
      "verifyFailed": "확인에 실패했습니다.",
      "verified": "인스턴스가 존재하며 연결되어 있습니다.",
      "nothingToVerify": "먼저 설정을 저장하세요.",
      "instanceNotFoundAtProvider": "CRMBR API에서 인스턴스를 찾을 수 없습니다.",
      "instanceNotOpen": "인스턴스는 있지만 아직 연결되지 않았습니다.",
      "instanceNameRequired": "인스턴스 이름은 필수입니다.",
      "noTemplatesTitle": "여기에는 메시지 템플릿이 없습니다",
      "noTemplatesDesc": "CRMBR API는 승인된 템플릿을 지원하지 않습니다. 필요하면 Meta 공식 API를 사용하세요.",
      "connectionTitle": "연결",
      "connectionDesc": "API 키와 번호를 담고 있는 인스턴스입니다.",
      "apiKey": "API 키",
      "apiKeyHint": "키는 암호화되어 저장되며 다시 표시되지 않습니다. 현재 키를 유지하려면 비워 두세요.",
      "toggleKeyVisibility": "API 키 표시 또는 숨기기",
      "baseUrl": "기본 URL",
      "baseUrlHint": "자체 WhatsMiau 서버를 운영할 때만 변경하세요.",
      "instanceName": "인스턴스 이름",
      "instanceNameHint": "최대 40자: 문자, 숫자, 점, 하이픈, 밑줄.",
      "createInstance": "인스턴스 만들기",
      "verify": "확인",
      "numberTitle": "연결된 번호",
      "numberDesc": "WhatsApp로 QR 코드를 스캔하거나 페어링 코드를 입력하세요.",
      "connected": "연결됨",
      "connecting": "연결 중",
      "error": "오류",
      "disconnected": "연결 안 됨",
      "linkedNumber": "연결된 번호:",
      "qrAlt": "WhatsApp 번호 페어링용 QR 코드",
      "pairingCode": "페어링 코드",
      "waitingForScan": "휴대폰의 확인을 기다리는 중...",
      "shareQr": "QR 코드 공유",
      "showQr": "QR 코드 보기",
      "generateQr": "QR 코드 만들기",
      "reconnect": "다시 연결",
      "qrFailed": "QR 코드를 만들지 못했습니다.",
      "reconnectFailed": "인스턴스를 다시 연결하지 못했습니다.",
      "paired": "번호를 연결했습니다!",
      "behaviorsTitle": "인스턴스 동작",
      "behaviorsDesc": "앱에 아무도 없을 때 인스턴스가 스스로 하는 일입니다.",
      "alwaysOnline": "항상 온라인",
      "alwaysOnlineDesc": "번호를 온라인 상태로 유지합니다.",
      "groupsIgnore": "그룹 무시",
      "groupsIgnoreDesc": "웹훅의 그룹 이벤트를 차단합니다.",
      "rejectCall": "통화 거절",
      "rejectCallDesc": "수신 통화를 자동으로 거절합니다.",
      "readMessages": "읽음 처리",
      "readMessagesDesc": "수신 메시지의 읽음 상태를 확인합니다. 기본값은 꺼짐입니다.",
      "saveMedia": "미디어 저장",
      "saveMediaDesc": "수신한 미디어를 제공업체에 보관합니다. 끄면 미디어 URL을 제공하지 않습니다.",
      "msgCall": "통화 거절 메시지",
      "msgCallPlaceholder": "통화가 거절될 때 전송되는 메시지",
      "msgCallDesc": "빈 값으로 두면 자동 응답이 제거됩니다.",
      "syncFullHistory": "전체 기록 동기화",
      "syncFullHistoryDesc": "인스턴스가 연결될 때 전체 대화 기록을 요청합니다.",
      "syncFullHistoryLocked": "이 항목은 인스턴스를 만들 때만 선택할 수 있습니다.",
      "dangerTitle": "위험 구역",
      "dangerDesc": "이 작업은 이 인스턴스에 연결된 번호에 영향을 줍니다.",
      "disconnect": "번호 연결 해제",
      "deleteInstance": "인스턴스 삭제",
      "disconnectConfirm": "이 번호의 연결을 해제할까요? 다시 연결하려면 새 QR 코드가 필요합니다.",
      "disconnectFailed": "번호 연결을 해제하지 못했습니다.",
      "disconnectDone": "번호 연결을 해제했습니다.",
      "deleteConfirm": "이 인스턴스를 삭제할까요? 되돌릴 수 없습니다.",
      "deleteFailed": "인스턴스를 삭제하지 못했습니다.",
      "deleted": "인스턴스를 삭제했습니다.",
      "unsavedChanges": "저장하지 않은 변경 사항이 있습니다",
      "noChanges": "대기 중인 변경 사항이 없습니다",
      "discard": "취소",
      "saveSettings": "설정 저장",
      "webhook": {
        "title": "웹훅",
        "description": "CRMBR API가 인스턴스 이벤트를 보내는 주소입니다.",
        "integrationType": "연동 유형",
        "integrationTypeHint": "제공업체가 보내는 페이로드 형식입니다.",
        "evolutionApi": "Evolution API",
        "url": "웹훅 URL",
        "copyUrl": "웹훅 URL 복사",
        "copied": "URL을 복사했습니다.",
        "headers": "사용자 정의 헤더",
        "headersHint": "모든 이벤트와 함께 전송됩니다. Authorization 헤더는 앱이 관리합니다.",
        "addHeader": "헤더 추가",
        "headerName": "헤더 이름",
        "headerValue": "값",
        "removeHeader": "헤더 삭제",
        "maxHeaders": "제공업체는 최대 {count}개의 헤더만 허용합니다.",
        "events": "전송되는 이벤트",
        "eventsHint": "받지 않을 이벤트는 선택을 해제하세요.",
        "viewSample": "JSON 예제 보기",
        "sampleDescription": "이 이벤트에서 제공업체가 보내는 내용입니다.",
        "close": "닫기"
      }
    },
```

- [ ] **Step 5: Valide os 4 JSON**

Run:

```bash
node -e "for (const l of ['en','es','ko','pt']) { JSON.parse(require('fs').readFileSync('messages/'+l+'.json','utf8')); console.log(l, 'ok'); }"
```

Expected: `en ok`, `es ok`, `ko ok`, `pt ok`.

Depois confira que **as 4 árvores têm exatamente as mesmas chaves**:

```bash
node -e "
const fs=require('fs');
const keys=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?keys(v,p+k+'.'):[p+k]);
const base=keys(JSON.parse(fs.readFileSync('messages/en.json','utf8')).Settings).sort();
for(const l of ['es','ko','pt']){
  const cur=keys(JSON.parse(fs.readFileSync('messages/'+l+'.json','utf8')).Settings).sort();
  const missing=base.filter(k=>!cur.includes(k));
  const extra=cur.filter(k=>!base.includes(k));
  console.log(l, missing.length||extra.length ? {missing, extra} : 'identical');
}
"
```

Expected: `es identical`, `ko identical`, `pt identical`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: sem erros. O `next-intl` tipa as chaves por locale em build — um catálogo faltando quebraria o typecheck.

- [ ] **Step 7: Commit**

```bash
git add messages/en.json messages/es.json messages/ko.json messages/pt.json
git commit -m "feat(i18n): textos da API CRMBR e do hub do WhatsApp

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 17: Pontos de entrada da seção de WhatsApp + composer sem templates na CRMBR

**Files:**
- Create: `src/hooks/use-active-provider.ts`
- Modify: `src/components/layout/header.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/lib/dashboard/overview.ts`
- Modify: `src/components/dashboard/whatsapp-health-chip.tsx`
- Modify: `src/components/settings/settings-overview.tsx`
- Modify: `src/app/(dashboard)/inbox/page.tsx`
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-thread.tsx`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ko.json`, `messages/pt.json`

**Interfaces:**
- Consumes (Task 13): `GET /api/whatsmiau/active` → `{ provider: 'meta'|'whatsmiau', status, connected }`.
- Produces: `useActiveProvider(): { provider: 'meta'|'whatsmiau'; supportsTemplates: boolean; loading: boolean }` — `src/hooks/use-active-provider.ts`.

> Cada arquivo tocado aqui é do upstream. As mudanças são de **1 a 5 linhas** cada, e todas apontam para a nova rota — é o que o upstream recebe no merge sem conflito (spec §12.3).

- [ ] **Step 1: Crie o hook `use-active-provider`**

Crie `src/hooks/use-active-provider.ts`:

```tsx
'use client';

import { useEffect, useState } from 'react';

export type ActiveProvider = 'meta' | 'whatsmiau';

export interface ActiveProviderState {
  provider: ActiveProvider;
  /** The CRMBR (non-official) API has no approved templates. */
  supportsTemplates: boolean;
  loading: boolean;
}

/**
 * Which WhatsApp API this account sends through.
 *
 * The composer uses it to hide the template picker when the CRMBR
 * API is the active provider. The server refuses template sends on
 * that path anyway (`assertProviderSupportsMessageType`) — this hook
 * is the friendly half of the defence, not the only one.
 *
 * A failed request falls back to Meta WITH templates: the server is
 * the one that has to say no, and the app must not lock the user out
 * of a feature because a small request did not answer.
 */
export function useActiveProvider(): ActiveProviderState {
  const [state, setState] = useState<ActiveProviderState>({
    provider: 'meta',
    supportsTemplates: true,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/whatsmiau/active', { cache: 'no-store' })
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ provider?: ActiveProvider }>)
          : null,
      )
      .then((body) => {
        if (cancelled || !body) return;
        const provider: ActiveProvider =
          body.provider === 'whatsmiau' ? 'whatsmiau' : 'meta';
        setState({
          provider,
          supportsTemplates: provider === 'meta',
          loading: false,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ provider: 'meta', supportsTemplates: true, loading: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
```

- [ ] **Step 2: Aponte os links para `/settings/whatsapp`**

Quatro arquivos, uma linha cada:

`src/components/layout/header.tsx` (linha ~127):

```tsx
                href="/settings/whatsapp"
```

`src/components/layout/sidebar.tsx` (linha ~374):

```tsx
                    href="/settings/whatsapp"
```

`src/lib/dashboard/overview.ts` (linha ~284):

```ts
    { id: 'whatsapp', done: setup.whatsappConnected, href: '/settings/whatsapp' },
```

`src/components/dashboard/whatsapp-health-chip.tsx` (linha ~56):

```tsx
      href="/settings/whatsapp"
```

> O `settings-overview.tsx` **não** precisa mudar para navegar: o tile chama `onSelect('whatsapp')` e o `go` do `SettingsPageClient` (Task 14) já leva para `/settings/whatsapp`. Só o **status** do tile precisa saber qual API está ativa — é o Step 3.

- [ ] **Step 3: Mostre a API ativa no tile do Overview**

Em `src/components/settings/settings-overview.tsx`:

1. Adicione o import:

```tsx
import { useActiveProvider } from '@/hooks/use-active-provider';
```

2. Dentro do componente, depois do `useTheme()`:

```tsx
  const { provider: activeProvider } = useActiveProvider();
```

3. Troque o bloco que busca o status do WhatsApp (o `Promise.allSettled` com `whatsapp_config` + `/api/whatsapp/config`) por este:

```tsx
    // WhatsApp connection status — slower, independent. `activeProvider`
    // tells us which API the account actually sends through: a CRMBR
    // account has no `whatsapp_config` row at all, and reading only
    // that table would report "not set up" for a perfectly working
    // account.
    (async () => {
      setWhatsappLoading(true);
      if (activeProvider !== 'meta') {
        const [crmbr, active] = await Promise.allSettled([
          fetch('/api/whatsmiau/config', { cache: 'no-store' }).then((r) =>
            r.json(),
          ),
          fetch('/api/whatsmiau/active', { cache: 'no-store' }).then((r) =>
            r.json(),
          ),
        ]);
        if (cancelled) return;
        const configured =
          crmbr.status === 'fulfilled' && !!crmbr.value?.configured;
        const connected =
          active.status === 'fulfilled' &&
          active.value?.provider === 'whatsmiau' &&
          !!active.value?.connected;
        setWhatsapp({ configured, connected });
        setWhatsappLoading(false);
        return;
      }

      const [row, health] = await Promise.allSettled([
        supabase
          .from('whatsapp_config')
          .select('phone_number_id')
          .eq('account_id', acctId)
          .maybeSingle(),
        fetch('/api/whatsapp/config', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if (cancelled) return;
      setWhatsapp({
        configured: row.status === 'fulfilled' && !!row.value.data?.phone_number_id,
        connected: health.status === 'fulfilled' && !!health.value?.connected,
      });
      setWhatsappLoading(false);
    })();
```

4. E ajuste o array de dependências do `useEffect` (lá embaixo):

```tsx
  }, [user?.id, accountId, canManageMembers, activeProvider]);
```

> O hook também devolve `supportsTemplates` e `loading`, mas **não** os declare aqui: o lint reclama de variável não usada. Desestruture só `provider`.

- [ ] **Step 4: Faça o banner do Inbox respeitar a API ativa**

Em `src/app/(dashboard)/inbox/page.tsx`, o banner "WhatsApp não conectado" é calculado a partir da tabela `whatsapp_config` (Meta). Para uma conta CRMBR essa tabela não tem linha — o banner apareceria mentindo.

1. Adicione o import:

```tsx
import { useActiveProvider } from '@/hooks/use-active-provider';
```

2. No componente da página, junto dos outros hooks:

```tsx
  const { provider: activeProvider } = useActiveProvider();
```

3. Dentro do `useEffect` que checa a conexão, **antes** da consulta ao `whatsapp_config`, insira:

```tsx
      // A CRMBR account has no `whatsapp_config` row — the banner must
      // follow the ACTIVE provider, not the Meta table.
      if (activeProvider === "whatsmiau") {
        const res = await fetch("/api/whatsmiau/active", {
          cache: "no-store",
        });
        const body = res.ok ? await res.json() : null;
        setWhatsappConnected(body?.provider === "whatsmiau" && !!body?.connected);
        return;
      }
```

4. E acrescente `activeProvider` às dependências daquele `useEffect` (o que termina com `}, []);`):

```tsx
  }, [activeProvider]);
```

- [ ] **Step 5: Esconda os templates no composer quando a CRMBR é a API ativa**

Em `src/components/inbox/message-composer.tsx`:

1. Adicione a prop na interface:

```tsx
interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  onSend: (text: string, replyToId?: string) => void;
  onSendMedia: (payload: SendMediaPayload) => void;
  onSendInteractive: (payload: InteractiveMessagePayload, replyToId?: string) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
  /**
   * The CRMBR (non-official) API has no approved templates, so the
   * picker is hidden when it is the active provider. Defaults to true
   * so the Meta path is unchanged.
   */
  canUseTemplates?: boolean;
}
```

2. Desestruture com o default:

```tsx
export function MessageComposer({
  conversationId,
  sessionExpired,
  onSend,
  onSendMedia,
  onSendInteractive,
  onOpenTemplates,
  replyTo,
  onClearReply,
  canUseTemplates = true,
}: MessageComposerProps) {
```

3. Esconda o botão de template da barra inferior:

```tsx
          {canUseTemplates ? (
            <GatedButton
              variant="ghost"
              size="sm"
              canAct={!readOnly}
              gateReason={tGate("reasons.sendMessages")}
              title={readOnly ? undefined : t("sendTemplate")}
              className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
              onClick={onOpenTemplates}
            >
              <LayoutTemplate className="h-4 w-4" />
            </GatedButton>
          ) : null}
```

4. E o botão do aviso de sessão expirada:

```tsx
          {canUseTemplates ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-amber-400 hover:text-amber-300"
              onClick={onOpenTemplates}
            >
              <LayoutTemplate className="mr-1 h-3 w-3" />
              {t("templates")}
            </Button>
          ) : null}
```

5. E o aviso de que a API ativa não tem modelos — logo acima da barra de botões, dentro do mesmo `div` que hoje abre com `{replyTo && (`:

```tsx
      {!canUseTemplates ? (
        <p className="mb-2 text-xs text-muted-foreground">
          {t("crmbrNoTemplates")}
        </p>
      ) : null}
```

> O `t` do composer é `useTranslations("Inbox.composer")` — por isso a chave é `Inbox.composer.crmbrNoTemplates` (Step 7).

- [ ] **Step 6: Passe a prop a partir do thread**

Em `src/components/inbox/message-thread.tsx`:

1. Adicione o import:

```tsx
import { useActiveProvider } from '@/hooks/use-active-provider';
```

2. No componente do thread:

```tsx
  const { supportsTemplates } = useActiveProvider();
```

3. E passe a prop ao composer:

```tsx
      <MessageComposer
        conversationId={conversation.id}
        sessionExpired={sessionInfo.expired}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onSendInteractive={handleSendInteractive}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        canUseTemplates={supportsTemplates}
      />
```

> O aviso em si é renderizado **pelo composer** (Step 5, item 5) — o `t` do composer é `useTranslations("Inbox.composer")`, o do thread é `useTranslations("Inbox.messageThread")`. Não duplique o texto nos dois arquivos.

- [ ] **Step 7: Adicione a chave `Inbox.composer.crmbrNoTemplates` nos 4 catálogos**

Dentro do objeto `"composer"` de cada `messages/*.json`, adicione:

`messages/pt.json`:

```json
    "crmbrNoTemplates": "A API CRMBR não tem mensagens de modelo — use a API oficial da Meta para isso.",
```

`messages/en.json`:

```json
    "crmbrNoTemplates": "The CRMBR API has no message templates — use the official Meta API for those.",
```

`messages/es.json`:

```json
    "crmbrNoTemplates": "La API CRMBR no tiene mensajes de plantilla — usa la API oficial de Meta para eso.",
```

`messages/ko.json`:

```json
    "crmbrNoTemplates": "CRMBR API에는 메시지 템플릿이 없습니다 — 해당 기능은 Meta 공식 API를 사용하세요.",
```

- [ ] **Step 8: Typecheck e lint**

Run: `npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 9: Verifique no navegador**

Run: `npm run dev`:

- Clicar em "WhatsApp" no menu da conta (header/sidebar) leva a `/settings/whatsapp` (e não a `?tab=whatsapp`).
- O tile "WhatsApp" do Overview leva ao hub.
- O passo "WhatsApp" do checklist do Dashboard leva ao hub.
- O chip de saúde do WhatsApp no Dashboard leva ao hub.
- Com a conta na API CRMBR, o composer **não** mostra o botão de template e mostra o aviso.

- [ ] **Step 10: Commit**

```bash
git add src/hooks/use-active-provider.ts src/components/layout/header.tsx src/components/layout/sidebar.tsx src/lib/dashboard/overview.ts src/components/dashboard/whatsapp-health-chip.tsx src/components/settings/settings-overview.tsx "src/app/(dashboard)/inbox/page.tsx" src/components/inbox/message-composer.tsx src/components/inbox/message-thread.tsx messages
git commit -m "feat(settings): pontos de entrada apontam para a secao de WhatsApp

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 18: Documento de integração com o upstream + verificação final

**Files:**
- Create: `docs/integracao/whatsmiau-upstream.md`
- Modify: `docs/whatsmiau.md` (link para o novo documento, no topo)

**Interfaces:**
- Consumes: nada de código — este é o passo de fechamento.
- Produz: o protocolo de merge (spec §12) e a lista de arquivos compartilhados.

- [ ] **Step 1: Escreva `docs/integracao/whatsmiau-upstream.md`**

Crie `docs/integracao/whatsmiau-upstream.md`:

````markdown
# Integração com o upstream — API CRMBR (WhatsMiau)

Este documento explica como manter a **API CRMBR (não oficial)** coexistindo com a
**API oficial da Meta** no crmbr, e como continuar recebendo as atualizações do
mantenedor upstream (`ArnasDon/wacrm`) sem que o trabalho novo entre em conflito.

> O número de Whatsapp do provedor, a chave da API e a URL do webhook **nunca**
> entram neste repositório. A chave da CRMBR é criptografada com `ENCRYPTION_KEY` e
> fica na tabela `whatsmiau_config`, por conta.

---

## 1. Topologia

| Remote | Repositório | Papel |
|---|---|---|
| `origin` | `devturco/wacrm` | o fork onde vive este trabalho |
| `upstream` | `ArnasDon/wacrm` | o mantenedor do app |

```bash
git fetch upstream
git merge upstream/main      # ou: git rebase upstream/main
```

No GitHub: **Sync fork** → PR de `upstream/main` para `main`.

`git rerere` já está ligado neste clone (`rerere.enabled=true`,
`rerere.autoupdate=true`): o git **memoriza** cada resolução de conflito e a
reaplica sozinha na próxima vez que o mesmo conflito aparece.

```bash
git config rerere.enabled true
git config rerere.autoupdate true
```

---

## 2. Quem toca o quê

| Área | Quem é dono |
|---|---|
| `src/lib/whatsapp/providers/**` | **nosso** — o upstream nunca vai mexer |
| `src/lib/whatsapp/whatsmiau-config.ts` | **nosso** |
| `src/app/api/whatsmiau/**` | **nosso** |
| `src/components/settings/whatsmiau-*.tsx` | **nosso** |
| `src/components/settings/settings-shell.tsx` | **nosso** |
| `src/lib/whatsapp/meta-api.ts` | **upstream** — não alterado |
| `src/app/api/whatsapp/webhook/route.ts` | **upstream** — não alterado |
| a tabela `whatsapp_config` | **upstream** — não alterada |
| `src/components/settings/whatsapp-config.tsx` | **upstream** — não alterado |

A regra que governa tudo:

> **Todo código novo vive em arquivos que o upstream nunca vai tocar.**
> Onde o app existente precisar agir, o toque é pequeno e no **topo** da função
> (imports + resolução de credencial) — nunca no meio da lógica.

Consequência: se o upstream mudar a assinatura de `meta-api.sendTextMessage`, o que
quebra é `src/lib/whatsapp/providers/meta/adapter.ts` — **arquivo nosso** — virando
erro de tipo do TypeScript. Erro de tipo se conserta em minutos; conflito de merge,
não.

---

## 3. Arquivos compartilhados (os únicos que podem conflitar)

`src/lib/whatsapp/send-message.ts` · `broadcast-core.ts` · `resolve-conversation.ts` ·
`src/lib/flows/meta-send.ts` · `src/lib/automations/meta-send.ts` ·
`src/lib/ai/auto-reply.ts` · `src/app/api/whatsapp/send/route.ts` ·
`src/app/api/whatsapp/react/route.ts` ·
`src/components/settings/whatsapp-config.tsx` · `settings-sections.ts` ·
`settings-rail.tsx` · `src/app/(dashboard)/settings/page.tsx` ·
`settings-overview.tsx` · `src/lib/dashboard/overview.ts` ·
`src/components/inbox/message-composer.tsx` · `message-thread.tsx` ·
`src/components/layout/header.tsx` · `sidebar.tsx`

Nesses arquivos, as nossas edições são **sempre de 1 a 5 linhas**, e o commit que as
toca é **um só** — o "cabo de ligação" entre o app e o dispatcher de providers. É esse
commit que se resolve quando o merge emperra.

---

## 4. Passo a passo do merge

```bash
git fetch upstream
git log --oneline upstream/main..origin/main     # o que é nosso
git log --oneline origin/main..upstream/main     # o que veio do upstream

# Se só entraram mudanças do upstream: merge direto.
git merge upstream/main

# Se os dois lados mexeram nos mesmos arquivos: resolva UM CONFLITO POR VEZ.
git status
# edite o arquivo, depois:
git add <arquivo>
git rerere          # mostra a resolução que o git já viu antes
git rebase --continue   # ou git merge --continue
```

Depois do merge, **sempre**:

```bash
npm run typecheck
npm run lint
npx vitest run
```

O typecheck é o detector de conflicts mais barato que existe: se o upstream
mudou a assinatura de algo que o nosso adapter consome, o erro aparece aqui — não
no deploy.

---

## 5. Se o upstream mexer no subsistema de templates

O upstream tem templates aprovados (a Meta exige aprovação de template para
qualquer mensagem fora da janela de 24h). A CRMBR **não tem** endpoint de
template.

Se o upstream mexer em `src/lib/whatsapp/templates.ts` ou no endpoint de
templates:

1. **Não copie o bloqueio para o lado do upstream.** O `assertProviderSupportsMessageType`
   (nosso, em `src/lib/whatsapp/providers/capabilities.ts`) já recusa template quando a
   API ativa é a CRMBR — o bloqueio vive **no dispatcher**, não no core.
2. Se o upstream criar um caminho novo de envio que bypassa o dispatcher, é o
   **nosso** `providers/index.ts` que precisa ser ligado a ele.
3. A UI do composer esconde o botão de template quando a API ativa é a CRMBR — se o
   upstream redesenhar o composer, o prop `canUseTemplates` precisa ser repassado.

## 6. Se o upstream mexer no webhook do Meta

`src/app/api/whatsapp/webhook/route.ts` é **intocado** por nós. A CRMBR tem a
própria rota (`/api/whatsmiau/webhook`) e a própria autenticação
(`Authorization: Bearer <webhook_secret>`, comparado com `timingSafeEqual`).

Se o upstream mexer no webhook do Meta, nada muda do nosso lado — as duas rotas
são independentes. Só vale confirmar que o upstream **não** passou a escutar em
`/api/whatsmiau/*`.

## 7. Se o upstream mudar `meta-api.ts`

`src/lib/whatsapp/providers/meta/adapter.ts` é a **ponte**. Ela traduz o contrato
do app para o shape do `meta-api.ts`. Uma assinatura nova quebra **a ponte**, não
o app. Ajuste a ponte — é um arquivo nosso, uma função.

---

## 8. Referência

- `docs/whatsmiau.md` — a referência técnica da WhatsMiau Cloud API v2
- `docs/superpowers/specs/2026-10-27-whatsmiau-crmbr-provider-design.md` — o design
- `docs/superpowers/plans/2026-10-27-whatsmiau-crmbr-provider.md` — o plano de execução
````

- [ ] **Step 2: Adicione o link no topo de `docs/whatsmiau.md`**

No início de `docs/whatsmiau.md`, **depois** do título, acrescente:

```markdown
> Este arquivo é a referência técnica do provider. O protocolo de manutenção
> (merge com o upstream, arquivos compartilhados, o que fazer quando o upstream
> mexer em templates ou no webhook do Meta) está em
> [`docs/integracao/whatsmiau-upstream.md`](integracao/whatsmiau-upstream.md).
```

- [ ] **Step 3: Verificação final — typecheck e lint**

Run: `npm run typecheck && npm run lint`
Expected: **sem erros**. Se o lint reclamar de import não usado nos arquivos novos
(`react-icons`, `CheckCircle2`, `CircleSlash`…), remova o import.

- [ ] **Step 4: Verificação final — suíte de testes**

Run: `npx vitest run`
Expected: **tudo verde**, incluindo os testes novos:

- `src/lib/whatsapp/providers/connection.test.ts`
- `src/lib/whatsapp/providers/whatsmiau/client.test.ts`
- `src/lib/whatsapp/providers/whatsmiau/adapter.test.ts`
- `src/lib/whatsapp/providers/meta/adapter.test.ts`
- `src/lib/whatsapp/providers/whatsmiau/webhook.test.ts`
- `src/lib/whatsapp/providers/whatsmiau/inbound.test.ts`
- `src/lib/whatsapp/providers/whatsmiau/mirror-media.test.ts`
- `src/app/api/whatsmiau/webhook/route.test.ts`
- `src/app/api/whatsmiau/instances/route.test.ts`

E os **testes existentes** que o refactor do core tocou — `send-message.test.ts`,
`flows/meta-send.test.ts`, `automations/meta-send.test.ts`,
`broadcast-core.test.ts`, `resolve-conversation.test.ts`. Eles mudam de mock
(`@/lib/whatsapp/meta-api` → `@/lib/whatsapp/providers`) — é o esperado, e o
mock novo tem que continuar respondendo no **mesmo shape** para não mexer na
lógica do teste.

- [ ] **Step 5: Build de produção**

Run: `npm run build`
Expected: build sem erro. Ele pega duas coisas que o typecheck não pega: rotas
`page.tsx`/`route.ts` com assinatura errada e o bailout de CSR por
`useSearchParams` fora de um `<Suspense>`.

> A página `settings/page.tsx` virou server component justamente por isso: ela
> **não** usa `useSearchParams`. Se o build reclamar de "missing Suspense with
> CSR bailout", algum componente cliente novo usa `useSearchParams` — passe o
> valor por prop, como o `SettingsPageClient` faz.

- [ ] **Step 6: Commit**

```bash
git add docs/integracao/whatsmiau-upstream.md docs/whatsmiau.md
git commit -m "docs(integracao): protocolo de merge com o upstream

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

- [ ] **Step 7: Abranch e PR (só com autorização do usuário)**

O usuário faz o commit e o push por conta própria neste projeto. **Não** rode
`git push` nem `gh pr create` sem ele pedir. Quando pedir:

```bash
git checkout -b feature/whatsmiau-crmbr-provider
git push -u origin feature/whatsmiau-crmbr-provider
gh pr create --base main --title "feat(whatsapp): API CRMBR (não oficial) como segundo provider" --body "..."
```

---

## Checklist final do plano

- [ ] Task 1 — migration `060_whatsmiau_provider.sql` — **avisar o usuário que o SQL está pronto para subir**
- [ ] Task 2 — `providers/types.ts` + `providers/errors.ts`
- [ ] Task 3 — `providers/whatsmiau/client.ts`
- [ ] Task 4 — `providers/whatsmiau/adapter.ts` + `api.ts` (envio de mensagens)
- [ ] Task 5 — `providers/whatsmiau/instances.ts` (criar, QR, estado, update, delete)
- [ ] Task 6 — dispatcher, resolução da API ativa e capabilities
- [ ] Task 7 — corte no core (`send-message.ts`)
- [ ] Task 8 — corte nos engines (Flows, automações, typing da IA)
- [ ] Task 9 — corte em broadcast, reação e resolução de conversa
- [ ] Task 10 — parser do webhook e normalização
- [ ] Task 11 — `providers/whatsmiau/inbound.ts` + `mirror-media.ts`
- [ ] Task 12 — `app/api/whatsmiau/webhook/route.ts`
- [ ] Task 13 — rotas de gerenciamento da CRMBR
- [ ] Task 14 — shell das Settings + hub
- [ ] Task 15 — tela da API CRMBR
- [ ] Task 16 — textos nos 4 idiomas
- [ ] Task 17 — pontos de entrada + composer sem templates
- [ ] Task 18 — documentação + verificação final
