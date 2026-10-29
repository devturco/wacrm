# Mídia durável em bucket + abas Mídia / Documentos / Links por contato — Design

**Data:** 2026-10-29
**Status:** design aprovado no brainstorming (2026-10-29) · aguardando revisão do spec escrito
**Escopo:** armazenamento de toda mídia trocada em conversa (imagem, vídeo, áudio, PDF, documentos, planilhas, qualquer formato) + painel por contato no estilo WhatsApp Web

---

## 1. Objetivo

Resolver a complaint recorrente dos clientes — *"as mídias se perdem"* — e expor tudo o que foi trocado com um contato, tanto na caixa de entrada quanto na aba Contatos.

O app **já tem** um pipeline de mídia durável: o bucket público `chat-media`, o espelho do inbound (Meta e CRMBR) e o upload do composer. O que **não** funciona é a **política do bucket**: a lista de MIME é fechada e o teto é 16 MB, então o espelho falha e a mensagem fica só com a URL do provedor — que expira.

Além disso, duas superfícies novas de UI:

1. **Caixa de entrada** — o painel do contato vira abas `Sobre | Mídia | Documentos | Links`.
2. **Aba Contatos** — a Sheet de detalhe do contato ganha as mesmas 3 abas de mídia.

---

## 2. Decisões tomadas

| # | Decisão | Escolha |
|---|---|---|
| D1 | Backend de storage | **Plugável**: Supabase Storage agora (padrão, zero risco), Cloudflare R2 como segunda opção configurável |
| D2 | Teto por arquivo | **100 MB** (o mesmo limite que o WhatsApp aplica a documentos) |
| D3 | Mídia já existente | **Reparo sob demanda** — o usuário clica e o servidor re-espelha o que ainda estiver vivo no provedor |
| D4 | Painel do inbox | **Abas** `Sobre \| Mídia \| Documentos \| Links` — "Sobre" guarda o conteúdo atual (tags, negócios, notas) |
| D5 | Origem da galeria | **Derivada de `messages`** — nenhuma tabela nova de mídia |
| D6 | Formato aceito | **Qualquer** — o tipo declarado é normalizado para `application/octet-stream` quando não é seguro serv inline |
| D7 | Bucket (Supabase) | `file_size_limit` 16 MB → **100 MB**; `allowed_mime_types` = lista segura inline **+ `application/octet-stream`** |
| D8 | Configuração | Tabela `media_settings` por conta, editável em **Configurações → Mídia**; credenciais da R2 em **env server-only** |
| D9 | Escopo da R2 nesta entrega | A **interface plugável** e a implementação R2 entram; o **domínio público** (`media.crmbr.com`) é provisioned pelo usuário na Cloudflare |
| D10 | Tables | Migration nova cria `media_settings`; **nenhuma tabela existente muda de schema** |

---

## 3. Por que a mídia se perde hoje

O bucket `chat-media` foi criado com uma lista de MIME **fechada** (~18 tipos) em `supabase/migrations/023_chat_media.sql` e ampliada em `039_inbound_media_mirror.sql`. Dois furos:

1. **Rejeição.** Qualquer arquivo fora da lista é recusado pelo Storage — inclusive para o service role. O espelho devolve `null` e o chamador **mantém a URL do provedor**, que expira.
2. **O fallback também é recusado.** Quando o provedor não informa o MIME, o espelho usa `application/octet-stream` (`src/lib/whatsapp/mirror-inbound-media.ts:197`) — e esse tipo **não está na lista**. Ou seja: *todo anexo de tipo desconhecido é descartado silenciosamente*.

Somado ao teto de **16 MB** (o WhatsApp aceita documentos até 100 MB), o resultado é que `.zip`, `.csv`, `.odt`, `.heic`, `.rar`, `.json`, `.7z` e qualquer PDF grande nunca são persistidos.

**Isto é a causa raiz da complaint.** A arquitetura de bucket está certa; a política é que está errada.

---

## 4. Storage plugável

### 4.1 Interface

Novo diretório `src/lib/media/storage/`:

```ts
export type MediaBackend = 'supabase' | 'r2';

export interface UploadTarget {
  /** Onde o browser envia os bytes. */
  mode: 'supabase' | 'presigned';
  /** Caminho do objeto (account-scoped). */
  path: string;
  /** Bucket — só no modo `supabase`. */
  bucket?: string;
  /** URL pré-assinada — só no modo `presigned`. */
  url?: string;
  /** Headers exigidos no PUT — só no modo `presigned`. */
  headers?: Record<string, string>;
  /** URL pública final do objeto. */
  publicUrl: string;
}

export interface MediaStorage {
  readonly backend: MediaBackend;
  prepareUpload(a: {
    accountId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<UploadTarget>;
  put(a: {
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

### 4.2 Implementação Supabase (`storage/supabase.ts`)

 Embrulha o que já existe (`supabase.storage.from(bucket)`), com o upload direto do browser que o composer já faz hoje (`src/lib/storage/upload-media.ts`). `prepareUpload` devolve `{ mode: 'supabase', bucket, path, publicUrl }` e o client-side usa o SDK, sem mudança de fluxo.

### 4.3 Implementação R2 (`storage/r2.ts`)

S3-compatible, endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<R2_BUCKET>/<key>`.

- **Assinatura:** AWS Signature Version 4, região `auto`, serviço `s3`, `x-amz-content-sha256: UNSIGNED-PAYLOAD` (permite streaming sem hashear o corpo antes). Implementada com a dependência **`aws4fetch`** (~6 KB) — o repo não tem SDK AWS e não vamos escrever SigV4 à mão.
- **Upload do browser:** `prepareUpload` devolve uma **URL pré-assinada de PUT** (`mode: 'presigned'`), com validade de 15 minutos. O browser faz `fetch(url, { method: 'PUT', body: file, headers })` direto no R2 — os 100 MB **não passam pelo servidor Next**.
- **Upload do servidor** (espelho inbound): `put()` faz o PUT assinado com streaming direto do corpo.
- **Leitura:** URL pública `https://<MEDIA_PUBLIC_BASE_URL>/<key>`. O bucket precisa ser público atrás de um domínio próprio (`media.crmbr.com`), porque o **Meta baixa a mídia sem autenticação** — a mesma premissa do `chat-media` público de hoje.
- **Credenciais:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — **env, server-only**. Nunca são lidas no browser (Constraint global 5).

### 4.4 Seleção do backend

`getMediaStorage(accountId)` (server-side, service role) lê `media_settings` e devolve a implementação correspondente; **sem linha → Supabase**, que é o comportamento de hoje. O browser lê só `backend`/`bucket`/`public_base_url` da `media_settings` (RLS: membros podem ler) — nunca credenciais.

---

## 5. Política do bucket e normalização de tipo

### 5.1 Lista de MIME

`allowed_mime_types` do `chat-media` passa a ser a lista **segura** (o que pode ser servido inline) **+ `application/octet-stream`**:

- Imagem: `image/png`, `image/jpeg`, `image/jpg`, `image/webp`, `image/gif`
- Vídeo: `video/mp4`, `video/3gpp`, `video/quicktime`
- Áudio: `audio/ogg`, `audio/opus`, `audio/mpeg`, `audio/mp4`, `audio/aac`, `audio/amr`
- Documento: `application/pdf`, `text/plain`
- Office legado: `application/msword`, `application/vnd.ms-excel`, `application/vnd.ms-powerpoint`
- Office OOXML: os três `application/vnd.openxmlformats-officedocument.*`
- ODF: `application/vnd.oasis.opendocument.{text,spreadsheet,presentation,graphics}`
- **Catch-all:** `application/octet-stream`

### 5.2 Normalização (o que garante "qualquer formato")

Novo módulo `src/lib/media/content-type.ts`:

```ts
export function normalizeContentType(mime: string | null | undefined): string {
  const base = (mime ?? '').split(';')[0].trim().toLowerCase();
  if (!base.includes('/')) return 'application/octet-stream';
  return INLINE_SAFE_MIME_TYPES.has(base) ? base : 'application/octet-stream';
}
```

Regra: **MIME desconhecido ou perigoso (`text/html`, `image/svg+xml`, `application/xhtml+xml`, …) → `application/octet-stream`**. O browser **baixa** o arquivo em vez de renderizar — nenhum conteúdo ativo é servido inline (sem XSS no domínio da mídia), e **nada é jamais rejeitado**, porque `application/octet-stream` está na lista.

A extensão original do arquivo é **preservada** no caminho do objeto (o `Content-Type` é que governa a renderização). Download de `.html`/`.svg` mantém o nome — é o mesmo comportamento de qualquer cliente de e-mail.

### 5.3 Limites

| Constante | Valor | Origem |
|---|---|---|
| `MEDIA_MAX_BYTES` (bucket) | `104857600` (100 MB) | teto novo |
| `MEDIA_MAX_BYTES_BY_KIND.image` | 5 MB | limite do WhatsApp |
| `MEDIA_MAX_BYTES_BY_KIND.video` | 16 MB | limite do WhatsApp |
| `MEDIA_MAX_BYTES_BY_KIND.audio` | 16 MB | limite do WhatsApp |
| `MEDIA_MAX_BYTES_BY_KIND.document` | **100 MB** | limite do WhatsApp (era 16 MB) |

`MEDIA_MAX_BYTES` é o teto externo do bucket; os limites por tipo são regras de negócio do app, aplicados no composer e no espelho.

O limite efetivo de um arquivo é:

```
min( max_file_bytes da conta , MEDIA_MAX_BYTES_BY_KIND[kind] , MEDIA_MAX_BYTES )
```

O primeiro vem da tabela `media_settings` (§10) e **substitui** o default de 100 MB — mas nunca pode ultrapassar o `file_size_limit` do bucket, que é a última palavra.

---

## 6. Espelho inbound em 100 MB, com streaming

Hoje o webhook **bufferiza o arquivo inteiro em memória** (`downloadMedia` → `arrayBuffer()`; `downloadWhatsmiauMedia` → `arrayBuffer()`), e a checagem de tamanho vem **depois** do download.

Novo fluxo, nos dois provedores:

1. **Antes de baixar**, se o provedor anuncia `file_size` acima do limite → pula (já é o caso no caminho Meta).
2. **Baixa em streaming**, contando os bytes conforme chegam; ao passar do limite, **aborta** o stream (`reader.cancel()`).
3. **Sobe** o stream direto (Supabase `upload()` e R2 PUT aceitam `ReadableStream`), com `contentType` já normalizado (§5.2).

Resultado: memória plana (um 80 MB não vira 80 MB de RAM × 2), e o teto de 100 MB vale de verdade.

O espelho continua **best-effort**: qualquer falha devolve `null` e o chamador mantém a URL do provedor — o webhook nunca quebra por causa de mídia.

---

## 7. Reparo sob demanda

O anexo quebrado é exatamente o que **ainda está com a URL do provedor** na row — o espelho falhou e `if (mirrored) mediaUrl = mirrored` nunca rodou (`src/lib/whatsapp/providers/whatsmiau/inbound.ts:396`; o mesmo padrão no webhook do Meta). Por isso o reparo **não precisa de coluna nova**: a URL de origem já está em `messages.media_url`.

Rota nova `POST /api/media/repair`:

```json
{ "messageId": "<uuid>" }
```

Fluxo (server-side, service role):

1. Carrega a mensagem + a conversa + a conta. **Conta de outra conta → 404** (Constraint global 7).
2. Se `media_url` **não** é URL de proxy/provedor → já é durável → devolve a mesma URL (idempotente).
3. Senão, resolve o provedor da conta:
   - **Meta**: `whatsapp_config` → `getMediaUrl(mediaId)` → download com o access token → espelha no bucket.
   - **CRMBR**: `whatsmiau_config` → baixa a URL pública que já está na row → espelha no bucket.
4. `UPDATE messages SET media_url = <url durável>` e devolve `{ url }`.
5. Falha (provedor já apagou o arquivo) → erro de negócio com mensagem clara; a UI mantém o item marcado como indisponível.

**Limite real:** mídia que o provedor já expirou **não tem volta**. O reparo só alcança o que ainda está vivo na janela do provedor.

---

## 8. A galeria sai de `messages` — sem tabela nova

Tudo é derivado por JOIN `messages → conversations` filtrando `conversations.contact_id`. A RLS de `messages` é account-scoped (`messages_select` → `is_account_member(c.account_id)` em `017_account_sharing.sql`), e os índices `idx_conversations_contact_id` e `idx_messages_conversation` já existem — a query é barata e não vaza entre contas.

**Uma query por aba**, carregada sob demanda, paginada em 60 itens com "carregar mais":

| Aba | Filtro |
|---|---|
| Mídia | `content_type IN ('image','video','audio')` |
| Documentos | `content_type = 'document'` |
| Links | `content_type = 'text' AND content_text LIKE '%http%'` |

A forma da query (client-side, via SDK):

```ts
supabase
  .from('messages')
  .select('id, content_type, content_text, media_url, media_type, created_at, sender_type, conversations!inner(contact_id)')
  .eq('conversations.contact_id', contactId)
  .in('content_type', ['image', 'video', 'audio'])
  .order('created_at', { ascending: false })
  .range(from, from + 59);
```

### 8.1 Dados derivados

| O que a UI mostra | De onde vem |
|---|---|
| Nome do arquivo (Documentos) | `mediaFilename(message)` — [`src/lib/media/filename.ts:150`](../../../src/lib/media/filename.ts#L150) (usa `content_text` ou o basename da URL espelhada) |
| Tipo do arquivo | `media_type` do inbound; extensão do nome no outbound |
| Durabilidade | `isProxiedMediaUrl(media_url)` — [`src/lib/media/blob-cache.ts`](../../../src/lib/media/blob-cache.ts) |
| Enviado/recebido | `sender_type` (`customer` / `agent` / `bot`) |
| Data | `created_at` |

**Tamanho do arquivo não é exibido** — `messages` não guarda o tamanho e não vale a pena um HEAD por item na renderização. Limitação conhecida e aceita.

### 8.2 Links

Função pura `extractLinks(text)` em `src/lib/media/links.ts`:

- Regex de URL (`https?://…`), ignora `mailto:`, `tel:` e `wa.me` sem esquema.
- Dedupe por URL normalizada (sem fragmento, com `www.` normalizado), mantendo a ocorrência **mais recente**.
- Título: o texto da mensagem quando a URL é a mensagem inteira; senão, a própria URL.
- Domínio exibido a partir do host.

Sem preview/`og:image` — buscá-lo seria um fetch arbitrário por link do cliente (YAGNI, e risco de SSRF).

---

## 9. UI

### 9.1 Componente compartilhado

Novo `src/components/media/contact-media-panel.tsx` — usado nas **duas** superfícies, sem duplicar lógica:

```tsx
interface ContactMediaPanelProps {
  contactId: string;
  kind: 'media' | 'documents' | 'links';
  /** Rótulo do contato, usado no cabeçalho do lightbox. */
  contactLabel: string;
}
```

Internamente: carrega a página do `kind` pedido, com "carregar mais"; reusa `MediaLightbox` + `collectMediaGallery` para a visualização full-size, e `downloadMediaMessage` para baixar.

### 9.2 Caixa de entrada

`src/components/inbox/contact-sidebar.tsx` (280 px, recolhível, desktop-only):

- **Cabeçalho fixo** no topo: foto, nome, telefone (hoje está dentro do `ScrollArea` — sai de lá).
- **Abas** `Sobre | Mídia | Documentos | Links` usando o `Tabs` do kit (`src/components/ui/tabs.tsx`, base-ui).
- **Sobre**: o conteúdo atual — tags, negócios, notas — sem alteração de comportamento.
- **Mídia**: grade de 3 colunas de thumbnails (imagem/vídeo); áudio como item de lista com botão de play. Clique abre o `MediaLightbox`.
- **Documentos**: lista com ícone por tipo, nome, data, botão de download.
- **Links**: lista com domínio, título, data; clique abre em nova aba.

### 9.3 Aba Contatos

`src/components/contacts/contact-detail-view.tsx`: as 3 abas (`Mídia`, `Documentos`, `Links`) entram no `TabsList` existente, ao lado de `details | tags | notes | custom | deals`. O `TabsList` já tem `overflow-x-auto` (a lista atual tem 5 abas de larguras muito diferentes) — 8 abas continuam funcionando.

### 9.4 Estados

Em cada aba: **carregando** (skeleton), **vazio** ("Nenhuma mídia ainda" / "Nenhum documento" / "Nenhum link"), **erro** (mensagem + botão de tentar de novo). Um item indisponível (mídia expirada e não reparável) aparece com o estado "Indisponível" e o botão **Restaurar** (reparo sob demanda, §7) — nunca quebra a aba inteira.

---

## 10. Configurações → Mídia

Bloco novo em Configurações, alimentado pela tabela `media_settings`:

| Campo | Tipo | Default |
|---|---|---|
| `backend` | `supabase` \| `r2` | `supabase` |
| `bucket` | texto (bucket do Supabase) | `chat-media` |
| `max_file_bytes` | inteiro | `104857600` (100 MB) |
| `public_base_url` | texto, opcional | vazio (usa a URL padrão do backend) |
| `updated_at` | timestamp | `NOW()` |

- Escolha do backend por `RadioGroup` (`src/components/ui/radio-group.tsx`).
- Limite por `Select` (25 / 50 / 100 MB).
- **Credenciais da R2 não são editáveis na UI** — são env server-only. A UI apenas mostra o **status**: "R2 selecionada, mas faltam `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` no ambiente" quando ausência (nomes das variáveis, **nunca os valores**).
- `public_base_url` permite que a conta aponte para um domínio próprio (ex.: CDN da marca do cliente).

---

## 11. Migration 066

`supabase/migrations/066_media_settings_and_bucket.sql`:

1. `CREATE TABLE IF NOT EXISTS media_settings` — colunas da §10, `account_id` PK com `REFERENCES accounts(id) ON DELETE CASCADE`.
2. `ALTER TABLE media_settings ENABLE ROW LEVEL SECURITY` + políticas:
   - `media_settings_select` — `USING (is_account_member(account_id))`
   - `media_settings_upsert` — `FOR ALL` com `is_account_member(account_id, 'admin')`
3. `INSERT INTO storage.buckets … ON CONFLICT (id) DO UPDATE` para o `chat-media`: `file_size_limit = 104857600`, `allowed_mime_types` = lista da §5.1.

**Nenhuma tabela existente muda de schema** — só criação, como manda a regra do projeto.

---

## 12. Erros e resiliência

| Situação | Comportamento |
|---|---|
| Falha no espelho inbound | `null` → a row mantém a URL do provedor. O webhook **não** quebra (best-effort já existente) |
| Falha no reparo | Toast com a mensagem; o item segue marcado como indisponível |
| Storage fora do ar | A aba inteira mostra o estado de erro; as outras abas seguem funcionando |
| MIME desconhecido | Normalizado para `application/octet-stream` (§5.2) — nunca rejeitado |
| Arquivo acima do limite | Pulado **antes** do download (quando o provedor anuncia o tamanho) ou abortado no streaming |
| Backend R2 sem credenciais | A UI de Configurações mostra o que falta; o app continua no Supabase |

---

## 13. Testes

| Arquivo | Cobertura |
|---|---|
| `src/lib/media/content-type.test.ts` | Normalização: HTML/SVG → octet-stream; PDF preservado; `image/jpeg; charset=binary` → `image/jpeg`; MIME ausente → octet-stream; `image/jpg` preservado |
| `src/lib/media/storage.test.ts` | `buildMediaPath` inalterado; Supabase: `prepareUpload`/`put`/`remove` com storage fakeado; R2: URL pré-assinada com `fetch` mockado (assert de método, headers e `X-Amz-Signature`), `put` com stream |
| `src/lib/media/links.test.ts` | Extração: múltiplas URLs numa mensagem, sem http, `mailto:`/`tel:` ignorados, dedupe por URL normalizada, título a partir do texto |
| `src/components/media/contact-media-panel.test.tsx` | Query certa por `kind`; paginação ("carregar mais"); estados vazio/carregando/erro |
| `src/app/api/media/repair.test.ts` | Repara e atualiza a `messages.media_url`; **404** para conta alheia; idempotente quando já é durável; erro claro quando o provedor já apagou |
| `src/app/api/media/upload-url.test.ts` | Presigned URL para conta da sessão; **404**/negação para conta alheia; devolve `{ mode:'supabase' }` quando o backend é Supabase |
| `src/lib/whatsapp/mirror-inbound-media.test.ts` (existente) | Continua passando; casos novos: limite de 100 MB, normalização do content-type, stream abortado no limite |
| `src/lib/whatsapp/providers/whatsmiau/mirror-media.test.ts` | Idem para o caminho CRMBR |

**i18n:** toda string nova em `en.json`, `pt.json`, `es.json`, `ko.json`.

**Verificação final:** `npm run typecheck`, `npx vitest run`, `npm run lint`, `npx next build`.

---

## 14. Fora de escopo (YAGNI)

- Preview / `og:image` dos links.
- Download em ZIP.
- Thumbnails gerados (usa a própria imagem).
- Versionamento de arquivos.
- Galeria de áudio separada (áudio entra em "Mídia").
- Migração dos objetos já existentes no Supabase para a R2 — os dois convivem; a migração de bytes fica para depois, se e quando a conta trocar.
- Contagem de espaço usado nas Configurações (opcional, requer listagem do bucket).
- Recuperação de mídia que o provedor já apagou (impossível por definição).

---

## 15. Riscos e limites conhecidos

1. **A R2 exige um domínio público** provisioned pelo usuário na Cloudflare (`media.crmbr.com` → bucket R2). Sem isso, o outbound para o WhatsApp quebra, porque o Meta não autentica no fetch. O bucket R2 **precisa** ser público — a separação por conta continua no path `account-<uuid>/…` (mesma premissa do `chat-media` de hoje, whose URLs are unguessable).
2. **A normalização é a defesa principal contra conteúdo ativo; a lista de MIME é a segunda.** A lista do bucket **não** inclui `text/html`, `image/svg+xml` nem `application/xhtml+xml` — quem subir direto no bucket pelo SDK com um desses tipos é **recusado** pelo Storage. E o app, que é quem decide o `Content-Type` de tudo que sobe, nunca declara esses tipos (§5.2). As duas barreiras são independentes e nenhuma delas depende da outra.
3. **O tamanho do arquivo não aparece** na aba Documentos (§8.1).
4. **`mediaFilename()` tem um caso frágil com a CRMBR**: o basename espelhado é `<mediaId>-<nome>.<ext>`, e `basenameFromUrl` só remove prefixos de 10+ dígitos (`^\d{10,}-`). Se o `mediaId` da CRMBR não tiver 10+ dígitos, o nome exibido carrega o prefixo. **Ação no plano:** normalizar o prefixo do objeto para uma forma que o `basenameFromUrl` remova de forma determinística (ex.: sempre prefixar `m<mediaId>-` e ampliar a regex), sem quebrar os objetos já gravados.
5. **A galeria cresce com o histórico**: paginação em 60 itens resolve; não há, por enquanto, virtualização nem cache persistente das páginas.

---

## 16. Ordem de implementação

O plano de implementação (skill `writing-plans`) vai decompor em:

1. Migration 066 (`media_settings` + bucket).
2. `content-type.ts` — normalização.
3. `MediaStorage` plugável (Supabase + R2) + `aws4fetch`.
4. Espelho inbound: 100 MB, streaming, normalização.
5. Composer: upload plugável (presigned no R2) + rota `POST /api/media/upload-url`.
6. Reparo sob demanda: rota `POST /api/media/repair` + botão na UI.
7. `contact-media-panel.tsx` + abas no inbox.
8. Abas no Contatos (Sheet).
9. Configurações → Mídia.
10. i18n (4 idiomas) + docs (`docs/media.md`).
