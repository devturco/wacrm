# Provider de API WhatsApp não-oficial (CRMBR / WhatsMiau) — Design

**Data:** 2026-10-27
**Status:** design aprovado no brainstorming (2026-10-27) · aguardando revisão do spec escrito
**Referência do provider:** [`docs/whatsmiau.md`](../../whatsmiau.md) (referência técnica da WhatsMiau Cloud API v2, consultada em 27/10/2026)

---

## 1. Objetivo

Adicionar um **segundo provedor de API WhatsApp**, não-oficial (WhatsMiau, comercializada como **API CRMBR**), ao lado do provedor oficial Meta Cloud API já existente no app — de forma que:

1. as duas APIs **coexistam** sem quebrar o caminho Meta existente;
2. o trabalho novo fique **isolado** do mantenedor upstream do repositório (`ArnasDon/wacrm`), para que os updates dele continuem sendo mergeados sem arrastar os módulos novos;
3. cada empresa (conta) que adotar a API CRMBR tenha **controle pleno das configurações da sua instância** na WhatsMiau.

## 2. Decisões tomadas

| # | Decisão | Escolha |
|---|---|---|
| D1 | Qual provedor | WhatsMiau Cloud API v2 (`https://api.whatsmiau.dev/v2`) |
| D2 | Nome no código vs. na UI | código: `whatsmiau` · UI: **API CRMBR (não oficial)** |
| D3 | Coexistência | **Troca**: uma API ativa por conta (`is_active`) |
| D4 | Provisionamento da instância | **Criar instância + QR code dentro do app** |
| D5 | Templates | **Bloquear** na CRMBR (não existe endpoint de template) |
| D6 | Escopo da v1 | **Paridade** com o que o app já expõe (texto, mídia, interativas, reação, typing, inbound, status) |
| D7 | Abordagem de arquitetura | **Despacho no core** (adaptador + um ponto de corte), sem duplicar o core |
| D8 | `baseUrl` | Configurável (default cloud; abre porta pra self-hosted) |
| D9 | `readMessages` | Exposto como switch, **default off**, usuário liga se quiser |
| D10 | Tela de config da instância | Espelha a aba "Configurações" do painel da WhatsMiau |
| D11 | Webhook da CRMBR | Rota própria (`/api/whatsmiau/webhook`) com header `Authorization` customizado |

## 3. Princípio de isolamento

O mantenedor upstream mantém `meta-api.ts`, o webhook do Meta, a tabela `whatsapp_config` e a UI da Meta. A regra que governa todo o design:

> **Todo código novo vive em arquivos que o upstream nunca vai tocar.**
> Onde o app existente precisar agir, o toque é **pequeno, no topo da função** (imports + resolução de credencial) — nunca no meio da lógica.

Consequência prática: se o upstream mudar a assinatura de `meta-api.sendTextMessage`, o que quebra é `providers/meta/adapter.ts` — **arquivo nosso** — virando erro de tipo do TypeScript. Erro de tipo se conserta em minutos; conflito de merge não.

## 4. Arquitetura

### 4.1 Mapa de arquivos

```
src/lib/whatsapp/providers/                    ← NOVO (100% nosso)
├── types.ts            contrato Provider + ProviderConnection
├── index.ts            dispatcher público (sendTextMessage, sendMediaMessage, …)
├── connection.ts       resolveProviderConnection(accountId) → API ativa
├── meta/
│   └── adapter.ts      delega para @/lib/whatsapp/meta-api  (meta-api.ts INTOCADO)
└── whatsmiau/
    ├── client.ts       HTTP: baseUrl + header `apikey` + WhatsmiauApiError
    ├── api.ts          sendText/Media/Audio/Buttons/List/Reaction/Presence
    ├── instances.ts    create / connect(QR) / state / update / logout / delete
    ├── webhook.ts      parser do envelope {event, instance, data}
    ├── normalize.ts    payload WhatsMiau → modelo interno do app
    ├── event-samples.ts amostras JSON por evento (extraídas de docs/whatsmiau.md)
    └── adapter.ts      implementa o contrato

src/app/api/whatsmiau/                         ← NOVO
├── webhook/route.ts                 POST (eventos) · GET (health)
├── instances/route.ts               GET lista · POST cria
├── instances/[name]/route.ts        GET estado · PUT update · DELETE
├── instances/[name]/connect/route.ts GET QR base64 + pairing code
├── settings/route.ts                GET config da conta · PATCH flags · POST salvar
└── active/route.ts                  POST alternar a API ativa

src/components/settings/
├── whatsmiau-config.tsx             ← NOVO (tela /settings/whatsapp/crmbr)
├── whatsmiau-webhook-card.tsx       ← NOVO (config do webhook, no formato do painel)
├── whatsmiau-instance-card.tsx      ← NOVO (comportamentos da instância)
└── whatsapp-hub.tsx                 ← NOVO (hub /settings/whatsapp)

src/app/(dashboard)/settings/whatsapp/         ← NOVO (rotas reais)
├── layout.tsx          shell da Settings com "WhatsApp" ativo no rail
├── page.tsx            HUB
├── meta/page.tsx       <WhatsAppConfig /> (o de hoje, sem alteração)
└── crmbr/page.tsx      <WhatsmiauConfig />

supabase/migrations/060_whatsmiau_provider.sql ← NOVO
docs/whatsmiau.md                               ← NOVO (referência do provider)
docs/integracao/whatsmiau-upstream.md          ← NOVO (protocolo de merge)
```

### 4.2 Contrato

```ts
// src/lib/whatsapp/providers/types.ts
export type ProviderId = 'meta' | 'whatsmiau';

export interface MetaConnection {
  provider: 'meta';
  phoneNumberId: string;
  accessToken: string;
}

export interface WhatsmiauConnection {
  provider: 'whatsmiau';
  instanceName: string;
  apiKey: string;
  baseUrl: string;
}

export type ProviderConnection = MetaConnection | WhatsmiauConnection;
```

O dispatcher exporta **os mesmos nomes** que `meta-api.ts` usa hoje, com a conexão no primeiro argumento:

```ts
sendTextMessage(conn, { to, text, contextMessageId? })
sendMediaMessage(conn, { to, kind, link, caption?, filename?, contextMessageId? })
sendTemplateMessage(conn, { to, templateName, … })          // lança em 'whatsmiau'
sendInteractiveButtons(conn, { to, bodyText, headerText?, footerText?, buttons, contextMessageId? })
sendInteractiveList(conn, { to, bodyText, buttonLabel, headerText?, footerText?, sections, contextMessageId? })
sendReactionMessage(conn, { to, messageId, emoji })
sendTypingIndicator(conn, { to })
```

### 4.3 Resolução da API ativa

```ts
// src/lib/whatsapp/providers/connection.ts
export async function resolveProviderConnection(
  db: SupabaseClient,
  accountId: string
): Promise<ProviderConnection>
```

1. Lê `whatsmiau_config` da conta.
   - `is_active = true` → exige `status = 'connected'`; senão lança `SendMessageError('provider_not_connected', 400)`.
   - **Nunca há fallback silencioso para a Meta** — enviar pelo número errado é pior que erro.
2. Senão, lê `whatsapp_config` (Meta) → devolve `MetaConnection`, incluindo o self-heal do ciphertext legado que hoje vive em `send-message.ts`.
3. Nenhuma das duas → `SendMessageError('whatsapp_not_configured', 400)`.

### 4.4 Cut (ponto de corte) no core

Os quatro caminhos de saída passam a resolver a conexão e chamar o dispatcher:

| arquivo | mudança |
|---|---|
| `src/lib/whatsapp/send-message.ts` | `resolveProviderConnection` + dispatcher; **bloqueio de template** |
| `src/lib/flows/meta-send.ts` | `loadAccountMetaCredentials` → `resolveProviderConnection` |
| `src/lib/automations/meta-send.ts` | idem |
| `src/lib/whatsapp/broadcast-core.ts` | idem + recusa de broadcast por template na CRMBR |
| `src/lib/whatsapp/resolve-conversation.ts` | resolve a conexão **antes** do find-or-create (evita contato/conversa órfã) |
| `src/lib/ai/auto-reply.ts` | typing via dispatcher |

E as rotas que são Meta-por-natureza **não mudam**: `api/whatsapp/config`, `api/whatsapp/health`, `api/whatsapp/config/verify-registration`, `api/whatsapp/templates/*`, `api/whatsapp/media/[mediaId]`.

### 4.5 Mapeamento de endpoints (adapter `whatsmiau`)

| Chamada do dispatcher | Endpoint WhatsMiau |
|---|---|
| `sendTextMessage` | `POST /message/sendText/:instance` `{number, text, quoted?}` |
| `sendMediaMessage` (image/video/document) | `POST /message/sendMedia/:instance` `{number, mediatype, media, caption?, fileName?, mimetype?}` |
| `sendMediaMessage` (audio) | `POST /message/sendWhatsAppAudio/:instance` `{number, audio}` — **endpoint separado**; `sendMedia` não aceita `audio` |
| `sendInteractiveButtons` | `POST /message/sendButtons/:instance` `{number, title?, description, footer?, buttons[]}` (máx 3) |
| `sendInteractiveList` | `POST /message/sendList/:instance` `{number, title?, description, buttonText?, footerText?, sections[]}` |
| `sendReactionMessage` | `POST /message/sendReaction/:instance` `{reaction, key:{remoteJid, id, fromMe}}` |
| `sendTypingIndicator` | `POST /chat/sendPresence/:instance` `{number, presence:'composing', type:'text'}` |
| `sendTemplateMessage` | **sem endpoint** → lança `template_unsupported` |

Normalizações: `number` sem `+` e só dígitos; `remoteJid` normalizado para `<numero>@s.whatsapp.net`; `quoted.key.id` só (participante só em grupo, que não suportamos).

Traduções de campo (do nosso modelo para o da WhatsMiau):

| Nosso campo | Campo WhatsMiau |
|---|---|
| `buttons[].title` | `buttons[].displayText` |
| `buttons[].id` | `buttons[].id` |
| `buttons[].type` | `buttons[].type` = `reply` (a CRMBR também aceita `pix`, fora de escopo na v1) |
| `sections[].rows[].id` | `sections[].rows[].rowId` |
| `sections[].rows[].title` | `sections[].rows[].title` |
| `sections[].rows[].description` | `sections[].rows[].description` |
| `buttonLabel` | `buttonText` |
| `footerText` | `footerText` (buttons: `footer`) |
| `messageId` (reação) | `key.id` + `key.remoteJid` + `key.fromMe` |

## 5. Modelo de dados

### 5.1 Migration

`supabase/migrations/060_whatsmiau_provider.sql` — número 060 porque o último upstream é 059. Supabase identifica migration por **nome de arquivo**, então um `060_x.sql` do upstream convive sem conflito.

```sql
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

ALTER TABLE whatsmiau_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsmiau_config_select ON whatsmiau_config
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY whatsmiau_config_insert ON whatsmiau_config
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY whatsmiau_config_update ON whatsmiau_config
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY whatsmiau_config_delete ON whatsmiau_config
  FOR DELETE USING (is_account_member(account_id, 'admin'));
```

### 5.2 Decisões de modelagem

- **Tabela separada, não coluna em `whatsapp_config`.** `whatsapp_config` é lida com `.single()`/`.maybeSingle()` por conta em vários lugares; duas linhas lá quebrariam o app inteiro — inclusive o caminho Meta. A tabela nova é 1:1 com a conta e o Meta continua intocado.
- **`instance_settings` em JSONB** com os **mesmos nomes de campo da API** (`alwaysOnline`, `readMessages`, `rejectCall`, `msgCall`, `groupsIgnore`, `saveMedia`, `webhook`). "Aplicar na instância" é literalmente `PUT /instance/update/:name` com esse JSON — sem tabela de tradução. Um tipo TS (`WhatsmiauInstanceSettings`) valida o shape.
- **`api_key_encrypted`** usa o `encryption.ts` que o app já usa (AES-GCM). A tabela é nova, então todo ciphertext gravado nela já nasce em GCM — não há formato legado a self-heal (o self-heal do `encryption.ts` foi copiado do caminho Meta, onde a tabela é antiga).
- **`webhook_secret`** em texto plano, com o mesmo papel do `verify_token` do Meta (verificador, não credencial de conta). É gerado pelo servidor (32 bytes hex) e exibido com botão de copiar/regenerar.
- **`is_active`** é a chave da troca (D3). Uma conta tem no máximo uma linha; o provider ativo é `whatsmiau` se `is_active`, senão `meta`.

### 5.3 Tabelas e rotas que NÃO mudam

`whatsapp_config`, `message_templates`, `contacts`, `conversations`, `messages`, `accounts`. Nenhuma migration altera schema existente — só cria tabela nova. Isso elimina conflicts de schema com o upstream.

## 6. Fluxo de saída

1. O chamador (composer do inbox, API pública `/api/v1/messages`, engine de automações, engine de flows, broadcast) chama `sendMessageToConversation` / `engineSend*` / `deliverBroadcast`.
2. `resolveProviderConnection(db, accountId)` devolve a conexão ativa.
3. `assertProviderSupportsMessageType(conn, messageType)` — recusa `template` na CRMBR **antes** de qualquer escrita.
4. O dispatcher chama o adapter do provider.
5. Persistência, status, pausa de Flow e atualização de conversa: **inalterados** (código existente).

O retry de variantes de telefone (`phoneVariants`) continua existindo e só engata no erro específico da Meta (`recipient not allowed`). Na CRMBR ele não dispara — uma tentativa só.

## 7. Fluxo de entrada (webhook)

### 7.1 Rota e autenticação

`POST /api/whatsmiau/webhook` — nova, nossa. Sem `hub.challenge`, sem `x-hub-signature-256`.

- O app configura a instância com `POST /webhook/set/:instance` e `{webhook:{enabled, url, headers:{Authorization:'Bearer <webhookSecret>'}, events, base64:false}}`.
- Ao receber, a rota compara o header `Authorization` com o `webhook_secret` da conta → **401** se não bater.
- Corpo limitado a 4 MB via `readCappedBody` (mesmo helper do Meta).
- `GET` na mesma rota devolve health simples.

### 7.2 Eventos tratados

| Evento | Ação |
|---|---|
| `messages.upsert` | inbound (texto, mídia, reação, listResponse); `data.key.fromMe:true` reconcilia a mensagem enviada |
| `messages.update` | `data.status` = `DELIVERY_ACK` → `delivered`, `READ` → `read` (via `applyMessageStatus`, com `data.messageId` no campo `wamid`) |
| `messages.edited` | atualiza o texto da mensagem identificada por `data.key.id` |
| `messages.delete` | marca a mensagem (`data.id`) como removida |
| `connection.update` | `data.state:'open'` → `status='connected'`, grava `phone_number` (do `data.wuid`, formatado) e `connected_at`; `data.state:'close'` → `disconnected`. `data.statusReason !== 200` → `status='error'` |
| `contacts.upsert` | ignorado na v1 (`data` é array) |

Eventos não suportados (`messages.set`, `group-participants.update`, `call`) são ignorados com log.

### 7.3 Reuso de helpers existentes (sem duplicar o pipeline)

| Etapa | Helper reutilizado |
|---|---|
| achar/criar contato | `findExistingContact`, `isUniqueViolation` (`lib/contacts/dedupe`) |
| reabrir conversa fechada | `reopenClosedConversation` |
| primeira mensagem da conversa | `claimFirstInboundMessage` |
| espelhar mídia | `mirrorInboundMedia` (bucket `chat-media`) |
| status de entrega | `applyMessageStatus` (ladder `sending→sent→delivered→read`) |
| automações / flows / IA | `runAutomationsForTrigger`, `dispatchInboundToFlows`, `dispatchInboundToAiReply`, `resumeAwaitingReply` |
| webhooks do app | `dispatchWebhookEvent` |

**Não** se copia o webhook do Meta (1389 linhas): o que é Meta-específico fica no adapter (`normalize.ts`), e o resto é reuso.

### 7.4 Mídia

Com `saveMedia: true` e `base64: false`, a mídia chega em `data.message.mediaUrl` (URL pública) — baixamos e espelhamos no `chat-media`, igual o Meta. Se `mediaUrl` não vier, cai para o base64 do payload.

### 7.5 Idempotência

A WhatsMiau reenvia webhook em falha. `data.key.id` é a chave: conferimos `messages.message_id` antes de inserir.

### 7.6 Roteamento da conta

O roteamento usa o **`webhook_secret`** da conta, não o nome da instância. O segredo é gerado uma vez por linha (32 bytes aleatórios) e é o que o provedor devolve em `Authorization: Bearer <secret>` — é o único identificador que aponta para exatamente uma conta. O `instance` do envelope serve apenas de conferência: o nome é escolhido pelo cliente e duas empresas podem dar o mesmo nome à sua instância, o que tornaria ambígua uma busca só pelo nome.

- Sem header `Authorization`, ou com segredo que não pertence a nenhuma conta → **401**.
- Segredo válido, mas o envelope nomeia outra instância → **404** (instância desconhecida).

## 8. Instância e configurações (tela `/settings/whatsapp/crmbr`)

Espelha a aba "Configurações" do painel da WhatsMiau.

### 8.1 Blocos da tela

1. **Vínculo do número** — QR em base64 (`data:image/png;base64,…`) + pairing code, polling de `connectionState` até `open`/`closed`, botão "Reconectar" (`logout` → `connect`), botão "Compartilhar QR".
2. **Conexão** — `apiKey` (masked, nunca retorna em texto puro), `baseUrl`, `instanceName` + "Criar instância" (valida: ≤40 chars, sem acento, `A-Za-z0-9._-`, ≥1 alfanumérico).
3. **Configuração do webhook** — "Tipo de integração: Evolution API" (badge fixo), URL do webhook (pré-preenchida com a URL pública do app), "Headers personalizados" com o `Authorization` **travado** + "+ Adicionar header" (até 20, como o provider), e a grade "Eventos enviados" (checkbox + badge do nome do evento + "Ver exemplo JSON").
4. **Comportamentos da instância** — `alwaysOnline`, `groupsIgnore` (default `true`), `rejectCall` (default `true`), `readMessages` (default `false`), `msgCall`, e `syncFullHistory` (só na criação, desabilitado depois).
5. **Zona de risco** — Desconectar / Excluir instância.
6. **Sticky bar** — "Nenhuma alteração pendente" / "Há alterações não salvas" + "Salvar configurações" (`PUT /instance/update/:name` + `POST /webhook/set/:name`).

### 8.2 Aplicar vs. Verificar

Nosso banco é a fonte da verdade.

- **"Salvar configurações"** → `PUT /instance/update/:name` com o `instance_settings` + `POST /webhook/set/:name`.
- **"Verificar"** → `GET /instance/fetchInstances` + `GET /webhook/find/:name`, comparando com o que temos. O diff do webhook é exato (o endpoint documenta a config); o diff das flags de comportamento depende de `fetchInstances` devolver esses campos — o que a documentação **não garante**. Implementação com fallback: se não vierem, mostra só "alterações locais não salvas". Nenhum endpoint é inventado.

### 8.3 Isolamento entre empresas

Cada conta tem a sua `apiKey` e a sua instância. As rotas `/api/whatsmiau/instances/[name]` resolvem a conta dona do `instance_name` e usam **a apiKey dela**. Uma empresa nunca alcança a instância de outra — nem por URL manipulada. Instância de outra conta → **404** (não revela existência).

## 9. UI — hub e rotas

### 9.1 Rotas

```
/settings/whatsapp              → HUB
/settings/whatsapp/meta         → <WhatsAppConfig /> (inalterado)
/settings/whatsapp/crmbr        → <WhatsmiauConfig /> (novo)
```

`?tab=whatsapp` vira **redirect server-side** para `/settings/whatsapp` — os links já existentes no app continuam funcionando.

### 9.2 Shell

O shell da Settings (título + rail + grid) sai de `src/app/(dashboard)/settings/page.tsx` para `src/components/settings/settings-shell.tsx`, usado tanto pela página de abas quanto por `settings/whatsapp/layout.tsx`.

### 9.3 Pontos de entrada atualizados

| Ponto | Antes | Depois |
|---|---|---|
| Dashboard → "Configure sua conta" → passo WhatsApp | `/settings?tab=whatsapp` | `/settings/whatsapp` |
| Rail de Settings → "WhatsApp" | `?tab=whatsapp` | `/settings/whatsapp` |
| Tile "WhatsApp" no Overview | `?tab=whatsapp` | `/settings/whatsapp` |
| Menu da conta (header/sidebar) | `?tab=whatsapp` | `/settings/whatsapp` |
| Banner "WhatsApp não conectado" no Inbox | `?tab=whatsapp` | `/settings/whatsapp` |

Arquivos tocados: `settings-sections.ts`, `settings-rail.tsx`, `settings/page.tsx`, `settings-overview.tsx`, `lib/dashboard/overview.ts` — **1 a 3 linhas cada**.

### 9.4 O hub

- Banner no topo: **qual API está em uso** + ação de troca.
- Card **API Oficial (Meta)** — badge `Oficial` — status — CTA "Configurar" → `/settings/whatsapp/meta`. Menciona templates aprovados e verificação de empresa.
- Card **API CRMBR (não oficial)** — badge `Não oficial` — status — CTA "Configurar" → `/settings/whatsapp/crmbr`. Menciona que **não tem templates**.

Cada card declara o que a API **não** faz, para evitar a surpresa de esperar template na CRMBR.

### 9.5 Composer do inbox

Quando a API ativa é a CRMBR, o composer **esconde a opção de template** e mostra um aviso. O servidor recusa de novo (defesa em profundidade) via `assertProviderSupportsMessageType`.

## 10. Erros, limites e não-suportado

### 10.1 Erro do provider

`WhatsmiauApiError { status, code, message, raw }` — espelha `MetaApiError`. Mapeamentos relevantes: `400` nome inválido, `401/403` apiKey inválida, `404` instância inexistente, `409` delete em andamento, `423` instância suspensa (com `suspension_reason`: `administrative`, `billing_past_due`, `billing_ended`, `billing`), `502` delete não confirmado.

### 10.2 Erros de aplicação

| Código | HTTP | Situação |
|---|---|---|
| `whatsapp_not_configured` | 400 | nenhuma das duas APIs configurada |
| `provider_not_connected` | 400 | CRMBR selecionada mas `status ≠ 'connected'` — **sem fallback** |
| `template_unsupported` | 400 | template pedido com a CRMBR ativa |
| `whatsmiau_suspended` | 409 | instância suspensa na WhatsMiau |
| `whatsmiau_unauthorized` | 401 | apiKey inválida |

### 10.3 Limites do provider respeitados

`instanceName` ≤40 chars, sem acento, `A-Za-z0-9._-`, ≥1 alfanumérico · botões ≤3 · `delay` ≤110000 ms · imagem de link-preview ≤5 MiB · webhook ≤20 headers, HTTPS público · poll 2–12 · PTV ≤60 s · corpo do webhook ≤4 MB.

### 10.4 Limites que o app impõe (inalterados)

`INTERACTIVE_LIMITS` continua vindo de `meta-api.ts` — `maxButtons: 3`, `buttonTitleMaxLength: 20`, `maxListSections: 10`, `maxListRowsTotal: 10`, `bodyMaxLength: 1024`, `footerMaxLength: 60`, `headerTextMaxLength: 60` — **assim `flows/validate.ts`, `interactive.ts` e `interactive-builder.tsx` não são tocados**. Os limites da CRMBR coincidem ou são mais permissivos (≤3 botões, ≤10 linhas), então nada trava. Caption ≤1024 chars.

### 10.5 Fora de escopo na v1

- **Templates** (bloqueados) · **health check / registro de número / WABA pairing** (Meta-only) · **grupos** (`@g.us` ignorado; `groupsIgnore` default `true`) · **contatos com BSUID** (inalcançáveis pela CRMBR, que é phone-only) · **ligações** · **stickers, enquete, PTV, status, localização, contato, figurinha** (existem na API, mas o app não expõe) · **`messages.set`** (sincronização em lote) · **MCP** · **`POST /chat/markMessageAsRead`** (o flag `readMessages` cobre o caso automático).

## 11. Estratégia de testes

Vitest, com `vi.mock` — nenhum teste novo toca a rede (o `fetch` é mockado e as asserções são sobre URL + headers + body).

| Arquivo | Cobre |
|---|---|
| `providers/connection.test.ts` | resolução da API ativa; **caso-chave**: CRMBR `is_active` mas desconectada → erro, **sem** cair para a Meta |
| `providers/whatsmiau/client.test.ts` | header `apikey`, `Content-Type`, `baseUrl` customizável, erro não-2xx → `WhatsmiauApiError` |
| `providers/whatsmiau/adapter.test.ts` | tradução de shapes: `sendText`, `sendMedia` (audio → `sendWhatsAppAudio`), `sendButtons`, `sendList`, `sendReaction` (JID normalizado), `sendPresence`, `sendTemplateMessage` → lança |
| `providers/meta/adapter.test.ts` | o adapter Meta delega pro `meta-api.ts` com o shape certo — **rede de segurança da refatoração** |
| `api/whatsmiau/webhook/route.test.ts` | 401 sem header; inbound de texto; idempotência por `key.id`; `DELIVERY_ACK → delivered`; `READ → read`; `connection.update` → `connected`; `@g.us` ignorado; `fromMe:true` não duplica conversa |
| `api/whatsmiau/instances/route.test.ts` | nome inválido → 400 explicando a regra; `PUT /instance/update` envia o `instance_settings` da conta; **isolamento**: instância de outra conta → 404 |
| `send-message.test.ts` (existente) | o mock de `@/lib/whatsapp/meta-api` passa a ser de `@/lib/whatsapp/providers`; novo caso: CRMBR ativa → `meta-api` **não** é chamado |
| `flows/meta-send.test.ts`, `automations/meta-send.test.ts` (existentes) | idem |

**Manual / E2E** (exige apiKey real → roteiro, não teste automatizado): Settings → hub → CRMBR → criar instância → QR → escanear → ativar API → Inbox → enviar mensagem (texto, mídia, botão, lista) → reconferir o webhook chegando.

## 12. Protocolo de merge com o upstream

### 12.1 Topologia (já correta)

`origin` = `devturco/wacrm` (fork do usuário) · `upstream` = `ArnasDon/wacrm` (mantenedor). Em 27/10/2026, `origin/main..upstream/main` = 0 commits — o fork já contém todo o upstream.

```bash
git fetch upstream
git merge upstream/main       # ou: git rebase upstream/main
```
Alternativa pelo GitHub: botão "Sync fork" → PR de `upstream/main` para `main`.

### 12.2 Onde pode haver conflito

Conflito só é possível nos arquivos que os dois lados tocam. A lista é fechada e conhecida:

`src/lib/whatsapp/send-message.ts` · `broadcast-core.ts` · `resolve-conversation.ts` · `src/lib/flows/meta-send.ts` · `src/lib/automations/meta-send.ts` · `src/lib/ai/auto-reply.ts` · `src/app/api/whatsapp/send/route.ts` · `src/app/api/whatsapp/react/route.ts` · `src/components/settings/whatsapp-config.tsx` · `settings-sections.ts` · `settings-rail.tsx` · `settings/page.tsx` · `settings-overview.tsx` · `src/lib/dashboard/overview.ts` · composer do inbox.

### 12.3 Mitigações

1. **Toque mínimo e no topo.** Toda edição nossa nesses arquivos fica no topo (import + resolução de credencial), nunca no meio da lógica — o hunk de conflito é pequeno e o contexto é estável.
2. **`git rerere`** — habilita `git config rerere.enabled true` (config local, não versionada). O git **memoriza** a resolução de cada conflito e reaplica sozinho na próxima vez que o mesmo conflito aparecer. A partir da segunda ocorrência, o merge do upstream fica automático nos pontos que já brigaram.
3. **Commit isolado do "cabo de ligação".** O commit que toca os arquivos do upstream é um só, com mensagem explicando o porquê — o conflito se resolve olhando aquele commit.
4. **Erro de tipo ≠ conflito.** Mudança de assinatura no `meta-api.ts` quebra `providers/meta/adapter.ts` (nosso) → erro de TS, conserto rápido, sem conflito.
5. **Documento no repo.** `docs/integracao/whatsmiau-upstream.md` com o mapa "quem toca o quê", a lista de arquivos compartilhados, o passo-a-passo de merge e o que fazer se o upstream mexer no subsistema de templates ou no webhook do Meta.
6. **Nada do upstream quebra.** `meta-api.ts`, o webhook do Meta, `whatsapp_config` e a UI da Meta continuam **funcionais e inalterados**. Se o upstream mexer neles, a mudança dele é a fonte da verdade e a gente ajusta o lado novo.

## 13. Riscos

| Risco | Mitigação |
|---|---|
| A WhatsMiau é um serviço não-oficial (Whatsmeow/Baileys) — pode quebrar com mudança no WhatsApp | `baseUrl` configurável; a integração fica isolada em `providers/whatsmiau/`; o provider pode ser trocado sem tocar no app |
| A WhatsMiau **não tem API de templates** | bloqueio explícito e visível na UI; não há degradação silenciosa |
| A conta da WhatsMiau é **por empresa** — cada empresa precisa da própria apiKey e instância | tela de conexão por conta; `UNIQUE(account_id)`; isolamento testado |
| Instância suspensa por faturamento (`suspension_reason: billing_*`) | erro 409 explícito com o motivo; status `error` na config |
| Conflito de merge com o upstream | Seção 12 (toque mínimo + rerere + doc) |
| A documentação da API pode mudar | `docs/whatsmiau.md` versionado no repo como referência |

## 14. Ordem de implementação (visão geral)

1. Migration `060_whatsmiau_provider.sql` — **aviso ao usuário: SQL pronto para subir**.
2. `providers/types.ts` + `providers/connection.ts` + `providers/meta/adapter.ts` + `providers/index.ts` (dispatcher) — com o Meta passando por ele sem mudança de comportamento.
3. Ponto de corte nos 4 caminhos de saída + `assertProviderSupportsMessageType`.
4. `providers/whatsmiau/` — client, api, instances, adapter.
5. `api/whatsmiau/` — webhook + rotas de instância.
6. Settings — hub, rotas, tela da CRMBR (usando as skills de UI/UX do ambiente).
7. Composer do inbox — bloqueio de template.
8. Testes.

## 15. Referências

- `docs/whatsmiau.md` — referência técnica da WhatsMiau Cloud API v2
- `docs/multi-waba.md` — o padrão de multi-conta já existente no app
- `supabase/migrations/017_account_sharing.sql` — padrão de RLS (`is_account_member`)
