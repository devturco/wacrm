# Origem do Lead — Implementation Plan

> **Status (2026-10-29): as 7 tasks estão implementadas e commitadas.** A
> migration `supabase/migrations/067_lead_origin.sql` ainda precisa ser
> rodada no Supabase — sem ela, `lead_settings` e `lead_origins` não
> existem e o módulo inteiro falha em runtime (a suíte passa, porque os
> testes rodam contra o SQL em disco).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Capturar de onde veio cada lead (anúncio, post, DM, site) e mostrar essa origem no card do contato, no painel do inbox e em Configurações.

**Architecture:** Duas tabelas novas (`lead_settings` — configuração por conta; `lead_origins` — um toque por linha). Três entradas de captura: o script `track.js` colado no site do cliente (POST público `/api/leads/capture`), o link de campanha `/r/<code>` (redirect público), e o inbound do WhatsApp (Meta e whatsmiau), que amarra o toque pendente ao contato. Um módulo único `src/lib/leads/origin.ts` resolve a amarração nos dois provedores, na ordem token > telefone > referral do provider > `direct`.

**Tech Stack:** Next.js 16 (App Router), TypeScript 6, React 19, Tailwind v4, Supabase (Postgres + RLS), vitest 5, next-intl (en/pt/es/ko).

**Spec:** `docs/superpowers/specs/2026-10-29-lead-origin-design.md` — o plano argumenta a partir do spec; quem executa lê os dois. Em caso de conflito, **o spec vence**.

## Global Constraints

1. **Nenhuma migration altera schema existente.** A migration 067 cria `lead_settings` e `lead_origins` e nada mais. Nenhuma coluna nova em `contacts` (decisão D1 do spec).
2. **Toda rota nova é account-scoped.** Instância de outra conta → **404**, nunca revela existência (spec §8).
3. **A capture key é identificador público, não credencial.** Ela identifica a conta, não concede privilégio. Ela não volta ao navegador em texto puro para *ninguém além dos membros da conta* — e mesmo assim não abre nada.
4. **Credenciais nunca em código frontend nem em repositório público.** A capture key vai para o `<script data-key="...">` do site do cliente — é pública por desenho (spec §4.1).
5. **Mensagens de erro para o cliente final nunca nomeiam WhatsMiau nem CRMBR.** Vale para o WhatsApp; o `track.js` é do site do cliente, mas o mesmo princípio vale: nada de erro cru com nome de provider.
6. **Toda string nova vai em `messages/en.json`, `pt.json`, `es.json` e `ko.json`.** Componente usa `useTranslations`; route handler usa `getT("Api")`.
7. **Sem dependência nova.** `zod` NÃO está no `package.json` — a validação do payload público é feita à mão, em `src/lib/leads/`.
8. **RLS:** leitura por `is_account_member(account_id)`; escrita de `lead_origins` **só pelo service role** (sem policy de escrita). `lead_settings` ganha policy de escrita para admin, espelhando `media_settings` (migration 066).
9. **O gancho de origem fica DEPOIS da fronteira de idempotência** do inbound (o `upsert` de `messages` com `ignoreDuplicates`): uma reentrega do Meta não pode duplicar a origem.
10. **O texto que o agente vê é o texto limpo** (sem `ref XXXXXXXX`); o texto cru fica em `lead_origins.meta.raw_text`.
11. **Build sempre com `CIRCLE_NODE_TOTAL=4 npx next build`** — a máquina tem 23 workers e 23 CPUs, e o build padrão estoura a memória (EXIT=139).
12. **Um commit por tarefa.** Nada de subagentes: a implementação é inline, nesta sessão.
13. **Nada de migration "depois"** — quando a 067 for escrita, avisar o usuário que o SQL precisa ser rodado no Supabase.

---

## Mapa de arquivos

```
supabase/migrations/067_lead_origin.sql              NOVA  — 2 tabelas + índices + RLS + guard do redeem_invitation
src/lib/leads/types.ts                               NOVA  — LeadChannel, LeadProvider, LeadOriginRow, NewLeadOrigin, CampaignLink
src/lib/leads/token.ts                               NOVA  — gerar/validar/extrair o código de 8 chars
src/lib/leads/utm.ts                                 NOVA  — parse de UTM/click-id, payload do primeiro toque, cookie
src/lib/leads/origin.ts                              NOVA  — resolveOrigin() + a regra de quantidade de linhas
src/lib/leads/store.ts                               NOVA  — LeadOriginStore (Supabase) + LeadSettingsStore
src/lib/leads/admin-client.ts                        NOVA  — cliente service-role compartilhado
src/lib/leads/track-script.ts                        NOVA  — o JS do /api/leads/track.js (string)
src/lib/leads/*.test.ts                              NOVA  — token, utm, origin
src/app/api/leads/capture/route.ts                   NOVA  — POST público
src/app/api/leads/capture/route.test.ts              NOVA
src/app/api/leads/track.js/route.ts                  NOVA  — serve o script
src/app/api/leads/settings/route.ts                  NOVA  — GET/PUT da config da conta
src/app/api/leads/settings/route.test.ts             NOVA
src/app/api/leads/origins/route.ts                   NOVA  — a jornada de um contato
src/app/r/[code]/route.ts                            NOVA  — link de campanha
src/app/r/[code]/route.test.ts                       NOVA
src/components/leads/lead-origin-badge.tsx           NOVA  — badge + sheet da jornada
src/components/settings/lead-origin-settings.tsx     NOVA  — painel de Configurações
src/components/settings/settings-sections.ts         MOD   — nova seção 'leads'
src/components/settings/settings-page-client.tsx     MOD   — registra o painel
src/components/contacts/contact-detail-view.tsx      MOD   — badge no card do contato
src/components/inbox/contact-sidebar.tsx             MOD   — badge no painel do inbox
src/app/api/whatsapp/webhook/route.ts                MOD   — referral do Meta + gancho de origem
src/lib/whatsapp/providers/whatsmiau/inbound.ts      MOD   — gancho de origem
src/lib/rate-limit.ts                                MOD   — bucket leadCapture
messages/{en,pt,es,ko}.json                          MOD   — Strings
docs/lead-origin.md                                   NOVA  — documentação
```

---

### Task 1: Migration 067 — `lead_settings` + `lead_origins`

**Files:**
- Create: `supabase/migrations/067_lead_origin.sql`
- Test: `src/lib/leads/migration.test.ts`

**Interfaces:**
- Produces: tabela `lead_settings(account_id PK, capture_key TEXT UNIQUE, enabled BOOL, allowed_hosts TEXT[], links JSONB, created_at, updated_at)` e tabela `lead_origins(id UUID PK, account_id, contact_id, channel, provider, utm_*, landing_path, referrer, click_ids, ad_id, adset_id, campaign_id, creative_id, post_id, external_id, lead_token, link_code, phone, is_primary, touched_at, meta, created_at, updated_at)`.
- Produces: 8 índices, incluindo o **único parcial** `UNIQUE (contact_id) WHERE is_primary AND contact_id IS NOT NULL`.
- Produces: `redeem_invitation` recriada com `lead_settings` e `lead_origins` no `v_has_data`.
- Consumes: nada (primeira tarefa).

- [x] **Step 1: Escreva o teste que falha**

Crie `src/lib/leads/migration.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));

const leadMigration = migrations.find((m) => m.name.startsWith("067_"));
if (!leadMigration) throw new Error("Migration 067_lead_origin.sql not found");
const sql = leadMigration.sql;

describe("lead_settings", () => {
  it("is a new table keyed by the account", () => {
    expect(sql).toMatch(
      /create\s+table\s+if\s+not\s+exists\s+lead_settings/i,
    );
    expect(sql).toMatch(
      /lead_settings[\s\S]*?account_id\s+uuid\s+primary\s+key\s+references\s+accounts\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i,
    );
  });

  it("has a unique capture key, the enable flag, the host allowlist and the links", () => {
    expect(sql).toMatch(/capture_key\s+text\s+not\s+null\s+unique/i);
    expect(sql).toMatch(/enabled\s+boolean\s+not\s+null\s+default\s+true/i);
    expect(sql).toMatch(/allowed_hosts\s+text\[\]\s+not\s+null\s+default\s+'\{\}'/i);
    expect(sql).toMatch(/links\s+jsonb\s+not\s+null\s+default\s+'\[\]'/i);
  });

  it("is readable by the account members", () => {
    expect(sql).toMatch(
      /create\s+policy\s+"Members can read lead settings"[\s\S]*?using\s*\(\s*is_account_member\s*\(\s*account_id\s*\)/i,
    );
  });
});

describe("lead_origins", () => {
  it("is a new table with a nullable contact (pending) and a primary flag", () => {
    expect(sql).toMatch(/create\s+table\s+if\s+not\s+exists\s+lead_origins/i);
    expect(sql).toMatch(
      /contact_id\s+uuid\s+references\s+contacts\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i,
    );
    expect(sql).toMatch(/is_primary\s+boolean\s+not\s+null\s+default\s+false/i);
  });

  it("allows only the seven known channels", () => {
    expect(sql).toMatch(
      /channel\s+text\s+not\s+null\s+check\s*\(\s*channel\s+in\s*\(\s*'whatsapp'\s*,\s*'instagram_dm'\s*,\s*'instagram_comment'\s*,\s*'tiktok_dm'\s*,\s*'tiktok_lead'\s*,\s*'web'\s*,\s*'direct'\s*\)\s*\)/i,
    );
  });

  it("allows only the four known providers", () => {
    expect(sql).toMatch(
      /provider\s+text\s+check\s*\(\s*provider\s+in\s*\(\s*'meta'\s*,\s*'whatsmiau'\s*,\s*'tiktok'\s*,\s*'web'\s*\)\s*\)/i,
    );
  });

  it("keeps the utm, click-id and social axes in their own columns", () => {
    for (const column of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "landing_path",
      "referrer",
      "click_ids",
      "ad_id",
      "adset_id",
      "campaign_id",
      "creative_id",
      "post_id",
      "external_id",
      "lead_token",
      "link_code",
      "phone",
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`, "i"));
    }
    expect(sql).toMatch(/click_ids\s+jsonb\s+not\s+null\s+default\s+'\{\}'/i);
    expect(sql).toMatch(/meta\s+jsonb\s+not\s+null\s+default\s+'\{\}'/i);
  });

  it("creates every index the spec lists", () => {
    expect(sql).toMatch(/create\s+index[\s\S]*?on\s+lead_origins\s*\(\s*account_id\s*,\s*contact_id\s*\)/i);
    expect(sql).toMatch(/create\s+index[\s\S]*?on\s+lead_origins\s*\(\s*account_id\s*,\s*phone\s*\)/i);
    expect(sql).toMatch(/create\s+index[\s\S]*?on\s+lead_origins\s*\(\s*account_id\s*,\s*lead_token\s*\)/i);
    expect(sql).toMatch(
      /create\s+unique\s+index[\s\S]*?on\s+lead_origins\s*\(\s*account_id\s*,\s*lead_token\s*\)\s+where\s+lead_token\s+is\s+not\s+null/i,
    );
    expect(sql).toMatch(
      /create\s+unique\s+index[\s\S]*?on\s+lead_origins\s*\(\s*contact_id\s*\)\s+where\s+is_primary\s+and\s+contact_id\s+is\s+not\s+null/i,
    );
    expect(sql).toMatch(/create\s+index[\s\S]*?on\s+lead_origins\s*\(\s*account_id\s*,\s*campaign_id\s*\)/i);
    expect(sql).toMatch(/create\s+index[\s\S]*?on\s+lead_origins\s*\(\s*account_id\s*,\s*post_id\s*\)/i);
    expect(sql).toMatch(
      /create\s+index[\s\S]*?on\s+lead_origins\s*\(\s*account_id\s*,\s*touched_at\s*\)\s+where\s+contact_id\s+is\s+null/i,
    );
    expect(sql).toMatch(/create\s+index[\s\S]*?using\s+gin\s*\(\s*meta\s*\)/i);
  });

  it("is readable by the account members and writable by nobody else", () => {
    expect(sql).toMatch(
      /create\s+policy\s+"Members can read lead origins"[\s\S]*?using\s*\(\s*is_account_member\s*\(\s*account_id\s*\)/i,
    );
    expect(sql).not.toMatch(
      /create\s+policy[^;]*on\s+lead_origins[^;]*for\s+(insert|update|delete)/i,
    );
  });
});

describe("a migration that only creates tables", () => {
  it("never alters an existing table", () => {
    // `lead_settings` and `lead_origins` are the tables THIS migration
    // creates, so the ALTER that enables RLS on them is expected.
    const altered = [...sql.matchAll(/alter\s+table\s+(?!lead_)([a-z_]+)/gi)]
      .map((m) => m[1].toLowerCase());
    expect(altered).toEqual([]);
  });

  it("never adds a column to an existing table", () => {
    expect(sql).not.toMatch(/add\s+column/i);
  });
});

describe("redeem_invitation", () => {
  it("refuses to move an account that already has lead data", () => {
    const fn = sql.slice(sql.lastIndexOf("CREATE OR REPLACE FUNCTION public.redeem_invitation"));
    expect(fn).toMatch(/union\s+all\s+select\s+1\s+from\s+lead_settings/i);
    expect(fn).toMatch(/union\s+all\s+select\s+1\s+from\s+lead_origins/i);
  });
});
```

- [x] **Step 2: Rode o teste e veja falhar**

Run: `npx vitest run src/lib/leads/migration.test.ts`

Expected: FAIL com `"Migration 067_lead_origin.sql not found"`.

- [x] **Step 3: Escreva a migration**

Crie `supabase/migrations/067_lead_origin.sql`:

```sql
-- ============================================================
-- 067_lead_origin.sql
--
-- "Origem do lead": onde cada lead veio (anuncio, post, DM, site).
--
-- Duas tabelas novas:
--
--   lead_settings  -- 1 linha por conta: a capture key, o interruptor,
--                     a allowlist de hosts e os links de campanha.
--                     E CONFIGURACAO da conta, nao dado de negocio.
--
--   lead_origins   -- um TOQUE por linha: o que o lead viu no primeiro
--                     clique (utm_*, click ids, ad/campaign/post).
--                     `contact_id` NULL = origem PENDENTE (o lead ainda
--                     nao falou com a gente). O contato nasce no
--                     inbound, nunca pelo endpoint publico.
--
-- Por que `links` e JSONB e nao uma terceira tabela: um link de
-- campanha e configuracao da conta (poucos, mudam pouco, ninguem
-- consulta "links de outra conta"). O que E dado de negocio -- os
-- toques -- fica em `lead_origins`, com `link_code` em coluna propria
-- para a contagem por link.
--
-- O indice UNICO PARCIAL em `contact_id` garante UMA origem principal
-- por contato no proprio banco, nao por convencao de codigo.
--
-- TABELA NOVA -- nenhuma tabela existente muda de schema.
-- Idempotente -- pode ser reaplicada com seguranca.
-- ============================================================

-- ============================================================
-- 1. lead_settings
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_settings (
  account_id     UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- Identificador PUBLICO (como um measurement id do GA): vai
  -- embutido no <script data-key="..."> do site do cliente. NAO e
  -- credencial -- ele so diz a qual conta a origem pertence.
  capture_key    TEXT NOT NULL UNIQUE,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  -- Allowlist de host do endpoint publico. Vazio = aceita qualquer
  -- origem.
  allowed_hosts  TEXT[] NOT NULL DEFAULT '{}',
  -- Links de campanha (JSONB). Ver o comentario do topo.
  links          JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lead_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read lead settings" ON lead_settings;
CREATE POLICY "Members can read lead settings"
  ON lead_settings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Admins can manage lead settings" ON lead_settings;
CREATE POLICY "Admins can manage lead settings"
  ON lead_settings FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ============================================================
-- 2. lead_origins
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_origins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- NULL = PENDENTE: a origem foi capturada mas o contato ainda nao
  -- nasceu. O primeiro inbound do lead a amarra.
  contact_id    UUID REFERENCES contacts(id) ON DELETE CASCADE,

  -- canal pelo qual o toque aconteceu
  channel       TEXT NOT NULL CHECK (channel IN (
                  'whatsapp','instagram_dm','instagram_comment',
                  'tiktok_dm','tiktok_lead','web','direct')),
  provider      TEXT CHECK (provider IN ('meta','whatsmiau','tiktok','web')),

  -- eixo web
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  utm_content   TEXT,
  utm_term      TEXT,
  landing_path  TEXT,
  referrer      TEXT,
  click_ids     JSONB NOT NULL DEFAULT '{}',

  -- eixo social / anuncios
  ad_id         TEXT,
  adset_id      TEXT,
  campaign_id   TEXT,
  creative_id   TEXT,
  post_id       TEXT,
  external_id   TEXT,

  -- amarração
  lead_token    TEXT,
  link_code     TEXT,
  phone         TEXT,

  is_primary    BOOLEAN NOT NULL DEFAULT false,
  touched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lead_origins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read lead origins" ON lead_origins;
CREATE POLICY "Members can read lead origins"
  ON lead_origins FOR SELECT
  USING (is_account_member(account_id));
-- Nenhuma policy de escrita: `lead_origins` e escrita SO pelo
-- service role (os endpoints). Um `viewer` da conta le, ninguem da
-- conta escreve por RLS.

-- ============================================================
-- 3. Indices
-- ============================================================

-- A jornada do contato.
CREATE INDEX IF NOT EXISTS idx_lead_origins_account_contact
  ON lead_origins (account_id, contact_id);

-- Amarracao por telefone (o caminho limpo: form do site).
CREATE INDEX IF NOT EXISTS idx_lead_origins_account_phone
  ON lead_origins (account_id, phone);

-- Amarracao pelo codigo de 8 chars.
CREATE INDEX IF NOT EXISTS idx_lead_origins_account_token
  ON lead_origins (account_id, lead_token);

-- Um codigo por conta. O codigo e a PONTE entre o clique e a
-- mensagem: se dois cliques dividissem o mesmo codigo, o lead
-- poderia ser amarrado a origem errada. O indice UNICO PARCIAL
-- transforma essa colisao (2^-40 por clique) num erro visivel no
-- banco em vez de uma atribuicao silenciosa.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_origins_unique_token
  ON lead_origins (account_id, lead_token)
  WHERE lead_token IS NOT NULL;

-- UMA origem principal por contato, garantido no banco.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_origins_primary_contact
  ON lead_origins (contact_id)
  WHERE is_primary AND contact_id IS NOT NULL;

-- As contagens que a "Inteligencia de Conteudo" vai ler.
CREATE INDEX IF NOT EXISTS idx_lead_origins_account_campaign
  ON lead_origins (account_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_lead_origins_account_post
  ON lead_origins (account_id, post_id);

-- As origens pendentes (lead que ainda nao falou com a gente).
CREATE INDEX IF NOT EXISTS idx_lead_origins_pending
  ON lead_origins (account_id, touched_at)
  WHERE contact_id IS NULL;

-- O payload cru (texto original, referral inteiro).
CREATE INDEX IF NOT EXISTS idx_lead_origins_meta_gin
  ON lead_origins USING GIN (meta);

-- ============================================================
-- 4. redeem_invitation -- guarda a origem do lead
--
-- A funcao apaga a conta antiga quando o usuario resgata um convite.
-- `lead_settings` e configuracao da conta e `lead_origins` sao dado
-- de negocio: sem esta checagem as linhas seriam removidas em
-- cascata junto com a conta, e a origem do lead seria perdida.
--
-- Recriada a partir da migration 066 (a ultima versao) com as duas
-- linhas do guard.
-- ============================================================

CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsmiau_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM media_settings WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM lead_settings WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM lead_origins WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
```

- [x] **Step 4: Rode o teste e veja passar**

Run: `npx vitest run src/lib/leads/migration.test.ts`

Expected: PASS (todos os `it` verdes).

- [x] **Step 5: Avise o usuário que o SQL precisa ser rodado**

> A migration 067 está escrita. **Precisa rodar o `supabase/migrations/067_lead_origin.sql` no Supabase** antes de usar o módulo — sem as duas tabelas o app não grava origem.

- [x] **Step 6: Commit**

```bash
git add supabase/migrations/067_lead_origin.sql src/lib/leads/migration.test.ts
git commit -m "feat(leads): migration 067 — lead_settings + lead_origins"
```

---

### Task 2: `src/lib/leads/` — token, utm e `resolveOrigin()`

**Files:**
- Create: `src/lib/leads/types.ts`
- Create: `src/lib/leads/token.ts`
- Create: `src/lib/leads/token.test.ts`
- Create: `src/lib/leads/utm.ts`
- Create: `src/lib/leads/utm.test.ts`
- Create: `src/lib/leads/origin.ts`
- Create: `src/lib/leads/origin.test.ts`

**Interfaces:**
- Produces (`token.ts`): `LEAD_TOKEN_LENGTH: 8`, `generateLeadToken(random?): string`, `isLeadToken(value): boolean`, `normalizeLeadToken(value): string`, `extractLeadToken(text): { token: string; text: string } | null`.
- Produces (`utm.ts`): `FIRST_TOUCH_COOKIE = "crmbr_oid"`, `FIRST_TOUCH_COOKIE_MAX_AGE_DAYS = 30`, `UTM_KEYS`, `CLICK_ID_KEYS`, `TouchPayload`, `FirstTouchPayload`, `emptyTouch()`, `normalizeTouch(value)`, `isEmptyTouch(t)`, `isDifferentTouch(a, b)`, `encodeFirstTouch(p)`, `decodeFirstTouch(v)`, `parseTouch(search)`.
- Produces (`origin.ts`): `PHONE_MATCH_WINDOW_DAYS = 30`, `LeadOriginStore` (interface), `ReferralFacts`, `ResolveOriginInput`, `ResolveOriginResult`, `resolveOrigin(store, input)`, `generateUniqueLeadToken(store, accountId)`.
- Consumes: nada (nenhuma tarefa anterior entrega código para esta).

- [x] **Step 1: Escreva o teste que falha — `src/lib/leads/token.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  LEAD_TOKEN_LENGTH,
  extractLeadToken,
  generateLeadToken,
  isLeadToken,
  normalizeLeadToken,
} from "./token";

describe("generateLeadToken", () => {
  it("produces 8 characters from the base32 alphabet", () => {
    const token = generateLeadToken();
    expect(token).toHaveLength(LEAD_TOKEN_LENGTH);
    expect(token).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  it("never produces an ambiguous character", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateLeadToken()).not.toMatch(/[IO01]/);
    }
  });

  it("is driven by the injected random source", () => {
    // 0 maps to the first letter of the alphabet, every time.
    expect(generateLeadToken(() => 0)).toBe("AAAAAAAA");
  });
});

describe("isLeadToken", () => {
  it("accepts an 8-char code from the alphabet", () => {
    expect(isLeadToken("A7X9K2M4")).toBe(true);
  });

  it("rejects a code with an ambiguous character", () => {
    expect(isLeadToken("A7X9K2MI")).toBe(false);
  });

  it("rejects a code of the wrong length", () => {
    expect(isLeadToken("A7X9K2M")).toBe(false);
    expect(isLeadToken("A7X9K2M44")).toBe(false);
  });
});

describe("normalizeLeadToken", () => {
  it("uppercases and trims", () => {
    expect(normalizeLeadToken("  a7x9k2m4 ")).toBe("A7X9K2M4");
  });
});

describe("extractLeadToken", () => {
  it("finds the code in a message and returns the clean text", () => {
    const result = extractLeadToken("Olá, quero saber mais ref A7X9K2M4");
    expect(result?.token).toBe("A7X9K2M4");
    expect(result?.text).toBe("Olá, quero saber mais");
  });

  it("finds the code at the end of the message", () => {
    const result = extractLeadToken("Olá ref A7X9K2M4");
    expect(result?.token).toBe("A7X9K2M4");
    expect(result?.text).toBe("Olá");
  });

  it("is case-insensitive", () => {
    expect(extractLeadToken("olá ref a7x9k2m4")?.token).toBe("A7X9K2M4");
  });

  it("ignores a word that merely starts with ref", () => {
    expect(extractLeadToken("reference A7X9K2M4")).toBeNull();
  });

  it("ignores a code with an ambiguous character", () => {
    expect(extractLeadToken("ref A7X9K2MI")).toBeNull();
  });

  it("returns null for a message without a code", () => {
    expect(extractLeadToken("Olá, quero saber mais")).toBeNull();
    expect(extractLeadToken(null)).toBeNull();
    expect(extractLeadToken(undefined)).toBeNull();
  });

  it("removes only the first occurrence", () => {
    const result = extractLeadToken("ref A7X9K2M4 e ref B7X9K2M4");
    expect(result?.text).toContain("ref B7X9K2M4");
  });
});
```

- [x] **Step 2: Escreva o teste que falha — `src/lib/leads/utm.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  CLICK_ID_KEYS,
  FIRST_TOUCH_COOKIE,
  FIRST_TOUCH_COOKIE_MAX_AGE_DAYS,
  UTM_KEYS,
  decodeFirstTouch,
  emptyTouch,
  encodeFirstTouch,
  isDifferentTouch,
  isEmptyTouch,
  normalizeTouch,
  parseTouch,
} from "./utm";

describe("parseTouch", () => {
  it("reads the utm parameters", () => {
    const touch = parseTouch(
      "?utm_source=instagram&utm_medium=paid_social&utm_campaign=verao&utm_content=video1&utm_term=tenha",
    );
    expect(touch.utm_source).toBe("instagram");
    expect(touch.utm_medium).toBe("paid_social");
    expect(touch.utm_campaign).toBe("verao");
    expect(touch.utm_content).toBe("video1");
    expect(touch.utm_term).toBe("tenha");
  });

  it("reads the click ids", () => {
    const touch = parseTouch("?gclid=abc&fbclid=def&ttclid=ghi&wbraid=jkl&igshid=mno");
    expect(touch.click_ids).toEqual({
      gclid: "abc",
      fbclid: "def",
      ttclid: "ghi",
      wbraid: "jkl",
      igshid: "mno",
    });
  });

  it("ignores an unknown click id", () => {
    expect(parseTouch("?evil=1").click_ids).toEqual({});
  });

  it("returns nulls for a query without parameters", () => {
    const touch = parseTouch("");
    expect(touch.utm_source).toBeNull();
    expect(isEmptyTouch(touch)).toBe(true);
  });
});

describe("normalizeTouch", () => {
  it("ignores a value that is not a string", () => {
    const touch = normalizeTouch({ utm_source: 42, utm_campaign: ["x"] });
    expect(touch.utm_source).toBeNull();
    expect(touch.utm_campaign).toBeNull();
  });

  it("keeps only the known click ids", () => {
    const touch = normalizeTouch({ click_ids: { gclid: "abc", nope: "x" } });
    expect(touch.click_ids).toEqual({ gclid: "abc" });
  });

  it("survives a payload that is not an object", () => {
    expect(normalizeTouch(null)).toEqual(emptyTouch());
    expect(normalizeTouch("nope")).toEqual(emptyTouch());
  });
});

describe("isDifferentTouch", () => {
  it("is false for two identical touches", () => {
    const a = { utm_source: "instagram", utm_campaign: "verao" };
    const b = { utm_source: "instagram", utm_campaign: "verao" };
    expect(isDifferentTouch(a, b)).toBe(false);
  });

  it("is true when the campaign changes", () => {
    const a = { utm_campaign: "verao" };
    const b = { utm_campaign: "inverno" };
    expect(isDifferentTouch(a, b)).toBe(true);
  });

  it("is true when the campaign appears", () => {
    expect(isDifferentTouch({ utm_campaign: null }, { utm_campaign: "verao" })).toBe(true);
  });

  it("compares case-insensitively", () => {
    expect(isDifferentTouch({ utm_campaign: "VERAO" }, { utm_campaign: "verao" })).toBe(false);
  });

  it("looks at the campaign id and the post id, not only at the utm", () => {
    expect(isDifferentTouch({ campaign_id: "c1" }, { campaign_id: "c2" })).toBe(true);
    expect(isDifferentTouch({ post_id: "p1" }, { post_id: "p2" })).toBe(true);
    expect(isDifferentTouch({ link_code: "a1" }, { link_code: "a2" })).toBe(true);
  });
});

describe("the first-touch cookie", () => {
  it("is named crmbr_oid and lives for 30 days", () => {
    expect(FIRST_TOUCH_COOKIE).toBe("crmbr_oid");
    expect(FIRST_TOUCH_COOKIE_MAX_AGE_DAYS).toBe(30);
  });

  it("round-trips through the encoding", () => {
    const payload = {
      ...emptyTouch(),
      utm_source: "instagram",
      utm_campaign: "verão",
      link_code: "a7x9k2m4",
      lead_token: "A7X9K2M4",
      touched_at: "2026-10-29T12:00:00.000Z",
    };
    expect(decodeFirstTouch(encodeFirstTouch(payload))).toEqual(payload);
  });

  it("decodes an empty cookie into an empty payload", () => {
    const decoded = decodeFirstTouch("");
    expect(decoded.utm_source).toBeNull();
    expect(decoded.click_ids).toEqual({});
  });
});

describe("the key lists", () => {
  it("covers the five utm parameters", () => {
    expect([...UTM_KEYS]).toEqual([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
    ]);
  });

  it("covers the five click ids", () => {
    expect([...CLICK_ID_KEYS]).toEqual([
      "gclid",
      "fbclid",
      "ttclid",
      "wbraid",
      "igshid",
    ]);
  });
});
```

- [x] **Step 3: Escreva o teste que falha — `src/lib/leads/origin.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  PHONE_MATCH_WINDOW_DAYS,
  generateUniqueLeadToken,
  resolveOrigin,
  type LeadOriginStore,
} from "./origin";
import type { LeadOriginRow, NewLeadOrigin } from "./types";

/**
 * The clock of the test, so the 30-day window does not depend on the
 * day the suite runs.
 */
const NOW_ISO = new Date().toISOString();

/** Far enough in the past to be outside any window. */
const LONG_AGO_ISO = "2020-01-01T00:00:00.000Z";

function makeRow(overrides: Partial<LeadOriginRow> = {}): LeadOriginRow {
  return {
    id: "origin-1",
    account_id: "acc-1",
    contact_id: null,
    channel: "web",
    provider: "web",
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    landing_path: null,
    referrer: null,
    click_ids: {},
    ad_id: null,
    adset_id: null,
    campaign_id: null,
    creative_id: null,
    post_id: null,
    external_id: null,
    lead_token: null,
    link_code: null,
    phone: null,
    is_primary: false,
    touched_at: NOW_ISO,
    meta: {},
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...overrides,
  };
}

/** A store that remembers everything it was asked to remember. */
function makeStore(rows: LeadOriginRow[] = []) {
  const state = { rows: [...rows] };
  const store: LeadOriginStore = {
    async findByToken(accountId, token) {
      return (
        state.rows.find(
          (r) =>
            r.account_id === accountId &&
            r.lead_token === token &&
            r.contact_id === null,
        ) ?? null
      );
    },
    async findPendingByPhone(accountId, phone, sinceIso) {
      const matches = state.rows
        .filter(
          (r) =>
            r.account_id === accountId &&
            r.phone === phone &&
            r.contact_id === null &&
            r.touched_at >= sinceIso,
        )
        .sort((a, b) => b.touched_at.localeCompare(a.touched_at));
      return matches[0] ?? null;
    },
    async findPrimaryByContact(accountId, contactId) {
      return (
        state.rows.find(
          (r) =>
            r.account_id === accountId &&
            r.contact_id === contactId &&
            r.is_primary,
        ) ?? null
      );
    },
    async insertOrigin(input: NewLeadOrigin) {
      const row = makeRow({ ...input, id: `origin-${state.rows.length + 1}` });
      state.rows.push(row);
      return row;
    },
    async attachContact(originId, contactId) {
      const row = state.rows.find((r) => r.id === originId);
      if (row) row.contact_id = contactId;
    },
    async setPrimary(originId) {
      const row = state.rows.find((r) => r.id === originId);
      if (!row) return false;
      row.is_primary = true;
      return true;
    },
    async isTokenTaken(accountId, token) {
      return state.rows.some(
        (r) => r.account_id === accountId && r.lead_token === token,
      );
    },
  };
  return { store, state };
}

const BASE = {
  accountId: "acc-1",
  contactId: "contact-1",
  provider: "meta" as const,
  touchedAt: NOW_ISO,
};

describe("resolveOrigin", () => {
  it("binds the pending origin found by the token", async () => {
    const pending = makeRow({
      id: "origin-token",
      lead_token: "A7X9K2M4",
      utm_source: "instagram",
    });
    const { store, state } = makeStore([pending]);

    const result = await resolveOrigin(store, {
      ...BASE,
      phone: "5511999999999",
      leadToken: "A7X9K2M4",
    });

    expect(result.matchedBy).toBe("token");
    expect(state.rows[0].contact_id).toBe("contact-1");
    expect(state.rows[0].is_primary).toBe(true);
  });

  it("prefers the token over the phone", async () => {
    const byToken = makeRow({ id: "origin-token", lead_token: "A7X9K2M4" });
    const byPhone = makeRow({ id: "origin-phone", phone: "5511999999999" });
    const { store } = makeStore([byToken, byPhone]);

    const result = await resolveOrigin(store, {
      ...BASE,
      phone: "5511999999999",
      leadToken: "A7X9K2M4",
    });

    expect(result.matchedBy).toBe("token");
    expect(result.origin?.id).toBe("origin-token");
  });

  it("binds the pending origin found by the phone", async () => {
    const pending = makeRow({
      id: "origin-phone",
      phone: "5511999999999",
      utm_source: "instagram",
    });
    const { store, state } = makeStore([pending]);

    const result = await resolveOrigin(store, {
      ...BASE,
      phone: "5511999999999",
    });

    expect(result.matchedBy).toBe("phone");
    expect(state.rows[0].contact_id).toBe("contact-1");
    expect(state.rows[0].is_primary).toBe(true);
  });

  it("ignores a pending origin older than the window", async () => {
    const old = makeRow({
      id: "origin-old",
      phone: "5511999999999",
      touched_at: LONG_AGO_ISO,
    });
    const { store } = makeStore([old]);

    const result = await resolveOrigin(store, {
      ...BASE,
      phone: "5511999999999",
    });

    expect(result.matchedBy).toBe("direct");
    expect(PHONE_MATCH_WINDOW_DAYS).toBe(30);
  });

  it("does not steal an origin that already belongs to a contact", async () => {
    const taken = makeRow({
      id: "origin-taken",
      lead_token: "A7X9K2M4",
      contact_id: "someone-else",
    });
    const { store } = makeStore([taken]);

    const result = await resolveOrigin(store, {
      ...BASE,
      leadToken: "A7X9K2M4",
    });

    expect(result.matchedBy).toBe("direct");
    expect(taken.contact_id).toBe("someone-else");
  });

  it("creates a direct origin when nothing matches", async () => {
    const { store, state } = makeStore();

    const result = await resolveOrigin(store, { ...BASE });

    expect(result.matchedBy).toBe("direct");
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].channel).toBe("direct");
    expect(state.rows[0].provider).toBe("meta");
    expect(state.rows[0].is_primary).toBe(true);
  });

  it("creates an origin from the provider referral", async () => {
    const { store, state } = makeStore();

    const result = await resolveOrigin(store, {
      ...BASE,
      referral: {
        ad_id: "ad-1",
        adset_id: "adset-1",
        campaign_id: "camp-1",
        creative_id: "creative-1",
      },
    });

    expect(result.matchedBy).toBe("referral");
    expect(state.rows[0].ad_id).toBe("ad-1");
    expect(state.rows[0].campaign_id).toBe("camp-1");
    expect(state.rows[0].is_primary).toBe(true);
  });

  it("does not create a second row when the touch repeats the same campaign", async () => {
    const primary = makeRow({
      id: "origin-1",
      contact_id: "contact-1",
      is_primary: true,
      campaign_id: "camp-1",
    });
    const { store, state } = makeStore([primary]);

    const result = await resolveOrigin(store, {
      ...BASE,
      referral: { campaign_id: "camp-1" },
    });

    expect(result.matchedBy).toBe("existing");
    expect(state.rows).toHaveLength(1);
  });

  it("creates a second row when the touch brings another campaign", async () => {
    const primary = makeRow({
      id: "origin-1",
      contact_id: "contact-1",
      is_primary: true,
      campaign_id: "camp-1",
    });
    const { store, state } = makeStore([primary]);

    const result = await resolveOrigin(store, {
      ...BASE,
      referral: { campaign_id: "camp-2" },
    });

    expect(result.matchedBy).toBe("referral");
    expect(state.rows).toHaveLength(2);
    expect(state.rows[1].is_primary).toBe(false);
  });

  it("does not change the primary of a contact that already has one", async () => {
    const primary = makeRow({
      id: "origin-1",
      contact_id: "contact-1",
      is_primary: true,
      channel: "direct",
    });
    const pending = makeRow({
      id: "origin-2",
      lead_token: "A7X9K2M4",
      utm_campaign: "verao",
    });
    const { store, state } = makeStore([primary, pending]);

    await resolveOrigin(store, { ...BASE, leadToken: "A7X9K2M4" });

    expect(state.rows[0].is_primary).toBe(true);
    expect(state.rows[1].is_primary).toBe(false);
    expect(state.rows[1].contact_id).toBe("contact-1");
  });

  it("keeps the raw text in the meta of the created origin", async () => {
    const { store, state } = makeStore();

    await resolveOrigin(store, { ...BASE, rawText: "Olá ref A7X9K2M4" });

    expect(state.rows[0].meta.raw_text).toBe("Olá ref A7X9K2M4");
  });
});

describe("generateUniqueLeadToken", () => {
  it("retries until the code is free", async () => {
    const taken = makeRow({ id: "origin-1", lead_token: "AAAAAAAA" });
    const { store } = makeStore([taken]);

    const codes = ["AAAAAAAA", "BBBBBBBB"];
    let index = 0;
    const token = await generateUniqueLeadToken(
      store,
      "acc-1",
      5,
      () => codes[index++] ?? "CCCCCCCC"
    );

    expect(token).toBe("BBBBBBBB");
  });

  it("gives up after the attempts are exhausted", async () => {
    const taken = makeRow({ id: "origin-1", lead_token: "AAAAAAAA" });
    const { store } = makeStore([taken]);

    let calls = 0;
    const token = await generateUniqueLeadToken(store, "acc-1", 2, () => {
      calls += 1;
      return "AAAAAAAA";
    });
    expect(calls).toBe(2);
    expect(token).toBe("AAAAAAAA");
  });
});
```

- [x] **Step 4: Rode os três testes e veja falhar**

Run: `npx vitest run src/lib/leads/token.test.ts src/lib/leads/utm.test.ts src/lib/leads/origin.test.ts`

Expected: FAIL com "Cannot find module './token'" (e idem para `./utm` e `./origin`).

- [x] **Step 5: Escreva `src/lib/leads/types.ts`**

```ts
/**
 * The types of the "Origem do lead" module.
 *
 * `LeadChannel` and `LeadProvider` mirror the CHECK constraints of
 * the `lead_origins` table (migration 067) — a value outside these
 * unions would abort the insert, so the vocabulary lives in ONE
 * place and the migration is the other.
 */

/** Where the touch happened. */
export type LeadChannel =
  | 'whatsapp'
  | 'instagram_dm'
  | 'instagram_comment'
  | 'tiktok_dm'
  | 'tiktok_lead'
  | 'web'
  | 'direct';

/** Who delivered the touch. */
export type LeadProvider = 'meta' | 'whatsmiau' | 'tiktok' | 'web';

/** A row of `lead_origins`. */
export interface LeadOriginRow {
  id: string;
  account_id: string;
  contact_id: string | null;
  channel: LeadChannel;
  provider: LeadProvider | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  landing_path: string | null;
  referrer: string | null;
  click_ids: Record<string, string>;
  ad_id: string | null;
  adset_id: string | null;
  campaign_id: string | null;
  creative_id: string | null;
  post_id: string | null;
  external_id: string | null;
  lead_token: string | null;
  link_code: string | null;
  phone: string | null;
  is_primary: boolean;
  touched_at: string;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** The shape `insertOrigin` writes. */
export type NewLeadOrigin = Omit<
  LeadOriginRow,
  'id' | 'created_at' | 'updated_at'
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

/** A campaign link, as stored in `lead_settings.links`. */
export interface CampaignLink {
  code: string;
  label: string;
  /** `wa:<number>` or `url:<https://...>`. */
  destination: string;
  /** The prefilled WhatsApp message. */
  message: string;
  created_at: string;
}

/** The account's lead configuration. */
export interface LeadSettings {
  account_id: string;
  capture_key: string;
  enabled: boolean;
  allowed_hosts: string[];
  links: CampaignLink[];
}
```

- [x] **Step 6: Escreva `src/lib/leads/token.ts`**

```ts
/**
 * The 8-character code that ties a browser click to the first
 * inbound message of that lead.
 *
 * The lead clicks an ad, the browser leaves for WhatsApp, and no
 * cookie crosses that boundary. The only bridge left is a short code
 * the client carries in the message: `ref A7X9K2M4`. The CRM strips
 * it before the agent sees the text and keeps the raw text in
 * `lead_origins.meta.raw_text`.
 *
 * 8 characters of a 32-symbol alphabet is ~40 bits. The code is
 * single-use: once it is tied to a contact it stops matching.
 */

/** The length of the code. */
export const LEAD_TOKEN_LENGTH = 8;

/**
 * The alphabet. Base32 minus the four ambiguous symbols (I, O, 0,
 * 1) — a code read aloud or copied by hand has to survive that.
 */
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `ref A7X9K2M4` — the code, preceded by the marker. */
const TOKEN_PATTERN = new RegExp(
  `\\bref\\s+([${TOKEN_ALPHABET}]{${LEAD_TOKEN_LENGTH}})\\b`,
  'i',
);

/** A single code from the alphabet. */
export function generateLeadToken(random: () => number = Math.random): string {
  let token = '';
  for (let i = 0; i < LEAD_TOKEN_LENGTH; i++) {
    const index = Math.floor(random() * TOKEN_ALPHABET.length);
    token += TOKEN_ALPHABET[index] ?? 'A';
  }
  return token;
}

/** Is this a well-formed code? */
export function isLeadToken(value: string): boolean {
  return new RegExp(`^[${TOKEN_ALPHABET}]{${LEAD_TOKEN_LENGTH}}$`).test(value);
}

/** Uppercase and trim — the code is case-insensitive on the wire. */
export function normalizeLeadToken(value: string): string {
  return value.trim().toUpperCase();
}

/** The code found in a message, and the message without it. */
export interface ExtractedLeadToken {
  token: string;
  /** The text the agent will read. */
  text: string;
}

/**
 * Pull the code out of an inbound message.
 *
 * Returns null when there is no code — the common case. The text
 * comes back with the code removed and the leftover spaces tidied,
 * so the agent reads what the customer actually typed.
 */
export function extractLeadToken(
  text: string | null | undefined,
): ExtractedLeadToken | null {
  if (!text) return null;

  const match = TOKEN_PATTERN.exec(text);
  if (!match || match.index === undefined) return null;

  const token = normalizeLeadToken(match[1] ?? '');
  if (!isLeadToken(token)) return null;

  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  const cleaned = `${before} ${after}`.replace(/[ \t]{2,}/g, ' ').trim();

  return { token, text: cleaned };
}
```

- [x] **Step 7: Escreva `src/lib/leads/utm.ts`**

```ts
/**
 * The web axis of a touch: the UTM parameters, the click ids, the
 * landing page and the referrer.
 *
 * Everything here is PURE — the same functions run in the capture
 * route, in the `/r/<code>` route and in the browser script, so the
 * first-touch cookie is written and read with the same format.
 */

/** The first-party cookie that remembers the first touch. */
export const FIRST_TOUCH_COOKIE = 'crmbr_oid';

/** How long the first touch is remembered. */
export const FIRST_TOUCH_COOKIE_MAX_AGE_DAYS = 30;

/** The five standard UTM parameters. */
export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

/** The click ids we keep. */
export const CLICK_ID_KEYS = [
  'gclid',
  'fbclid',
  'ttclid',
  'wbraid',
  'igshid',
] as const;

/** The web facts of a touch. */
export interface TouchPayload {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  landing_path: string | null;
  referrer: string | null;
  click_ids: Record<string, string>;
}

/** The touch, plus what the capture route adds to it. */
export interface FirstTouchPayload extends TouchPayload {
  link_code: string | null;
  lead_token: string | null;
  touched_at: string;
}

/** A touch with nothing on it. */
export function emptyTouch(): TouchPayload {
  return {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    landing_path: null,
    referrer: null,
    click_ids: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string, trimmed and capped. Anything else is null. */
function readString(value: unknown, maxLength = 512): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/** Only the click ids we know about. */
function readClickIds(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const key of CLICK_ID_KEYS) {
    const read = readString(value[key], 255);
    if (read) out[key] = read;
  }
  return out;
}

/**
 * A touch from an untrusted payload.
 *
 * The public endpoint receives JSON from the browser, so every field
 * is checked: a number in `utm_source` is not a string and is
 * dropped, an unknown click id is not stored, and a long value is
 * capped.
 */
export function normalizeTouch(value: unknown): TouchPayload {
  if (!isRecord(value)) return emptyTouch();

  return {
    utm_source: readString(value.utm_source),
    utm_medium: readString(value.utm_medium),
    utm_campaign: readString(value.utm_campaign),
    utm_content: readString(value.utm_content),
    utm_term: readString(value.utm_term),
    landing_path: readString(value.landing_path),
    referrer: readString(value.referrer),
    click_ids: readClickIds(value.click_ids),
  };
}

/** A touch from a query string. */
export function parseTouch(search: string): TouchPayload {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  const touch = emptyTouch();
  for (const key of UTM_KEYS) {
    const read = readString(params.get(key));
    if (read) touch[key] = read;
  }
  const clickIds: Record<string, string> = {};
  for (const key of CLICK_ID_KEYS) {
    const read = readString(params.get(key), 255);
    if (read) clickIds[key] = read;
  }
  touch.click_ids = clickIds;
  return touch;
}

/** Is there nothing on this touch? */
export function isEmptyTouch(touch: TouchPayload): boolean {
  return (
    !touch.utm_source &&
    !touch.utm_medium &&
    !touch.utm_campaign &&
    !touch.utm_content &&
    !touch.utm_term &&
    !touch.landing_path &&
    !touch.referrer &&
    Object.keys(touch.click_ids).length === 0
  );
}

/**
 * The fields that decide whether two touches are the same touch.
 *
 * The union of the two lists in the spec: the capture endpoint
 * compares `utm_source` / `utm_campaign` / `utm_content` /
 * `link_code`, and the inbound compares `campaign_id` / `post_id` /
 * `utm_campaign` / `link_code`. At capture time there is no
 * `campaign_id` nor `post_id` (those are the social axis), so the
 * union never fires where the spec would not.
 */
export const DIFF_TOUCH_FIELDS = [
  'utm_source',
  'utm_campaign',
  'utm_content',
  'campaign_id',
  'post_id',
  'link_code',
] as const;

/** The facts two touches are compared by. */
export interface TouchFacts {
  utm_source?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  campaign_id?: string | null;
  post_id?: string | null;
  link_code?: string | null;
}

function normalizeFact(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Do these two touches bring something different? */
export function isDifferentTouch(a: TouchFacts, b: TouchFacts): boolean {
  return DIFF_TOUCH_FIELDS.some(
    (field) => normalizeFact(a[field]) !== normalizeFact(b[field]),
  );
}

/**
 * The cookie value.
 *
 * A plain query string, not JSON: the browser decodes it with
 * `URLSearchParams` and the server encodes it with the same class.
 * No base64, no UTF-8 dance, nothing to keep in sync.
 */
export function encodeFirstTouch(payload: FirstTouchPayload): string {
  const params = new URLSearchParams();
  for (const key of UTM_KEYS) {
    const value = payload[key];
    if (value) params.set(key, value);
  }
  if (payload.landing_path) params.set('landing_path', payload.landing_path);
  if (payload.referrer) params.set('referrer', payload.referrer);
  for (const key of CLICK_ID_KEYS) {
    const value = payload.click_ids[key];
    if (value) params.set(key, value);
  }
  if (payload.link_code) params.set('link_code', payload.link_code);
  if (payload.lead_token) params.set('lead_token', payload.lead_token);
  if (payload.touched_at) params.set('touched_at', payload.touched_at);
  return params.toString();
}

/** The cookie value, back into a payload. */
export function decodeFirstTouch(value: string): FirstTouchPayload {
  const params = new URLSearchParams(value);
  const touch = normalizeTouch({
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
    utm_content: params.get('utm_content'),
    utm_term: params.get('utm_term'),
    landing_path: params.get('landing_path'),
    referrer: params.get('referrer'),
    click_ids: {
      gclid: params.get('gclid'),
      fbclid: params.get('fbclid'),
      ttclid: params.get('ttclid'),
      wbraid: params.get('wbraid'),
      igshid: params.get('igshid'),
    },
  });

  return {
    ...touch,
    link_code: readString(params.get('link_code')),
    lead_token: readString(params.get('lead_token')),
    touched_at: readString(params.get('touched_at')) ?? new Date(0).toISOString(),
  };
}
```

- [x] **Step 8: Escreva `src/lib/leads/origin.ts`**

```ts
/**
 * Tying a lead's first touch to the contact it became.
 *
 * The module is PURE with respect to HTTP: it takes a store and
 * returns what it did. Both inbound paths — the Meta webhook and
 * the whatsmiau provider — call the SAME function, so the two
 * providers behave identically.
 *
 * The resolution order (spec §6.1):
 *
 *   1. the code in the message  (`ref A7X9K2M4`)
 *   2. the phone (a pending origin captured from the site form)
 *   3. the referral the provider delivered
 *   4. `direct` — nothing above
 */

import {
  isDifferentTouch,
  type TouchFacts,
} from './utm';
import type {
  LeadChannel,
  LeadOriginRow,
  LeadProvider,
  NewLeadOrigin,
} from './types';
import { generateLeadToken } from './token';

/** How long a pending origin can wait for its contact. */
export const PHONE_MATCH_WINDOW_DAYS = 30;

/** What the provider told us about the ad the lead came from. */
export interface ReferralFacts {
  ad_id?: string | null;
  adset_id?: string | null;
  campaign_id?: string | null;
  creative_id?: string | null;
  post_id?: string | null;
  /** The provider's own source name (`facebook`, `instagram`...). */
  source?: string | null;
  ads_metadata?: Record<string, unknown> | null;
}

/**
 * The persistence the resolver needs.
 *
 * Narrow on purpose: the resolver must be testable without a
 * database, and the SQL must live in one place (`store.ts`).
 */
export interface LeadOriginStore {
  /** A pending origin with this token. */
  findByToken(accountId: string, token: string): Promise<LeadOriginRow | null>;
  /** The most recent pending origin with this phone. */
  findPendingByPhone(
    accountId: string,
    phone: string,
    sinceIso: string,
  ): Promise<LeadOriginRow | null>;
  /** The contact's primary origin. */
  findPrimaryByContact(
    accountId: string,
    contactId: string,
  ): Promise<LeadOriginRow | null>;
  insertOrigin(input: NewLeadOrigin): Promise<LeadOriginRow | null>;
  attachContact(originId: string, contactId: string): Promise<void>;
  setPrimary(originId: string): Promise<boolean>;
  isTokenTaken(accountId: string, token: string): Promise<boolean>;
}

/** How the origin was found. */
export type OriginMatch = 'token' | 'phone' | 'referral' | 'direct' | 'existing';

export interface ResolveOriginInput {
  accountId: string;
  contactId: string;
  provider: LeadProvider;
  channel?: LeadChannel;
  phone?: string | null;
  leadToken?: string | null;
  /** The text as the customer sent it, code included. */
  rawText?: string | null;
  referral?: ReferralFacts | null;
  /** The moment of the touch. */
  touchedAt?: string;
}

export interface ResolveOriginResult {
  origin: LeadOriginRow | null;
  matchedBy: OriginMatch;
}

function nowIso(): string {
  return new Date().toISOString();
}

function referralFacts(referral: ReferralFacts | null | undefined): TouchFacts {
  return {
    campaign_id: referral?.campaign_id ?? null,
    post_id: referral?.post_id ?? null,
  };
}

/**
 * Bind a pending origin to a contact.
 *
 * The contact is attached FIRST and the primary flag is set after,
 * because the partial unique index only covers the rows that have a
 * contact. When the contact already has a primary origin, the
 * pending row joins the journey as a second touch — the primary is
 * NOT touched (spec §6.2).
 */
async function attach(
  store: LeadOriginStore,
  origin: LeadOriginRow,
  accountId: string,
  contactId: string,
): Promise<void> {
  await store.attachContact(origin.id, contactId);

  const primary = await store.findPrimaryByContact(accountId, contactId);
  if (primary) return;

  // The contact had no origin: this one becomes the primary. A
  // concurrent inbound for the same contact can win the race — the
  // unique index rejects the loser, which is the right answer.
  await store.setPrimary(origin.id);
}

/**
 * Resolve — and record — where a lead came from.
 */
export async function resolveOrigin(
  store: LeadOriginStore,
  input: ResolveOriginInput,
): Promise<ResolveOriginResult> {
  const { accountId, contactId } = input;
  const touchedAt = input.touchedAt ?? nowIso();
  const provider = input.provider;
  const channel: LeadChannel = input.channel ?? 'whatsapp';

  // 1. The code in the message.
  const token = input.leadToken?.trim();
  if (token) {
    const pending = await store.findByToken(accountId, token);
    if (pending) {
      await attach(store, pending, accountId, contactId);
      return { origin: pending, matchedBy: 'token' };
    }
  }

  // 2. The phone — the pending origin captured from the site form.
  const phone = input.phone?.trim();
  if (phone) {
    const since = new Date(
      Date.now() - PHONE_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const pending = await store.findPendingByPhone(accountId, phone, since);
    if (pending) {
      await attach(store, pending, accountId, contactId);
      return { origin: pending, matchedBy: 'phone' };
    }
  }

  const primary = await store.findPrimaryByContact(accountId, contactId);

  // 3 and 4. A referral or a direct touch. Neither creates a new row
  // when the touch repeats what the primary already says (spec §6.2).
  const referral = input.referral ?? null;
  const hasReferral = Boolean(
    referral &&
      (referral.ad_id ||
        referral.adset_id ||
        referral.campaign_id ||
        referral.creative_id ||
        referral.post_id),
  );

  if (primary && !isDifferentTouch(referralFacts(primary), referralFacts(referral))) {
    return { origin: primary, matchedBy: 'existing' };
  }

  const meta: Record<string, unknown> = {};
  if (input.rawText) meta.raw_text = input.rawText;
  if (referral?.source) meta.referral_source = referral.source;
  if (referral?.ads_metadata) meta.ads_metadata = referral.ads_metadata;

  const created = await store.insertOrigin({
    account_id: accountId,
    contact_id: contactId,
    channel: hasReferral ? channel : 'direct',
    provider,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    landing_path: null,
    referrer: null,
    click_ids: {},
    ad_id: referral?.ad_id ?? null,
    adset_id: referral?.adset_id ?? null,
    campaign_id: referral?.campaign_id ?? null,
    creative_id: referral?.creative_id ?? null,
    post_id: referral?.post_id ?? null,
    external_id: null,
    lead_token: null,
    link_code: null,
    phone: phone ?? null,
    is_primary: !primary,
    touched_at: touchedAt,
    meta,
  });

  return {
    origin: created,
    matchedBy: hasReferral ? 'referral' : 'direct',
  };
}

/**
 * A code that is not taken yet.
 *
 * 40 bits is a lot of room, but a collision inside one account would
 * tie two leads to the same origin — so we check and regenerate.
 *
 * `generate` is injectable so the test can hand out a known sequence
 * of codes; in production it draws from the alphabet.
 */
export async function generateUniqueLeadToken(
  store: LeadOriginStore,
  accountId: string,
  maxAttempts = 5,
  generate: () => string = () => generateLeadToken()
): Promise<string> {
  let token = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    token = generate();
    const taken = await store.isTokenTaken(accountId, token);
    if (!taken) return token;
  }
  // Every attempt collided: the last code is returned and the unique
  // index on the table rejects it — the collision surfaces in the
  // database instead of silently tying two leads to one origin.
  return token;
}
```

- [x] **Step 9: Rode os testes e veja passar**

Run: `npx vitest run src/lib/leads/token.test.ts src/lib/leads/utm.test.ts src/lib/leads/origin.test.ts`

Expected: PASS — 3 arquivos, todos os `it` verdes.

- [x] **Step 10: Commit**

```bash
git add src/lib/leads
git commit -m "feat(leads): token, utm e resolveOrigin — a amarração da origem"
```

---

### Task 3: `POST /api/leads/capture` + `/api/leads/track.js`

**Files:**
- Create: `src/lib/leads/admin-client.ts`
- Create: `src/lib/leads/store.ts`
- Create: `src/lib/leads/track-script.ts`
- Create: `src/app/api/leads/capture/route.ts`
- Create: `src/app/api/leads/capture/route.test.ts`
- Create: `src/app/api/leads/track.js/route.ts`
- Modify: `src/lib/rate-limit.ts`

**Interfaces:**
- Consumes: `normalizeTouch`, `isDifferentTouch`, `isEmptyTouch`, `emptyTouch` (de `utm.ts`); `generateUniqueLeadToken`, `LeadOriginStore` (de `origin.ts`); `LeadSettings`, `CampaignLink` (de `types.ts`).
- Produces: `supabaseAdmin()` (de `@/lib/leads/admin-client`), `createLeadOriginStore(db)`, `createLeadSettingsStore(db)` (de `store.ts`), `RATE_LIMITS.leadCapture` (de `@/lib/rate-limit`).
- Produces: `POST /api/leads/capture` → `200 { leadToken }`, `404`, `403`, `429`, `400`.
- Produces: `GET /api/leads/track.js` → `application/javascript`.

- [x] **Step 1: Escreva o teste que falha — `src/app/api/leads/capture/route.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const inserts: Array<Record<string, unknown>> = [];
let settingsRow: Record<string, unknown> | null = null;
let rateLimitResult = { success: true, remaining: 9, reset: Date.now() + 60_000, limit: 30 };

vi.mock("@/lib/leads/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => {
        const builder = {
          eq: () => builder,
          maybeSingle: async () => (table === "lead_settings" ? settingsRow : null),
          single: async () => (table === "lead_settings" ? settingsRow : null),
        };
        return builder;
      },
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return { select: () => ({ single: async () => row }) };
      },
    }),
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: { leadCapture: { limit: 30, windowMs: 60_000 } },
  getClientIp: () => "203.0.113.7",
  checkRateLimit: () => rateLimitResult,
  rateLimitResponse: () =>
    new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }),
}));

import { POST } from "./route";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://crm.example.com/api/leads/capture", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-capture-key": "key-1",
      origin: "https://site.example.com",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const VALID = {
  action: "form_submit",
  channel: "web",
  phone: "+55 (11) 99999-9999",
  first: { utm_source: "instagram", utm_campaign: "verao" },
  now: { utm_source: "instagram", utm_campaign: "verao" },
};

beforeEach(() => {
  inserts.length = 0;
  rateLimitResult = { success: true, remaining: 9, reset: Date.now() + 60_000, limit: 30 };
  settingsRow = {
    account_id: "acc-1",
    capture_key: "key-1",
    enabled: true,
    allowed_hosts: [],
    links: [],
  };
});

describe("POST /api/leads/capture", () => {
  it("answers 404 when the key is unknown", async () => {
    settingsRow = null;
    const res = await POST(request(VALID));
    expect(res.status).toBe(404);
    expect(inserts).toHaveLength(0);
  });

  it("answers 404 when the capture is disabled", async () => {
    settingsRow = { ...(settingsRow as Record<string, unknown>), enabled: false };
    const res = await POST(request(VALID));
    expect(res.status).toBe(404);
  });

  it("answers 404 when the key header is missing", async () => {
    const res = await POST(request(VALID, { "x-capture-key": "" }));
    expect(res.status).toBe(404);
  });

  it("answers 403 when the host is not on the allowlist", async () => {
    settingsRow = { ...(settingsRow as Record<string, unknown>), allowed_hosts: ["other.example.com"] };
    const res = await POST(request(VALID));
    expect(res.status).toBe(403);
    expect(inserts).toHaveLength(0);
  });

  it("accepts a host on the allowlist", async () => {
    settingsRow = { ...(settingsRow as Record<string, unknown>), allowed_hosts: ["site.example.com"] };
    const res = await POST(request(VALID));
    expect(res.status).toBe(200);
  });

  it("answers 429 when the rate limit is exhausted", async () => {
    rateLimitResult = { success: false, remaining: 0, reset: Date.now() + 60_000, limit: 30 };
    const res = await POST(request(VALID));
    expect(res.status).toBe(429);
    expect(inserts).toHaveLength(0);
  });

  it("answers 400 for an invalid body", async () => {
    const res = await POST(request({ action: "nope" }));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("writes one pending origin when both touches are the same", async () => {
    const res = await POST(request(VALID));
    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].contact_id).toBeNull();
    expect(inserts[0].is_primary).toBe(false);
    expect(inserts[0].utm_source).toBe("instagram");
  });

  it("writes two pending origins when the touches differ", async () => {
    const res = await POST(
      request({
        ...VALID,
        now: { utm_source: "instagram", utm_campaign: "inverno" },
      }),
    );
    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(2);
  });

  it("normalizes the phone to digits", async () => {
    await POST(request(VALID));
    expect(inserts[0].phone).toBe("5511999999999");
  });

  it("returns the lead token it wrote", async () => {
    const res = await POST(request(VALID));
    const body = (await res.json()) as { leadToken: string };
    expect(body.leadToken).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(inserts[0].lead_token).toBe(body.leadToken);
  });

  it("puts the token on the FIRST touch, not the last one", async () => {
    const res = await POST(
      request({
        ...VALID,
        now: { utm_source: "instagram", utm_campaign: "inverno" },
      }),
    );
    const body = (await res.json()) as { leadToken: string };
    expect(inserts[0].lead_token).toBe(body.leadToken);
    expect(inserts[1].lead_token).toBeNull();
  });
});
```

- [x] **Step 2: Rode o teste e veja falhar**

Run: `npx vitest run src/app/api/leads/capture/route.test.ts`

Expected: FAIL com "Cannot find module '@/lib/leads/admin-client'" (ou "Cannot find module './route'").

- [x] **Step 3: Escreva `src/lib/leads/admin-client.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The service-role client of the lead module.
 *
 * The public capture endpoint has no session — it authenticates with
 * the capture key — and the inbound webhook has no `auth.uid()`
 * either. Both write through the service role, exactly like
 * `src/lib/ai/admin-client.ts` and the two other admin clients of
 * this repo.
 */
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
```

- [x] **Step 4: Escreva `src/lib/leads/store.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

import type { LeadOriginStore } from './origin'
import type { CampaignLink, LeadOriginRow, LeadSettings } from './types'

/**
 * The Supabase implementation of the two stores.
 *
 * `lead_origins` is written by the service role only (there is no
 * write policy on the table), so every write here goes through a
 * client that bypasses RLS.
 */
export function createLeadOriginStore(db: SupabaseClient): LeadOriginStore {
  return {
    async findByToken(accountId, token) {
      const { data, error } = await db
        .from('lead_origins')
        .select('*')
        .eq('account_id', accountId)
        .eq('lead_token', token)
        .is('contact_id', null)
        .limit(1)
      if (error) throw error
      return (data?.[0] as LeadOriginRow | undefined) ?? null
    },

    async findPendingByPhone(accountId, phone, sinceIso) {
      const { data, error } = await db
        .from('lead_origins')
        .select('*')
        .eq('account_id', accountId)
        .eq('phone', phone)
        .is('contact_id', null)
        .gte('touched_at', sinceIso)
        .order('touched_at', { ascending: false })
        .limit(1)
      if (error) throw error
      return (data?.[0] as LeadOriginRow | undefined) ?? null
    },

    async findPrimaryByContact(accountId, contactId) {
      const { data, error } = await db
        .from('lead_origins')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('is_primary', true)
        .limit(1)
      if (error) throw error
      return (data?.[0] as LeadOriginRow | undefined) ?? null
    },

    async insertOrigin(input) {
      const { data, error } = await db
        .from('lead_origins')
        .insert(input)
        .select('*')
        .single()
      if (error) throw error
      return data as LeadOriginRow
    },

    async attachContact(originId, contactId) {
      const { error } = await db
        .from('lead_origins')
        .update({ contact_id: contactId, updated_at: new Date().toISOString() })
        .eq('id', originId)
      if (error) throw error
    },

    async setPrimary(originId) {
      const { error } = await db
        .from('lead_origins')
        .update({ is_primary: true, updated_at: new Date().toISOString() })
        .eq('id', originId)
      // The partial unique index rejects a second primary for the same
      // contact — a concurrent inbound won the race, and the other
      // origin is the primary. Not an error.
      if (error && !/duplicate key|unique/i.test(error.message)) throw error
      return true
    },

    async isTokenTaken(accountId, token) {
      const { data, error } = await db
        .from('lead_origins')
        .select('id')
        .eq('account_id', accountId)
        .eq('lead_token', token)
        .limit(1)
      if (error) throw error
      return (data?.length ?? 0) > 0
    },
  }
}

/** The account's lead configuration. */
export interface LeadSettingsStore {
  read(accountId: string): Promise<LeadSettings | null>;
  create(accountId: string, captureKey: string): Promise<LeadSettings>;
  update(accountId: string, patch: Partial<LeadSettings>): Promise<LeadSettings>;
  findByCaptureKey(captureKey: string): Promise<LeadSettings | null>;
  findByLinkCode(code: string): Promise<LeadSettings | null>;
}

function toSettings(row: Record<string, unknown>): LeadSettings {
  return {
    account_id: String(row.account_id),
    capture_key: String(row.capture_key),
    enabled: row.enabled === true,
    allowed_hosts: Array.isArray(row.allowed_hosts)
      ? (row.allowed_hosts as string[])
      : [],
    links: Array.isArray(row.links) ? (row.links as CampaignLink[]) : [],
  }
}

export function createLeadSettingsStore(db: SupabaseClient): LeadSettingsStore {
  const read = async (accountId: string): Promise<LeadSettings | null> => {
    const { data, error } = await db
      .from('lead_settings')
      .select('*')
      .eq('account_id', accountId)
      .limit(1)
    if (error) throw error
    const row = data?.[0] as Record<string, unknown> | undefined
    return row ? toSettings(row) : null
  }

  return {
    read,

    async create(accountId, captureKey) {
      const { data, error } = await db
        .from('lead_settings')
        .insert({
          account_id: accountId,
          capture_key: captureKey,
          enabled: true,
          allowed_hosts: [],
          links: [],
        })
        .select('*')
        .single()
      if (error) throw error
      return toSettings(data as Record<string, unknown>)
    },

    async update(accountId, patch) {
      const current = await read(accountId)
      if (!current) throw new Error('Lead settings not found')

      const body: Record<string, unknown> = {
        account_id: accountId,
        // `capture_key` is NOT NULL with no default and Postgres
        // validates it BEFORE the ON CONFLICT branch runs — an upsert
        // that omits it fails even when the row already exists. The
        // current value always travels with the update.
        capture_key: patch.capture_key ?? current.capture_key,
        updated_at: new Date().toISOString(),
      }
      if (patch.enabled !== undefined) body.enabled = patch.enabled
      if (patch.allowed_hosts !== undefined) body.allowed_hosts = patch.allowed_hosts
      if (patch.links !== undefined) body.links = patch.links

      const { data, error } = await db
        .from('lead_settings')
        .upsert(body, { onConflict: 'account_id' })
        .select('*')
        .single()
      if (error) throw error
      return toSettings(data as Record<string, unknown>)
    },

    async findByCaptureKey(captureKey) {
      const { data, error } = await db
        .from('lead_settings')
        .select('*')
        .eq('capture_key', captureKey)
        .limit(1)
      if (error) throw error
      const row = data?.[0] as Record<string, unknown> | undefined
      return row ? toSettings(row) : null
    },

    async findByLinkCode(code) {
      // JSONB containment: an array contains an object when one of its
      // elements contains that object. `[{ "code": "a7x9" }]` is
      // contained by the links array exactly when one link has that
      // code.
      const { data, error } = await db
        .from('lead_settings')
        .select('*')
        .contains('links', [{ code }])
        .limit(1)
      if (error) throw error
      const row = data?.[0] as Record<string, unknown> | undefined
      return row ? toSettings(row) : null
    },
  }
}
```

- [x] **Step 5: Escreva `src/lib/leads/track-script.ts`**

```ts
/**
 * The script the client pastes on their own site.
 *
 * Plain JS, no dependency, ~1 KB. It reads the UTM parameters from
 * the URL, remembers the FIRST touch in a first-party cookie, and
 * reports the touch to the CRM when the form is submitted or when a
 * WhatsApp/Instagram/TikTok link is clicked.
 *
 * It creates no contact and sends nothing but the origin. It
 * injects nothing into the DOM.
 */
export const TRACK_SCRIPT = `(function () {
  'use strict';
  var COOKIE = 'crmbr_oid';
  var DAYS = 30;
  var UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var CLICKS = ['gclid', 'fbclid', 'ttclid', 'wbraid', 'igshid'];

  function readCookie() {
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      var pair = parts[i].trim();
      if (pair.indexOf(COOKIE + '=') === 0) {
        return decodeURIComponent(pair.slice(COOKIE.length + 1));
      }
    }
    return null;
  }

  function writeCookie(value) {
    var expires = new Date(Date.now() + DAYS * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = COOKIE + '=' + encodeURIComponent(value) +
      '; expires=' + expires + '; path=/; SameSite=Lax';
  }

  function touchFromUrl(url) {
    var params = new URLSearchParams(url.search);
    var touch = {};
    for (var i = 0; i < UTM.length; i++) {
      var value = params.get(UTM[i]);
      if (value) touch[UTM[i]] = value;
    }
    for (var j = 0; j < CLICKS.length; j++) {
      var click = params.get(CLICKS[j]);
      if (click) touch[CLICKS[j]] = click;
    }
    touch.landing_path = url.pathname;
    return touch;
  }

  function decodeTouch(value) {
    var params = new URLSearchParams(value);
    var touch = { click_ids: {} };
    for (var i = 0; i < UTM.length; i++) {
      var read = params.get(UTM[i]);
      if (read) touch[UTM[i]] = read;
    }
    for (var j = 0; j < CLICKS.length; j++) {
      var click = params.get(CLICKS[j]);
      if (click) touch.click_ids[CLICKS[j]] = click;
    }
    touch.landing_path = params.get('landing_path');
    touch.referrer = params.get('referrer');
    touch.link_code = params.get('link_code');
    touch.lead_token = params.get('lead_token');
    touch.touched_at = params.get('touched_at');
    return touch;
  }

  function encodeTouch(touch) {
    var params = new URLSearchParams();
    for (var i = 0; i < UTM.length; i++) {
      if (touch[UTM[i]]) params.set(UTM[i], touch[UTM[i]]);
    }
    for (var j = 0; j < CLICKS.length; j++) {
      if (touch.click_ids && touch.click_ids[CLICKS[j]]) {
        params.set(CLICKS[j], touch.click_ids[CLICKS[j]]);
      }
    }
    if (touch.landing_path) params.set('landing_path', touch.landing_path);
    if (touch.referrer) params.set('referrer', touch.referrer);
    if (touch.link_code) params.set('link_code', touch.link_code);
    if (touch.lead_token) params.set('lead_token', touch.lead_token);
    if (touch.touched_at) params.set('touched_at', touch.touched_at);
    return params.toString();
  }

  function key() {
    var script = document.currentScript ||
      (function () {
        var all = document.getElementsByTagName('script');
        return all[all.length - 1];
      })();
    return script ? script.getAttribute('data-key') : null;
  }

  function referrer() {
    var ref = document.referrer;
    return ref && ref.indexOf(location.origin) !== 0 ? ref : null;
  }

  var captureKey = key();
  if (!captureKey) return;

  var now = touchFromUrl(location);
  now.referrer = referrer();
  now.touched_at = new Date().toISOString();

  // WRITE ONCE. The first touch is the origin — a later visit must
  // not overwrite it.
  var stored = readCookie();
  if (!stored) {
    writeCookie(encodeTouch(now));
    stored = encodeTouch(now);
  }
  var first = decodeTouch(stored);

  function send(action, channel, phone) {
    try {
      fetch('/api/leads/capture', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-capture-key': captureKey
        },
        credentials: 'omit',
        keepalive: true,
        body: JSON.stringify({
          action: action,
          channel: channel,
          phone: phone || null,
          first: first,
          now: now
        })
      }).then(function (res) {
        return res.ok ? res.json() : null;
      }).then(function (body) {
        if (!body || !body.leadToken) return;
        var token = body.leadToken;
        var links = document.querySelectorAll(
          'a[href*="wa.me"], a[href*="api.whatsapp.com"], a[href^="wa:"], ' +
          'a[href*="instagram.com"], a[href*="tiktok.com"]'
        );
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute('href') || '';
          if (href.indexOf('ref%20') !== -1 || href.indexOf('ref ') !== -1) continue;
          links[i].setAttribute(
            'data-lead-ref',
            href + (href.indexOf('?') === -1 ? '?' : '&') + 'ref=' + token
          );
        }
      }).catch(function () {});
    } catch (err) {}
  }

  function channelOf(href) {
    if (href.indexOf('instagram.com') !== -1) return 'instagram_dm';
    if (href.indexOf('tiktok.com') !== -1) return 'tiktok_dm';
    return 'whatsapp';
  }

  function phoneOf() {
    var field = document.querySelector(
      'input[name="phone"], input[name="telefone"], input[name="whatsapp"], ' +
      'input[type="tel"]'
    );
    return field && field.value ? field.value : null;
  }

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || !form.tagName || form.tagName.toLowerCase() !== 'form') return;
    send('form_submit', 'web', phoneOf());
  }, true);

  document.addEventListener(
    'blur',
    function (event) {
      var target = event.target;
      if (!target || !target.name) return;
      var name = String(target.name).toLowerCase();
      if (name !== 'phone' && name !== 'telefone' && name !== 'whatsapp') return;
      send('link_click', 'web', target.value);
    },
    true
  );

  document.addEventListener('click', function (event) {
    var node = event.target;
    while (node && node.tagName && node.tagName.toLowerCase() !== 'a') {
      node = node.parentNode;
    }
    if (!node || !node.getAttribute) return;
    var href = node.getAttribute('href') || '';
    var isSocial =
      href.indexOf('wa.me') !== -1 ||
      href.indexOf('api.whatsapp.com') !== -1 ||
      href.indexOf('wa:') === 0 ||
      href.indexOf('instagram.com') !== -1 ||
      href.indexOf('tiktok.com') !== -1;
    if (!isSocial) return;
    send('link_click', channelOf(href), phoneOf());
  }, true);
})();
`
```

- [x] **Step 6: Escreva `src/app/api/leads/capture/route.ts`**

```ts
// ============================================================
// The public capture endpoint.
//
// The client pastes the track script on their own site; the script
// POSTs the origin here. There is NO session — the request
// authenticates with the capture key, a PUBLIC identifier that only
// says which account the origin belongs to.
//
// Nothing here creates a contact. The origin is written PENDING
// (contact_id NULL) and the contact is born when the lead actually
// talks to us (the inbound). Zero spam, zero ghost contacts.
// ============================================================

import { NextResponse } from 'next/server'

import { getT } from '@/lib/i18n/translate'
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from '@/lib/rate-limit'
import { normalizePhone, parseInternationalPhone } from '@/lib/whatsapp/phone-utils'

import { supabaseAdmin } from '@/lib/leads/admin-client'
import { generateUniqueLeadToken } from '@/lib/leads/origin'
import { createLeadOriginStore, createLeadSettingsStore } from '@/lib/leads/store'
import {
  emptyTouch,
  isDifferentTouch,
  isEmptyTouch,
  normalizeTouch,
  type TouchPayload,
} from '@/lib/leads/utm'

const t = getT('Api')

const ACTIONS = ['form_submit', 'link_click', 'page_view'] as const
const CHANNELS = ['web', 'whatsapp', 'instagram_dm', 'tiktok_dm'] as const

type CaptureAction = (typeof ACTIONS)[number]
type CaptureChannel = (typeof CHANNELS)[number]

interface CaptureBody {
  action: CaptureAction
  channel: CaptureChannel
  phone: string | null
  name: string | null
  email: string | null
  first: TouchPayload
  now: TouchPayload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, maxLength = 512): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

/**
 * The phone, as the inbound stores it: digits only.
 *
 * A number typed by a person only becomes reliable with the
 * international `+` — without it, "1199999999" could be Brazil or
 * Uruguay. So the strict parser is tried first and the digits-only
 * fallback is the last resort.
 */
function normalizeCapturedPhone(raw: string | null): string | null {
  if (!raw) return null
  const strict = parseInternationalPhone(raw)
  if (strict) return strict
  const loose = normalizePhone(raw)
  return loose || null
}

/** The host of the request, from `Origin` or from `Referer`. */
function requestHost(request: Request): string | null {
  const origin = request.headers.get('origin')
  if (origin) {
    try {
      return new URL(origin).hostname.toLowerCase()
    } catch {
      return null
    }
  }
  const referer = request.headers.get('referer')
  if (referer) {
    try {
      return new URL(referer).hostname.toLowerCase()
    } catch {
      return null
    }
  }
  return null
}

/** Is this host allowed? An empty allowlist accepts everything. */
function hostAllowed(host: string | null, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) return true
  if (!host) return false
  return allowedHosts.some((allowed) => allowed.toLowerCase() === host)
}

/** Validate the untrusted body. */
function parseBody(raw: unknown): { ok: true; body: CaptureBody } | { ok: false; fields: string[] } {
  const fields: string[] = []
  if (!isRecord(raw)) return { ok: false, fields: ['body'] }

  const action = raw.action
  if (typeof action !== 'string' || !ACTIONS.includes(action as CaptureAction)) {
    fields.push('action')
  }
  const channel = raw.channel
  if (typeof channel !== 'string' || !CHANNELS.includes(channel as CaptureChannel)) {
    fields.push('channel')
  }
  if (fields.length > 0) return { ok: false, fields }

  return {
    ok: true,
    body: {
      action: action as CaptureAction,
      channel: channel as CaptureChannel,
      phone: readString(raw.phone, 32),
      name: readString(raw.name, 200),
      email: readString(raw.email, 200),
      first: normalizeTouch(raw.first),
      now: normalizeTouch(raw.now),
    },
  }
}

/**
 * The rows to write.
 *
 * The FIRST touch always gets a row. The "now" row only when it
 * brings something the first one did not (spec §5.2).
 */
export function buildCaptureRows(first: TouchPayload, now: TouchPayload): TouchPayload[] {
  if (isEmptyTouch(first)) return [now]
  if (isEmptyTouch(now)) return [first]
  if (!isDifferentTouch(first, now)) return [first]
  return [first, now]
}

export async function POST(request: Request) {
  try {
    const captureKey = request.headers.get('x-capture-key')?.trim()
    if (!captureKey) {
      return NextResponse.json({ error: t('leads.notFound') }, { status: 404 })
    }

    // The IP limit comes FIRST: a bad key must not be able to
    // brute-force the account space.
    const ipLimit = checkRateLimit(
      `lead-capture:ip:${getClientIp(request)}`,
      RATE_LIMITS.leadCapture,
    )
    if (!ipLimit.success) return rateLimitResponse(ipLimit)

    const db = supabaseAdmin()
    const settingsStore = createLeadSettingsStore(db)
    const settings = await settingsStore.findByCaptureKey(captureKey)

    // Unknown key OR disabled capture: the SAME answer. The endpoint
    // must not reveal that an account exists.
    if (!settings || !settings.enabled) {
      return NextResponse.json({ error: t('leads.notFound') }, { status: 404 })
    }

    const keyLimit = checkRateLimit(
      `lead-capture:key:${captureKey}`,
      RATE_LIMITS.leadCapture,
    )
    if (!keyLimit.success) return rateLimitResponse(keyLimit)

    const host = requestHost(request)
    if (!hostAllowed(host, settings.allowed_hosts)) {
      return NextResponse.json({ error: t('leads.hostNotAllowed') }, { status: 403 })
    }

    const raw = await request.json().catch(() => null)
    const parsed = parseBody(raw)
    if (!parsed.ok) {
      return NextResponse.json(
        { error: t('leads.invalidPayload'), fields: parsed.fields },
        { status: 400 },
      )
    }

    const body = parsed.body
    const phone = normalizeCapturedPhone(body.phone)
    const rows = buildCaptureRows(body.first, body.now)

    const store = createLeadOriginStore(db)
    const leadToken = await generateUniqueLeadToken(store, settings.account_id)

    for (const [index, row] of rows.entries()) {
      await store.insertOrigin({
        account_id: settings.account_id,
        contact_id: null,
        channel: body.channel,
        provider: 'web',
        utm_source: row.utm_source,
        utm_medium: row.utm_medium,
        utm_campaign: row.utm_campaign,
        utm_content: row.utm_content,
        utm_term: row.utm_term,
        landing_path: row.landing_path,
        referrer: row.referrer,
        click_ids: row.click_ids,
        ad_id: null,
        adset_id: null,
        campaign_id: null,
        creative_id: null,
        post_id: null,
        external_id: null,
        // The token rides on the FIRST touch: the origin of a lead is
        // its first touch (spec D2), and the token is the only bridge
        // between the click and the message.
        lead_token: index === 0 ? leadToken : null,
        link_code: null,
        phone,
        is_primary: false,
        touched_at: new Date().toISOString(),
        meta: { action: body.action, name: body.name, email: body.email },
      })
    }

    return NextResponse.json({ leadToken })
  } catch (err) {
    console.error('[leads/capture] could not record the origin:', err)
    return NextResponse.json({ error: t('leads.captureFailed') }, { status: 500 })
  }
}
```

- [x] **Step 7: Escreva `src/app/api/leads/track.js/route.ts`**

```ts
import { TRACK_SCRIPT } from '@/lib/leads/track-script'

/**
 * The tracking script, served as a static file.
 *
 * The client pastes one `<script>` tag on their own site; the file
 * is plain JS with no dependency, so it is served as-is instead of
 * going through the bundler.
 */
export function GET() {
  return new Response(TRACK_SCRIPT, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
```

- [x] **Step 8: Adicione o bucket de rate limit**

Em `src/lib/rate-limit.ts`, dentro de `RATE_LIMITS`, adicione:

```ts
  /** Public lead capture (`POST /api/leads/capture`). The bucket is
   *  checked twice: once per IP and once per capture key. 30/min per
   *  IP is generous for a site with a form on every page and still
   *  bounds a script that loops the endpoint. */
  leadCapture: { limit: 30, windowMs: 60_000 },
```

- [x] **Step 9: Rode o teste e veja passar**

Run: `npx vitest run src/app/api/leads/capture/route.test.ts`

Expected: PASS — todos os `it` verdes.

- [x] **Step 10: Commit**

```bash
git add src/lib/leads src/lib/rate-limit.ts src/app/api/leads
git commit -m "feat(leads): endpoint público de captura e o script track.js"
```

---

### Task 4: `GET /r/[code]` — o link de campanha

**Files:**
- Create: `src/app/r/[code]/route.ts`
- Create: `src/app/r/[code]/route.test.ts`

**Interfaces:**
- Consumes: `parseTouch`, `encodeFirstTouch`, `FIRST_TOUCH_COOKIE`, `FIRST_TOUCH_COOKIE_MAX_AGE_DAYS` (de `utm.ts`); `createLeadSettingsStore`, `createLeadOriginStore` (de `store.ts`); `generateUniqueLeadToken` (de `origin.ts`).
- Produces: `GET /r/<code>` → `302` para o destino, com o cookie `crmbr_oid` gravado.

- [x] **Step 1: Escreva o teste que falha — `src/app/r/[code]/route.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  settingsRow: null as Record<string, unknown> | null,
}));

/**
 * The builder the store drives.
 *
 * It is thenable: every filter method returns the builder itself and
 * the `await` at the end of the chain resolves to `{ data, error }`,
 * exactly like the real PostgREST builder.
 */
interface FakeBuilder {
  eq: () => FakeBuilder;
  contains: () => FakeBuilder;
  limit: () => FakeBuilder;
  then: (
    resolve: (value: { data: unknown[]; error: null }) => unknown
  ) => unknown;
}

vi.mock("@/lib/leads/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const builder: FakeBuilder = {
        eq: () => builder,
        contains: () => builder,
        limit: () => builder,
        then: (resolve) =>
          resolve({
            data:
              table === "lead_settings" && fake.settingsRow
                ? [fake.settingsRow]
                : [],
            error: null,
          }),
      };
      return {
        select: () => builder,
        insert: (row: Record<string, unknown>) => {
          fake.inserts.push(row);
          return { select: () => ({ single: async () => row }) };
        },
      };
    },
  }),
}));

import { GET } from "./route";

beforeEach(() => {
  fake.inserts.length = 0;
  fake.settingsRow = {
    account_id: "acc-1",
    capture_key: "key-1",
    enabled: true,
    allowed_hosts: [],
    links: [
      {
        code: "a7x9k2m4",
        label: "Anúncio Verão",
        destination: "wa:5511999999999",
        message: "Olá! Tenho interesse no anúncio.",
        created_at: "2026-10-29T12:00:00.000Z",
      },
    ],
  };
});

function request(url: string) {
  return new Request(url);
}

describe("GET /r/[code]", () => {
  it("answers 404 for an unknown code", async () => {
    fake.settingsRow = null;
    const res = await GET(request("https://crm.example.com/r/zzzzzzzz"), {
      params: Promise.resolve({ code: "zzzzzzzz" }),
    });
    expect(res.status).toBe(404);
    expect(fake.inserts).toHaveLength(0);
  });

  it("creates one pending origin per click", async () => {
    await GET(request("https://crm.example.com/r/a7x9k2m4?utm_source=instagram"), {
      params: Promise.resolve({ code: "a7x9k2m4" }),
    });
    expect(fake.inserts).toHaveLength(1);
    expect(fake.inserts[0].contact_id).toBeNull();
    expect(fake.inserts[0].link_code).toBe("a7x9k2m4");
    expect(fake.inserts[0].landing_path).toBe("/r/a7x9k2m4");
    expect(fake.inserts[0].utm_source).toBe("instagram");
  });

  it("gives every click its own token", async () => {
    await GET(request("https://crm.example.com/r/a7x9k2m4"), {
      params: Promise.resolve({ code: "a7x9k2m4" }),
    });
    await GET(request("https://crm.example.com/r/a7x9k2m4"), {
      params: Promise.resolve({ code: "a7x9k2m4" }),
    });
    expect(fake.inserts[0].lead_token).not.toBe(fake.inserts[1].lead_token);
  });

  it("redirects to wa.me with the code in the message", async () => {
    const res = await GET(request("https://crm.example.com/r/a7x9k2m4"), {
      params: Promise.resolve({ code: "a7x9k2m4" }),
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("https://wa.me/5511999999999");
    expect(location).toContain("ref+");
    expect(location).toContain(fake.inserts[0].lead_token);
  });

  it("sets the first-touch cookie", async () => {
    const res = await GET(request("https://crm.example.com/r/a7x9k2m4"), {
      params: Promise.resolve({ code: "a7x9k2m4" }),
    });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("crmbr_oid=");
    expect(cookie).toContain("Max-Age=2592000");
    // Next.js serializes the attribute value in lower case; the
    // attribute itself is case-insensitive on the wire.
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });

  it("redirects to a url destination, keeping the utm parameters", async () => {
    fake.settingsRow = {
      ...(fake.settingsRow as Record<string, unknown>),
      links: [
        {
          code: "a7x9k2m4",
          label: "Site",
          destination: "url:https://site.example.com/oferta",
          message: "",
          created_at: "2026-10-29T12:00:00.000Z",
        },
      ],
    };
    const res = await GET(
      request("https://crm.example.com/r/a7x9k2m4?utm_source=instagram&utm_campaign=verao"),
      { params: Promise.resolve({ code: "a7x9k2m4" }) },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("https://site.example.com/oferta");
    expect(location).toContain("utm_source=instagram");
    expect(location).toContain("utm_campaign=verao");
  });

  it("never redirects to an unknown destination scheme", async () => {
    fake.settingsRow = {
      ...(fake.settingsRow as Record<string, unknown>),
      links: [
        {
          code: "a7x9k2m4",
          label: "Bad",
          destination: "javascript:alert(1)",
          message: "",
          created_at: "2026-10-29T12:00:00.000Z",
        },
      ],
    };
    const res = await GET(request("https://crm.example.com/r/a7x9k2m4"), {
      params: Promise.resolve({ code: "a7x9k2m4" }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [x] **Step 2: Rode o teste e veja falhar**

Run: `npx vitest run "src/app/r/[code]/route.test.ts"`

Expected: FAIL com "Cannot find module './route'".

- [x] **Step 3: Escreva `src/app/r/[code]/route.ts`**

```ts
// ============================================================
// The campaign link.
//
// The link that goes into the ad: `/r/a7x9k2m4?utm_source=...`.
//
// Every click is a touch: a pending origin is written, a fresh
// 8-character code is minted for THAT click, and the code is
// appended to the prefilled WhatsApp message. The code is what ties
// the click to the first inbound message — cookies do not cross the
// boundary between the browser and WhatsApp.
//
// The cookie is written too, but only when it is not there yet: the
// FIRST touch wins.
// ============================================================

import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/leads/admin-client'
import { generateUniqueLeadToken } from '@/lib/leads/origin'
import { createLeadOriginStore, createLeadSettingsStore } from '@/lib/leads/store'
import {
  FIRST_TOUCH_COOKIE,
  FIRST_TOUCH_COOKIE_MAX_AGE_DAYS,
  encodeFirstTouch,
  parseTouch,
  type FirstTouchPayload,
} from '@/lib/leads/utm'
import type { CampaignLink } from '@/lib/leads/types'

/** A campaign code: lowercase letters and digits. */
function normalizeCode(raw: string): string | null {
  const code = raw.trim().toLowerCase()
  if (!/^[a-z0-9]{4,32}$/.test(code)) return null
  return code
}

/** Where a `wa:` link goes. */
function whatsappUrl(destination: string, message: string, token: string): string | null {
  const number = destination.slice(3).replace(/\D/g, '')
  if (!number) return null
  const text = `${message} ref ${token}`.trim()
  // URLSearchParams encodes the space as "+", which is what wa.me
  // expects for a prefilled message.
  const params = new URLSearchParams()
  params.set('text', text)
  return `https://wa.me/${number}?${params.toString()}`
}

/** Where a `url:` link goes, with the utm parameters kept. */
function urlDestination(destination: string, search: string): string | null {
  const raw = destination.slice(4).trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const params = new URLSearchParams(search)
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const value = params.get(key)
    if (value) url.searchParams.set(key, value)
  }
  return url.toString()
}

function cookieHeader(value: string): string {
  const maxAge = FIRST_TOUCH_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60
  return `${FIRST_TOUCH_COOKIE}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params
  const code = normalizeCode(rawCode)
  if (!code) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const db = supabaseAdmin()
  const settingsStore = createLeadSettingsStore(db)
  const settings = await settingsStore.findByLinkCode(code)
  if (!settings || !settings.enabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const link = (settings.links as CampaignLink[]).find(
    (candidate) => candidate.code === code,
  )
  if (!link) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const touch = parseTouch(url.search)
  const touchedAt = new Date().toISOString()

  const store = createLeadOriginStore(db)
  const leadToken = await generateUniqueLeadToken(store, settings.account_id)

  await store.insertOrigin({
    account_id: settings.account_id,
    contact_id: null,
    channel: 'web',
    provider: 'web',
    utm_source: touch.utm_source,
    utm_medium: touch.utm_medium,
    utm_campaign: touch.utm_campaign,
    utm_content: touch.utm_content,
    utm_term: touch.utm_term,
    landing_path: `/r/${code}`,
    referrer: request.headers.get('referer'),
    click_ids: touch.click_ids,
    ad_id: null,
    adset_id: null,
    campaign_id: null,
    creative_id: null,
    post_id: null,
    external_id: null,
    lead_token: leadToken,
    link_code: code,
    phone: null,
    is_primary: false,
    touched_at: touchedAt,
    meta: { label: link.label, destination: link.destination },
  })

  const destination = link.destination.startsWith('wa:')
    ? whatsappUrl(link.destination, link.message ?? '', leadToken)
    : link.destination.startsWith('url:')
      ? urlDestination(link.destination, url.search)
      : null

  if (!destination) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const cookie: FirstTouchPayload = {
    ...touch,
    link_code: code,
    lead_token: leadToken,
    touched_at: touchedAt,
  }

  const response = NextResponse.redirect(destination, 302)
  response.cookies.set({
    name: FIRST_TOUCH_COOKIE,
    value: encodeFirstTouch(cookie),
    maxAge: FIRST_TOUCH_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
    path: '/',
    sameSite: 'lax',
  })
  return response
}
```

- [x] **Step 4: Rode o teste e veja passar**

Run: `npx vitest run "src/app/r/[code]/route.test.ts"`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add "src/app/r"
git commit -m "feat(leads): link de campanha /r/<code>"
```

---

### Task 5: O gancho no inbound — Meta e whatsmiau

**Files:**
- Modify: `src/app/api/whatsapp/webhook/route.ts`
- Modify: `src/lib/whatsapp/providers/whatsmiau/inbound.ts`
- Create: `src/lib/leads/inbound.ts`

**Interfaces:**
- Consumes: `resolveOrigin` (de `origin.ts`), `createLeadOriginStore` (de `store.ts`), `extractLeadToken` (de `token.ts`).
- Produces: `stripLeadCode(text)` → `{ token, text }` (de `@/lib/leads/inbound`), `referralFromMetaMessage(message)` → `ReferralFacts | null` (de `@/lib/leads/inbound`).
- Produces: o `referral` no tipo `WhatsAppMessage` do webhook Meta.

- [x] **Step 1: Escreva `src/lib/leads/inbound.ts`**

```ts
/**
 * The glue between the inbound pipelines and the lead module.
 *
 * Two providers, one behaviour: the Meta webhook and the whatsmiau
 * provider both call `resolveOrigin` with the same shape.
 */

import type { ReferralFacts } from './origin'
import { extractLeadToken } from './token'

/**
 * The message text, without the lead code.
 *
 * The agent reads the clean text; the raw text goes into
 * `lead_origins.meta.raw_text`.
 */
export function stripLeadCode(text: string | null | undefined): {
  token: string | null
  text: string
} {
  const raw = text ?? ''
  const extracted = extractLeadToken(raw)
  if (!extracted) return { token: null, text: raw }
  return { token: extracted.token, text: extracted.text }
}

/**
 * The ad a Meta message came from.
 *
 * Two envelopes carry it (spec §6.3):
 *
 *   - `referral` — click-to-WhatsApp ads: `ad_id`, `adset_id`,
 *     `campaign_id`, `source`.
 *   - `context.messaging_referral` — a DM that answers an ad: the
 *     same ids plus `post_id` and `ads_metadata`.
 *
 * Today NEITHER is read anywhere in the app — the referral of an ad
 * is exactly the origin the CRM was missing.
 */
export function referralFromMetaMessage(message: {
  referral?: Record<string, unknown> | null
  context?: { messaging_referral?: Record<string, unknown> | null } | null
}): ReferralFacts | null {
  const referral = message.referral ?? message.context?.messaging_referral ?? null
  if (!referral) return null

  const facts: ReferralFacts = {
    ad_id: readString(referral.ad_id),
    adset_id: readString(referral.adset_id),
    campaign_id: readString(referral.campaign_id),
    creative_id: readString(referral.creative_id ?? referral.adcreatives_id),
    post_id: readString(referral.post_id),
    source: readString(referral.source),
    ads_metadata: isRecord(referral.ads_metadata) ? referral.ads_metadata : null,
  }

  const hasAny = Boolean(
    facts.ad_id ||
      facts.adset_id ||
      facts.campaign_id ||
      facts.creative_id ||
      facts.post_id,
  )
  return hasAny ? facts : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}
```

- [x] **Step 2: Escreva o teste que falha — `src/lib/leads/inbound.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { referralFromMetaMessage, stripLeadCode } from "./inbound";

describe("stripLeadCode", () => {
  it("removes the code and keeps the rest", () => {
    expect(stripLeadCode("Olá ref A7X9K2M4")).toEqual({
      token: "A7X9K2M4",
      text: "Olá",
    });
  });

  it("leaves a message without a code alone", () => {
    expect(stripLeadCode("Olá")).toEqual({ token: null, text: "Olá" });
  });

  it("handles an empty message", () => {
    expect(stripLeadCode(null)).toEqual({ token: null, text: "" });
  });
});

describe("referralFromMetaMessage", () => {
  it("reads the click-to-WhatsApp referral", () => {
    const facts = referralFromMetaMessage({
      referral: {
        source: "facebook",
        ad_id: "ad-1",
        adset_id: "adset-1",
        campaign_id: "camp-1",
      },
    });
    expect(facts?.ad_id).toBe("ad-1");
    expect(facts?.campaign_id).toBe("camp-1");
    expect(facts?.source).toBe("facebook");
  });

  it("reads the messaging referral of a DM that answers an ad", () => {
    const facts = referralFromMetaMessage({
      context: {
        messaging_referral: {
          ad_id: "ad-2",
          post_id: "post-2",
          ads_metadata: { ad_campaign_id: 123 },
        },
      },
    });
    expect(facts?.post_id).toBe("post-2");
    expect(facts?.ads_metadata).toEqual({ ad_campaign_id: 123 });
  });

  it("returns null when there is no referral", () => {
    expect(referralFromMetaMessage({})).toBeNull();
  });

  it("returns null when the referral carries no ad id", () => {
    expect(referralFromMetaMessage({ referral: { source: "facebook" } })).toBeNull();
  });
});
```

- [x] **Step 3: Rode o teste e see it fail, then pass**

Run: `npx vitest run src/lib/leads/inbound.test.ts`

Expected: PASS (o arquivo foi criado no Step 1 com o código completo).

- [x] **Step 4: Ligue o gancho no webhook da Meta**

Em `src/app/api/whatsapp/webhook/route.ts`:

**(a)** acrescente o `referral` ao tipo `WhatsAppMessage`, logo depois de `context?`:

```ts
  /**
   * The ad this message came from. TWO envelopes carry it:
   *
   *   - `referral` — a click-to-WhatsApp ad (`ad_id`, `adset_id`,
   *     `campaign_id`, `source`).
   *   - `context.messaging_referral` — a DM that answers an ad (the
   *     same ids plus `post_id` and `ads_metadata`).
   *
   * Neither was read anywhere before — the referral of an ad is
   * exactly the origin the CRM was missing.
   */
  referral?: {
    source?: string
    ad_id?: string
    adset_id?: string
    campaign_id?: string
    creative_id?: string
    adcreatives_id?: string
    post_id?: string
    ads_metadata?: Record<string, unknown>
  }
```

e estenda o `context`:

```ts
  /** Present when the customer swipe-replies to one of our messages. */
  context?: {
    id: string
    /** The ad this reply answers. See `referral` above. */
    messaging_referral?: {
      ad_id?: string
      adset_id?: string
      campaign_id?: string
      creative_id?: string
      post_id?: string
      ads_metadata?: Record<string, unknown>
    }
  }
```

**(b)** importe o gancho no topo do arquivo:

```ts
import { referralFromMetaMessage, stripLeadCode } from '@/lib/leads/inbound'
import { resolveOrigin } from '@/lib/leads/origin'
import { createLeadOriginStore } from '@/lib/leads/store'
```

**(c)** em `processMessage`, logo depois do bloco que resolve o `replyToInternalId` e **antes** do `upsert` de `messages`, acrescente:

```ts
  // The lead code. The agent must NOT see `ref A7X9K2M4` — the CRM
  // strips it and keeps the raw text in the origin. The strip happens
  // BEFORE the insert so the bubble the agent reads is already clean.
  const rawContentText = contentText
  const stripped = stripLeadCode(rawContentText)
  const agentText = stripped.text
```

**(d)** troque, no `upsert` de `messages`, `content_text: contentText,` por `content_text: agentText,`.

**(e)** no `rpc('bump_conversation_on_inbound', ...)`, troque `p_last_message_text: contentText || \`[${message.type}]\`,` por `p_last_message_text: agentText || \`[${message.type}]\`,`.

**(f)** logo DEPOIS do bloco `if (!insertedRows || insertedRows.length === 0) { ... return }` — o gancho de origem fica depois da fronteira de idempotência, para uma reentrega do Meta não duplicar a origem — acrescente:

```ts
  // Where this lead came from. AFTER the idempotency boundary: a
  // replayed delivery must not write a second origin.
  try {
    await resolveOrigin(createLeadOriginStore(supabaseAdmin()), {
      accountId,
      contactId: contactRecord.id,
      provider: 'meta',
      channel: 'whatsapp',
      phone: message.from ? normalizePhone(message.from) : null,
      leadToken: stripped.token,
      rawText: rawContentText,
      referral: referralFromMetaMessage(message),
      touchedAt: receivedAt,
    })
  } catch (originError) {
    // A failure here must not lose the message — the message is
    // already stored. The origin is recreated by the next touch.
    console.error('[webhook] could not record the lead origin:', originError)
  }
```

- [x] **Step 5: Ligue o gancho no inbound do whatsmiau**

Em `src/lib/whatsapp/providers/whatsmiau/inbound.ts`:

**(a)** importe:

```ts
import { stripLeadCode } from '@/lib/leads/inbound';
import { resolveOrigin } from '@/lib/leads/origin';
import { createLeadOriginStore } from '@/lib/leads/store';
```

**(b)** logo depois de `const contentText = ...` (o bloco que define `contentText`), acrescente:

```ts
  // The lead code — the agent reads the clean text. See the Meta
  // webhook for the full story.
  const rawContentText = contentText;
  const stripped = stripLeadCode(rawContentText);
  const agentText = stripped.text;
```

**(c)** no `upsert` de `messages`, troque `content_text: contentText,` por `content_text: agentText,`.

**(d)** troque as uses de `contentText` que sobraram, para que o texto limpo seja o que o agente lê:

| lugar | antes | depois |
|---|---|---|
| `rpc('bump_conversation_on_inbound', ...)` | `p_last_message_text: contentText \|\| \`[${message.kind}]\`,` | `p_last_message_text: agentText \|\| \`[${message.kind}]\`,` |
| `dispatchInboundToFlows` (reply) | `reply_title: contentText ?? '',` | `reply_title: agentText,` |
| `dispatchInboundToFlows` (texto) | `text: contentText ?? '',` | `text: agentText,` |
| `const inboundText = contentText ?? ''` | `const inboundText = contentText ?? ''` | `const inboundText = agentText` |
| `dispatchWebhookEvent(... 'message.received')` | `text: contentText,` | `text: agentText,` |

O `contentText` cru continua vivo em `rawContentText` — é ele que vai para `lead_origins.meta.raw_text`.

**(e)** logo DEPOIS do bloco `if (!insertedRows || insertedRows.length === 0) { ... return }` — o gancho de origem fica depois da fronteira de idempotência, para uma reentrega do provider não duplicar a origem — acrescente:

```ts
  // Where this lead came from. AFTER the idempotency boundary: a
  // replayed delivery must not write a second origin.
  //
  // whatsmiau does not expose the ad that produced the message, so
  // there is no referral here — the code in the text and the phone
  // number are the two bridges back to the click.
  try {
    await resolveOrigin(createLeadOriginStore(ctx.db), {
      accountId,
      contactId: contactOutcome.contact.id,
      provider: 'whatsmiau',
      channel: 'whatsapp',
      phone,
      leadToken: stripped.token,
      rawText: rawContentText,
      referral: null,
      touchedAt: receivedAt,
    })
  } catch (originError) {
    // A failure here must not lose the message — the message is
    // already stored. The origin is recreated by the next touch.
    console.error('[whatsmiau] could not record the lead origin:', originError)
  }
```

**Nota:** o import do Step 5(a) é apenas `stripLeadCode` — o `referralFromMetaMessage` é específico da Meta e não é usado neste arquivo (import não usado quebra o lint).

- [x] **Step 6: Rode os testes**

Run: `npx vitest run src/lib/leads/`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/lib/leads/inbound.ts src/lib/leads/inbound.test.ts src/app/api/whatsapp/webhook/route.ts src/lib/whatsapp/providers/whatsmiau/inbound.ts
git commit -m "feat(leads): registra a origem do lead no inbound de Meta e whatsmiau"
```

---

### Task 6: A UI — o badge da origem, a jornada e o painel de configurações

**Files:**
- Create: `src/app/api/leads/settings/route.ts`
- Create: `src/app/api/leads/origins/route.ts`
- Create: `src/components/leads/lead-origin-badge.tsx`
- Create: `src/components/settings/lead-origin-settings.tsx`
- Modify: `src/lib/leads/token.ts` — `generateCaptureKey()`
- Modify: `src/lib/leads/store.ts` — `update()` leva o `capture_key`
- Modify: `src/components/settings/settings-sections.ts` — nova seção `'leads'`
- Modify: `src/components/settings/settings-page-client.tsx` — registra o painel
- Modify: `src/components/contacts/contact-detail-view.tsx` — badge no card do contato
- Modify: `src/components/inbox/contact-sidebar.tsx` — badge no painel do inbox
- Modify: `messages/en.json`, `messages/pt.json`, `messages/es.json`, `messages/ko.json`

**Interfaces:**
- Consumes: `LeadSettings`, `CampaignLink`, `LeadOriginRow` (de `@/lib/leads/types`); `createLeadSettingsStore` (de `@/lib/leads/store`); `generateLeadToken` (de `@/lib/leads/token`).
- Produces: `GET /api/leads/settings` → `LeadSettingsResponse` (viewer); `PUT /api/leads/settings` → `LeadSettingsResponse` (admin).
- Produces: `GET /api/leads/origins?contactId=<uuid>` → `{ origins: LeadOriginRow[] }` (viewer).
- Produces: `LeadOriginBadge({ contactId, compact })` — a linha compacta + a Sheet da jornada.

> **Nota de rota nova:** `src/app/api/leads/origins/route.ts` não estava no "Mapa de arquivos" do topo do plano. Ele é necessário: o badge é account-scoped e não pode ler `lead_origins` direto do browser sem uma rota que aplique o escopo da conta.

- [x] **Step 1: `generateCaptureKey()` em `src/lib/leads/token.ts`**

Acrescente no fim do arquivo:

```ts
/**
 * The public capture key.
 *
 * It says WHICH account a click belongs to — it does NOT authenticate
 * against anything. The capture endpoint is public by design (the
 * customer's own website calls it from the visitor's browser), so the
 * key has to sit in a `<script data-key="...">` tag.
 *
 * `crypto.randomUUID()` is the Web Crypto API: it works in Node and
 * in the browser, so no `node:crypto` import drags a server-only
 * module into a client bundle.
 */
export function generateCaptureKey(): string {
  return `pk_${crypto.randomUUID().replace(/-/g, '')}`
}
```

- [x] **Step 2: `capture_key` no `update()` de `src/lib/leads/store.ts`**

O `upsert` atual monta o corpo sem `capture_key`, e `capture_key` é `NOT NULL` sem default. O Postgres valida o NOT NULL **antes** do ramo `ON CONFLICT`, então um upsert sem a coluna falha mesmo quando a linha já existe. Troque o método:

```ts
    async update(accountId, patch) {
      const current = await read(accountId);

      // `capture_key` is NOT NULL with no default and Postgres
      // validates it BEFORE the ON CONFLICT branch runs — an upsert
      // that omits it fails even when the row already exists. The
      // current value always travels with the update; on the first
      // save there is no current value, so the patch has to bring one.
      const captureKey = patch.capture_key ?? current?.capture_key;
      if (!captureKey) throw new Error('Lead settings not found');

      const body: Record<string, unknown> = {
        account_id: accountId,
        capture_key: captureKey,
        updated_at: new Date().toISOString(),
      }
      if (patch.enabled !== undefined) body.enabled = patch.enabled
      if (patch.allowed_hosts !== undefined) body.allowed_hosts = patch.allowed_hosts
      if (patch.links !== undefined) body.links = patch.links

      const { data, error } = await db
        .from('lead_settings')
        .upsert(body, { onConflict: 'account_id' })
        .select('*')
        .single()
      if (error) throw error
      return toSettings(data as Record<string, unknown>)
    },
```

A assinatura `update(accountId: string, patch: Partial<LeadSettings>): Promise<LeadSettings>` continua válida — `LeadSettings` já tem `capture_key`.

> **`update` é um UPSERT de verdade.** A primeira versão do plano lia a
> linha atual e lançava `Lead settings not found` quando ela não
> existia — ou seja, na conta que ainda não tinha salvo nada. Como o
> `capture_key` chega no patch (`existing?.capture_key ?? generateCaptureKey()`),
> o upsert cria a linha. `create()` não é chamado pela rota.

- [x] **Step 3: `src/app/api/leads/settings/route.ts`**

```ts
// ============================================================
// The account's lead-origin configuration.
//
// GET is readable by any member: the capture key is PUBLIC by
// design — it sits in the `<script data-key="...">` tag the customer
// pastes into their own website. It identifies the account; it does
// NOT authenticate against it.
//
// PUT is admin-only: it decides where every click of every account
// lands.
//
// The route NEVER returns a credential. The capture key is not one.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { getT } from "@/lib/i18n/translate";
import { createLeadSettingsStore } from "@/lib/leads/store";
import { generateCaptureKey, generateLeadToken } from "@/lib/leads/token";
import type { CampaignLink, LeadSettings } from "@/lib/leads/types";

const t = getT("Api");

/** What the browser is allowed to see. */
export interface LeadSettingsResponse {
  /** Is the account configured yet? */
  configured: boolean;
  capture_key: string | null;
  enabled: boolean;
  allowed_hosts: string[];
  links: CampaignLink[];
}

function toResponse(settings: LeadSettings | null): LeadSettingsResponse {
  if (!settings) {
    return {
      configured: false,
      capture_key: null,
      enabled: false,
      allowed_hosts: [],
      links: [],
    };
  }
  return {
    configured: true,
    capture_key: settings.capture_key,
    enabled: settings.enabled,
    allowed_hosts: settings.allowed_hosts,
    links: settings.links,
  };
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole("viewer");

    const store = createLeadSettingsStore(supabase);
    const settings = await store.read(accountId);

    return NextResponse.json(toResponse(settings));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole("admin");

    const body = (await request.json().catch(() => null)) as {
      enabled?: unknown;
      allowed_hosts?: unknown;
      links?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json(
        { error: t("common.invalidRequestBody") },
        { status: 400 },
      );
    }

    const enabled = body.enabled === true;

    const allowedHosts = normalizeHosts(body.allowed_hosts);
    if (!allowedHosts) {
      return NextResponse.json(
        { error: t("common.invalidRequestBody") },
        { status: 400 },
      );
    }

    const links = normalizeLinks(body.links);
    if (!links) {
      return NextResponse.json(
        { error: t("common.invalidRequestBody") },
        { status: 400 },
      );
    }

    const store = createLeadSettingsStore(supabase);
    const existing = await store.read(accountId);
    const captureKey = existing?.capture_key ?? generateCaptureKey();

    const updated = await store.update(accountId, {
      capture_key: captureKey,
      enabled,
      allowed_hosts: allowedHosts,
      links,
    });

    return NextResponse.json(toResponse(updated));
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * The allowlist of hosts, lowercased and without protocol or path.
 *
 * Empty = any host may call the public endpoint.
 *
 * @returns the hosts, or null when the payload is not a list of
 * strings.
 */
function normalizeHosts(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  const hosts: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const host = normalizeHost(item);
    if (!host) continue;
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/**
 * `https://Site.com.br/oferta` → `site.com.br`.
 *
 * The browser sends the full URL in the `Origin` header, so the
 * allowlist has to compare the bare host.
 */
function normalizeHost(value: string): string | null {
  let host = value.trim().toLowerCase();
  if (!host) return null;
  host = host.replace(/^https?:\/\//, "");
  host = host.split("/")[0];
  host = host.split(":")[0];
  if (!host) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  return host;
}

/**
 * The campaign links.
 *
 * `wa:<number>` and `url:<https://...>` are the only two
 * destinations — the redirect route refuses anything else, and the
 * validation here refuses it before it is ever stored.
 *
 * @returns the links, or null when the payload is not a valid list.
 */
function normalizeLinks(value: unknown): CampaignLink[] | null {
  if (!Array.isArray(value)) return null;

  const links: CampaignLink[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const row = item as Record<string, unknown>;

    const destination = normalizeDestination(row.destination);
    if (!destination) return null;

    const label =
      typeof row.label === "string" ? row.label.trim().slice(0, 120) : "";
    const message =
      typeof row.message === "string" ? row.message.trim().slice(0, 500) : "";

    const code = normalizeLinkCode(row.code, seen);
    if (!code) return null;
    seen.add(code);

    links.push({
      code,
      label,
      destination,
      message,
      created_at:
        typeof row.created_at === "string" && row.created_at
          ? row.created_at
          : new Date().toISOString(),
    });
  }

  return links;
}

/**
 * The code of a link. A new link has none, so one is generated — and
 * regenerated if it collides with a code already in this list.
 */
function normalizeLinkCode(
  value: unknown,
  seen: ReadonlySet<string>,
): string | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw) {
    if (!/^[a-z0-9]{4,32}$/.test(raw)) return null;
    return seen.has(raw) ? null : raw;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateLeadToken().toLowerCase();
    if (!seen.has(candidate)) return candidate;
  }
  return null;
}

/**
 * `wa:5511999999999` or `url:https://site.com/oferta`.
 *
 * Anything else — `javascript:`, `data:`, a bare phone number — is
 * refused. The redirect route has the same rule; this is the first
 * of the two.
 */
function normalizeDestination(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  if (raw.startsWith("wa:")) {
    const number = raw.slice(3).replace(/[^0-9]/g, "");
    if (!/^[1-9]\d{6,14}$/.test(number)) return null;
    return `wa:${number}`;
  }

  if (raw.startsWith("url:")) {
    const url = raw.slice(4).trim();
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return null;
      }
      return `url:${url}`;
    } catch {
      return null;
    }
  }

  return null;
}
```

- [x] **Step 4: `src/app/api/leads/origins/route.ts`**

```ts
// ============================================================
// The journey of ONE contact.
//
// GET /api/leads/origins?contactId=<uuid>
//
// Account-scoped twice over: the query carries `account_id`, and the
// table's RLS only lets a member read their own account's rows. A
// contact from another account has no journey here — the endpoint
// never reveals that the contact exists somewhere else.
//
// The `lead_origins` table has NO write policy: the service role
// writes it, the members read it.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { getT } from "@/lib/i18n/translate";
import type { LeadOriginRow } from "@/lib/leads/types";

const t = getT("Api");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole("viewer");

    const contactId =
      new URL(request.url).searchParams.get("contactId")?.trim() ?? "";
    if (!UUID_RE.test(contactId)) {
      return NextResponse.json(
        { error: t("common.invalidRequestBody") },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("lead_origins")
      .select("*")
      .eq("account_id", accountId)
      .eq("contact_id", contactId)
      .order("touched_at", { ascending: true });

    if (error) {
      console.error("[leads/origins] query error:", error);
      return NextResponse.json(
        { error: t("common.internalServerError") },
        { status: 500 },
      );
    }

    const origins = (data ?? []) as LeadOriginRow[];
    return NextResponse.json({ origins });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [x] **Step 5: `src/components/leads/lead-origin-badge.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Route, Target } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { LeadOriginRow } from "@/lib/leads/types";

/**
 * Where this lead came from.
 *
 * One compact line — the origin, the campaign and the date — plus a
 * chip that opens the FULL journey in a sheet: every touch, from the
 * first click to the last message.
 *
 * The badge says nothing when there is no origin: most contacts did
 * not come from a campaign, and an empty chip would be noise.
 */
export function LeadOriginBadge({
  contactId,
  compact = false,
}: {
  contactId: string;
  compact?: boolean;
}) {
  const t = useTranslations("Leads");
  const locale = useLocale();

  const [origins, setOrigins] = useState<LeadOriginRow[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchOrigins(): Promise<LeadOriginRow[]> {
      try {
        const response = await fetch(
          `/api/leads/origins?contactId=${encodeURIComponent(contactId)}`,
        );
        if (!response.ok) return [];
        const body = (await response.json()) as { origins?: LeadOriginRow[] };
        return Array.isArray(body.origins) ? body.origins : [];
      } catch {
        // A failed load must not break the contact card: the badge
        // simply does not show up.
        return [];
      }
    }

    void fetchOrigins().then((rows) => {
      if (!cancelled) setOrigins(rows);
    });

    return () => {
      cancelled = true;
    };
  }, [contactId]);

  if (!origins || origins.length === 0) return null;

  const primary = origins.find((origin) => origin.is_primary) ?? origins[0];
  const campaign =
    primary.utm_campaign ?? primary.campaign_id ?? primary.external_id ?? null;
  const date = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(primary.touched_at));

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <Target className="size-3.5 shrink-0 text-primary" />
      {compact ? null : (
        <span className="truncate">
          {t("origin")}: {t(`channel.${primary.channel}`)}
          {campaign ? ` · ${campaign}` : ""} · {date}
        </span>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted">
          <Route className="size-3" />
          {compact
            ? (campaign ?? t(`channel.${primary.channel}`))
            : t("journey", { count: origins.length })}
        </SheetTrigger>
        <SheetContent side="right" className="sm:max-w-md!">
          <SheetHeader>
            <SheetTitle>{t("journeyTitle")}</SheetTitle>
            <SheetDescription>{t("journeyDescription")}</SheetDescription>
          </SheetHeader>

          <div className="overflow-y-auto px-4 pb-4">
            <ol className="space-y-4">
              {origins.map((origin) => (
                <li key={origin.id} className="border-l border-border pl-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {t(`channel.${origin.channel}`)}
                    </span>
                    {origin.is_primary ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {t("primary")}
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(origin.touched_at))}
                    </span>
                  </div>

                  <dl className="mt-1.5 space-y-0.5 text-xs">
                    <OriginRow label={t("fields.campaign")} value={origin.utm_campaign} />
                    <OriginRow label={t("fields.ad")} value={origin.ad_id} />
                    <OriginRow label={t("fields.post")} value={origin.post_id} />
                    <OriginRow label={t("fields.utmSource")} value={origin.utm_source} />
                    <OriginRow label={t("fields.utmMedium")} value={origin.utm_medium} />
                    <OriginRow label={t("fields.utmContent")} value={origin.utm_content} />
                    <OriginRow label={t("fields.landingPath")} value={origin.landing_path} />
                    <OriginRow label={t("fields.referrer")} value={origin.referrer} />
                    <OriginRow label={t("fields.link")} value={origin.link_code} />
                  </dl>
                </li>
              ))}
            </ol>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** One labelled value of the journey — nothing renders for a null. */
function OriginRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="min-w-0 break-all text-foreground">{value}</dd>
    </div>
  );
}
```

> **Duas correções na implementação:**
>
> 1. O `fetch` ficou DENTRO do efeito (com a flag `cancelled`) em vez de
>    um `useCallback` separado. A regra `react-hooks/set-state-in-effect`
>    do `eslint-config-next` é **erro** (não aviso): ela acusa o
>    `void load()` porque o `load` chama `setState`. O `setState` dentro
>    de um `.then()` não é síncrono no corpo do efeito e a regra
>    passa.
> 2. O prop `compact` precisa ser USADO — a regra `no-unused-vars`
>    quebra o build com um prop declarado e nunca lido. Na versão
>    compacta (a barra do inbox, que é estreita) o chip mostra a
>    campanha; na versão cheia, o chip mostra a contagem da jornada.

- [x] **Step 6: `src/components/settings/lead-origin-settings.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Loader2,
  Plus,
  Target,
  Trash2,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsPanelHead } from "@/components/settings/settings-panel-head";
import type { CampaignLink } from "@/lib/leads/types";

/**
 * Where the leads come from.
 *
 * Three things live here:
 *
 *   1. The capture key and the script the customer pastes into their
 *      own site.
 *   2. The campaign links (`/r/<code>`) — a short link that carries
 *      the click all the way to the first WhatsApp message.
 *   3. The allowlist of hosts allowed to call the public endpoint,
 *      and the on/off switch.
 *
 * The capture key is PUBLIC: it is in the script the customer
 * publishes. It is not a credential and it never authenticates
 * against anything.
 */

interface LeadSettingsState {
  configured: boolean;
  capture_key: string | null;
  enabled: boolean;
  allowed_hosts: string[];
  links: CampaignLink[];
}

const EMPTY: LeadSettingsState = {
  configured: false,
  capture_key: null,
  enabled: false,
  allowed_hosts: [],
  links: [],
};

export function LeadOriginSettings() {
  const { canEditSettings, profileLoading } = useAuth();
  const t = useTranslations("Settings.leads");

  const [state, setState] = useState<LeadSettingsState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [hosts, setHosts] = useState<string[]>([]);
  const [links, setLinks] = useState<CampaignLink[]>([]);
  const [hostDraft, setHostDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState("");

  const [newLabel, setNewLabel] = useState("");
  const [newDestination, setNewDestination] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/leads/settings");
      if (!response.ok) {
        toast.error(t("loadFailed"));
        return;
      }
      const body = (await response.json()) as LeadSettingsState;
      setState(body);
      setEnabled(body.enabled);
      setHosts(body.allowed_hosts);
      setLinks(body.links);
    } catch {
      toast.error(t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const disabled = !canEditSettings || profileLoading || state === null;

  const dirty =
    state !== null &&
    (enabled !== state.enabled ||
      hosts.join(",") !== state.allowed_hosts.join(",") ||
      JSON.stringify(links) !== JSON.stringify(state.links));

  async function handleSave() {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const response = await fetch("/api/leads/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, allowed_hosts: hosts, links }),
      });
      if (!response.ok) {
        toast.error(t("saveFailed"));
        return;
      }
      const body = (await response.json()) as LeadSettingsState;
      setState(body);
      setEnabled(body.enabled);
      setHosts(body.allowed_hosts);
      setLinks(body.links);
      toast.success(t("saveSuccess"));
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  function addHost() {
    const host = hostDraft.trim().toLowerCase();
    if (!host) return;
    if (hosts.includes(host)) {
      setHostDraft("");
      return;
    }
    setHosts([...hosts, host]);
    setHostDraft("");
  }

  function addLink() {
    const label = newLabel.trim();
    const destination = newDestination.trim();
    if (!destination) return;
    setLinks([
      ...links,
      {
        code: "",
        label,
        destination,
        message: "",
        created_at: new Date().toISOString(),
      },
    ]);
    setNewLabel("");
    setNewDestination("");
  }

  const scriptSnippet =
    origin && state?.capture_key
      ? `<script src="${origin}/api/leads/track.js" data-key="${state.capture_key}"></script>`
      : "";

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />

      {/* The switch */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Target className="size-4 text-primary" />
            {t("captureTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("captureDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="leads-enabled" className="text-foreground">
              {t("enabled")}
            </Label>
            <Switch
              id="leads-enabled"
              checked={enabled}
              onCheckedChange={(checked: boolean) => setEnabled(checked)}
              disabled={disabled}
            />
          </div>

          {!canEditSettings ? (
            <p className="text-xs text-muted-foreground">{t("adminOnlyHint")}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* The key + the script */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-foreground">{t("scriptTitle")}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("scriptDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="leads-key" className="text-muted-foreground">
              {t("captureKey")}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="leads-key"
                readOnly
                value={state?.capture_key ?? ""}
                placeholder={t("notConfigured")}
                className="font-mono text-xs"
              />
              {state?.capture_key ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copy(state.capture_key as string)}
                  aria-label={t("copyKey")}
                >
                  <Copy className="size-4" />
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{t("keyHint")}</p>
          </div>

          {scriptSnippet ? (
            <div className="grid gap-2">
              <Label htmlFor="leads-script" className="text-muted-foreground">
                {t("script")}
              </Label>
              <div className="flex items-start gap-2">
                <Input
                  id="leads-script"
                  readOnly
                  value={scriptSnippet}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => copy(scriptSnippet)}
                  aria-label={t("copyScript")}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* The campaign links */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-foreground">{t("linksTitle")}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("linksDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {links.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("noLinks")}</p>
          ) : (
            <ul className="space-y-2">
              {links.map((link, index) => (
                <li
                  key={`${link.code}-${index}`}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      {link.label || link.destination}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {origin ? `${origin}/r/${link.code || "…"}` : `/r/${link.code || "…"}`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={!link.code}
                    onClick={() =>
                      copy(`${origin}/r/${link.code}`)
                    }
                    aria-label={t("copyLink")}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    onClick={() =>
                      setLinks(links.filter((_, i) => i !== index))
                    }
                    aria-label={t("removeLink")}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
            <div className="grid gap-2">
              <Label htmlFor="leads-link-label" className="text-muted-foreground">
                {t("linkLabel")}
              </Label>
              <Input
                id="leads-link-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={t("linkLabelPlaceholder")}
                disabled={disabled}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="leads-link-destination" className="text-muted-foreground">
                {t("linkDestination")}
              </Label>
              <Input
                id="leads-link-destination"
                value={newDestination}
                onChange={(e) => setNewDestination(e.target.value)}
                placeholder="wa:5511999999999"
                disabled={disabled}
              />
            </div>
            <Button type="button" variant="outline" onClick={addLink} disabled={disabled}>
              <Plus className="size-4" />
              {t("addLink")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("linkDestinationHint")}</p>
        </CardContent>
      </Card>

      {/* The allowlist */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-foreground">{t("hostsTitle")}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("hostsDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {hosts.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("noHosts")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {hosts.map((host) => (
                <li
                  key={host}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-foreground"
                >
                  {host}
                  <button
                    type="button"
                    onClick={() => setHosts(hosts.filter((h) => h !== host))}
                    disabled={disabled}
                    aria-label={t("removeHost")}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-end gap-2">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="leads-host" className="text-muted-foreground">
                {t("addHost")}
              </Label>
              <Input
                id="leads-host"
                value={hostDraft}
                onChange={(e) => setHostDraft(e.target.value)}
                placeholder="site.com.br"
                disabled={disabled}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addHost();
                  }
                }}
              />
            </div>
            <Button type="button" variant="outline" onClick={addHost} disabled={disabled}>
              <Plus className="size-4" />
              {t("addHost")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {canEditSettings ? (
        <Button onClick={handleSave} disabled={saving || !dirty}>
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t("saving")}
            </>
          ) : (
            t("save")
          )}
        </Button>
      ) : null}
    </section>
  );
}
```

> **`Check` não é usado** — tire o import `Check` do bloco acima antes de salvar o arquivo (o lint `@typescript-eslint/no-unused-vars` quebra o build).

- [x] **Step 7: registre a seção em `src/components/settings/settings-sections.ts`**

Acrescente `'leads'` em `SETTINGS_SECTIONS` (entre `'media'` e `'members'`):

```ts
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'whatsapp',
  'templates',
  'quick-replies',
  'inbox',
  'fields',
  'deals',
  'media',
  'leads',
  'members',
  'api',
] as const;
```

Acrescente o `Target` no import de `lucide-react` e a entrada em `SECTION_META`:

```ts
  leads: { id: 'leads', label: 'Lead origin', icon: Target, group: 'workspace' },
```

- [x] **Step 8: registre o painel em `src/components/settings/settings-page-client.tsx`**

Importe e registre:

```tsx
import { LeadOriginSettings } from '@/components/settings/lead-origin-settings';
```

```tsx
    media: <MediaSettings />,
    leads: <LeadOriginSettings />,
    members: <MembersTab />,
```

- [x] **Step 9: o badge nas duas superfícies**

**Em `src/components/contacts/contact-detail-view.tsx`:** importe e monte logo abaixo do cabeçalho (depois do bloco `</SheetHeader>`, antes de `<Tabs`):

```tsx
import { LeadOriginBadge } from '@/components/leads/lead-origin-badge';
```

```tsx
            <div className="px-4 pt-3">
              <LeadOriginBadge contactId={contact.id} />
            </div>
```

**Em `src/components/inbox/contact-sidebar.tsx`:** importe e monte logo abaixo do nome do contato (depois do bloco que renderiza `displayName` / `contact.company`):

```tsx
import { LeadOriginBadge } from '@/components/leads/lead-origin-badge';
```

```tsx
          <div className="mt-2 flex justify-center px-1">
            <LeadOriginBadge contactId={contact.id} compact />
          </div>
```

> O bloco do contato no inbox é **centralizado** (`items-center
> text-center`), então o badge entra centralizado também.

- [x] **Step 10: as strings**

Acrescente o namespace `Leads` e o bloco `Settings.leads` em `messages/en.json`, `messages/pt.json`, `messages/es.json` e `messages/ko.json`.

`messages/en.json`:

```json
  "Leads": {
    "origin": "Origin",
    "primary": "First touch",
    "journey": "journey ({count})",
    "journeyTitle": "Lead journey",
    "journeyDescription": "Every touch this lead had with you, from the first click to the last message.",
    "channel": {
      "whatsapp": "WhatsApp",
      "instagram_dm": "Instagram DM",
      "instagram_comment": "Instagram comment",
      "tiktok_dm": "TikTok DM",
      "tiktok_lead": "TikTok lead",
      "web": "Web",
      "direct": "Direct"
    },
    "fields": {
      "campaign": "Campaign",
      "ad": "Ad",
      "post": "Post",
      "utmSource": "Source",
      "utmMedium": "Medium",
      "utmContent": "Content",
      "landingPath": "Landing page",
      "referrer": "Referrer",
      "link": "Link"
    }
  }
```

`Settings.leads`:

```json
    "leads": {
      "title": "Lead origin",
      "description": "Where your leads come from: the campaign that brought them, the ad they saw and the page they landed on.",
      "captureTitle": "Capture",
      "captureDescription": "Turn the capture on to start recording where each lead came from.",
      "enabled": "Record the origin of every lead",
      "scriptTitle": "Script for your site",
      "scriptDescription": "Paste this at the end of the pages where people arrive. It records the campaign parameters and remembers the first visit.",
      "captureKey": "Capture key",
      "keyHint": "The key is public — it identifies your account and grants no access. It is safe to publish.",
      "notConfigured": "Save once to generate your key",
      "script": "Tag",
      "copyKey": "Copy the capture key",
      "copyScript": "Copy the tag",
      "linksTitle": "Campaign links",
      "linksDescription": "A short link that carries the click all the way to the first message. The destination is a WhatsApp number (wa:5511999999999) or a URL (url:https://your.site/offer).",
      "noLinks": "No campaign links yet.",
      "addLink": "Add link",
      "linkLabel": "Label",
      "linkLabelPlaceholder": "Summer ad",
      "linkDestination": "Destination",
      "linkDestinationHint": "Only the wa: and url: destinations are accepted — a WhatsApp number or an https link.",
      "copyLink": "Copy the link",
      "removeLink": "Remove the link",
      "hostsTitle": "Allowed domains",
      "hostsDescription": "Which sites may report a click. Empty accepts any site.",
      "noHosts": "Any site can report a click.",
      "addHost": "Add domain",
      "removeHost": "Remove the domain",
      "save": "Save",
      "saving": "Saving...",
      "saveSuccess": "Lead origin settings updated",
      "saveFailed": "Couldn't save the lead origin settings",
      "loadFailed": "Couldn't load the lead origin settings",
      "copied": "Copied",
      "copyFailed": "Couldn't copy",
      "adminOnlyHint": "Only account admins can change the lead origin settings."
    }
```

`messages/pt.json`:

```json
  "Leads": {
    "origin": "Origem",
    "primary": "Primeiro toque",
    "journey": "jornada ({count})",
    "journeyTitle": "Jornada do lead",
    "journeyDescription": "Todos os toques deste lead com você, do primeiro clique até a última mensagem.",
    "channel": {
      "whatsapp": "WhatsApp",
      "instagram_dm": "DM do Instagram",
      "instagram_comment": "Comentário do Instagram",
      "tiktok_dm": "DM do TikTok",
      "tiktok_lead": "Lead do TikTok",
      "web": "Site",
      "direct": "Direto"
    },
    "fields": {
      "campaign": "Campanha",
      "ad": "Anúncio",
      "post": "Publicação",
      "utmSource": "Origem",
      "utmMedium": "Mídia",
      "utmContent": "Conteúdo",
      "landingPath": "Página",
      "referrer": "Referenciador",
      "link": "Link"
    }
  }
```

```json
    "leads": {
      "title": "Origem dos leads",
      "description": "De onde vêm seus leads: a campanha que trouxe, o anúncio que viram e a página em que caíram.",
      "captureTitle": "Captura",
      "captureDescription": "Ative a captura para começar a registrar de onde veio cada lead.",
      "enabled": "Registrar a origem de cada lead",
      "scriptTitle": "Script para o seu site",
      "scriptDescription": "Cole no fim das páginas por onde as pessoas chegam. Ele registra os parâmetros de campanha e lembra a primeira visita.",
      "captureKey": "Chave de captura",
      "keyHint": "A chave é pública — ela identifica a sua conta e não dá acesso a nada. Pode publicar.",
      "notConfigured": "Salve uma vez para gerar a sua chave",
      "script": "Tag",
      "copyKey": "Copiar a chave de captura",
      "copyScript": "Copiar a tag",
      "linksTitle": "Links de campanha",
      "linksDescription": "Um link curto que leva o clique até a primeira mensagem. O destino é um número de WhatsApp (wa:5511999999999) ou uma URL (url:https://seu.site/oferta).",
      "noLinks": "Nenhum link de campanha ainda.",
      "addLink": "Adicionar link",
      "linkLabel": "Rótulo",
      "linkLabelPlaceholder": "Anúncio de verão",
      "linkDestination": "Destino",
      "linkDestinationHint": "Só os destinos wa: e url: são aceitos — um número de WhatsApp ou um link https.",
      "copyLink": "Copiar o link",
      "removeLink": "Remover o link",
      "hostsTitle": "Domínios permitidos",
      "hostsDescription": "Quais sites podem reportar um clique. Vazio aceita qualquer site.",
      "noHosts": "Qualquer site pode reportar um clique.",
      "addHost": "Adicionar domínio",
      "removeHost": "Remover o domínio",
      "save": "Salvar",
      "saving": "Salvando...",
      "saveSuccess": "Configurações de origem dos leads atualizadas",
      "saveFailed": "Não foi possível salvar as configurações de origem dos leads",
      "loadFailed": "Não foi possível carregar as configurações de origem dos leads",
      "copied": "Copiado",
      "copyFailed": "Não foi possível copiar",
      "adminOnlyHint": "Só administradores da conta podem mudar as configurações de origem dos leads."
    }
```

`messages/es.json`:

```json
  "Leads": {
    "origin": "Origen",
    "primary": "Primer toque",
    "journey": "recorrido ({count})",
    "journeyTitle": "Recorrido del lead",
    "journeyDescription": "Cada contacto que este lead tuvo contigo, desde el primer clic hasta el último mensaje.",
    "channel": {
      "whatsapp": "WhatsApp",
      "instagram_dm": "DM de Instagram",
      "instagram_comment": "Comentario de Instagram",
      "tiktok_dm": "DM de TikTok",
      "tiktok_lead": "Lead de TikTok",
      "web": "Web",
      "direct": "Directo"
    },
    "fields": {
      "campaign": "Campaña",
      "ad": "Anuncio",
      "post": "Publicación",
      "utmSource": "Origen",
      "utmMedium": "Medio",
      "utmContent": "Contenido",
      "landingPath": "Página",
      "referrer": "Referente",
      "link": "Enlace"
    }
  }
```

```json
    "leads": {
      "title": "Origen de los leads",
      "description": "De dónde vienen tus leads: la campaña que los trajo, el anuncio que vieron y la página donde aterrizaron.",
      "captureTitle": "Captura",
      "captureDescription": "Activa la captura para empezar a registrar de dónde viene cada lead.",
      "enabled": "Registrar el origen de cada lead",
      "scriptTitle": "Script para tu sitio",
      "scriptDescription": "Pega al final de las páginas por donde llegan las personas. Registra los parámetros de campaña y recuerda la primera visita.",
      "captureKey": "Clave de captura",
      "keyHint": "La clave es pública — identifica tu cuenta y no da acceso a nada. Es seguro publicarla.",
      "notConfigured": "Guarda una vez para generar tu clave",
      "script": "Etiqueta",
      "copyKey": "Copiar la clave de captura",
      "copyScript": "Copiar la etiqueta",
      "linksTitle": "Enlaces de campaña",
      "linksDescription": "Un enlace corto que lleva el clic hasta el primer mensaje. El destino es un número de WhatsApp (wa:5511999999999) o una URL (url:https://tu.site/oferta).",
      "noLinks": "Todavía no hay enlaces de campaña.",
      "addLink": "Añadir enlace",
      "linkLabel": "Etiqueta",
      "linkLabelPlaceholder": "Anuncio de verano",
      "linkDestination": "Destino",
      "linkDestinationHint": "Solo se aceptan los destinos wa: y url: — un número de WhatsApp o un enlace https.",
      "copyLink": "Copiar el enlace",
      "removeLink": "Quitar el enlace",
      "hostsTitle": "Dominios permitidos",
      "hostsDescription": "Qué sitios pueden reportar un clic. Vacío acepta cualquier sitio.",
      "noHosts": "Cualquier sitio puede reportar un clic.",
      "addHost": "Añadir dominio",
      "removeHost": "Quitar el dominio",
      "save": "Guardar",
      "saving": "Guardando...",
      "saveSuccess": "Configuración de origen de leads actualizada",
      "saveFailed": "No se pudo guardar la configuración de origen de leads",
      "loadFailed": "No se pudo cargar la configuración de origen de leads",
      "copied": "Copiado",
      "copyFailed": "No se pudo copiar",
      "adminOnlyHint": "Solo los administradores de la cuenta pueden cambiar la configuración de origen de los leads."
    }
```

`messages/ko.json`:

```json
  "Leads": {
    "origin": "유입 경로",
    "primary": "첫 접촉",
    "journey": "여정 ({count})",
    "journeyTitle": "리드 여정",
    "journeyDescription": "이 리드가 처음 클릭한 것부터 마지막 메시지까지의 모든 접촉입니다.",
    "channel": {
      "whatsapp": "WhatsApp",
      "instagram_dm": "인스타그램 DM",
      "instagram_comment": "인스타그램 댓글",
      "tiktok_dm": "틱톡 DM",
      "tiktok_lead": "틱톡 리드",
      "web": "웹",
      "direct": "직접 유입"
    },
    "fields": {
      "campaign": "캠페인",
      "ad": "광고",
      "post": "게시물",
      "utmSource": "소스",
      "utmMedium": "미디어",
      "utmContent": "콘텐츠",
      "landingPath": "랜딩 페이지",
      "referrer": "리퍼러",
      "link": "링크"
    }
  }
```

```json
    "leads": {
      "title": "리드 유입 경로",
      "description": "리드가 어디에서 왔는지 확인하세요: 유입된 캠페인, 본 광고, 도착한 페이지.",
      "captureTitle": "캡처",
      "captureDescription": "캡처를 켜면 각 리드의 유입 경로를 기록합니다.",
      "enabled": "모든 리드의 유입 경로 기록",
      "scriptTitle": "사이트에 넣을 스크립트",
      "scriptDescription": "방문자가 도착하는 페이지의 맨 아래에 붙여넣으세요. 캠페인 매개변수를 기록하고 첫 방문을 기억합니다.",
      "captureKey": "캡처 키",
      "keyHint": "키는 공개 정보입니다 — 계정을 식별할 뿐 접근 권한을 주지 않습니다. 공개해도 안전합니다.",
      "notConfigured": "한 번 저장하면 키가 생성됩니다",
      "script": "태그",
      "copyKey": "캡처 키 복사",
      "copyScript": "태그 복사",
      "linksTitle": "캠페인 링크",
      "linksDescription": "클릭을 첫 메시지까지 이어주는 짧은 링크입니다. 목적지는 WhatsApp 번호(wa:5511999999999) 또는 URL(url:https://your.site/offer)입니다.",
      "noLinks": "아직 캠페인 링크가 없습니다.",
      "addLink": "링크 추가",
      "linkLabel": "라벨",
      "linkLabelPlaceholder": "여름 광고",
      "linkDestination": "목적지",
      "linkDestinationHint": "wa:와 url: 목적지만 허용됩니다 — WhatsApp 번호 또는 https 링크.",
      "copyLink": "링크 복사",
      "removeLink": "링크 삭제",
      "hostsTitle": "허용 도메인",
      "hostsDescription": "클릭을 보고할 수 있는 사이트입니다. 비워 두면 모든 사이트가 허용됩니다.",
      "noHosts": "모든 사이트가 클릭을 보고할 수 있습니다.",
      "addHost": "도메인 추가",
      "removeHost": "도메인 삭제",
      "save": "저장",
      "saving": "저장 중...",
      "saveSuccess": "리드 유입 경로 설정이 업데이트되었습니다",
      "saveFailed": "리드 유입 경로 설정을 저장하지 못했습니다",
      "loadFailed": "리드 유입 경로 설정을 불러오지 못했습니다",
      "copied": "복사됨",
      "copyFailed": "복사하지 못했습니다",
      "adminOnlyHint": "계정 관리자만 리드 유입 경로 설정을 변경할 수 있습니다."
    }
```

Acrescente também `Settings.sections.leads` em cada idioma:

| idioma | valor |
|---|---|
| `en` | `"Lead origin"` |
| `pt` | `"Origem dos leads"` |
| `es` | `"Origen de los leads"` |
| `ko` | `"리드 유입 경로"` |

> **Ordem das chaves:** `messages/*.json` é lido pelo `next-intl` — a ordem não importa para o runtime. O `Leads` entra depois de `Interactive` e o `Settings.leads` antes de `Settings.media`.
>
> **Duas strings NÃO podem ter `<` nem `>`:** o `scriptDescription` e o
> `linkDestinationHint`. O test `src/i18n/messages.test.ts` exige que
> uma string lida com `t()` seja ICU válida — e `<number>` é lido como
> tag de rich text, `</body>` como tag de fechamento sem abertura. As
> duas foram reescritas sem o HTML. O mesmo vale para qualquer
> tradução: o nome da tag tem de ser o MESMO nos quatro idiomas.

- [x] **Step 11: escreva o teste que falha — `src/app/api/leads/settings/route.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "" as string,
  settings: null as {
    account_id: string;
    capture_key: string;
    enabled: boolean;
    allowed_hosts: string[];
    links: unknown[];
  } | null,
  updates: [] as Array<{ accountId: string; patch: Record<string, unknown> }>,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: async (min: string) => {
    h.role = min;
    return {
      accountId: "acc-1",
      userId: "user-1",
      role: "admin",
      supabase: {},
    };
  },
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : "error" },
    status: 500,
  }),
}));

vi.mock("@/lib/leads/store", () => ({
  createLeadSettingsStore: () => ({
    read: async () => h.settings,
    create: async () => {
      throw new Error("create() must not be called by the route");
    },
    update: async (accountId: string, patch: Record<string, unknown>) => {
      h.updates.push({ accountId, patch });
      return {
        account_id: accountId,
        capture_key: String(patch.capture_key ?? ""),
        enabled: patch.enabled === true,
        allowed_hosts: (patch.allowed_hosts as string[]) ?? [],
        links: (patch.links as unknown[]) ?? [],
      };
    },
  }),
}));

import { GET, PUT } from "./route";

type Res = { status: number; body: Record<string, unknown> };

function put(body: unknown) {
  return PUT(
    new Request("http://t/api/leads/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  ) as unknown as Promise<Res>;
}

beforeEach(() => {
  h.role = "";
  h.settings = null;
  h.updates = [];
});

describe("GET /api/leads/settings", () => {
  it("asks for the viewer role", async () => {
    await GET();
    expect(h.role).toBe("viewer");
  });

  it("says the account is not configured yet", async () => {
    const res = (await GET()) as unknown as Res;
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.capture_key).toBeNull();
  });

  it("returns the account's configuration", async () => {
    h.settings = {
      account_id: "acc-1",
      capture_key: "pk_abc",
      enabled: true,
      allowed_hosts: ["site.com.br"],
      links: [],
    };
    const res = (await GET()) as unknown as Res;
    expect(res.body.configured).toBe(true);
    expect(res.body.capture_key).toBe("pk_abc");
    expect(res.body.allowed_hosts).toEqual(["site.com.br"]);
  });
});

describe("PUT /api/leads/settings", () => {
  it("asks for the admin role", async () => {
    await put({ enabled: true, allowed_hosts: [], links: [] });
    expect(h.role).toBe("admin");
  });

  it("keeps the capture key the account already has", async () => {
    h.settings = {
      account_id: "acc-1",
      capture_key: "pk_existing",
      enabled: false,
      allowed_hosts: [],
      links: [],
    };
    await put({ enabled: true, allowed_hosts: [], links: [] });
    expect(h.updates[0]?.patch.capture_key).toBe("pk_existing");
  });

  it("generates a capture key when the account has none", async () => {
    await put({ enabled: true, allowed_hosts: [], links: [] });
    const key = String(h.updates[0]?.patch.capture_key ?? "");
    expect(key).toMatch(/^pk_[0-9a-f]{32}$/);
  });

  it("normalizes the hosts", async () => {
    await put({
      enabled: true,
      allowed_hosts: ["https://Site.com.br/oferta", "site.com.br"],
      links: [],
    });
    expect(h.updates[0]?.patch.allowed_hosts).toEqual(["site.com.br"]);
  });

  it("refuses a host list that is not a list", async () => {
    const res = await put({
      enabled: true,
      allowed_hosts: "site.com.br",
      links: [],
    });
    expect(res.status).toBe(400);
    expect(h.updates).toHaveLength(0);
  });

  it("refuses a destination that is neither a number nor a URL", async () => {
    const res = await put({
      enabled: true,
      allowed_hosts: [],
      links: [{ label: "x", destination: "javascript:alert(1)" }],
    });
    expect(res.status).toBe(400);
    expect(h.updates).toHaveLength(0);
  });

  it("gives a new link a code", async () => {
    await put({
      enabled: true,
      allowed_hosts: [],
      links: [{ label: "Verão", destination: "wa:5511999999999" }],
    });
    const links = h.updates[0]?.patch.links as Array<{ code: string }>;
    expect(links[0]?.code).toMatch(/^[a-z0-9]{8}$/);
  });

  it("refuses two links with the same code", async () => {
    const res = await put({
      enabled: true,
      allowed_hosts: [],
      links: [
        { code: "abcd1234", destination: "wa:5511999999999" },
        { code: "abcd1234", destination: "wa:5511999999999" },
      ],
    });
    expect(res.status).toBe(400);
  });
});
```

- [x] **Step 12: escreva o teste que falha — `src/app/api/leads/origins/route.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "" as string,
  queries: [] as Array<{ table: string; filters: string[] }>,
  rows: [] as Record<string, unknown>[],
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: async (min: string) => {
    h.role = min;
    return {
      accountId: "acc-1",
      userId: "user-1",
      role: "viewer",
      supabase: {
        from: (table: string) => {
          const filters: string[] = [];
          const builder = {
            select: () => builder,
            eq: (column: string, value: unknown) => {
              filters.push(`${column}=${String(value)}`);
              return builder;
            },
            order: () => builder,
            then: (resolve: (value: unknown) => unknown) =>
              resolve({ data: h.rows, error: null }),
          };
          h.queries.push({ table, filters });
          return builder;
        },
      },
    };
  },
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : "error" },
    status: 500,
  }),
}));

import { GET } from "./route";

type Res = { status: number; body: Record<string, unknown> };

const CONTACT = "11111111-1111-4111-8111-111111111111";

function get(contactId: string | null) {
  const url = new URL("http://t/api/leads/origins");
  if (contactId !== null) url.searchParams.set("contactId", contactId);
  return GET(new Request(url)) as unknown as Promise<Res>;
}

beforeEach(() => {
  h.role = "";
  h.queries = [];
  h.rows = [];
});

describe("GET /api/leads/origins", () => {
  it("asks for the viewer role", async () => {
    await get(CONTACT);
    expect(h.role).toBe("viewer");
  });

  it("returns the journey of the contact", async () => {
    h.rows = [{ id: "origin-1", contact_id: CONTACT }];
    const res = await get(CONTACT);
    expect(res.status).toBe(200);
    expect(res.body.origins).toHaveLength(1);
  });

  it("scopes the query to the account", async () => {
    await get(CONTACT);
    expect(h.queries[0]?.table).toBe("lead_origins");
    expect(h.queries[0]?.filters).toContain("account_id=acc-1");
    expect(h.queries[0]?.filters).toContain(`contact_id=${CONTACT}`);
  });

  it("refuses a contact id that is not a uuid", async () => {
    const res = await get("not-a-uuid");
    expect(res.status).toBe(400);
    expect(h.queries).toHaveLength(0);
  });

  it("refuses a missing contact id", async () => {
    const res = await get(null);
    expect(res.status).toBe(400);
  });
});
```

- [x] **Step 13: rode os testes e o build**

Run: `npx vitest run`

Expected: PASS (1911 tests).

Run: `CIRCLE_NODE_TOTAL=4 npx next build`

Expected: EXIT=0. (Sem `CIRCLE_NODE_TOTAL` o build abre 23 workers em 23 CPUs e morre com segfault — sempre use esta forma.)

- [x] **Step 14: Commit**

```bash
git add src/app/api/leads src/components/leads src/components/settings src/components/contacts/contact-detail-view.tsx src/components/inbox/contact-sidebar.tsx src/lib/leads messages
git commit -m "feat(leads): badge de origem, jornada e painel de configuracao"
```

---

### Task 7: A documentação

**Files:**
- Create: `docs/lead-origin.md`

**Interfaces:**
- Consumes: nada do código — é a página que explica o fluxo para quem opera o CRM.
- Produces: `docs/lead-origin.md`.

- [x] **Step 1: Escreva `docs/lead-origin.md`**

```markdown
# Origem dos leads

De onde veio o lead? O CRM guarda a origem de cada contato: a campanha,
o anúncio, a página de entrada e a data do primeiro toque.

## Como funciona

### 1. O site do cliente

O cliente cola uma tag no seu site:

```html
<script src="https://app.seucrm.com/api/leads/track.js" data-key="pk_..."></script>
```

A tag faz três coisas:

- lê os parâmetros UTM (`utm_source`, `utm_medium`, `utm_campaign`,
  `utm_content`, `utm_term`) e os click ids (`gclid`, `fbclid`,
  `ttclid`, `wbraid`, `igshid`) da URL;
- guarda o **primeiro** toque num cookie (`crmbr_oid`, 30 dias) — visits
  seguintes não sobrescrevem a origem;
- reporta o toque ao CRM quando alguém envia um formulário ou clica em
  um link de WhatsApp, Instagram ou TikTok.

A tag não cria contato, não injeta nada na página e não envia nada
além da origem.

### 2. A amarração

Quando o lead escreve, o CRM procura a origem pendente:

1. **pelo código** — a tag acrescenta `ref A7X9K2M4` ao link do
   WhatsApp. O CRM tira o código antes de mostrar a mensagem ao agente;
2. **pelo telefone** — se o formulário tinha o telefone, a origem
   pendente mais recente (até 30 dias) é a mesma;
3. **pelo anúncio** — a Meta manda o `referral` do anúncio junto da
   mensagem.

A origem que amarra vira a **origem principal** do contato. As outras
entradas viram toques da jornada.

### 3. O link de campanha

Um link curto que carrega o clique até a primeira mensagem:

```
https://app.seucrm.com/r/a7x9k2m4
```

Ele grava a origem, guarda o cookie do primeiro toque e redireciona
para o destino (`wa:<número>` ou `url:<link>`). O link de WhatsApp já
sobe com o código `ref` na mensagem.

## O que fica guardado

| Onde | O quê |
|---|---|
| `lead_settings` | a chave de captura, os links de campanha, os domínios permitidos |
| `lead_origins` | um toque por linha: canal, UTMs, anúncio, post, link, data |

`lead_origins` é escrita só pelo backend. Quem lê é a equipe da conta.

## Onde aparece

- **Card do contato** — a linha de origem e o chip de jornada.
- **Conversa (inbox)** — a mesma linha, no painel do contato.
- **Configurações → Origem dos leads** — a chave, a tag, os links e os
  domínios permitidos.

## Privacidade

- A chave de captura é **pública**: ela identifica a conta, não dá
  acesso a nada.
- Nenhum texto da conversa é gravado em `lead_origins`, a não ser o
  texto cru da primeira mensagem, que só existe para recompor o
  contexto do clique.
- A API key do CRM nunca aparece aqui e nunca volta ao navegador.

## Privacidade — o que o endpoint público aceita

O `POST /api/leads/capture` é público por natureza (o navegador do
visitante é quem chama). O que ele NÃO faz:

- não aceita chamadas de domínios fora da lista permitida (quando a
  lista está configurada);
- não cria contato;
- não responde o conteúdo gravado — devolve só o código do toque;
- tem limite de requisições por chave.
```

- [x] **Step 2: Commit**

```bash
git add docs/lead-origin.md
git commit -m "docs(leads): como a origem do lead e capturada e amarrada"
```

---

## Ordem de execução e o que precisa da sua mão

| Task | Depende de | Precisa de você |
|---|---|---|
| 1. Migration 067 | — | **SIM — rodar o SQL no Supabase** |
| 2. `src/lib/leads/` | 1 | não |
| 3. `/api/leads/capture` + `track.js` | 1, 2 | não |
| 4. `/r/[code]` | 1, 2 | não |
| 5. Gancho no inbound | 2, 3 | não |
| 6. UI | 2, 3 | não |
| 7. Docs | — | não |

**A Task 1 é a única que trava o resto:** sem a migration aplicada, as
tabelas `lead_settings` e `lead_origins` não existem e todo o resto
falha. Os testes de migration rodam contra o SQL em disco, então a
suíte passa sem o banco — o que significa que **verde no CI não quer
dizer que o banco está pronto**.

Rode este arquivo no Supabase Studio (SQL Editor) depois que eu
commitá-lo:

```
supabase/migrations/067_lead_origin.sql
```

---
