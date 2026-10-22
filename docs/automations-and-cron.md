# Automações, flows e o cron

Duas features do app precisam de alguém para "dar a hora":

- **Automações** com passo *Wait* — a execução fica pendente
  esperando um evento (uma resposta, um tempo) e precisa ser
  drenada quando esse prazo chega.
- **Flows** — as execuções que terminaram ou falharam precisam ser
  varridas para o estado terminal.

Nenhuma das duas se auto-destrava: o app não tem timer, e um
serviço web que fica ocioso não é lugar de scheduler. O dreno é feito
por **dois endpoints HTTP**, que qualquer agendador pode chamar.

---

## Os endpoints

| Endpoint | O que faz |
|---|---|
| `GET /api/automations/cron` | Drena execuções pendentes com prazo vencido, encerra as `wait_for_reply` cuja janela de 24h passou, recoloca na fila as execuções travadas. |
| `GET /api/flows/cron` | Varre as execuções de flow que já terminaram ou falharam para o estado final. |

São independentes de propósito: um falhando não impede o outro de
rodar. E ambos usam o mesmo segredo.

### Autenticação

O header `x-cron-secret` precisa bater com a variável
`AUTOMATION_CRON_SECRET` do deploy:

```bash
curl -H "x-cron-secret: $AUTOMATION_CRON_SECRET" \
  https://app.crmbr.com/api/automations/cron
```

Os dois **falham fechados**:

| Resposta | Significado |
|---|---|
| `200` | Rodou. O corpo traz o que foi processado (`processed`, `expired`, `requeued` / `swept`). |
| `401` | O header não bate com o segredo do deploy. |
| `503` | `AUTOMATION_CRON_SECRET` não está no deploy — a variável ainda não chegou. |

---

## Railway: um serviço separado para o cron

O "Cron Schedule" que aparece nas settings do Railway **não faz
requisição HTTP**: ele executa o *start command* do serviço no
horário, e espera que o processo termine e saia. No caso do serviço
web, o start command é o servidor Next — ele nunca sai, a execução
fica "Active" para sempre e o Railway passa a pular as próximas
execuções. Por isso o cron é um **serviço próprio**, com start
command que faz as duas chamadas e sai.

O repositório já traz o que esse serviço precisa:

- [`scripts/cron-drain.mjs`](../scripts/cron-drain.mjs) — faz as duas
  chamadas, imprime o status de cada uma e **sai com código != 0 se
  alguma falhar** (o Railway marca a execução como falha no log).
- [`Dockerfile.cron`](../Dockerfile.cron) — imagem mínima, só o
  script. Sem `npm install`, sem build do Next: o serviço sobe em
  segundos.

### Passo a passo

1. **New → Service → GitHub Repo** → escolha o mesmo repositório
   (`devturco/wacrm`).
2. **Settings → Build → Dockerfile Path**: troque para
   `Dockerfile.cron`. Sem isso o serviço constrói a aplicação
   inteira — e o start command continuaria sendo o servidor web.
3. **Variables**:
   - `AUTOMATION_CRON_SECRET` — o mesmo valor do serviço web.
   - `CRON_BASE_URL` — `https://app.crmbr.com` (a URL pública da
     aplicação; o script usa essa como padrão).
4. **Settings → Deploy → Cron Schedule**: `*/5 * * * *`.
5. Deploy. A partir daí o serviço roda de 5 em 5 minutos (UTC).

> O `Cron Schedule` do Railway usa UTC e o intervalo mínimo é de 5
> minutos. A execução pode atrasar alguns minutos sob carga.

### Testar antes de confiar

```bash
# direto, pelo terminal
curl -i -H "x-cron-secret: a933e2f5...f2423" \
  https://app.crmbr.com/api/automations/cron | head -1
```

`200` = autenticando e rodando. `401` = o segredo não bate. `503` =
a variável não chegou no deploy.

No Railway dá para forçar uma execução pela CLI:

```bash
railway cron list
railway cron run
```

---

## Alternativas

O script não depende do Railway — qualquer agendador que faça uma
requisição HTTP com um header serve:

- **GitHub Actions** — o repositório já usa Actions para o CI; um
  workflow com `schedule:` resolve. Atenção: repositório público
  desativa workflows agendados após 60 dias sem atividade, e o
  agendamento do GitHub pode atrasar.
- **Pingers externos** (cron-job.org, UptimeRobot, Crontap) — sem
  código, mas o segredo passa a viver na UI de um terceiro.

O que **não** funciona: usar o mesmo serviço web, como explicado
acima.

---

## O que o dreno não faz

- Ele não dispara automações — só executa as que já estão na fila
  com prazo vencido. Quem cria a execução pendente é a própria
  automação, no momento em que a condição é satisfeita.
- Ele não é necessário para automações sem *Wait*: uma automação
  "dispara quando o contato manda mensagem" roda no webhook, na
  hora. O cron só importa quando há espera.
