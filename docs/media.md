# Mídia durável: onde os anexos ficam

> Este documento explica onde o app guarda os arquivos que os clientes
> enviam, por que eles existiam só "por um tempo", o que dá para
> recuperar quando somem, e o que **não** é recuperável.

---

## O problema

O provedor de WhatsApp entrega cada anexo com uma **URL temporária**.
Ela vale por um tempo curto e depois some — o arquivo continua existindo
na conversa do cliente, mas o CRM já não consegue mais baixá-lo.

Na prática o efeito é o que todo mundo reclama: a foto, o PDF, a
planilha que o cliente mandou "some" do CRM. A conversa continua lá, o
balão continua lá, e o anexo vira um retângulo vazio.

A causa não era só a expiração. A migration 023 criou o bucket
`chat-media` com uma **lista fechada de MIME types**, e o Storage do
Supabase **recusa** qualquer upload fora da lista. Um `.xlsx` de um
formato que ninguém catalogueu era recusado — e o espelho inbound
ainda tinha um segundo problema: o fallback `application/octet-stream`
também não estava na lista. Resultado: o espelho falhava em silêncio,
a row continuava apontando para a URL do provedor, e a URL expirava.

---

## Como funciona agora

### O espelho inbound

Toda mídia que **entra** é copiada para o bucket no momento em que a
mensagem chega:

```
provider ──GET bytes──► app ──PUT──► bucket (chat-media)
                                      │
                                      └─► messages.media_url = URL pública
```

O caminho do objeto é sempre escopado por conta — e organizado por
tipo, para o bucket ser navegável:

```
<raiz da conta>/<midias|documentos>/<dia>-<hash>/<nome>.<ext>
```

O primeiro segmento é o que a RLS do Storage olha — um agente da
conta A não enxerga (nem apaga) um objeto da conta B.

Quando o espelho funciona, `messages.media_url` passa a apontar para
a **URL pública do nosso bucket**. O arquivo é nosso: não expira, não
depende do provedor, e sobrevive a qualquer mudança de fornecedor.

Quando o espelho falha, a row continua apontando para a URL do
provedor — e aí entra o [reparo sob demanda](#reparo-sob-demanda).

### A árvore de arquivos

Toda conta tem uma pasta própria, e dentro dela três pastas — o que
cada uma guarda é óbvio pelo nome:

| Pasta | O que entra |
|---|---|
| `avatar/` | A foto de perfil dos contatos |
| `midias/` | Imagem, vídeo e áudio |
| `documentos/` | PDF, planilha, zip — tudo que não é mídia |

A raiz da árvore depende do backend:

| Backend | A raiz |
|---|---|
| Supabase | `account-<uuid>` — a RLS do bucket casa com esse primeiro segmento, e só ele serve |
| R2 | `nome-da-empresa-<8>` — o slug do nome da empresa mais um pedaço do id da conta |

No R2 a pasta se chama pelo **nome da empresa** porque é o bucket que o
cliente abre no console: `storm-eletronicos-3f2a1b9c/` diz, de
imediato, de quem são os arquivos. O R2 **não tem RLS** — o caminho é a
única fronteira entre duas contas, e o id no final da pasta é o que
mantém duas empresas com o mesmo nome separadas (`accounts.name` não
tem restrição de unicidade).

O **nome do arquivo** é o nome que o usuário deu a ele, com acentos e
espaços intactos. O último segmento da URL **é** o nome do arquivo —
e é dele que o provedor tira o nome do anexo que chega no WhatsApp.
Por isso a unicidade mora numa **pasta** acima do arquivo
(`20261030-143205-412/` na subida, `20231114-cb17f1f3/` na entrada),
e nunca no nome: um documento enviado como "Proposta Comercial.pdf"
chega como "Proposta Comercial.pdf", não como um blob com timestamp.

As regras moram em `src/lib/media/layout.ts` — puras, sem I/O, e
testadas por conta própria.

### A normalização de tipo

O Storage do Supabase aceita uma lista fechada de MIME types. O app
então **normaliza** o `Content-Type` antes de subir
(`src/lib/media/content-type.ts`):

- Tipos que podem ser servidos **inline** (imagem, vídeo, áudio,
  PDF) vão com o próprio tipo.
- Qualquer tipo fora dessa lista vira `application/octet-stream`.

O efeito é duplo:

1. **Nada é jamais recusado** — o catch-all sempre passa.
2. **Nenhum conteúdo ativo é servido inline** — `text/html` e
   `image/svg+xml` viram download, não página. Um SVG com script
   executado no navegador de quem abriu o link é um XSS servido pelo
   nosso próprio domínio; com o catch-all ele é baixado como arquivo.

O lado ruim: o objeto no bucket tem `Content-Type: application/octet-stream`.
É por isso que o download pelo app **não** depende do tipo — o nome do
arquivo vem da row (`mediaFilename`, em `src/lib/media/filename.ts`), e
o navegador baixa o que precisa.

### Os limites

| Limite | Valor | Onde |
|---|---|---|
| Teto por conta | 25 / 50 / 100 MB | `media_settings.max_file_bytes` |
| Teto do bucket | 100 MB | `storage.buckets.file_size_limit` |
| Teto do tipo | 100 MB | `src/lib/storage/upload-media.ts` |

O teto efetivo é o **menor** entre o que a conta configurou e o teto
do bucket. 100 MB é o limite de documento do WhatsApp — pedir mais do
que isso só faria o app aceitar arquivos que o próprio WhatsApp não
envia.

---

## Os dois backends

A escolha é **por conta**, e vive na tabela `media_settings`
(migration 066). Ela é criada no Supabase e editável em
**Configurações → Mídia**.

### Supabase (padrão)

O bucket `chat-media` do próprio projeto. Não precisa configurar
nada: é o que já funcionava antes.

- Bucket: `chat-media` (configurável por conta).
- A URL pública sai do próprio bucket.

### Cloudflare R2

Para quem quer os arquivos fora do banco, na própria conta Cloudflare.
R2 é compatível com S3, então a assinatura é a mesma do AWS (SigV4,
via `aws4fetch`).

**O bucket do R2 precisa ser PÚBLICO atrás de um domínio próprio**
(ex.: `media.suaempresa.com`) — o provedor busca a mídia sem
autenticação no momento do envio. É a mesma premissa do bucket
`chat-media` público de hoje.

As credenciais são **variáveis de ambiente do servidor**. Elas nunca
chegam ao navegador:

| Variável | Para quê |
|---|---|
| `R2_ACCOUNT_ID` | A primeira metade do endpoint (`<account>.r2.cloudflarestorage.com`) |
| `R2_ACCESS_KEY_ID` | O identificador da chave |
| `R2_SECRET_ACCESS_KEY` | **A chave em si** — nunca sai do servidor |
| `R2_BUCKET` | O bucket (padrão: `crmbr-media`) |
| `MEDIA_PUBLIC_BASE_URL` | A URL pública base |

A tela de configurações mostra **quais** variáveis faltam, pelo nome.
Os valores nunca aparecem em lugar nenhum.

> **O bucket e a URL pública do R2 são do servidor.** Quando a R2 está
> escolhida, o campo "Bucket" some da tela — o bucket do R2 é o
> `R2_BUCKET` do ambiente, e o bucket da conta (`media_settings.bucket`)
> é o do **Supabase**. A URL pública some pelo mesmo motivo, quando o
> servidor já define `MEDIA_PUBLIC_BASE_URL`.
>
> Se o servidor **não** definir `MEDIA_PUBLIC_BASE_URL`, o campo da URL
> aparece: a conta cola a sua e passa a valer no lugar da variável.
> Quem tem as três credenciais da R2 não precisa mexer no ambiente.

Quando a R2 está escolhida mas falta alguma variável, o app **continua
no Supabase** em vez de quebrar. Uma configuração incompleta nunca
derruba o inbox.

### O R2 exige o comprimento do corpo

A API S3 do R2 **não aceita** um PUT cujo comprimento ele não consiga
saber. Um stream sem `Content-Length` sai como
`Transfer-Encoding: chunked`, e o bucket responde "length required" —
o upload morre e a row continua apontando para a URL do provedor
(a foto aparece, mas é a cópia temporária de lá, que expira).

Por isso o espelho sempre declara o comprimento: o cabeçalho
`content-length` da resposta do provedor (e, no caso do WhatsMiau
com `webhook.base64`, o tamanho do próprio base64 decodificado). Sem
esses bytes, o adaptador do R2 lê o stream inteiro e conta sozinho —
mais lento, mas sempre certo.

Um corpo comprimido (`content-encoding: gzip`) **não** tem
comprimento declarado: o cabeçalho conta os bytes comprimidos, e o
stream que subimos é o decodificado. Um `Content-Length` errado faria o
upload falhar (ou truncar o arquivo).

---

## O reparo sob demanda

Nem todo anexo antigo vai ser espelhado — o espelho só existe a partir
de uma data, e os espelhos que falharam continuam apontando para o
provedor.

O botão **Restaurar** aparece em toda mídia que ainda mora no
provedor (a URL começa com `/api/whatsapp/media/`). Ele:

1. Busca os bytes no provedor (dois passos: URL de mídia, depois o
   download).
2. Normaliza o `Content-Type`.
3. Grava no bucket na mesma árvore (`<raiz>/midias|documentos/...`).
4. Reescreve `messages.media_url` com a URL pública nova.

A partir daí o arquivo é nosso e expira mais.

O reparo é **idempotente**: se a URL já é do nosso bucket, o botão não
aparece e a rota devolve `repaired: false` sem gravar nada.

A tela nunca nomeia o provedor. O usuário vê "não está mais
disponível" — não de quem é a culpa.

### O que **não** é recuperável

- **O provedor já descartou os bytes.** A URL temporária expirou e o
  provedor já apagou o arquivo. Não há de onde copiar. A resposta é
  `410`, e o cliente vê "este anexo não está mais disponível".
- **O arquivo era maior que o teto.** `413` — o provedor recusou
  devolver os bytes.
- **A conta não tem WhatsApp configurado.** Sem a configuração não há
  como falar com o provedor. `400`.

Nenhum desses casos é "consertável" pelo app. A única forma de não
perder o arquivo é o espelho automático, funcionando desde o momento
em que a mensagem chega.

---

## As abas do painel

O painel do contato — no inbox e na ficha de Contatos — tem quatro
abas:

| Aba | O que mostra |
|---|---|
| **Sobre** | Tags, negócios, notas (o que era o painel inteiro) |
| **Mídia** | Fotos, vídeos e áudios, em grade, com lightbox |
| **Documentos** | Anexos com nome, data e botão de baixar |
| **Links** | Os links que apareceram nas mensagens, com host e data |

As três últimas leem as **mesmas linhas** de `messages` que a conversa
tem — o painel é uma visão da conversa, não uma segunda cópia. A
paginação é de 60 linhas por vez.

Um ícone de "restaurar" aparece sobre os anexos que ainda dependem do
provedor.

---

## Migration 066

A migration [`supabase/migrations/066_media_settings_and_bucket.sql`](../supabase/migrations/066_media_settings_and_bucket.sql)
precisa ser aplicada no Supabase antes do resto:

```bash
# no SQL Editor do Supabase, ou via psql
\i supabase/migrations/066_media_settings_and_bucket.sql
```

Ela:

1. Cria a tabela `media_settings` (com RLS: leitura para membros,
   escrita para admins).
2. Atualiza o bucket `chat-media` para 100 MB e para a lista segura de
   MIME types com o catch-all.
3. Recria `redeem_invitation` com a checagem da `media_settings` — sem
   ela, trocar de conta apagaria o backend de storage escolhido.

**Sem a migration**, `readMediaSettings` cai no padrão (Supabase) e
nada quebra — a feature simplesmente não tem onde gravar a
configuração.

Nenhuma tabela existente muda de schema. As credenciais da R2 são
variáveis de ambiente, não migration.

---

## O que ainda não é suportado

- **Varredura automática.** As mídias antigas não são espelhadas em
  lote; cada uma é restaurada sob demanda.
- **Busca por conteúdo.** Não há OCR nem indexação do texto dentro de
  PDFs — as abas listam por data.
- **Vídeo grande.** Vídeo é servido pela URL plain (sem passar pelo
  blob cache), para não bufferingar o arquivo inteiro antes de tocar.
