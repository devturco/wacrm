# Origem do lead (UTM, referral e canal) — Design

**Data:** 2026-10-29
**Status:** design aprovado no brainstorming (2026-10-29) · aguardando revisão do spec escrito
**Escopo:** capturar de onde veio cada lead (anúncio, post, DM, site) e mostrar isso no card do contato e na conversa — a base que alimenta a futura "Inteligência de Conteúdo"

---

## 1. Objetivo

Responder, olhando para um contato, a pergunta que hoje ninguém consegue responder: **"de onde veio esse lead?"**

O app já sabe tudo que o lead disse, mas não sabe **como ele chegou**. Não existe `utm_*`, `source`, `referrer` nem `lead_origin` em lugar nenhum do código (grep limpo em `src/`), e a tabela `contacts` é phone-based, sem lugar para origem. O resultado é que um lead de anúncio no Instagram e um lead que veio por indicação são **indistinguíveis** — e nada alimenta a ideia de "qual post está trazendo lead".

Este é o **primeiro** módulo do conjunto Social / Conteúdo / Relatórios / Integrações. Ele é barato (não depende de nenhuma API nova de social) e é a peça que os outros três consumem:

- **Social** (DM do Instagram, comentários) entrega o `referral` que preenche a origem.
- **Conteúdo & Anúncios** (Meta Ads Insights, TikTok Ads) entrega os **números** — e a contagem de leads por campanha/post sai daqui.
- **Inteligência de Conteúdo** (IA) lê a jornada e sugere conteúdo a partir do que está funcionando.

---

## 2. Decisões tomadas

| # | Decisão | Escolha |
|---|---|---|
| D1 | Onde a origem mora | Tabela nova `lead_origins` — **nenhuma coluna nova em `contacts`** (a regra do projeto: migration só cria tabela) |
| D2 | O que é a "origem" | **Primeiro toque**, não último. "De onde veio" ≠ "o que ele clicou por último" |
| D3 | UTM e referral | Eixos **diferentes** que coexistem no mesmo contato. UTM = web; referral = social/anúncio |
| D4 | Sem UTM | Existe o valor explícito `direct` — senão "sem origem" vira sinônimo de "não sei" |
| D5 | Código de amarração no caminho "só clique" | Viaja na mensagem pré-preenchida (`ref A7X9K2M4`) e é **removido da exibição** para o agente; o texto cru fica salvo na origem |
| D6 | Form do site cria contato? | **Não.** O endpoint público grava origem **pendente**; o contato nasce quando o lead fala com a gente (inbound). Zero spam, zero contato fantasma |
| D7 | Chave do endpoint público | `capture_key` por conta — **identificador público, não é credencial**. Só roteia a conta e nada mais |
| D8 | Amarração no inbound | Prioridade **token > telefone > referral do provider > `direct`** |
| D9 | Quantas linhas por contato | 1 principal (primeiro toque) + linhas extras só quando um toque novo traz **campanha/post/utm diferente** |
| D10 | Migration | 1 arquivo (`067_lead_origin.sql`), **2 tabelas novas**: `lead_settings` + `lead_origins` |
| D11 | Destinos do link de campanha | v1: `wa:` (WhatsApp) e `url:` (qualquer URL). `ig:` fica para o módulo Social — no Instagram a atribuição confiável é o `referral`, não o nosso link |
| D12 | Fora do v1 | Landing pages no CRM, Meta Ads Insights, TikTok Ads, CAPI/Events API, criação de contato pelo form público, IG/TikTok no link |

---

## 3. Por que a origem não existe hoje

Três entradas de lead, três mecanismos diferentes, nenhum capturado:

| Entrada | Como o lead chega | O que o provedor entrega |
|---|---|---|
| Anúncio no site | clique → site → WhatsApp/IG | query string: `utm_*`, `gclid`, `fbclid`, `ttclid` |
| Anúncio no WhatsApp (Meta Cloud API) | clique no anúncio | `referral` no webhook: `ad_id`, `adset_id`, `campaign_id` |
| DM / comentário no Instagram | mensagem direta | `messaging_referral`: `ads_metadata`, `post_id` |
| Lead Ad no TikTok | Instant Form | webhook de lead: `campaign_id`, `ad_id`, `form_id` |
| Orgânico, indicação, telefone | — | **nada** |

O `referral` do Meta **não é tratado em lugar nenhum** hoje — grep por `referral` em `src/lib/whatsapp/` e `src/app/api/whatsapp/` não retorna nada, tanto no caminho Meta quanto no whatsmiau. E nenhum provider manda os UTMs, porque ninguém os pede: a URL do anúncio aponta direto para o site do cliente, que não tem nada a ver com o CRM.

---

## 4. Modelo de dados

### 4.1 `lead_settings` — 1 linha por conta

```
account_id     UUID PK  → accounts(id) ON DELETE CASCADE
capture_key    TEXT NOT NULL UNIQUE
enabled        BOOLEAN NOT NULL DEFAULT true
allowed_hosts  TEXT[] NOT NULL DEFAULT '{}'   -- vazio = qualquer origem
links          JSONB NOT NULL DEFAULT '[]'    -- links de campanha (ver 4.3)
created_at / updated_at
```

`capture_key` é gerado pelo app (server-side, `crypto.randomBytes(24).toString('hex')`) quando a conta abre a tela pela primeira vez. É **público por definição** — vai embutido no script do site, como uma measurement id do Google Analytics. Ele **não concede nenhum privilégio**: o que ele faz é identificar a conta para a qual a origem pertence. Quem escreve é sempre o service role, validando a chave, o host, o payload e a taxa.

`links` (JSONB) guarda os **links de campanha** criados em Configurações:

```json
[{
  "code": "a7x9k2m4",
  "label": "Anúncio Verão - Instagram",
  "destination": "wa:5511999999999",
  "message": "Olá! Tenho interesse no anúncio.",
  "created_at": "2026-10-29T12:00:00Z"
}]
```

`destination` aceita `wa:<numero>` ou `url:<https://...>`. O `code` é o segmento da URL pública: `/r/a7x9k2m4`.

### 4.2 `lead_origins` — um toque por linha

```
id            UUID PK
account_id    UUID NOT NULL → accounts(id) ON DELETE CASCADE
contact_id    UUID → contacts(id) ON DELETE CASCADE   -- NULL = PENDENTE

-- canal
channel       TEXT NOT NULL CHECK (channel IN (
                'whatsapp','instagram_dm','instagram_comment',
                'tiktok_dm','tiktok_lead','web','direct'))
provider      TEXT CHECK (provider IN ('meta','whatsmiau','tiktok','web'))

-- eixo web
utm_source / utm_medium / utm_campaign / utm_content / utm_term   TEXT
landing_path  TEXT      -- a URL nossa que capturou (ex.: '/r/a7x9k2m4')
referrer      TEXT
click_ids     JSONB NOT NULL DEFAULT '{}'   -- gclid, fbclid, ttclid, wbraid

-- eixo social / anúncios
ad_id / adset_id / campaign_id / creative_id / post_id   TEXT
external_id   TEXT      -- id do lead no provider (TikTok lead_id)

-- amarração
lead_token    TEXT      -- código de 8 chars (base32) — o "ref" da mensagem
link_code     TEXT      -- o link de campanha (a7x9k2m4)
phone         TEXT      -- E.164, para casar com o inbound

is_primary    BOOLEAN NOT NULL DEFAULT false
touched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
meta          JSONB NOT NULL DEFAULT '{}'   -- payload cru, texto original
created_at / updated_at
```

Índices:

```
(account_id, contact_id)                    -- a jornada do contato
(account_id, phone)                         -- amarração por telefone
(account_id, lead_token)                    -- amarração por código
UNIQUE (contact_id) WHERE is_primary AND contact_id IS NOT NULL
(account_id, campaign_id)                   -- contagem por campanha
(account_id, post_id)                       -- contagem por post
(account_id, touched_at) WHERE contact_id IS NULL   -- pendentes
GIN (meta)
```

O índice **único parcial** garante uma única origem principal por contato, no banco — não por convenção de código.

RLS: leitura por `is_account_member(account_id)`; escrita **só** pelo service role (os endpoints). Mesmo padrão de `media_settings` (migration 066).

### 4.3 Por que `links` é JSONB e não uma tabela

Um link de campanha é **configuração da conta**, não dado de negócio: são poucos (uma dúzia), mudam pouco, e ninguém vai consultar "links que não são da conta X" nem filtrar por link. Guardar em JSONB evita uma terceira tabela e a JOIN que ninguém precisa. O que **é** dado de negócio — os toques — fica em `lead_origins`, com coluna própria (`link_code`) para a contagem por link.

---

## 5. Captura

### 5.1 O script (`/api/leads/track.js`)

JS puro, ~1 KB, sem dependência. O cliente cola no site:

```html
<script src="https://crm.exemplo.com/api/leads/track.js"
        data-key="a1b2c3..." async></script>
```

Comportamento:

1. Na carga da página, lê da URL: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid`, `ttclid`, `wbraid`, `igshid`.
2. Guarda o **primeiro toque** no cookie first-party `crmbr_oid` (30 dias, `SameSite=Lax`, `path=/`). **Write-once**: se o cookie já existe, ele **não** é sobrescrito — é essa a regra que garante que a origem é o primeiro toque (D2).
3. Dispara `POST /api/leads/capture` em dois momentos:
   - `submit` do formulário (e `change`/`blur` de campo com nome `phone`/`telefone`/`whatsapp`, para pegar o telefone antes do envio);
   - clique em qualquer link `wa.me`, `api.whatsapp.com`, `instagram.com`, `tiktok.com` ou `wa:<numero>`.
4. No envio, manda **as duas coisas**: `first` (o que está no cookie) e `now` (os parâmetros da URL **daquele instante**).

O script **não** cria contato e **não** envia nada que não seja origem. Ele não injeta nada no DOM.

### 5.2 `POST /api/leads/capture`

Público, sem sessão. Autentica pela capture key (header `x-capture-key`).

```
→ x-capture-key: <capture_key>
{
  "action": "form_submit" | "link_click" | "page_view",
  "channel": "web" | "whatsapp" | "instagram_dm" | "tiktok_dm",
  "phone": "+5511999999999",      // opcional
  "name": "...", "email": "...",   // opcionais
  "first": { utm_*, landing_path, referrer, click_ids },
  "now":   { utm_*, landing_path, referrer, click_ids }
}
```

Servidor, em ordem:

1. Acha `lead_settings` pela chave. Não existe ou `enabled = false` → **404** (não revela a existência da conta).
2. Host do `Origin`/`Referer` está em `allowed_hosts`? Lista vazia = aceita.
3. Rate limit por IP + por chave.
4. Valida o payload (zod), normaliza o telefone (`normalizePhone` — o mesmo do inbound).
5. Grava **até 2 linhas**:
   - a linha do `first` (ou, sem cookie, a do `now`);
   - a linha do `now`, **só se for diferente** do `first` em `utm_source`/`utm_campaign`/`utm_content`/`link_code`.
6. As linhas nascem com `contact_id = NULL` (**pendentes**) e `is_primary = false`.
7. Responde `{ "leadToken": "A7X9K2M4" }` — o código que o cliente pode usar no passo 5.3 (o script injeta esse código na mensagem pré-preenchida quando o destino é WhatsApp).

### 5.3 `GET /r/[code]` — o link de campanha

Público. É o link que vai no anúncio.

```
/r/a7x9k2m4?utm_source=instagram&utm_medium=paid_social&utm_campaign=verao&utm_content=video1
```

1. Acha o link em `lead_settings.links` pelo `code`. Não existe → 404.
2. Cria uma linha nova em `lead_origins` com os UTMs da query, `link_code = a7x9k2m4`, `landing_path = '/r/a7x9k2m4'`, `contact_id = NULL`, e um **`lead_token` novo de 8 chars** (por clique).
3. Grava o cookie `crmbr_oid` com esse toque como primeiro toque (se o cookie ainda não existir).
4. Redirect 302:
   - `wa:<numero>` → `https://wa.me/<numero>?text=<mensagem + " ref A7X9K2M4">`
   - `url:<https://...>` → a URL, com os UTMs que vieram na query acrescentados (`utm_*` da query são repassados).

O código por clique é o que amarra a origem à primeira mensagem. Ele é gerado por clique porque o mesmo link pode ser clicado por mil pessoas e cada clique é um toque distinto.

### 5.4 A chave de amarração no caminho "só clique, sem form"

Quando não há telefone, não há como casar o toque com o contato: o lead sai do navegador e entra no app do WhatsApp, e cookies não atravessam essa fronteira. A única ponte é o **código na mensagem**.

Daí a decisão D5: o CRM **extrai o código da primeira mensagem recebida, remove do texto que o agente vê e guarda na origem**. O texto cru fica em `lead_origins.meta.raw_text`. O cliente vê um código curto no WhatsApp dele; o agente vê a mensagem limpa e a origem no painel.

O código tem 8 caracteres base32 (~40 bits) e é de **uso único**: ao ser amarrado a um contato, `contact_id` deixa de ser NULL e ele não casa mais com ninguém.

---

## 6. A amarração no inbound

Um módulo único, `src/lib/leads/origin.ts`, com `resolveOrigin()`, chamado nos **dois** caminhos de inbound que já existem:

- `src/app/api/whatsapp/webhook/route.ts` (Meta Cloud API)
- `src/lib/whatsapp/providers/whatsmiau/inbound.ts` (whatsmiau)

É por isso que a pergunta "Meta ou whatsmiau?" não muda o desenho: os dois chamam a mesma função.

### 6.1 Ordem de resolução

Para uma mensagem inbound com telefone `P` e texto `T`:

1. **Código na mensagem.** `T` casa com `ref <8 chars>` → procura `lead_origins` por `lead_token` (na conta) → se achar, amarra.
2. **Telefone.** Se `T` não tem código: procura `lead_origins` da conta com `phone = P`, `contact_id IS NULL`, `touched_at` dentro da janela (30 dias), a mais recente. Amarra.
3. **Referral do provider.** Se o payload trouxe `referral` (Meta: `ad_id`/`adset_id`/`campaign_id`/`post_id`; TikTok: os ids do lead) → cria a origem com esses ids.
4. **Direto.** Nada acima → cria a origem `channel = 'direct'`, `provider = <o do provider>`, sem UTM e sem ad.

### 6.2 Regra de quantidade de linhas

- Se o contato **não tem** origem: a linha criada vira a **principal** (`is_primary = true`).
- Se **já tem**: só entra uma linha nova se o toque trouxer **campanha, post, utm_campaign ou link_code diferente** do principal. Uma segunda mensagem do mesmo anúncio **não** duplica a jornada.
- Um `update` de `contact_id` na linha pendente **não** mexe no `is_primary` de outra linha: o índice único parcial continua valendo.

### 6.3 O que cada provider traz

| | Meta Cloud API | whatsmiau |
|---|---|---|
| Referral do anúncio | `entry[].changes[].value.messages[]` traz `referral` com `ad_id`, `adset_id`, `campaign_id`, `source` | **não traz** — o provedor não expõe |
| Origem do post (Instagram) | `messaging_referral` com `ads_metadata` e o post | n/a |
| Consequência | clique-to-WhatsApp e DM de anúncio dão origem **sem o nosso link** | a origem do anúncio depende do link `/r/<code>` ou do UTM |

Por isso o `referral` do Meta precisa ser lido no webhook — hoje não é lido em lugar nenhum.

### 6.4 Form + telefone (o caminho limpo)

Quando o form do site manda o telefone, a origem é criada **pendente com telefone**. Quando o lead mandar mensagem, o passo 2 casa por telefone — sem código na mensagem, sem poluição. Esse é o caminho preferencial.

---

## 7. UI

### 7.1 Badge de origem (componente compartilhado)

`src/components/leads/lead-origin.tsx` — uma linha compacta:

```
Origem: DM do Instagram · anúncio "Verão" · 12/out
```

Com um chip **"jornada (3)"** que abre uma Sheet com a lista dos toques: canal, campanha, post, UTMs, data, link de origem. Ela serve para as duas superfícies abaixo.

### 7.2 Card do contato (aba Contatos)

No topo do `contact-detail-view.tsx`, antes das abas: o badge + a jornada. É o lugar onde o time já está olhando para o contato.

### 7.3 Conversa (inbox)

No painel do contato do inbox, junto do nome: a mesma linha, compacta, com o mesmo modal de jornada. O lead não pode precisar abrir o card para saber de onde veio.

### 7.4 Configurações → Origem dos leads

- A capture key (copiar) e o **script pronto pra colar** (com a key embutida).
- Os **links de campanha**: criar (`/r/<code>`), rotular, escolher destino (`wa:`/`url:`), copiar.
- **Domínios permitidos** (allowlist de host).
- Interruptor liga/desliga a captura.
- Um botão "**Testar**" que abre `/api/leads/capture` com um payload de exemplo e mostra o que foi gravado.

### 7.5 A consulta que a "Inteligência de Conteúdo" vai usar

```sql
SELECT post_id, campaign_id, ad_id,
       count(DISTINCT contact_id) AS leads
FROM lead_origins
WHERE account_id = $1 AND contact_id IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY leads DESC;
```

É o "quais posts estão trazendo lead". Quando o módulo Social e o de Anúncios existirem, essa consulta passa a ser comparada com o alcance/engajamento das publicações — e é isso que a IA lê para sugerir conteúdo novo.

---

## 8. Erros e resiliência

| Situação | Comportamento |
|---|---|
| Chave inválida / conta desativada | 404 genérico. Não revela se a conta existe |
| Host fora da allowlist | 403. A origem não é gravada |
| Rate limit estourado | 429. O script repete no próximo clique |
| Payload inválido | 400 com a lista dos campos. Nada é gravado |
| Falha ao gravar | 500. O lead **não** é perdido: o inbound vai recriar a origem por telefone/referral |
| Cookie bloqueado pelo browser | O caminho sem cookie funciona: `first` = `now`. Perde-se o primeiro toque, não o lead |
| Lead nunca fala com a gente | A origem fica pendente. Limpeza: linhas `contact_id IS NULL` com mais de 30 dias são removidas por uma rota de manutenção |
| Código collisions | 8 chars base32 ≈ 40 bits. A geração verifica unicidade na conta e regenera |
| Corrida do código | O primeiro telefone que usar o código ganha a origem. Janela pequena, impacto baixo (ver riscos) |

---

## 9. Testes

| Arquivo | Cobre |
|---|---|
| `src/lib/leads/origin.test.ts` | Ordem de resolução (token > telefone > referral > direct); primeira origem vira principal; campanha diferente cria linha extra; campanha igual não duplica |
| `src/lib/leads/utm.test.ts` | Parse de `utm_*`/`gclid`/`fbclid`/`ttclid`; regra write-once do cookie; comparação "first" vs "now" |
| `src/lib/leads/token.test.ts` | Geração do código de 8 chars; unicidade; uso único (amarração) |
| `src/app/api/leads/capture/route.test.ts` | Chave inválida → 404; host bloqueado → 403; rate limit; grava 1 ou 2 linhas; telefone normalizado; linhas nascem pendentes |
| `src/app/r/[code]/route.test.ts` | Link desconhecido → 404; cria 1 linha por clique; cookie gravado; redirect `wa:` com o código na mensagem; redirect `url:` repassando os UTMs |
| `src/lib/leads/migration.test.ts` | A migration cria as 2 tabelas, os índices (incluindo o único parcial) e as policies; **nenhuma tabela existente muda de schema** |

---

## 10. Fora de escopo (YAGNI)

- **Landing pages no CRM.** Vira o módulo Integrações. O v1 consome um site que já existe.
- **Criar contato pelo form público.** O endpoint grava origem pendente; o contato nasce no inbound.
- **Meta Ads Insights / TikTok Ads.** São os **números** (alcance, engajamento, custo). Vem com o módulo Conteúdo & Anúncios.
- **CAPI (Conversions API) e TikTok Events API.** O pixel de conversão é outro problema (envio de evento, não captura de origem).
- **Instagram e TikTok no link de campanha.** No Instagram a atribuição confiável é o `referral`, não o nosso link — e o `referral` só existe quando a conta está integrada. Vem com o módulo Social.
- **Migração de origem para contatos que já existem.** Contatos atuais ficam sem origem até um toque novo.
- **Rewriting de UTM editável.** A origem é um *snapshot* do que o lead viu.

---

## 11. Riscos e limites conhecidos

1. **O código aparece para o cliente.** No caminho "só clique, sem form", o cliente vê `ref A7X9K2M4` no WhatsApp. O CRM remove da exibição do agente (o texto cru fica salvo). Se o cliente reclamar, o caminho do form elimina o código.
2. **Corrida do código.** Quem usar o código primeiro ganha a origem. Janela de poucos minutos entre o clique e a mensagem.
3. **Click IDs não sobrevivem a troca de navegador/dispositivo.** `gclid`/`fbclid`/`ttclid` ficam órfãos nesse caso. O Meta e o Google reconciliam pelo cookie do próprio clique — nós não temos esse cookie.
4. **O endpoint público é, por definição, público.** Mitigação: capture key rotacionável, rate limit, allowlist de host, validação estrita do payload, e nenhuma criação de contato.
5. **A origem congela o nome da campanha.** Se o cliente renomear a campanha no Ads Manager, o texto antigo continua — que é o que o lead viu. Para "o que a campanha se chama hoje" seria preciso chamar a API de anúncios.
6. **Só a primeira origem é a principal.** Se o primeiro toque foi "direct" e o segundo foi um anúncio, a origem principal continua sendo "direct". É a ordem cronológica que vale. A jornada mostra os dois.

---

## 12. Ordem de implementação

1. **Migration 067** — `lead_settings` + `lead_origins`, índices, RLS. Mais o teste da migration.
2. **`src/lib/leads/`** — token, utm, `resolveOrigin()`. Puro, testável, sem HTTP.
3. **`POST /api/leads/capture`** + **`/api/leads/track.js`** — a captura.
4. **`GET /r/[code]`** — o link de campanha.
5. **Gancho no inbound** — Meta e whatsmiau chamam `resolveOrigin()`; o Meta passa a ler o `referral`.
6. **UI** — badge de origem, card do contato, painel do inbox, Configurações.
7. **Documentação** — `docs/` explaining o script, o link e o que o CRM guarda.

Cada passo é um commit. Nada aqui altera tabela existente, e nada aqui depende de API de social nova — o `referral` do Meta é o único dado externo, e ele já chega no payload do webhook.
