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
- guarda o **primeiro** toque num cookie (`crmbr_oid`, 30 dias) — visitas
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
- Nenhuma conversa é gravada em `lead_origins`. A única exceção é o
  texto cru da mensagem que carregava o código — ele existe para
  recompor o contexto do clique e fica em `meta.raw_text`.
- A API key do CRM nunca aparece aqui e nunca volta ao navegador.

## Privacidade — o que o endpoint público aceita

O `POST /api/leads/capture` é público por natureza (o navegador do
visitante é quem chama). O que ele NÃO faz:

- não aceita chamadas de domínios fora da lista permitida (quando a
  lista está configurada);
- não cria contato;
- não responde o conteúdo gravado — devolve só o código do toque;
- tem limite de requisições por chave.
