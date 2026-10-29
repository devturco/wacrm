# Integração com o upstream — API CRMBR (WhatsMiau)

Este documento explica como manter a **API CRMBR (não oficial)** coexistindo com a
**API oficial da Meta** no crmbr, e como continuar recebendo as atualizações do
mantenedor upstream (`ArnasDon/wacrm`) sem que o trabalho novo entre em conflito.

> O número de Whatsapp do provedor, a chave da API e a URL do webhook **nunca**
> entram neste repositório. A chave da CRMBR é **da plataforma** e vive na
> variável de ambiente do servidor (`WHATSMIAU_API_KEY`) — nunca no banco, nunca
> no navegador. O assinante não tem chave: ele dá um nome para a conexão e nós
> provisionamos a instância na nossa conta do provedor.
>
> O endereço público do webhook vem de `NEXT_PUBLIC_SITE_URL` — o provedor
> recusa `localhost` e redes privadas (guard anti-SSRF), então em desenvolvimento
> local é preciso apontar essa variável para um túnel público.

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
| `src/lib/whatsapp/providers/whatsmiau/naming.ts` | **nosso** |
| `src/lib/whatsapp/providers/whatsmiau/platform-credential.ts` | **nosso** |
| `src/app/api/whatsmiau/**` | **nosso** |
| `src/components/settings/whatsmiau-*.tsx` | **nosso** |
| `src/components/settings/settings-shell.tsx` | **nosso** |
| `src/components/settings/whatsapp-hub.tsx` | **nosso** |
| `src/components/settings/whatsapp-provider-nav.tsx` | **nosso** |
| `src/app/(dashboard)/settings/whatsapp/**` | **nosso** |
| `src/hooks/use-active-provider.ts` | **nosso** |
| `supabase/migrations/06*_whatsmiau_*.sql` | **nosso** |
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

A lista abaixo é a do diff real da feature contra `18156e3` (commit do plano) —
arquivos **do upstream** que este trabalho tocou:

`src/lib/whatsapp/send-message.ts` · `broadcast-core.ts` · `broadcast-resume.ts` ·
`resolve-conversation.ts` · `src/lib/flows/meta-send.ts` ·
`src/lib/automations/meta-send.ts` · `src/lib/ai/auto-reply.ts` ·
`src/app/api/whatsapp/broadcast/route.ts` · `src/app/api/whatsapp/react/route.ts` ·
`src/app/(dashboard)/settings/page.tsx` · `src/app/(dashboard)/inbox/page.tsx` ·
`src/components/settings/settings-sections.ts` · `settings-rail.tsx` ·
`settings-page-client.tsx` · `settings-overview.tsx` ·
`src/components/inbox/message-composer.tsx` · `message-thread.tsx` ·
`src/components/layout/header.tsx` · `sidebar.tsx` ·
`src/components/dashboard/whatsapp-health-chip.tsx` ·
`src/lib/dashboard/overview.ts` · `messages/{en,es,ko,pt}.json`

Nesses arquivos, as nossas edições são **sempre de 1 a 5 linhas**, e o commit que as
toca é **um só** — o "cabo de ligação" entre o app e o dispatcher de providers. É esse
commit que se resolve quando o merge emperra.

Exceções que valem registro, porque são **maiores** que 5 linhas:

| Arquivo | Natureza da mudança | Por que é seguro |
|---|---|---|
| `src/app/(dashboard)/settings/page.tsx` | server component + delegação | o `?tab=` continua aceito; a página nova `/settings/whatsapp` é a rota do hub |
| `src/components/settings/settings-rail.tsx` | novo item "WhatsApp" no rail | item novo, não mexe nos itens existentes |
| `src/components/inbox/message-composer.tsx` | prop `canUseTemplates` | default `true` — o caminho Meta fica **byte a byte** igual |
| `messages/*.json` | bloco novo de chaves | as chaves antigas não mudam de valor |

> `messages/*.json` é o arquivo com maior chance de conflito textual: um merge
> malfeito costuma duplicar o bloco `Settings.whatsmiau.*`. Depois do merge, rode
> `npx vitest run src/i18n/messages.test.ts` — ele falha se os 4 catálogos
> divergirem de chave ou de placeholder.

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

Os arquivos de template do upstream são `src/lib/whatsapp/template-*.ts`
(`template-send-builder.ts`, `template-body.ts`, `template-validators.ts`…). Se o
upstream mexer neles, ou no endpoint `src/app/api/whatsapp/templates/route.ts`:

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

## 8. Referência

- `docs/whatsmiau.md` — a referência técnica da WhatsMiau Cloud API v2
- `docs/superpowers/specs/2026-10-27-whatsmiau-crmbr-provider-design.md` — o design
- `docs/superpowers/plans/2026-10-27-whatsmiau-crmbr-provider.md` — o plano de execução
