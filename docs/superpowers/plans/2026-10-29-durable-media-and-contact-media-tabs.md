# Mídia durável em bucket + abas Mídia / Documentos / Links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir toda mídia trocada em conversa em bucket (qualquer formato, até 100 MB) e exibi-la por contato em abas Mídia / Documentos / Links, na caixa de entrada e na aba Contatos.

**Architecture:** O storage vira plugável (`MediaStorage`: Supabase agora, R2 depois). O bucket `chat-media` deixa de recusar arquivos: a lista de MIME passa a ser "tipos seguros inline + `application/octet-stream`" e o app **normaliza** o `Content-Type` antes de subir, então nada é rejeitado e nenhum conteúdo ativo é servido inline. A galeria é **derivada de `messages`** (JOIN por `contact_id`), sem tabela nova — só `media_settings` (migration 066) para a configuração.

**Tech Stack:** Next.js 16 App Router · TypeScript 6 · Supabase (Postgres + Storage + RLS) · `aws4fetch` (SigV4 para R2) · base-ui (`@base-ui/react`) · Tailwind v4 · next-intl · vitest 5

**Spec:** `docs/superpowers/specs/2026-10-29-durable-media-and-contact-media-tabs-design.md`

## Global Constraints

- **A chave da API nunca volta ao navegador em texto puro.** As credenciais da R2 (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) são env server-only; o browser só recebe URL pré-assinada ou URL pública.
- **Toda rota nova é account-scoped.** Instância de outra conta → 404 (nunca revela existência).
- **Nenhuma migration altera schema existente — só cria tabela nova.** Alterar *funções* e *buckets* é permitido (o `chat-media` é ajustado, `media_settings` é criada).
- **O provedor nunca é nomeado para o usuário.** Mensagens de erro não dizem "WhatsMiau"/"CRMBR".
- **UI:** kit do repo (base-ui + `src/components/ui/*`), sem mockup. Strings novas em `en.json`, `pt.json`, `es.json`, `ko.json`.
- **Datas/horas** sempre via `src/lib/i18n/format.ts` (`formatDate`, `formatDateTime`), nunca `toLocaleDateString` direto.
- **`useEffect` não faz set-state síncrono** (regra do ESLint do repo) — carregar dados sempre em callback assíncrono.
- **Path de objeto** sempre `account-<account_id>/<subpasta>/<nome>` via `buildMediaPath` — a RLS casa no primeiro segmento.
- **Espelho é best-effort:** falha devolve `null` e o chamador mantém a URL do provedor; o webhook nunca quebra por causa de mídia.
- **Idioma de comunicação com o usuário:** pt-BR.

---

### Task 1: Migration 066 — `media_settings` + política do bucket

**Files:**
- Create: `supabase/migrations/066_media_settings_and_bucket.sql`
- Create: `src/lib/media/bucket-policy-migration.test.ts`
- Modify: `src/lib/auth/redeem-invitation-migration.test.ts` (o guard de `media_settings`)

**Interfaces:**
- Produces: tabela `media_settings (account_id UUID PK, backend TEXT, bucket TEXT, max_file_bytes BIGINT, public_base_url TEXT, updated_at TIMESTAMPTZ)`; bucket `chat-media` com `file_size_limit = 104857600` e `allowed_mime_types` = lista segura + `application/octet-stream`.

- [ ] **Step 1: Escrever o teste da política do bucket**

Criar `src/lib/media/bucket-policy-migration.test.ts` que lê `supabase/migrations/*.sql` (mesmo padrão de `src/lib/auth/redeem-invitation-migration.test.ts`) e garante:

```ts
const sql = migration('066_media_settings_and_bucket.sql');

it('stops the chat-media bucket at 100 MB', () => {
  expect(sql).toMatch(/104857600/);
});

it('accepts any format through the octet-stream catch-all', () => {
  expect(sql).toContain("'application/octet-stream'");
});

it('never serves active content inline', () => {
  expect(sql).not.toMatch(/'text\/html'/);
  expect(sql).not.toMatch(/'image\/svg\+xml'/);
});

it('keeps the safe inline types', () => {
  expect(sql).toContain("'application/pdf'");
  expect(sql).toContain("'image/png'");
  expect(sql).toContain("'application/vnd.oasis.opendocument.text'");
});
```

- [ ] **Step 2: Escrever a migration**

`supabase/migrations/066_media_settings_and_bucket.sql`:

```sql
-- ============================================================
-- 066_media_settings_and_bucket
--
-- Configuracao de storage por conta + a politica que faz o
-- `chat-media` aceitar QUALQUER formato.
--
-- A lista de MIME do bucket era fechada (migration 023 + 039): o
-- Storage recusava o upload de tudo que nao estivesse nela -- e o
-- fallback do espelho (`application/octet-stream`) TAMBIM nao estava,
-- entao todo anexo de tipo desconhecido era descartado em silencio.
-- A media ficava so com a URL do provedor, que expira. E a causa da
-- reclamacao "as midias se perdem".
--
-- A lista nova e "tipos que podem ser servidos inline + o catch-all
-- application/octet-stream". O app normaliza o `Content-Type` antes
-- de subir (src/lib/media/content-type.ts), entao:
--
--   - nada e jamais rejeitado (o catch-all sempre passa);
--   - nenhum conteudo ativo (text/html, image/svg+xml) e servido
--     inline, porque o app declara `application/octet-stream` para
--     qualquer tipo que nao esteja na lista segura.
--
-- O teto sobe de 16 MB para 100 MB -- o mesmo limite que o WhatsApp
-- aplica a documentos.
--
-- `media_settings` guarda a escolha de backend por conta (Supabase ou
-- R2), o bucket, o limite de tamanho e a URL publica base. As
-- credenciais da R2 NAO ficam aqui: sao env, server-only.
--
-- TABELA NOVA -- nenhuma tabela existente muda de schema.
-- Idempotente -- pode ser reaplicada com seguranca.
-- ============================================================

CREATE TABLE IF NOT EXISTS media_settings (
  account_id      UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  backend         TEXT NOT NULL DEFAULT 'supabase'
                    CHECK (backend IN ('supabase','r2')),
  bucket          TEXT NOT NULL DEFAULT 'chat-media',
  max_file_bytes  BIGINT NOT NULL DEFAULT 104857600,
  public_base_url TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE media_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read media settings" ON media_settings;
CREATE POLICY "Members can read media settings"
  ON media_settings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Admins can manage media settings" ON media_settings;
CREATE POLICY "Admins can manage media settings"
  ON media_settings FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- chat-media: teto de 100 MB + lista segura com o catch-all.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  TRUE,
  104857600, -- 100 MB (limite de documento do WhatsApp)
  ARRAY[
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
    'video/mp4', 'video/3gpp', 'video/quicktime',
    'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr',
    'application/pdf', 'text/plain',
    'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'application/vnd.oasis.opendocument.graphics',
    -- Catch-all: qualquer formato entra por aqui e o browser BAIXA.
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
```

- [ ] **Step 3: Guardar `media_settings` no `redeem_invitation`**

`media_settings` é config da conta — se a conta é apagada no resgate do convite, a config some junto (e a conta cairia no Supabase sem querer). Recriar a função com a linha do guard, no fim da migration 066:

```sql
-- A funcao apaga a conta antiga quando o usuario resgata um convite.
-- `media_settings` e config escopada por conta: sem esta checagem a
-- linha seria removida em cascata e a conta perderia o backend de
-- storage escolhido.
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

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run src/lib/media/bucket-policy-migration.test.ts src/lib/auth/redeem-invitation-migration.test.ts`
Expected: PASS (o guard de `redeem_invitation` passa porque a função agora checa `media_settings`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/066_media_settings_and_bucket.sql src/lib/media/bucket-policy-migration.test.ts
git commit -m "feat(storage): tabela media_settings e bucket chat-media aceitando qualquer formato"
```

---

### Task 2: Normalização de `Content-Type`

**Files:**
- Create: `src/lib/media/content-type.ts`
- Create: `src/lib/media/content-type.test.ts`

**Interfaces:**
- Produces: `INLINE_SAFE_MIME_TYPES: ReadonlySet<string>`, `normalizeContentType(mime: string | null | undefined): string`, `isInlineSafeMime(mime: string | null | undefined): boolean`.

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/media/content-type.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { INLINE_SAFE_MIME_TYPES, normalizeContentType } from './content-type';

describe('normalizeContentType', () => {
  it('keeps the types that are safe to render inline', () => {
    expect(normalizeContentType('image/png')).toBe('image/png');
    expect(normalizeContentType('application/pdf')).toBe('application/pdf');
    expect(normalizeContentType('image/jpg')).toBe('image/jpg');
    expect(normalizeContentType('application/vnd.oasis.opendocument.text')).toBe(
      'application/vnd.oasis.opendocument.text',
    );
  });

  it('drops the parameters of the type', () => {
    expect(normalizeContentType('image/jpeg; charset=binary')).toBe('image/jpeg');
    expect(normalizeContentType('AUDIO/OGG')).toBe('audio/ogg');
  });

  it('turns active content into a download', () => {
    expect(normalizeContentType('text/html')).toBe('application/octet-stream');
    expect(normalizeContentType('image/svg+xml')).toBe('application/octet-stream');
    expect(normalizeContentType('application/xhtml+xml')).toBe('application/octet-stream');
  });

  it('turns an unknown format into a download', () => {
    expect(normalizeContentType('application/zip')).toBe('application/octet-stream');
    expect(normalizeContentType('application/vnd.ms-cab-compressed')).toBe(
      'application/octet-stream',
    );
    expect(normalizeContentType('image/heic')).toBe('application/octet-stream');
  });

  it('answers the catch-all when there is no type at all', () => {
    expect(normalizeContentType(null)).toBe('application/octet-stream');
    expect(normalizeContentType(undefined)).toBe('application/octet-stream');
    expect(normalizeContentType('')).toBe('application/octet-stream');
    expect(normalizeContentType('nonsense')).toBe('application/octet-stream');
  });

  it('never declares a type the bucket would refuse', () => {
    for (const mime of INLINE_SAFE_MIME_TYPES) {
      expect(normalizeContentType(mime)).toBe(mime);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/media/content-type.test.ts`
Expected: FAIL — "Cannot find module './content-type'".

- [ ] **Step 3: Implementar**

`src/lib/media/content-type.ts`:

```ts
/**
 * O `Content-Type` que declaramos ao storage.
 *
 * O bucket `chat-media` aceita uma lista de tipos (migration 066) e
 * RECUSA o upload de qualquer coisa fora dela. Como o provedor nem
 * sempre diz qual e o tipo do anexo -- e o fallback do espelho era
 * `application/octet-stream`, que tambem nao estava na lista -- o
 * resultado era: anexo recusado, espelho falhando, midia_pointer
 * apontando para a URL do provedor, que EXPIRA.
 *
 * Aqui o tipo e normalizado ANTES do upload:
 *
 *   - tipo seguro (imagem, video, audio, PDF, texto, Office, ODF) =>
 *     declarado como esta, e o browser mostra inline;
 *   - qualquer outro tipo (zip, csv, heic, html, svg...) =>
 *     `application/octet-stream`, e o browser BAIXA o arquivo.
 *
 * O resultado e duplo: nada e jamais rejeitado (o catch-all esta na
 * lista do bucket) e nenhum conteudo ativo e servido inline.
 */

/** Tipos que o browser pode renderizar sem risco. */
export const INLINE_SAFE_MIME_TYPES: ReadonlySet<string> = new Set([
  // Imagem
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  // Video
  'video/mp4',
  'video/3gpp',
  'video/quicktime',
  // Audio
  'audio/ogg',
  'audio/opus',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
  // Documento
  'application/pdf',
  'text/plain',
  // Office legado
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  // Office OOXML
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // OpenDocument (LibreOffice) -- comum no Brasil
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.graphics',
]);

/** O tipo que o storage aceita e o browser baixa em vez de renderizar. */
export const DOWNLOAD_MIME_TYPE = 'application/octet-stream';

/** O tipo base, sem parametros (`; charset=...`) e em minusculas. */
function baseMime(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0]!.trim().toLowerCase();
}

/** O tipo pode ser servido inline? */
export function isInlineSafeMime(mime: string | null | undefined): boolean {
  return INLINE_SAFE_MIME_TYPES.has(baseMime(mime));
}

/**
 * O `Content-Type` a declarar no upload: o proprio tipo quando ele e
 * seguro, o catch-all quando nao e.
 */
export function normalizeContentType(mime: string | null | undefined): string {
  const base = baseMime(mime);
  if (!base.includes('/')) return DOWNLOAD_MIME_TYPE;
  return INLINE_SAFE_MIME_TYPES.has(base) ? base : DOWNLOAD_MIME_TYPE;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/media/content-type.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media/content-type.ts src/lib/media/content-type.test.ts
git commit -m "feat(storage): normaliza o Content-Type para o storage aceitar qualquer formato"
```

---

### Task 3: `MediaStorage` plugável (Supabase + R2)

**Files:**
- Modify: `package.json` (dependência `aws4fetch`)
- Create: `src/lib/media/storage/types.ts`
- Create: `src/lib/media/storage/supabase.ts`
- Create: `src/lib/media/storage/r2.ts`
- Create: `src/lib/media/storage/settings.ts`
- Create: `src/lib/media/storage/index.ts`
- Create: `src/lib/media/storage/storage.test.ts`

**Interfaces:**
- Consumes: `media_settings` (Task 1), `buildMediaPath` (`src/lib/storage/upload-media.ts`).
- Produces:
  ```ts
  type MediaBackend = 'supabase' | 'r2';
  interface UploadTarget { mode: 'supabase' | 'presigned'; path: string; bucket?: string; url?: string; headers?: Record<string,string>; publicUrl: string; }
  interface MediaStorage {
    readonly backend: MediaBackend;
    prepareUpload(a: {accountId: string; fileName: string; contentType: string; sizeBytes: number}): Promise<UploadTarget>;
    put(a: {path: string; body: ReadableStream<Uint8Array> | Uint8Array | Buffer; contentType: string; upsert?: boolean; cacheControl?: string}): Promise<{publicUrl: string; path: string; size: number}>;
    remove(path: string): Promise<void>;
    publicUrl(path: string): string;
  }
  interface MediaSettings { backend: MediaBackend; bucket: string; maxFileBytes: number; publicBaseUrl: string | null; }
  async function readMediaSettings(db, accountId): Promise<MediaSettings>
  async function getMediaStorage(accountId, db?): Promise<MediaStorage>
  ```

- [ ] **Step 1: Instalar `aws4fetch`**

```bash
npm install aws4fetch
```

- [ ] **Step 2: Escrever o teste que falha**

`src/lib/media/storage/storage.test.ts` — cobre as duas implementações com doubles:

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildMediaPath } from '@/lib/storage/upload-media';
import { SupabaseMediaStorage } from './supabase';
import { R2MediaStorage, r2ConfigFromEnv } from './r2';

describe('SupabaseMediaStorage', () => {
  it('prepares a direct browser upload and the public url', async () => {
    const storage = new SupabaseMediaStorage({ bucket: 'chat-media', publicBaseUrl: null });
    const target = await storage.prepareUpload({
      accountId: 'acc-1',
      fileName: 'foto.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 10,
    });
    expect(target.mode).toBe('supabase');
    expect(target.bucket).toBe('chat-media');
    expect(target.path.startsWith('account-acc-1/')).toBe(true);
    expect(target.publicUrl).toContain(target.path);
  });
});

describe('R2MediaStorage', () => {
  it('presigns a PUT that points at the R2 endpoint', async () => {
    const storage = new R2MediaStorage({
      accountId: 'r2-account',
      accessKeyId: 'AKIA_TEST',
      secretAccessKey: 'secret',
      bucket: 'wacrm-media',
      publicBaseUrl: 'https://media.test',
    });
    const target = await storage.prepareUpload({
      accountId: 'acc-1',
      fileName: 'contrato.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
    });
    expect(target.mode).toBe('presigned');
    expect(target.url).toContain('https://r2-account.r2.cloudflarestorage.com/wacrm-media/');
    expect(target.url).toContain('X-Amz-Signature=');
    expect(target.headers?.['Content-Type']).toBe('application/pdf');
    expect(target.publicUrl).toBe(
      `https://media.test/account-acc-1/${encodeURIComponent('contrato.pdf')}`,
    );
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/lib/media/storage/storage.test.ts`
Expected: FAIL — módulo `./supabase` / `./r2` não encontrado.

- [ ] **Step 4: Implementar `types.ts`**

```ts
/** Qual backend guarda a midia da conta. */
export type MediaBackend = 'supabase' | 'r2';

/** Onde o browser envia os bytes. */
export interface UploadTarget {
  /** `supabase`: o client SDK sobe. `presigned`: um PUT assinado. */
  mode: 'supabase' | 'presigned';
  /** Caminho do objeto (account-scoped). */
  path: string;
  /** Bucket -- so no modo `supabase`. */
  bucket?: string;
  /** URL pre-assinada -- so no modo `presigned`. */
  url?: string;
  /** Headers exigidos no PUT -- so no modo `presigned`. */
  headers?: Record<string, string>;
  /** URL publica final do objeto. */
  publicUrl: string;
}

/** Superficie de storage da midia. */
export interface MediaStorage {
  readonly backend: MediaBackend;
  prepareUpload(args: {
    accountId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<UploadTarget>;
  put(args: {
    path: string;
    body: ReadableStream<Uint8Array> | Uint8Array | Buffer;
    contentType: string;
    upsert?: boolean;
    cacheControl?: string;
  }): Promise<{ publicUrl: string; path: string; size: number }>;
  remove(path: string): Promise<void>;
  publicUrl(path: string): string;
}
```

- [ ] **Step 5: Implementar `supabase.ts`**

```ts
import { createClient } from '@/lib/supabase/client';
import { buildMediaPath } from '@/lib/storage/upload-media';
import type { MediaStorage, UploadTarget } from './types';

export interface SupabaseMediaStorageOptions {
  bucket: string;
  /** URL publica base; quando null, usa a URL do proprio bucket. */
  publicBaseUrl: string | null;
  /** Cliente injetavel (testes). */
  client?: ReturnType<typeof createClient>;
}

/**
 * Storage no Supabase Storage -- o backend padrao.
 *
 * O bucket `chat-media` e PUBLICO (migration 023) porque o Meta baixa
 * a midia sem autenticacao no envio. O upload do browser vai direto
 * pelo client SDK, com a RLS casando o primeiro segmento do caminho
 * (`account-<id>`).
 */
export class SupabaseMediaStorage implements MediaStorage {
  readonly backend = 'supabase' as const;

  constructor(private readonly options: SupabaseMediaStorageOptions) {}

  private get client() {
    return this.options.client ?? createClient();
  }

  async prepareUpload(args: {
    accountId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<UploadTarget> {
    const path = buildMediaPath(args.accountId, args.fileName);
    const { data } = this.client.storage
      .from(this.options.bucket)
      .getPublicUrl(path);
    return {
      mode: 'supabase',
      bucket: this.options.bucket,
      path,
      publicUrl: data.publicUrl,
    };
  }

  async put(args: {
    path: string;
    body: ReadableStream<Uint8Array> | Uint8Array | Buffer;
    contentType: string;
    upsert?: boolean;
    cacheControl?: string;
  }): Promise<{ publicUrl: string; path: string; size: number }> {
    const { error } = await this.client.storage
      .from(this.options.bucket)
      .upload(args.path, args.body, {
        contentType: args.contentType,
        cacheControl: args.cacheControl ?? '3600',
        upsert: args.upsert ?? false,
      });
    if (error) throw new Error(error.message);
    const { data } = this.client.storage
      .from(this.options.bucket)
      .getPublicUrl(args.path);
    return { publicUrl: data.publicUrl, path: args.path, size: 0 };
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.client.storage
      .from(this.options.bucket)
      .remove([path]);
    if (error) throw new Error(error.message);
  }

  publicUrl(path: string): string {
    if (this.options.publicBaseUrl) {
      return `${this.options.publicBaseUrl.replace(/\/$/, '')}/${path}`;
    }
    const { data } = this.client.storage
      .from(this.options.bucket)
      .getPublicUrl(path);
    return data.publicUrl;
  }
}
```

- [ ] **Step 6: Implementar `r2.ts`**

```ts
import { sign } from 'aws4fetch';
import { buildMediaPath } from '@/lib/storage/upload-media';
import type { MediaStorage, UploadTarget } from './types';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

/** Validade da URL pre-assinada de upload. */
export const PRESIGN_EXPIRES_SECONDS = 900;

/**
 * Le a configuracao da R2 do ambiente.
 *
 * As credenciais sao SEMPRE server-only: elas nunca voltam para o
 * browser. O que vai para o browser e a URL pre-assinada.
 *
 * @returns null quando falta alguma peca -- a UI de Configuracoes
 *          mostra o nome das variaveis que faltam, nunca o valor.
 */
export function r2ConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): (R2Config & { missing: string[] }) | null {
  const missing: string[] = [];
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET ?? 'wacrm-media';
  const publicBaseUrl = env.MEDIA_PUBLIC_BASE_URL;
  if (!accountId) missing.push('R2_ACCOUNT_ID');
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!publicBaseUrl) missing.push('MEDIA_PUBLIC_BASE_URL');
  if (missing.length > 0) return null;
  return {
    accountId: accountId!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucket,
    publicBaseUrl: publicBaseUrl!,
    missing,
  };
}

/** Endpoint S3-compatible da R2. */
export function r2Endpoint(config: R2Config, key: string): string {
  return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`;
}

/**
 * Storage na Cloudflare R2 (S3-compatible).
 *
 * O bucket precisa ser PUBLICO atras de um dominio proprio
 * (`media.crmbr.com`), porque o WhatsApp baixa a midia sem
 * autenticacao no envio -- a mesma premissa do `chat-media` publico.
 *
 * A separacao por conta continua no caminho (`account-<uuid>/...`).
 */
export class R2MediaStorage implements MediaStorage {
  readonly backend = 'r2' as const;

  constructor(private readonly config: R2Config) {}

  private endpoint(key: string): string {
    return r2Endpoint(this.config, key);
  }

  async prepareUpload(args: {
    accountId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<UploadTarget> {
    const path = buildMediaPath(args.accountId, args.fileName);
    const url = this.presign(path, 'PUT', args.contentType);
    return {
      mode: 'presigned',
      path,
      url,
      headers: { 'Content-Type': args.contentType },
      publicUrl: this.publicUrl(path),
    };
  }

  /** URL de PUT pre-assinada (15 minutos). */
  private presign(path: string, method: string, contentType: string): string {
    const signer = sign(this.endpoint(path), {
      method,
      headers: { 'Content-Type': contentType },
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: 'auto',
      service: 's3',
      expires: PRESIGN_EXPIRES_SECONDS,
    });
    return signer.url;
  }

  async put(args: {
    path: string;
    body: ReadableStream<Uint8Array> | Uint8Array | Buffer;
    contentType: string;
    upsert?: boolean;
    cacheControl?: string;
  }): Promise<{ publicUrl: string; path: string; size: number }> {
    const signer = sign(this.endpoint(args.path), {
      method: 'PUT',
      body: args.body as BodyInit,
      headers: { 'Content-Type': args.contentType },
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: 'auto',
      service: 's3',
    });
    const response = await signer.fetch();
    if (!response.ok) {
      throw new Error(`R2 upload failed: ${response.status}`);
    }
    return { publicUrl: this.publicUrl(args.path), path: args.path, size: 0 };
  }

  async remove(path: string): Promise<void> {
    const signer = sign(this.endpoint(path), {
      method: 'DELETE',
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: 'auto',
      service: 's3',
    });
    const response = await signer.fetch();
    if (!response.ok) {
      throw new Error(`R2 delete failed: ${response.status}`);
    }
  }

  publicUrl(path: string): string {
    return `${this.config.publicBaseUrl.replace(/\/$/, '')}/${path}`;
  }
}
```

> **Nota de implementação:** `aws4fetch`'s `sign()` assina o corpo quando ele é um `Uint8Array`/`Buffer`, mas **não** pode hashear um `ReadableStream`. Para o upload em streaming, passe `body: undefined` e o header `x-amz-content-sha256: UNSIGNED-PAYLOAD` no `sign()`, e mande o stream como `body` no `fetch`. Se a versão instalada não aceitar `region`/`service`/`expires`, usar `sign(url, { method, headers, accessKeyId, secretAccessKey, aws: { signQuery: true, region: 'auto', service: 's3' } })` — confirmar pela doc do pacote instalado antes de escrever o teste do §2.

- [ ] **Step 7: Implementar `settings.ts` + `index.ts`**

`src/lib/media/storage/settings.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MediaBackend } from './types';

/** A configuracao de storage de uma conta. */
export interface MediaSettings {
  backend: MediaBackend;
  bucket: string;
  maxFileBytes: number;
  publicBaseUrl: string | null;
}

/** Default quando a conta nunca configurou nada. */
export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  backend: 'supabase',
  bucket: 'chat-media',
  maxFileBytes: 104857600,
  publicBaseUrl: null,
};

/**
 * Le a configuracao de storage da conta.
 *
 * Falha de leitura NAO e erro: a conta cai no default (Supabase),
 * que e o comportamento de antes. Uma config quebrada nunca pode
 * derrubar o inbox.
 */
export async function readMediaSettings(
  db: SupabaseClient,
  accountId: string,
): Promise<MediaSettings> {
  const { data, error } = await db
    .from('media_settings')
    .select('backend, bucket, max_file_bytes, public_base_url')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return DEFAULT_MEDIA_SETTINGS;
  return {
    backend: (data.backend as MediaBackend) ?? DEFAULT_MEDIA_SETTINGS.backend,
    bucket: data.bucket ?? DEFAULT_MEDIA_SETTINGS.bucket,
    maxFileBytes: data.max_file_bytes ?? DEFAULT_MEDIA_SETTINGS.maxFileBytes,
    publicBaseUrl: data.public_base_url ?? null,
  };
}
```

`src/lib/media/storage/index.ts`:

```ts
import { createClient } from '@/lib/supabase/client';
import { readMediaSettings, type MediaSettings } from './settings';
import { R2MediaStorage, r2ConfigFromEnv } from './r2';
import { SupabaseMediaStorage } from './supabase';
import type { MediaStorage } from './types';

export type { MediaBackend, MediaStorage, UploadTarget } from './types';
export { DEFAULT_MEDIA_SETTINGS, readMediaSettings } from './settings';
export { R2MediaStorage, r2ConfigFromEnv } from './r2';
export { SupabaseMediaStorage } from './supabase';

/**
 * O storage da conta.
 *
 * A escolha vem de `media_settings`. Sem configuracao (ou com a R2
 * sem credenciais no ambiente) a conta fica no Supabase -- o backend
 * que ja funciona hoje.
 */
export async function getMediaStorage(
  accountId: string,
  db?: ReturnType<typeof createClient>,
): Promise<MediaStorage> {
  const client = db ?? createClient();
  const settings = await readMediaSettings(client, accountId);
  return mediaStorageFor(settings);
}

/** O storage para uma configuracao ja lida. */
export function mediaStorageFor(
  settings: MediaSettings,
  env: Record<string, string | undefined> = process.env,
): MediaStorage {
  if (settings.backend === 'r2') {
    const config = r2ConfigFromEnv(env);
    if (config) {
      return new R2MediaStorage({
        accountId: config.accountId,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        bucket: config.bucket,
        publicBaseUrl: settings.publicBaseUrl ?? config.publicBaseUrl,
      });
    }
  }
  return new SupabaseMediaStorage({
    bucket: settings.bucket,
    publicBaseUrl: settings.publicBaseUrl,
  });
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run src/lib/media/storage/storage.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/lib/media/storage/
git commit -m "feat(storage): backend de midia plugavel, Supabase e R2"
```

---

### Task 4: Espelho inbound em 100 MB, com streaming e tipo normalizado

**Files:**
- Modify: `src/lib/storage/upload-media.ts` (`MEDIA_MAX_BYTES`, `MEDIA_MAX_BYTES_BY_KIND.document`)
- Modify: `src/lib/whatsapp/meta-api.ts` (novo `downloadMediaStream`)
- Modify: `src/lib/whatsapp/mirror-inbound-media.ts`
- Modify: `src/lib/whatsapp/providers/whatsmiau/mirror-media.ts`
- Modify: `src/lib/media/filename.ts` (prefixo do basename espelhado)
- Test: `src/lib/whatsapp/mirror-inbound-media.test.ts` (existente), `src/lib/whatsapp/providers/whatsmiau/mirror-media.test.ts`, `src/lib/media/filename.test.ts` (existente)

**Interfaces:**
- Consumes: `normalizeContentType` (Task 2), `MediaStorage` (Task 3).
- Produces: `downloadMediaStream({downloadUrl, accessToken, maxBytes}): Promise<{stream: ReadableStream<Uint8Array>; contentType: string}>`; `mirrorInboundMedia` aceita `maxBytes`; `basenameFromUrl` remove o prefixo `m<id>-`.

- [ ] **Step 1: Ajustar os limites**

Em `src/lib/storage/upload-media.ts`:

```ts
/** 100 MB — o teto do bucket `chat-media` (migration 066) e o limite
 *  de documento do WhatsApp. */
export const MEDIA_MAX_BYTES = 100 * 1024 * 1024;

export const MEDIA_MAX_BYTES_BY_KIND = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  /** Documento: o WhatsApp aceita ate 100 MB. */
  document: 100 * 1024 * 1024,
} as const;
```

- [ ] **Step 2: Streaming do download (Meta)**

Adicionar em `src/lib/whatsapp/meta-api.ts`:

```ts
export interface DownloadMediaStreamArgs {
  downloadUrl: string
  accessToken: string
  /** Corta o stream quando os bytes passam deste limite. */
  maxBytes: number
}

/**
 * Os bytes da midia, em streaming.
 *
 * A versao com `buffer` (downloadMedia) carrega o arquivo inteiro na
 * memoria -- com o teto novo de 100 MB isso sao 100 MB por download
 * concorrente. Aqui os bytes sao contados enquanto chegam e o stream
 * e abortado no limite.
 */
export async function downloadMediaStream(
  args: DownloadMediaStreamArgs
): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string }> {
  const { downloadUrl, accessToken, maxBytes } = args
  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status}`)
  }
  const contentType =
    response.headers.get('content-type') || 'application/octet-stream'
  if (!response.body) {
    throw new Error('Media download returned no body')
  }
  let seen = 0
  const reader = response.body.getReader()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      seen += value.byteLength
      if (seen > maxBytes) {
        await reader.cancel()
        controller.error(new Error(`Media exceeds the ${maxBytes}-byte limit`))
        return
      }
      controller.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  return { stream, contentType }
}
```

- [ ] **Step 3: Espelho Meta — streaming + normalização**

Em `src/lib/whatsapp/mirror-inbound-media.ts`:

- `MirrorInboundMediaArgs` ganha `maxBytes?: number` (default `MEDIA_MAX_BYTES`) e `storageApi?: MediaStorage`.
- O `download` injetado passa a poder devolver `{ stream, contentType }`; manter `downloadMedia` (buffer) como fallback quando não há stream? **Não** — simplificar: o espelho passa a exigir stream. `downloadMediaStream` é a única fonte.
- O `contentType` declarado passa por `normalizeContentType`.
- O upload passa a receber o `ReadableStream`.

```ts
export interface MirrorInboundMediaArgs {
  storage: MirrorStorage;
  accountId: string;
  mediaId: string;
  downloadUrl: string;
  accessToken: string;
  mimeType?: string | null;
  fileSize?: number | null;
  fileName?: string | null;
  messageTimestamp?: string | number | null;
  /** Teto em bytes -- o da conta, limitado pelo teto do bucket. */
  maxBytes?: number;
  /** Injetado em testes. */
  download?: typeof downloadMediaStream;
}
```

E no corpo: trocar a checagem por `MEDIA_MAX_BYTES` por `maxBytes`, trocar o `download` por `downloadMediaStream`, e trocar o `upload` por:

```ts
    const uploadType = normalizeContentType(
      normalizedMime ?? normalizeMimeType(contentType),
    );
    ...
    const { error } = await storage.from(MIRROR_BUCKET).upload(path, stream, {
      contentType: uploadType,
      cacheControl: '3600',
      upsert: true,
    });
```

O tipo `MirrorStorage.upload` passa a aceitar `ReadableStream<Uint8Array>` no body:

```ts
    upload(
      path: string,
      body: ReadableStream<Uint8Array> | Uint8Array | Buffer,
      options: { contentType: string; cacheControl: string; upsert: boolean },
    ): Promise<{ error: { message: string } | null }>;
```

- [ ] **Step 4: Espelho CRMBR — streaming + normalização**

Em `src/lib/whatsapp/providers/whatsmiau/mirror-media.ts`, o mesmo tratamento:

```ts
/** Baixa os bytes do provedor em streaming, cortando no limite. */
export const downloadWhatsmiauMedia: WhatsmiauMediaDownloader = async (
  url: string,
  maxBytes: number,
) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Media download failed with ${response.status}`);
  }
  const contentType = response.headers.get('content-type');
  if (!response.body) throw new Error('Media download returned no body');
  let seen = 0;
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) { controller.close(); return; }
      seen += value.byteLength;
      if (seen > maxBytes) {
        await reader.cancel();
        controller.error(new Error(`Media exceeds the ${maxBytes}-byte limit`));
        return;
      }
      controller.enqueue(value);
    },
  });
  return { stream, contentType };
};
```

O `uploadType` passa por `normalizeContentType(...)` e o upload recebe o stream.

- [ ] **Step 5: Corrigir o prefixo do basename espelhado (risco #4 do spec)**

Em `src/lib/media/filename.ts`, `basenameFromUrl` hoje remove só prefixos de 10+ dígitos (`/^\d{10,}-/`). O nome espelhado é `<mediaId>-<nome>.<ext>` e o `mediaId` do CRMBR pode não ter 10+ dígitos — o nome exibido carregaria o prefixo.

Regra nova: o espelho passa a **prefixar com `m`** e o parser remove `m<id>-` (qualquer `m` seguido de dígitos) **e** o prefixo numérico antigo:

```ts
/** Remove o prefixo que o espelho poe no nome do objeto:
 *  `m<mediaId>-` (novo) ou `<mediaId>-` de 10+ digitos (antigo). */
const MIRROR_PREFIX = /^(?:m\d+|\d{10,})-/;

export function basenameFromUrl(url: string): string {
  ...
  const withoutStamp = decoded.replace(MIRROR_PREFIX, '');
  return hasExtension(withoutStamp) ? sanitizeFilename(withoutStamp) : '';
}
```

E em `mirrorFileName` (nos dois espelhos), o nome passa a ser `m${mediaId}-${stem}.${ext}` / `m${mediaId}-${kind}-${stamp}.${ext}`.

> Cuidado: `buildMediaPath` corta o basename em 40 caracteres. Com `m` + 19 dígitos + `-` = 21 caracteres, o nome do arquivo perde ~19 caracteres. Aceitável — e o nome exibido na aba Documentos continua correto porque o corte só afeta o objeto, não o `mediaFilename`.

- [ ] **Step 6: Rodar os testes**

Run: `npx vitest run src/lib/whatsapp/mirror-inbound-media.test.ts src/lib/whatsapp/providers/whatsmiau src/lib/media/filename.test.ts`
Expected: PASS (ajustar os testes existentes que esperavam 16 MB ou o buffer).

- [ ] **Step 7: Commit**

```bash
git add src/lib/storage/upload-media.ts src/lib/whatsapp/meta-api.ts src/lib/whatsapp/mirror-inbound-media.ts src/lib/whatsapp/providers/whatsmiau/mirror-media.ts src/lib/media/filename.ts
git commit -m "feat(storage): espelho inbound em streaming, 100 MB e Content-Type normalizado"
```

---

### Task 5: Upload do composer pelo backend plugável

**Files:**
- Create: `src/app/api/media/upload-url/route.ts`
- Modify: `src/lib/storage/upload-media.ts` (`uploadAccountMedia` aceita um `MediaStorage`)
- Modify: `src/components/inbox/message-composer.tsx`
- Test: `src/app/api/media/upload-url/route.test.ts`, `src/lib/storage/upload-media.test.ts` (existente)

**Interfaces:**
- Produces: `POST /api/media/upload-url` → `{ mode, path, bucket?, url?, headers?, publicUrl }`; `uploadAccountMedia(bucket, file, storage?)` passa a usar o `MediaStorage`.

- [ ] **Step 1: Rota de URL de upload**

`src/app/api/media/upload-url/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMediaStorage } from '@/lib/media/storage'
import { normalizeContentType } from '@/lib/media/content-type'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: t('common.unauthorized') }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: t('common.profileNotLinked') }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      fileName?: string
      contentType?: string
      sizeBytes?: number
    }
    const fileName = (body.fileName ?? '').trim()
    if (!fileName) {
      return NextResponse.json({ error: t('common.badRequest') }, { status: 400 })
    }

    const storage = await getMediaStorage(accountId)
    const target = await storage.prepareUpload({
      accountId,
      fileName,
      contentType: normalizeContentType(body.contentType),
      sizeBytes: body.sizeBytes ?? 0,
    })
    return NextResponse.json(target)
  } catch {
    return NextResponse.json({ error: t('common.internalError') }, { status: 500 })
  }
}
```

> Os nomes das chaves de `Api` (`common.unauthorized`, `common.profileNotLinked`, `common.badRequest`, `common.internalError`) **precisam existir** em `messages/en.json` e `pt.json` — conferir antes de escrever; se algum não existir, usar uma string já existente do bloco `Api`.

- [ ] **Step 2: `uploadAccountMedia` passa a usar o storage plugável**

Em `src/lib/storage/upload-media.ts`:

```ts
export async function uploadAccountMedia(
  bucket: string,
  file: File,
  storage?: MediaStorage,
): Promise<UploadAccountMediaResult> {
  const supabase = createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new Error(t("upload.notSignedIn"));
  }

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileErr || !profile?.account_id) {
    throw new Error(t("upload.accountUnresolved"));
  }

  const accountId = profile.account_id as string;

  // Backend plugavel: quando a conta escolheu a R2, o browser faz um
  // PUT direto numa URL pre-assinada -- os bytes nao passam pelo
  // servidor Next.
  if (storage) {
    const target = await storage.prepareUpload({
      accountId,
      fileName: file.name,
      contentType: normalizeContentType(file.type),
      sizeBytes: file.size,
    });
    if (target.mode === 'presigned' && target.url && target.headers) {
      const response = await fetch(target.url, {
        method: 'PUT',
        headers: target.headers,
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Upload failed with status ${response.status}`);
      }
      return { publicUrl: target.publicUrl, path: target.path };
    }
    const { error: upErr } = await supabase.storage
      .from(target.bucket ?? bucket)
      .upload(target.path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: normalizeContentType(file.type),
      });
    if (upErr) throw new Error(upErr.message);
    return { publicUrl: target.publicUrl, path: target.path };
  }

  // ... (caminho atual, sem storage injetado) ...
}
```

> O `getMediaStorage` roda **no servidor**; o composer (client) nao importa esse modulo. O upload do browser acontece por `POST /api/media/upload-url` (que devolve o `UploadTarget`), e o `uploadAccountMedia` com `storage` injetado existe para o **servidor**. Decidir na implementacao: o composer chama a rota `/api/media/upload-url` e faz o PUT; `uploadAccountMedia` fica para uso server-side. **Nao** deixar os dois caminhos divergirem — o composer passa a usar a rota.

- [ ] **Step 3: Composer usa a rota**

Em `src/components/inbox/message-composer.tsx`, `stageUpload` e `finalizeRecording` passam a:

```ts
const target = await requestUploadTarget(file);   // helper local
const response = await fetch(target.url!, { method: 'PUT', headers: target.headers, body: file });
```

com o helper:

```ts
/** Pede ao servidor o alvo do upload e sobe o arquivo. */
async function requestUploadTarget(file: File): Promise<UploadTarget> {
  const res = await fetch('/api/media/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || `HTTP ${res.status}`);
  }
  return payload as UploadTarget;
}
```

Quando `target.mode === 'supabase'`, o upload continua pelo client SDK (`supabase.storage.from(bucket).upload(...)`).

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run src/app/api/media src/lib/storage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/media/upload-url/route.ts src/lib/storage/upload-media.ts src/components/inbox/message-composer.tsx
git commit -m "feat(storage): upload do composer pelo backend plugavel"
```

---

### Task 6: Reparo sob demanda da mídia antiga

**Files:**
- Create: `src/app/api/media/repair/route.ts`
- Create: `src/app/api/media/repair/route.test.ts`

**Interfaces:**
- Produces: `POST /api/media/repair` com `{ messageId }` → `{ url: string }` ou `{ error }`.

- [ ] **Step 1: Escrever o teste**

`src/app/api/media/repair/route.test.ts` — cobre: repara e atualiza a row; **404** para conta alheia; idempotente quando a URL ja e duravel; erro claro quando o provedor devolve 404.

```ts
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: { id: 'u1' },
  profile: { account_id: 'acc-1' },
  message: {
    id: 'm1',
    conversation_id: 'conv-1',
    media_url: '/api/whatsapp/media/MEDIA123',
    media_type: 'image/jpeg',
    content_type: 'image',
  },
  conversationAccount: 'acc-1',
  updateCalls: [] as unknown[],
  download: vi.fn(async () => ({
    stream: new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); },
    }),
    contentType: 'image/jpeg',
  })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
    from: (table: string) => {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => {
          if (table === 'profiles') return { data: h.profile, error: null };
          if (table === 'messages') return { data: h.message, error: null };
          return { data: null, error: null };
        },
        update: (row: unknown) => { h.updateCalls.push(row); return api; },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ error: null })),
      };
      return api;
    },
  }),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: async () => ({ url: 'https://cdn.test/a.jpg', mimeType: 'image/jpeg', fileSize: 3 }),
  downloadMediaStream: h.download,
}));

describe('POST /api/media/repair', () => {
  it('re-mirrors the media and rewrites the row', async () => { /* ... */ });
  it('answers 404 for a message of another account', async () => { /* ... */ });
  it('is idempotent when the media is already durable', async () => { /* ... */ });
});
```

- [ ] **Step 2: Implementar a rota**

`src/app/api/media/repair/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMediaUrl, downloadMediaStream } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { normalizeContentType } from '@/lib/media/content-type'
import { buildMediaPath, MEDIA_MAX_BYTES } from '@/lib/storage/upload-media'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: t('common.unauthorized') }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: t('common.profileNotLinked') }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as { messageId?: string }
    const messageId = body.messageId
    if (!messageId) {
      return NextResponse.json({ error: t('common.badRequest') }, { status: 400 })
    }

    const { data: message } = await supabase
      .from('messages')
      .select('id, conversation_id, media_url, media_type, content_type')
      .eq('id', messageId)
      .maybeSingle()
    if (!message) {
      // 404 -- nao revela se a mensagem existe em outra conta.
      return NextResponse.json({ error: t('common.notFound') }, { status: 404 })
    }

    const { data: conversation } = await supabase
      .from('conversations')
      .select('account_id')
      .eq('id', message.conversation_id)
      .maybeSingle()
    if (!conversation || conversation.account_id !== accountId) {
      return NextResponse.json({ error: t('common.notFound') }, { status: 404 })
    }

    // Ja duravel? Nada a fazer.
    if (message.media_url && !message.media_url.startsWith('/api/whatsapp/media/')) {
      return NextResponse.json({ url: message.media_url })
    }

    // Meta: resolve a URL de download pelo id e baixa com o token.
    const mediaId = message.media_url?.split('/').pop() ?? ''
    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('access_token')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!config) {
      return NextResponse.json({ error: t('common.whatsappNotConfigured') }, { status: 400 })
    }
    const accessToken = decrypt(config.access_token)
    const mediaInfo = await getMediaUrl({ mediaId, accessToken })
    const { stream, contentType } = await downloadMediaStream({
      downloadUrl: mediaInfo.url,
      accessToken,
      maxBytes: MEDIA_MAX_BYTES,
    })

    const uploadType = normalizeContentType(message.media_type ?? mediaInfo.mimeType ?? contentType)
    const path = buildMediaPath(accountId, `repaired-${mediaId}.bin`, null, 'inbound')
    const { error: uploadError } = await supabase.storage
      .from('chat-media')
      .upload(path, stream, { contentType: uploadType, cacheControl: '3600', upsert: true })
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }
    const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(path)
    const url = urlData.publicUrl

    await supabase
      .from('messages')
      .update({ media_url: url })
      .eq('id', messageId)

    return NextResponse.json({ url })
  } catch {
    return NextResponse.json({ error: t('common.internalError') }, { status: 500 })
  }
}
```

> A rota acima cobre o caminho **Meta**. O caminho CRMBR (baixar a URL publica que ja esta na row) entra como um segundo bloco, resolvendo o provedor pela conta: se existir `whatsmiau_config`, baixar `message.media_url` direto; senao, o caminho Meta acima.

- [ ] **Step 3: Rodar os testes**

Run: `npx vitest run src/app/api/media/repair`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/media/repair/
git commit -m "feat(storage): reparo sob demanda da midia que o provedor ainda guarda"
```

---

### Task 7: Painel de mídia por contato + abas no inbox

**Files:**
- Create: `src/lib/media/links.ts`
- Create: `src/lib/media/links.test.ts`
- Create: `src/components/media/contact-media-panel.tsx`
- Create: `src/components/media/contact-media-panel.test.tsx`
- Modify: `src/components/inbox/contact-sidebar.tsx`

**Interfaces:**
- Consumes: `mediaFilename` (`src/lib/media/filename.ts`), `isProxiedMediaUrl` (`src/lib/media/blob-cache.ts`), `MediaLightbox`, `collectMediaGallery`, `downloadMediaMessage`.
- Produces: `extractLinks(text: string | null | undefined): ExtractedLink[]`; `ContactMediaPanel({contactId, kind, contactLabel})`.

- [ ] **Step 1: `extractLinks` + teste**

`src/lib/media/links.ts`:

```ts
export interface ExtractedLink {
  /** A URL, sem o fragmento. */
  url: string;
  /** O texto que acompanha a URL, quando ha. */
  title: string;
  /** O host, para exibir. */
  domain: string;
}

/** URL http/https. `mailto:`, `tel:` e `wa.me` sem esquema ficam de fora. */
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

/**
 * Os links de um texto de mensagem.
 *
 * Dedupe por URL normalizada (sem fragmento, `www.` normalizado) e
 * ordena pela ocorrencia mais recente -- o painel mostra o link uma
 * vez, com a data da ultima vez que ele apareceu.
 */
export function extractLinks(
  text: string | null | undefined,
): ExtractedLink[] {
  if (!text) return [];
  const found: ExtractedLink[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0].replace(/[.,;:!?)]+$/, '');
    const normalized = normalizeUrl(raw);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    found.push({
      url: raw,
      title: titleFor(text, raw),
      domain: domainOf(raw),
    });
  }
  return found;
}

function normalizeUrl(url: string): string {
  const withoutHash = url.split('#')[0] ?? url;
  return withoutHash.replace(/^https?:\/\//, '').replace(/^www\./, '');
}

function domainOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function titleFor(text: string, url: string): string {
  const trimmed = text.trim();
  return trimmed === url ? url : trimmed;
}
```

O teste cobre: duas URLs na mesma mensagem, mensagem que e so uma URL, texto sem URL, `mailto:` ignorado, dedupe por `www.`, dominio extraido.

- [ ] **Step 2: `ContactMediaPanel`**

`src/components/media/contact-media-panel.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useTranslations } from 'next-intl';
import { FileText, Link2, Loader2, Music, Play, RefreshCw, Download } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/i18n/format';
import { mediaFilename } from '@/lib/media/filename';
import { isProxiedMediaUrl } from '@/lib/media/blob-cache';
import { collectMediaGallery, type MediaGalleryItem } from '@/lib/media/gallery';
import { downloadMediaMessage } from '@/lib/media/download';
import { MediaLightbox } from '@/components/inbox/media-lightbox';
import { Button } from '@/components/ui/button';
import type { Message } from '@/types';

/** Quantos itens entram por pagina. */
export const MEDIA_PAGE_SIZE = 60;

export type ContactMediaKind = 'media' | 'documents' | 'links';

interface ContactMediaPanelProps {
  contactId: string;
  kind: ContactMediaKind;
  contactLabel: string;
}
```

O corpo:

- `useState` para `items`, `loading`, `error`, `hasMore`, `page`.
- `loadMore` monta a query por `kind`:
  - `media`: `.in('content_type', ['image','video','audio'])`
  - `documents`: `.eq('content_type', 'document')`
  - `links`: `.eq('content_type', 'text').like('content_text', '%http%')`
  - `.eq('conversations.contact_id', contactId)`, `.order('created_at', {ascending:false})`, `.range(from, from + MEDIA_PAGE_SIZE - 1)`.
- `media` e `documents` renderizam a partir de `messages`; `links` extrai com `extractLinks` e achata em uma lista `{id, url, title, domain, createdAt}`.
- Item de mídia: thumbnail (`<img>` para imagem, `<video>` para vídeo), clique abre o `MediaLightbox` com `collectMediaGallery(messages)`.
- Item de documento: ícone, nome via `mediaFilename(message)`, data, botão de download (`downloadMediaMessage`).
- Item não durável (`isProxiedMediaUrl(message.media_url)`): botão "Restaurar" que chama `POST /api/media/repair` com o `messageId` e, em sucesso, substitui a URL na lista.
- Estados: `loading` → skeleton; `error` → mensagem + "Tentar de novo"; lista vazia → texto de vazio.

- [ ] **Step 3: Abas no painel do inbox**

Em `src/components/inbox/contact-sidebar.tsx`:

- Extrair o cabeçalho (foto, nome, telefone) para fora do `ScrollArea`, num bloco fixo.
- Envolver o restante em `Tabs` com `TabsList` de 4 triggers: `Sobre`, `Mídia`, `Documentos`, `Links`.
- `TabsContent value="sobre"` → o conteúdo atual (tags, negócios, notas).
- Os outros três → `<ContactMediaPanel contactId={contact.id} kind={...} contactLabel={displayName} />`.

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run src/lib/media/links.test.ts src/components/media`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media/links.ts src/lib/media/links.test.ts src/components/media/ src/components/inbox/contact-sidebar.tsx
git commit -m "feat(inbox): abas de midia, documentos e links no painel do contato"
```

---

### Task 8: Abas de mídia na aba Contatos

**Files:**
- Modify: `src/components/contacts/contact-detail-view.tsx`

**Interfaces:**
- Consumes: `ContactMediaPanel` (Task 7).

- [ ] **Step 1: Adicionar as 3 abas**

No `TabsList` existente de `contact-detail-view.tsx`, adicionar:

```tsx
<TabsTrigger value="media" className="flex-none data-active:bg-muted data-active:text-primary text-muted-foreground">
  {t('tabs.media')}
</TabsTrigger>
<TabsTrigger value="documents" className="flex-none data-active:bg-muted data-active:text-primary text-muted-foreground">
  {t('tabs.documents')}
</TabsTrigger>
<TabsTrigger value="links" className="flex-none data-active:bg-muted data-active:text-primary text-muted-foreground">
  {t('tabs.links')}
</TabsTrigger>
```

E os `TabsContent` correspondentes, cada um com o `ContactMediaPanel` e o `contactId`/`contactLabel` do contato aberto.

- [ ] **Step 2: Verificar**

Run: `npm run typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/contacts/contact-detail-view.tsx
git commit -m "feat(contacts): abas de midia, documentos e links no detalhe do contato"
```

---

### Task 9: Configurações → Mídia

**Files:**
- Create: `src/app/api/media/settings/route.ts`
- Create: `src/components/settings/media-settings.tsx`
- Modify: `src/components/settings/settings-page-client.tsx` (ou a página que lista as seções de Configurações)
- Test: `src/app/api/media/settings/route.test.ts`

**Interfaces:**
- Produces: `GET /api/media/settings` → `{ backend, bucket, maxFileBytes, publicBaseUrl, r2Configured, r2Missing }`; `PUT /api/media/settings` com o mesmo corpo de escrita.

- [ ] **Step 1: Rota de configuração**

`src/app/api/media/settings/route.ts`:

- `GET`: autentica, resolve a conta, le `media_settings` (ou o default), e devolve **apenas** o status da R2 — `r2Configured: boolean` e `r2Missing: string[]` (nomes das variáveis, **nunca os valores**).
- `PUT`: autentica, exige `account_role = 'admin'` (ou a policy `is_account_member(account_id, 'admin')` deixa barrar), valida `backend ∈ {supabase, r2}`, `maxFileBytes ∈ {25MB, 50MB, 100MB}`, e faz `upsert` em `media_settings` com `onConflict: 'account_id'`.

- [ ] **Step 2: UI de Configurações**

`src/components/settings/media-settings.tsx`:

- `RadioGroup` para o backend (Supabase / R2).
- `Input` para o bucket (visível só no backend Supabase).
- `Select` para o limite (25 / 50 / 100 MB).
- `Input` para a URL pública base (opcional).
- Bloco de status da R2: quando o backend é R2 e faltam env, mostrar os **nomes** das variáveis faltando; quando está tudo certo, mostrar "pronto".
- Botão salvar → `PUT /api/media/settings` → toast.

- [ ] **Step 3: Ligar a seção nas Configurações**

Adicionar o bloco `MediaSettings` na lista de seções de `settings-page-client.tsx`, seguindo o padrão das outras (ex.: o bloco CRMBR).

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run src/app/api/media/settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/media/settings/ src/components/settings/media-settings.tsx src/components/settings/settings-page-client.tsx
git commit -m "feat(settings): configuracao de storage por conta"
```

---

### Task 10: i18n, docs e verificação final

**Files:**
- Modify: `messages/en.json`, `messages/pt.json`, `messages/es.json`, `messages/ko.json`
- Create: `docs/media.md`

**Interfaces:**
- Consumes: todas as strings novas dos Tasks 7–9.

- [ ] **Step 1: Strings novas**

Adicionar nos 4 idiomas, nos blocos existentes:

- `Inbox.sidebar.tabs.{about,media,documents,links}`
- `Inbox.sidebar.media.{empty,loading,error,retry,restore,restoreFailed,download,unavailable}`
- `Contacts.detailView.tabs.{media,documents,links}`
- `Contacts.detailView.media.{empty,loading,error,retry,restore,restoreFailed,download,unavailable}`
- `Settings.media.{title,description,backend,bucket,maxSize,publicBaseUrl,save,saved,r2Ready,r2Missing,backendSupabase,backendR2}`

> Os blocos de mídia de Inbox e de Contacts podem compartilhar as mesmas chaves (`Contacts.detailView.media.*`) para nao duplicar texto — **verificar** a estrutura de `messages/en.json` antes e reusar o bloco que ja existir.

- [ ] **Step 2: Documentação**

`docs/media.md` — como a mídia é guardada, os dois backends, o que a normalização de tipo faz e por quê, os limites, o reparo sob demanda e o que **não** é recuperável.

- [ ] **Step 3: Verificação final**

```bash
npm run typecheck
npx vitest run
npm run lint
npx next build
```

Expected: typecheck sem erros, todos os testes passando, lint sem erros novos, build compilando.

- [ ] **Step 4: Commit**

```bash
git add messages/ docs/media.md
git commit -m "feat(i18n): textos da galeria de midia nos quatro idiomas"
```

---

## Notas de execução

- **Ordem importa:** a Task 3 (storage) vem antes da 4 (espelho) porque o espelho passa a escrever pelo `MediaStorage`.
- **A migration 066 precisa ser aplicada no Supabase** pelo usuário antes de a Task 9 (Configurações) funcionar — até lá, `readMediaSettings` cai no default (Supabase) e nada quebra.
- **`aws4fetch`**: conferir a assinatura instalada (`sign(url, {method, headers, accessKeyId, secretAccessKey, aws: {signQuery, region, service}, expires})`) antes de escrever o teste da Task 3 — a forma exata do objeto de opcoes muda entre versões.
- **Verificação**: `npx vitest run` deve terminar com **todos** os testes verdes (o baseline atual é 159 arquivos / 1779 testes).
