# Whatsmiau Cloud — Referência técnica consolidada

> Este arquivo é a referência técnica do provider. O protocolo de manutenção
> (merge com o upstream, arquivos compartilhados, o que fazer quando o upstream
> mexer em templates ou no webhook do Meta) está em
> [`docs/integracao/whatsmiau-upstream.md`](integracao/whatsmiau-upstream.md).

> **Data de consulta:** 27/10/2026  
> **Documentação consultada:** https://whatsmiau.dev/docs/getting-started  
> **API REST:** `https://api.whatsmiau.dev/v2`  
> **Servidor MCP:** `https://mcp.whatsmiau.dev`  
> **Natureza do material:** referência técnica detalhada, reescrita e organizada a partir da documentação pública. Não é uma transcrição literal da página nem substitui schemas obtidos diretamente da API/MCP.

## Índice

1. [Visão geral e autenticação](#1-visão-geral-e-autenticação)
2. [Instâncias](#2-instâncias)
3. [Mensagens](#3-mensagens)
4. [Chat e presença](#4-chat-e-presença)
5. [Ligações](#5-ligações)
6. [Webhooks](#6-webhooks)
7. [Eventos de webhook](#7-eventos-de-webhook)
8. [Compatibilidade Z-API e callbacks](#8-compatibilidade-z-api-e-callbacks)
9. [Grupos](#9-grupos)
10. [Comunidades](#10-comunidades)
11. [MCP — Model Context Protocol](#11-mcp--model-context-protocol)
12. [Exemplos de integração](#12-exemplos-de-integração)
13. [Auditoria de cobertura e ressalvas](#13-auditoria-de-cobertura-e-ressalvas)

## 1. Visão geral e autenticação

A interface HTTP v2 adota convenções compatíveis com a Evolution API. Instâncias são criadas com um `instanceName`, reutilizado como `:name` ou `:instance` nas rotas. Não é necessário obter um ObjectID separado para operar as sessões. Uma instância corresponde, em geral, a um número WhatsApp conectado.

A chave é obtida no dashboard da Whatsmiau, enviada no cabeçalho `apikey` e limitada ao escopo da conta proprietária. Para corpos JSON, informe também `Content-Type: application/json`.

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/instance/fetchInstances' \
  -H 'apikey: SUA_CHAVE_API'
```

**GET `/instance/fetchInstances`** é simultaneamente um teste de credencial e a listagem de instâncias. Uma conta não deve consultar instâncias pertencentes a outra. Nas operações de ligação REST também é aceito Bearer JWT conforme a seção específica de chamadas.

### Convenções comuns

| Elemento | Significado |
|---|---|
| `:instance` / `:name` | Nome público atribuído ao criar a sessão, como `Atendimento01`. |
| `number` | Número do WhatsApp com DDI + DDD, sem pontuação; em endpoints específicos também é permitido JID. |
| JID individual | Exemplo: `5511999988888@s.whatsapp.net`. |
| JID de grupo/comunidade | Exemplo: `120363001234567890@g.us`. |
| LID | Identificador alternativo do WhatsApp, eventualmente no formato `...@lid`. |
| `quoted` | Referência a mensagem anterior; `key.id` é indispensável e `key.participant` é necessário para citação adequada em grupos. |
| `delay` | Em rotas de envio que o oferecem, representa milissegundos, com limite de **110.000 ms**. |
| Credenciais | Nunca armazenar chaves em código frontend ou em repositórios públicos. |

### Como o wacrm usa esta API (credencial da plataforma)

O wacrm **não entrega a chave ao assinante**. A chave é da **plataforma** e mora
apenas na variável de ambiente do servidor:

```bash
WHATSMIAU_API_KEY=...            # obrigatório
WHATSMIAU_BASE_URL=...           # opcional — padrão https://api.whatsmiau.dev/v2
```

Sem `WHATSMIAU_API_KEY`, a tela "API CRMBR" avisa que o recurso não está
disponível neste servidor. A chave nunca vai para o banco, nunca vai para o
navegador e nunca é digitada por ninguém.

Isso traz uma consequência prática: **a conta do provedor é compartilhada por todos
os assinantes**. Duas empresas podem, portanto, pedir o mesmo nome de instância —
e a colisão significaria uma empresa assumindo o número de WhatsApp da outra. Por
isso o wacrm nunca usa o nome que o cliente digitou como nome da instância no
provedor. Ele cria o nome assim:

```
<empresa>_<instância>          # ex.: studio_bella_atendimento
```

O nome da empresa vem de `accounts.name`; o nome da instância é o que o cliente
digitou, slugado (`atendimento principal` → `atendimento_principal`). Se o nome
completo já existir, um sufixo numérico é acrescentado (`_2`, `_3`…). A tabela
`whatsmiau_config` garante a unicidade com uma constraint sobre
`provider_instance_name`.

Do lado do cliente há **dois nomes**, e eles nunca se cruzam:

| Nome | Onde vive | Quem enxerga |
|---|---|---|
| `instance_name` | `whatsmiau_config.instance_name` | o cliente (é o nome que ele deu) |
| `provider_instance_name` | `whatsmiau_config.provider_instance_name` | só o servidor — é o nome no provedor |

O `Authorization: Bearer <webhook_secret>` é o que identifica a conta de verdade:
o segredo é gerado por instância e exclusivo dela. O nome da instância é apenas
uma **conferência** — e o provedor o escreve de mais de uma forma:

| Onde | O que aparece |
|---|---|
| `instance` (envelope) | o nome da sessão — no formato compatível com Evolution, o **apelido** `<nome>_<id>` |
| `data.instanceId` (§7.1, "instância de origem") | o mesmo nome/apelido |

Por isso a rota compara **todos** os nomes que o payload carrega: basta um
deles bater com o `provider_instance_name` (aceitando o apelido) para a
entrega ser aceita. Um payload que não nomeia nenhuma instância nossa é 404.

> **Formatos de entrega.** O `messages.upsert` documentado (§7.1) chega como
> **lote** (`data.messages` é um array, `data.type` é `"notify"`); a entrega
> compatível com Evolution traz a mensagem solta em `data`. O wacrm lê as
> duas formas.

### O endereço público do webhook

O provedor entrega os eventos **no endereço que nós informamos** — então ele
precisa conseguir chegar lá. A documentação é explícita: *"Destino HTTPS público,
sem localhost e redes privadas (SSRF)"*. Um `http://localhost:3000` é recusado
com `invalid webhook URL: host must not point to internal network`.

Por isso o wacrm **não usa cegamente o endereço do request**. A regra é:

1. **se a requisição chegou por um endereço público, ele vence** — em produção
   esse endereço é o domínio do app, e ele está certo por construção. Um
   `NEXT_PUBLIC_SITE_URL` velho no ambiente não consegue apontar o webhook para
   o host errado.
2. **caso contrário, o app usa `NEXT_PUBLIC_SITE_URL`** — é o que acontece em
   desenvolvimento local (`localhost`) e atrás de proxy que não repassa o host
   público.

```
${origem pública}/api/whatsmiau/webhook
```

| Ambiente | O que fazer |
|---|---|
| Produção | nada — o origin da requisição já é o domínio. `NEXT_PUBLIC_SITE_URL` é opcional (e, se existir, só entra quando a requisição não vem por endereço público). |
| Desenvolvimento local | suba um túnel público (`ngrok http 3000` ou `cloudflared tunnel --url http://localhost:3000`) e aponte `NEXT_PUBLIC_SITE_URL` para a URL do túnel. |

Se nenhum dos dois for um endereço público, a criação da conexão é recusada
**antes** de qualquer chamada ao provedor, com a mensagem *"the CRMBR API could
not deliver events to this app: its public address is not reachable from the
internet"*. O detalhe (o endereço usado e o que fazer) fica no log do servidor,
não no navegador.

O mesmo endereço é devolvido por `GET /api/whatsmiau/config` (`webhook_url`),
para que a tela mostre exatamente a string que o servidor envia ao provedor — o
`window.location.origin` do navegador mentiria em desenvolvimento.

> O túnel muda de URL a cada reinício. Depois de reiniciá-lo, re-salve as
> configurações da conexão (o botão de salvar reenvia o endereço ao provedor).

Para inspecionar o que existe na conta do provedor (sem expor a chave):

```bash
node scripts/check-provider-instances.mjs
```

Para perguntar à aplicação **publicada** se ela já está aceitando o envelope do
provedor (o alvo é obrigatório — nada é enviado para lugar nenhum por padrão):

```bash
node scripts/probe-webhook-deploy.mjs https://app.crmbr.com/api/whatsmiau/webhook
```

A sonda lê o `webhook_secret` da linha da conta e o usa **apenas** no cabeçalho
`Authorization`; imprime apenas o status e o corpo da resposta. O esperado é
`200` no nome canônico e no apelido.


## 2. Instâncias

### 1. Criar instância

**`POST /instance/create`**

Cria uma conexão independente. O nome escolhido define todas as URLs subsequentes.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `instanceName` | `string` | Sim | Único por conta, imutável; até 40 caracteres, apenas letras não acentuadas, números, ponto, hífen e underscore; deve conter letra ou dígito |
| `rejectCall` | `boolean` | Não | Rejeita ligações recebidas automaticamente |
| `msgCall` | `string` | Não | Mensagem automática associada à rejeição de chamada |
| `groupsIgnore` | `boolean` | Não | Suprime eventos de grupos no webhook |
| `alwaysOnline` | `boolean` | Não | Mantém status online |
| `readMessages` | `boolean` | Não | Confirma leitura automaticamente |
| `syncFullHistory` | `boolean` | Não | Solicita sincronização completa de histórico na conexão |
| `saveMedia` | `boolean` | Não | Padrão true; se false, não salva mídia recebida nem produz mediaUrl |
| `webhook.enabled` | `boolean` | Não | Habilita recebimento; requer URL válida |
| `webhook.url` | `string` | Não | Destino HTTPS público, sem localhost e redes privadas (SSRF) |
| `webhook.headers` | `object` | Não | Até 20 cabeçalhos, nomes case-insensitive únicos; exige HTTPS |
| `webhook.events` | `string[]` | Não | Tipos selecionados; ausência da lista implica nenhum evento entregue |
| `webhook.base64` | `boolean` | Não | Inclui mídia em base64 nos eventos quando habilitado |
| `proxyHost` | `string` | Não | Proxy público no plano Enterprise |
| `proxyPort` | `string` | Não | Porta do proxy Enterprise |
| `proxyProtocol` | `string` | Não | http, https ou socks5 (Enterprise) |
| `proxyUsername` | `string` | Não | Login de proxy Enterprise |
| `proxyPassword` | `string` | Não | Senha do proxy Enterprise |
| `migration` | `object` | Não | Enterprise; estrutura {creds: object, preKeys: array} para importar sessão Baileys |

**Comportamento e limites:** Nome inválido resulta em HTTP 400. Migração Baileys devolve `migration: {jid, preKeysImported, connected}`. A resposta de criação pode mostrar `id` igual ao nome e `state: connecting`.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/instance/create' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "instanceName": "Atendimento01",
  "rejectCall": true,
  "webhook": {
    "enabled": true,
    "url": "https://sistema.exemplo.com/webhook",
    "events": [
      "messages.upsert",
      "connection.update"
    ]
  }
}'
```

### 2. Listar instâncias

**`GET /instance/fetchInstances`**

Lista as sessões da conta e permite validar credenciais. Suspensões não são consequência exclusiva de exceder limite do plano.


**Comportamento e limites:** Quando suspensa, uma entrada pode apresentar `state: closed`, `suspended: true` e `suspension_reason`.

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/instance/fetchInstances' \
  -H 'apikey: SUA_CHAVE_API'
```

### 3. Conectar / gerar QR ou pairing code

**`GET /instance/connect/:name`**

Inicia vinculação ao WhatsApp. Devolve QR Code em base64 e, se aplicável, pairing code.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `name` | `string` | Sim | Nome da instância na URL |
| `number` | `string` | Não | Telefone com DDI para solicitar código de pareamento |

**Comportamento e limites:** Bloqueio da conta pode retornar **HTTP 423** com `suspension_reason`; suspensão administrativa somente é revertida por administração. A resposta pode conter `id`, `connected`, `base64` e `pairingCode`.

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/instance/connect/Atendimento01?number=5511999988888' \
  -H 'apikey: SUA_CHAVE_API'
```

### 4. QR Code em PNG

**`GET /instance/connect/:name/image`**

Fornece a imagem binária do QR no tipo `image/png`.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `name` | `string` | Sim | Nome no caminho |

**Comportamento e limites:** Quando a instância já está conectada, retorna **204 No Content**. O header de API é necessário mesmo se usado numa página web.

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/instance/connect/Atendimento01/image' \
  -H 'apikey: SUA_CHAVE_API'
```

### 5. Consultar conexão

**`GET /instance/connectionState/:name`**

Inspeciona o estado da sessão.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `name` | `string` | Sim | Nome da instância |

**Comportamento e limites:** Estados esperados: `open`, `closed`, `connecting`, `qr-code`. Suspensões reportam `closed`, `suspended=true` e motivo `administrative`, `billing_past_due`, `billing_ended` ou `billing`.

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/instance/connectionState/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API'
```

### 6. Atualizar instância

**`PUT /instance/update/:name`**

Modifica parcialmente as flags de comportamento, webhook ou proxy; omissões não sobrescrevem valores atuais.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `name` | `string` | Sim | Instância na URL |
| `rejectCall` | `boolean` | Não | Rejeitar chamadas automaticamente |
| `msgCall` | `string` | Não | Resposta de rejeição; string vazia remove mensagem |
| `groupsIgnore` | `boolean` | Não | Ignorar eventos de grupo |
| `alwaysOnline` | `boolean` | Não | Permanecer online |
| `readMessages` | `boolean` | Não | Marcar como lidas |
| `saveMedia` | `boolean` | Não | Controlar armazenamento; padrão true |
| `webhook.enabled` | `boolean` | Não | Habilitar/desabilitar |
| `webhook.url` | `string` | Não | HTTPS público, sem redes privadas |
| `webhook.headers` | `object` | Não | Máximo 20 cabeçalhos de nomes únicos |
| `webhook.events` | `string[]` | Não | Filtro explícito dos eventos |
| `webhook.base64` | `boolean` | Não | Codificação base64 na entrega |
| `proxyHost` | `string` | Não | Proxy Enterprise |
| `proxyPort` | `string` | Não | Porta Enterprise |
| `proxyProtocol` | `string` | Não | http, https ou socks5 |
| `proxyUsername` | `string` | Não | Usuário Enterprise |
| `proxyPassword` | `string` | Não | Senha Enterprise |

**Comportamento e limites:** `syncFullHistory` **não pode ser modificado** por esta rota. Proxy é exclusivo de Enterprise.

**Exemplo:**

```bash
curl -X PUT 'https://api.whatsmiau.dev/v2/instance/update/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "alwaysOnline": true,
  "readMessages": true
}'
```

### 7. Desconectar (logout)

**`DELETE /instance/logout/:name`**

Remove a autenticação da sessão WhatsApp, mantendo o registro da instância.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `name` | `string` | Sim | Instância na URL |

**Comportamento e limites:** Para religar, invoque `/instance/connect/:name`.

**Exemplo:**

```bash
curl -X DELETE 'https://api.whatsmiau.dev/v2/instance/logout/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API'
```

### 8. Deletar instância

**`DELETE /instance/delete/:name`**

Exclui o recurso no Core e depois seu registro no Manager, condicionado à confirmação da primeira etapa.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `name` | `string` | Sim | Nome público, ID do Core ou identificador legado |

**Comportamento e limites:** Respostas de exceção: `404` inexistente, `409` operação concorrente, `502` exclusão não confirmada (preserva o registro para repetição).

**Exemplo:**

```bash
curl -X DELETE 'https://api.whatsmiau.dev/v2/instance/delete/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API'
```

## 3. Mensagens

### 1. Enviar texto

**`POST /message/sendText/:instance`**

Entrega texto Unicode e emojis a um contato ou grupo.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Destinatário com DDI |
| `text` | `string` | Sim | Corpo da mensagem |
| `delay` | `number` | Não | Atraso até 110000 ms |
| `linkPreview` | `boolean` | Não | Prévia automática de URL contida no texto |
| `linkPreviewImage` | `string` | Não | Imagem por URL, base64 ou data URI |
| `linkPreviewTitle` | `string` | Não | Título personalizado |
| `linkPreviewDescription` | `string` | Não | Descrição personalizada |
| `linkPreviewLarge` | `boolean` | Não | true (padrão) para card grande, false para pequeno |
| `mentionsEveryOne` | `boolean` | Não | Para menção a todos, texto precisa conter @all |
| `mentioned` | `string[]` | Não | Lista de JIDs |
| `quoted` | `object` | Não | Mensagem a responder; key.id e eventual key.participant |

**Comportamento e limites:** Imagem do card customizado limitada a 5 MiB; com base64, payload HTTP tem limite de 4 MiB, deixando ~3 MiB efetivos para imagem. Ao informar dados personalizados não consulta página externa. Link automático no começo do texto pode ser substituído visualmente pelo card; o restante é mantido. Título vazio com imagem envia card só com imagem.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/message/sendText/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888",
  "text": "Olá! Confira https://exemplo.com",
  "linkPreview": true
}'
```

### 2. Enviar mídia

**`POST /message/sendMedia/:instance`**

Envia imagem, vídeo ou documento a partir de uma URL acessível.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Destinatário |
| `mediatype` | `string` | Sim | image, video ou document |
| `media` | `string` | Sim | URL pública |
| `caption` | `string` | Não | Legenda |
| `fileName` | `string` | Não | Nome do documento |
| `mimetype` | `string` | Não | MIME informado |
| `delay` | `number` | Não | Máximo 110000 |
| `quoted` | `object` | Não | Mensagem citada |
| `mentionsEveryOne` | `boolean` | Não | Menção @all |
| `mentioned` | `string[]` | Não | JIDs |

**Comportamento e limites:** Mídia deve estar acessível ao servidor. Para documentos, use filename e MIME coerentes.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/message/sendMedia/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888",
  "mediatype": "document",
  "media": "https://exemplo.com/contrato.pdf",
  "fileName": "contrato.pdf",
  "mimetype": "application/pdf"
}'
```

### 3. Enviar áudio PTT

**`POST /message/sendWhatsAppAudio/:instance`**

Entrega uma nota de voz no formato de mensagem gravada.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Destino |
| `audio` | `string` | Sim | URL pública MP3/OGG |
| `delay` | `number` | Não | Até 110000 |
| `encoding` | `boolean` | Não | Solicita recodificação |
| `quoted` | `object` | Não | Citação |
| `mentionsEveryOne` | `boolean` | Não | @all em grupos |
| `mentioned` | `string[]` | Não | JIDs |

**Comportamento e limites:** Pode ser necessário recodificar áudio para formato adequado ao WhatsApp.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/message/sendWhatsAppAudio/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888",
  "audio": "https://exemplo.com/voz.ogg",
  "encoding": true
}'
```

### 4. Enviar lista interativa

**`POST /message/sendList/:instance`**

Exibe menu com seções e opções selecionáveis.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Destinatário |
| `title` | `string` | Não | Título geral |
| `description` | `string` | Sim | Texto principal |
| `buttonText` | `string` | Não | Texto do botão que abre a lista |
| `footerText` | `string` | Não | Rodapé |
| `sections` | `array` | Sim | Lista de seções |
| `sections[].title` | `string` | Não | Nome da seção |
| `sections[].rows[].title` | `string` | Sim | Título da opção |
| `sections[].rows[].description` | `string` | Não | Complemento |
| `sections[].rows[].rowId` | `string` | Sim | Identificador da escolha devolvido no webhook |

**Comportamento e limites:** `rowId` deve ser estável e inequívoco para processar seleções.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/message/sendList/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888",
  "description": "Selecione uma área",
  "buttonText": "Escolher",
  "sections": [
    {
      "title": "Atendimento",
      "rows": [
        {
          "title": "Suporte",
          "rowId": "suporte"
        },
        {
          "title": "Vendas",
          "rowId": "vendas"
        }
      ]
    }
  ]
}'
```

### 5. Enviar botões / PIX

**`POST /message/sendButtons/:instance`**

Apresenta até três botões de resposta ou pagamento PIX.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Destino |
| `title` | `string` | Não | Cabeçalho |
| `description` | `string` | Sim | Mensagem |
| `footer` | `string` | Não | Rodapé |
| `buttons` | `array` | Sim | Máximo 3 |
| `buttons[].type` | `string` | Sim | reply ou pix |
| `buttons[].displayText` | `string` | Sim | Legenda |
| `buttons[].id` | `string` | Não | Identificador para reply devolvido no webhook |
| `buttons[].currency` | `string` | Não | Obrigatório para pix, p.ex. BRL |
| `buttons[].name` | `string` | Não | Recebedor pix |
| `buttons[].keyType` | `string` | Não | pix: email, cpf, cnpj, phone ou random |
| `buttons[].key` | `string` | Não | Chave do recebedor para pix |

**Comportamento e limites:** Os campos de pagamento (`currency`, `name`, `keyType`, `key`) tornam-se obrigatórios quando o tipo do botão é `pix`.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/message/sendButtons/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888",
  "description": "Você confirma o pedido?",
  "buttons": [
    {
      "type": "reply",
      "displayText": "Confirmar",
      "id": "sim"
    },
    {
      "type": "reply",
      "displayText": "Cancelar",
      "id": "nao"
    }
  ]
}'
```

### 6. Enviar figurinha

**`POST /message/sendSticker/:instance`**

Publica uma figurinha a partir de URL de WebP (outros formatos podem sofrer conversão).

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Destino |
| `sticker` | `string` | Sim | Endereço da figurinha |
| `delay` | `number` | Não | Até 110000 |
| `notConvertSticker` | `boolean` | Não | Pula conversão quando true |
| `quoted` | `object` | Não | Mensagem citada |
| `mentionsEveryOne` | `boolean` | Não | @all |
| `mentioned` | `string[]` | Não | Lista de JIDs |

**Comportamento e limites:** Prefira um arquivo WebP válido para evitar conversões.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/message/sendSticker/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888",
  "sticker": "https://exemplo.com/adesivo.webp"
}'
```

### 7. Enviar localização

**`POST /message/sendLocation/:instance`**

Compartilha coordenadas e metadados opcionais.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Destino |
| `latitude` | `number` | Sim | Latitude decimal |
| `longitude` | `number` | Sim | Longitude decimal |
| `name` | `string` | Não | Título do local |
| `address` | `string` | Não | Endereço descritivo |
| `delay` | `number` | Não | Até 110000 |
| `quoted` | `object` | Não | Citação |

**Comportamento e limites:** Latitude e longitude são valores em graus decimais.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/message/sendLocation/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888",
  "latitude": -23.5505,
  "longitude": -46.6333,
  "name": "São Paulo"
}'
```

### 8. Enviar contatos

**`POST /message/sendContact/:instance`**

Envia um conjunto de contatos, agrupado pelo WhatsApp.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Destino |
| `contact` | `array` | Sim | Vetor de contatos |
| `contact[].fullName` | `string` | Sim | Nome completo |
| `contact[].phoneNumber` | `string` | Sim | Telefone |
| `contact[].wuid` | `string` | Não | Identificador WhatsApp |
| `contact[].organization` | `string` | Não | Empresa |
| `contact[].email` | `string` | Não | E-mail |
| `contact[].url` | `string` | Não | Website |
| `delay` | `number` | Não | Até 110000 |
| `quoted` | `object` | Não | Mensagem citada |

**Comportamento e limites:** Enviar vários contatos significa adicionar vários objetos **dentro do mesmo array**, não repetir chamadas ou enviar o objeto isolado.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/message/sendContact/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888",
  "contact": [
    {
      "fullName": "Equipe Suporte",
      "phoneNumber": "5511999911111",
      "organization": "Empresa Exemplo"
    }
  ]
}'
```

### 9. Enviar enquete

**`POST /message/sendPoll/:instance`**

Cria uma votação em conversa individual ou grupo.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Destino |
| `name` | `string` | Sim | Pergunta |
| `values` | `string[]` | Sim | De 2 a 12 alternativas |
| `selectableCount` | `number` | Não | 0 (padrão) = seleção única; 1..N para múltiplas |
| `delay` | `number` | Não | Até 110000 |
| `quoted` | `object` | Não | Mensagem citada |

**Comportamento e limites:** O retorno de votos aparece como atualização `pollUpdateMessage` nos eventos de mensagem. Atenção: a ferramenta **MCP** diz 2–10 opções, limite diferente do endpoint REST (2–12).

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/message/sendPoll/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888",
  "name": "Qual turno prefere?",
  "values": [
    "Manhã",
    "Tarde",
    "Noite"
  ],
  "selectableCount": 0
}'
```

### 10. Enviar vídeo redondo (PTV)

**`POST /message/sendPtv/:instance`**

Envia vídeo circular como mensagem rápida.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Destino |
| `video` | `string` | Sim | URL MP4 |
| `delay` | `number` | Não | Até 110000 |
| `quoted` | `object` | Não | Citação |
| `mentionsEveryOne` | `boolean` | Não | @all |
| `mentioned` | `string[]` | Não | JIDs |

**Comportamento e limites:** Recomendação documentada: vídeo MP4 curto, no máximo **60 segundos**.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/message/sendPtv/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888",
  "video": "https://exemplo.com/recado.mp4"
}'
```

### 11. Publicar Status

**`POST /message/sendStatus/:instance`**

Cria status para contatos selecionados ou para todos.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `type` | `string` | Sim | text, image, audio ou video |
| `content` | `string` | Sim | Texto ou URL pública de mídia |
| `caption` | `string` | Não | Legenda para imagens ou vídeos |
| `backgroundColor` | `string` | Não | Cor hexadecimal em status textual |
| `font` | `number` | Não | Índice de fonte 0–5 |
| `allContacts` | `boolean` | Não | Compartilhar com todos |
| `statusJidList` | `string[]` | Não | Destinatários específicos; ignorado quando allContacts=true |

**Comportamento e limites:** `statusJidList` contém JIDs completos; defina o público de forma inequívoca.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/message/sendStatus/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "type": "text",
  "content": "Comunicado interno",
  "backgroundColor": "#14213D",
  "font": 2,
  "allContacts": true
}'
```

## 4. Chat e presença

### 1. Reagir a mensagem

**`POST /message/sendReaction/:instance`**

Associa reação a um ID de mensagem existente.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `reaction` | `string` | Sim | Emoji de reação |
| `key` | `object` | Sim | Identidade da mensagem |
| `key.remoteJid` | `string` | Sim | JID do chat |
| `key.id` | `string` | Sim | ID da mensagem |
| `key.fromMe` | `boolean` | Sim | Indica se foi enviada pela própria instância |

**Comportamento e limites:** O texto da referência descreve um caractere de reação; emojis compostos podem precisar de validação no ambiente real.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/message/sendReaction/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "reaction": "👍",
  "key": {
    "remoteJid": "5511999988888@s.whatsapp.net",
    "id": "ABC123",
    "fromMe": false
  }
}'
```

### 2. Enviar presença

**`POST /chat/sendPresence/:instance`**

Atualiza o indicador de presença do chat.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Destino |
| `presence` | `string` | Sim | composing ou available |
| `type` | `string` | Não | text ou audio |
| `delay` | `number` | Não | Tempo em ms, até 110000 |

**Comportamento e limites:** Para indicador de gravação, combine `presence=composing` e `type=audio`.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/chat/sendPresence/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888",
  "presence": "composing",
  "type": "audio",
  "delay": 1500
}'
```

### 3. Marcar mensagens como lidas

**`POST /chat/markMessageAsRead/:instance`**

Confirma leitura de mensagens específicas.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `readMessages` | `object[]` | Sim | Mensagens a confirmar |
| `readMessages[].remoteJid` | `string` | Sim | Chat correspondente |
| `readMessages[].id` | `string` | Sim | ID original |
| `readMessages[].sender` | `string` | Não | Em grupo, obrigatório; JID do autor |

**Comportamento e limites:** Envie uma lista de chaves, não somente IDs avulsos.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/chat/markMessageAsRead/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "readMessages": [
    {
      "remoteJid": "5511999988888@s.whatsapp.net",
      "id": "ABC123"
    }
  ]
}'
```

### 4. Checar números WhatsApp

**`POST /chat/whatsappNumbers/:instance`**

Consulta se números estão registrados.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `numbers` | `string[]` | Sim | Telefones com DDI e DDD |

**Comportamento e limites:** É uma consulta de existência, não autorização para iniciar disparos não solicitados.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/chat/whatsappNumbers/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "numbers": [
    "5511999988888",
    "5511999977777"
  ]
}'
```

### 5. Editar texto enviado

**`POST /chat/updateMessage/:instance`**

Altera o conteúdo de mensagem enviada pela instância.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Destino |
| `text` | `string` | Sim | Novo conteúdo |
| `key` | `object` | Sim | Mensagem original |
| `key.remoteJid` | `string` | Sim | Chat |
| `key.id` | `string` | Sim | ID |
| `key.fromMe` | `boolean` | Sim | Deve identificar corretamente a autoria |

**Comportamento e limites:** Recomendado acompanhar o webhook `messages.edited` após edição.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/chat/updateMessage/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888",
  "text": "Texto atualizado",
  "key": {
    "remoteJid": "5511999988888@s.whatsapp.net",
    "id": "ABC123",
    "fromMe": true
  }
}'
```

### 6. Foto de perfil

**`POST /chat/fetchProfilePictureUrl/:instance`**

Consulta foto full-res por telefone ou JID, inclusive grupos.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Telefone, JID individual ou JID de grupo |

**Comportamento e limites:** `profilePictureUrl: null` quando inexistente ou ocultada por privacidade.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/chat/fetchProfilePictureUrl/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888"
}'
```

#### Como o wacrm usa a foto de perfil

A API oficial (Meta) **não expõe** a foto de um contato — o webhook do Meta
entrega nome e número, e é só isso. A CRMBR expõe, então a caixa de entrada
passa a mostrar a imagem do cliente em vez da inicial.

O fluxo, no servidor (`src/lib/whatsapp/providers/whatsmiau/`):

| Passo | Onde | O que acontece |
|---|---|---|
| Consulta | `profile-picture.ts` | `POST /chat/fetchProfilePictureUrl/<instância>` com o número do contato. `profilePictureUrl: null` = o contato não tem foto (ou escondeu). |
| Cópia | `profile-picture.ts` | A URL vive no CDN do WhatsApp e **expira** — os bytes são baixados (limite de 2 MB) e gravados no bucket público `chat-media`, em `account-<id>/avatars/<contact_id>.<ext>`. |
| Referência | `avatar.ts` | `contacts.avatar_url` passa a apontar para o **nosso** objeto — durável, servido pelo mesmo bucket que já serve as mídias da conversa. |
| Memória | `avatar.ts` + migration `065` | A tabela `contact_avatars` guarda o resultado (`found` / `missing` / `pending`) e a hora da última consulta. Uma janela de **24 h** impede que cada mensagem de um contato sem foto vire uma chamada ao provedor. |

Regras que valem para este fluxo:

- **Falha do provedor não é "o contato não tem foto".** Um erro é gravado como
  `pending` e a consulta é refeita depois da janela; só a resposta `null` vira
  `missing`.
- **Tudo é melhor-esforço.** Um erro na foto nunca derruba a mensagem: ela já
  foi gravada antes da consulta, e a foto é best-effort.
- **A foto aparece ao vivo.** A migration `065` coloca `contacts` na publicação
  do Realtime; quando `avatar_url` é gravado, o navegador recebe o evento e a
  imagem aparece sem recarregar a página.
- **O evento `contacts.upsert`** (§7.6) traz `profilePicUrl`, mas ele é
  **ignorado na v1** — o webhook chega sem o contato ter conversado, e a
  consulta por demanda cobre qualquer contato a qualquer momento.

> Sem a migration `065` aplicada, o fluxo continua funcionando (a foto é
> buscada a cada mensagem), mas sem a janela de 24 h e sem o aviso ao vivo.

### 7. Apagar mensagem para todos

**`DELETE /chat/deleteMessageForEveryone/:instance`**

Revoga uma mensagem mediante sua chave.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `id` | `string` | Sim | Identificador da mensagem |
| `remoteJid` | `string` | Sim | Chat ou grupo |
| `fromMe` | `boolean` | Sim | Autoria |
| `participant` | `string` | Não | Exigido em grupo ao apagar mensagem de outro participante |

**Comportamento e limites:** A operação é destrutiva e depende de permissões e condições do WhatsApp.

**Exemplo:**

```bash
curl -X DELETE 'https://api.whatsmiau.dev/v2/chat/deleteMessageForEveryone/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "id": "ABC123",
  "remoteJid": "5511999988888@s.whatsapp.net",
  "fromMe": true
}'
```

### 8. Sincronizar histórico de um chat

**`POST /chat/syncMessages/:instance`**

Obtém mensagens anteriores a uma âncora diretamente do dispositivo principal, quando online.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Telefone/JID do chat ou grupo |
| `id` | `string` | Sim | ID conhecido de mensagem âncora |
| `count` | `number` | Não | Número solicitado, padrão 50; máximo 500 |
| `since` | `string` | Não | Data YYYY-MM-DD ou RFC3339 |
| `fromMe` | `boolean` | Não | Autoria da âncora; recomendado para localizá-la |

**Comportamento e limites:** Exige sessão autenticada e dispositivo principal acessível. Não foi projetado para extração maciça de histórico.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/chat/syncMessages/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888@s.whatsapp.net",
  "id": "ABC123",
  "fromMe": false,
  "count": 50
}'
```

## 5. Ligações

**Experimental.** Chamadas diretas de **áudio 1:1** exigem `CALLS_ENABLED=true` no Core; após ativação, a instância precisa reconectar. Não há API equivalente na camada Z-API. REST aceita `apikey` ou Bearer JWT; o WebSocket exige `apikey` no handshake. Navegadores não permitem definir esse cabeçalho nativamente, portanto utilize um backend intermediário autorizado, sem expor segredos.

### 1. Iniciar chamada de áudio

**`POST /instance/:instance/calls`**

Inicia uma chamada 1:1 para número/JID; responde HTTP 201.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `number` | `string` | Sim | Destinatário ou JID |

**Comportamento e limites:** Retorna `ID` e `Recipient` com chaves capitalizadas; monitore estado via lista ou evento `call`.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/instance/Atendimento01/calls' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "number": "5511999988888"
}'
```

### 2. Listar ligações

**`GET /instance/:instance/calls`**

Apresenta sessões e estados disponíveis.


**Comportamento e limites:** Formato contém `ID`, `Peer`, `Direction`, `Media`, `State`, `Reason`, `CanAnswer`, `CanReject`, `CanHangup`, `CreatedAt`, `UpdatedAt`; dados de SDP, chaves ou relays não são devolvidos.

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/instance/Atendimento01/calls' \
  -H 'apikey: SUA_CHAVE_API'
```

### 3. Atender ligação

**`POST /instance/:instance/calls/:callID/answer`**

Atende uma ligação recebida.


**Comportamento e limites:** Use apenas se `CanAnswer=true` e a sessão estiver tocando. Retorno típico `{ "status": "ok" }`.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/instance/Atendimento01/calls/ABCD1234/answer' \
  -H 'apikey: SUA_CHAVE_API'
```

### 4. Rejeitar ligação

**`POST /instance/:instance/calls/:callID/reject`**

Recusa uma chamada recebida.


**Comportamento e limites:** Verifique `CanReject=true` antes de agir.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/instance/Atendimento01/calls/ABCD1234/reject' \
  -H 'apikey: SUA_CHAVE_API'
```

### 5. Encerrar ligação

**`POST /instance/:instance/calls/:callID/hangup`**

Finaliza ligação ativa, iniciando ou tocando.


**Comportamento e limites:** Consulte `CanHangup=true` antes de solicitar.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/instance/Atendimento01/calls/ABCD1234/hangup' \
  -H 'apikey: SUA_CHAVE_API'
```

### 6. WebSocket de áudio

**`GET /instance/:instance/calls/:callID/audio`**

Conecta ponte bidirecional de áudio PCM via **wss**.


**Comportamento e limites:** Handshake exige `apikey` como header: não aceita chave na query string. Cada mensagem binária possui **3.840 bytes**, **960 amostras float32 little-endian**, PCM **mono 16 kHz**, **60 ms por frame**. Frames de outro tamanho, texto ou agregação encerram a conexão. Não são expostos SDP, áudio criptografado, endpoint de relay ou chaves. Duração pública máxima de até 60 minutos, necessitando reconectar enquanto a chamada persistir.

**Exemplo:**

```bash
npx wscat -c 'wss://api.whatsmiau.dev/v2/instance/Atendimento01/calls/ABCD1234/audio' \
  -H 'apikey: SUA_CHAVE_API'
```

## 6. Webhooks

### 1. Definir configuração

**`POST /webhook/set/:instance`**

Configura receptor para eventos POST por instância.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `webhook.enabled` | `boolean` | Não | Ativo/inativo |
| `webhook.url` | `string` | Não | HTTPS público de destino |
| `webhook.headers` | `object` | Não | Cabeçalhos adicionais, até 20, sem duplicatas case-insensitive |
| `webhook.events` | `string[]` | Não | Eventos liberados; omitido implica nenhuma entrega |
| `webhook.base64` | `boolean` | Não | Codifica dados de mídia em base64 conforme contexto |

**Comportamento e limites:** É necessário configurar eventos explicitamente para receber entregas.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/webhook/set/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "webhook": {
    "enabled": true,
    "url": "https://sistema.exemplo.com/whatsapp/eventos",
    "events": [
      "messages.upsert",
      "messages.edited",
      "connection.update",
      "messages.update"
    ]
  }
}'
```

### 2. Consultar configuração

**`GET /webhook/find/:instance`**

Retorna o webhook atualmente configurado.


**Comportamento e limites:** A resposta pode envolver a propriedade `webhook`.

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/webhook/find/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API'
```

## 7. Eventos de webhook

Todos os tipos abaixo são enviados por `POST` ao endereço cadastrado. A instância só envia os eventos selecionados em `webhook.events`. O formato padrão tem um **envelope** estável com dados específicos de cada evento:

```json
{
  "event": "messages.upsert",
  "instance": "Atendimento01",
  "date_time": "2026-10-27T15:00:00Z",
  "sender": "5511999988888@s.whatsapp.net",
  "server_url": "https://api.whatsmiau.dev",
  "data": {}
}
```

`event` identifica o tópico; `instance` aponta a sessão; `date_time` é ISO-8601; `data` é um objeto ou array conforme o tópico; `sender` e `server_url` podem acompanhar o envelope quando aplicáveis. A presença exata dos campos depende do evento.

### 7.1 `messages.upsert`

Emitido quando uma mensagem é enviada ou recebida. O campo `data.message` carrega **um tipo de conteúdo por mensagem**, enquanto `data.messageType` identifica o formato.

| Campo | Tipo | Interpretação |
|---|---|---|
| `data.key` | object | Identificador composto da mensagem. |
| `data.key.remoteJid` | string | JID de conversa ou grupo. |
| `data.key.fromMe` | boolean | Enviada pela própria instância? |
| `data.key.id` | string | Identificador da mensagem. |
| `data.key.participant` | string? | Autor específico quando enviada em grupo. |
| `data.pushName` | string | Nome exibido para o remetente. |
| `data.status` | string | `sent` ou `received`. |
| `data.message.conversation` | string? | Texto simples. |
| `data.message.imageMessage` | object? | Imagem; pode trazer `url`, `mimetype`, `caption`, `width` e `height`. |
| `data.message.videoMessage` | object? | Vídeo; pode incluir `url`, `mimetype`, `caption` e `seconds`. |
| `data.message.audioMessage` | object? | Áudio; pode incluir `url`, `mimetype`, `seconds` e `ptt`. |
| `data.message.documentMessage` | object? | Documento, com `url`, `mimetype`, `fileName`, `title`. |
| `data.message.reactionMessage` | object? | Reação; propriedade `key` aponta para mensagem reagida e `text` contém emoji. |
| `data.message.contactMessage` | object? | Nome de contato e vCard. |
| `data.message.listResponseMessage` | object? | Resposta de lista; `title` e `singleSelectReply.selectedRowId`. |
| `data.message.mediaUrl` | string? | URL gerada após armazenamento de mídia, quando disponível. |
| `data.messageType` | string | Ex.: `conversation`, `imageMessage`, `audioMessage`. |
| `data.messageTimestamp` | number | Timestamp Unix em segundos. |
| `data.instanceId` | string | Instância de origem. |
| `data.contextInfo` | object? | Contexto de respostas, menções ou mensagens temporárias. |
| `data.contextInfo.stanzaId` | string? | ID de mensagem citada. |
| `data.contextInfo.participant` | string? | Autor da mensagem citada. |
| `data.contextInfo.quotedMessage` | object? | Conteúdo original citado. |
| `data.contextInfo.mentionedJid` | string[]? | Destinatários mencionados. |
| `data.contextInfo.expiration` | number? | Tempo de expiração em segundos. |

**Exemplo de mensagem recebida:**

```json
{
  "event": "messages.upsert",
  "instance": "Atendimento01",
  "date_time": "2026-10-27T15:00:00Z",
  "data": {
    "key": {"remoteJid": "5511999988888@s.whatsapp.net", "id": "MSG_001", "fromMe": false},
    "pushName": "Cliente Exemplo",
    "status": "received",
    "message": {"conversation": "Preciso de suporte."},
    "messageType": "conversation",
    "messageTimestamp": 1793113200,
    "instanceId": "Atendimento01"
  }
}
```

**Mídias:** a documentação apresenta exemplos com `imageMessage`, `audioMessage`, comprimentos de arquivo, `mimetype` e `mediaUrl` aninhado em `message`. Não suponha que o mesmo campo exista em todos os formatos. Com `saveMedia=false`, o servidor não oferece `mediaUrl`. Exemplos adicionais da página abrangem imagem, áudio PTT e reação.

### 7.2 `messages.edited`

Evento de alterações de texto. Identifica a mensagem original por `data.key` e apresenta o resultado em `data.editedMessage`.

| Campo | Tipo | Interpretação |
|---|---|---|
| `data.key` | object | `remoteJid`, `id`, `fromMe` originais. |
| `data.editedMessage` | object | Texto/conteúdo atualizado, por exemplo `conversation`. |
| `data.messageType` | string | Tipo da versão editada. |
| `data.pushName` | string | Quem alterou. |
| `data.status` | enum | `received` ou `sent`. |
| `data.messageTimestamp` | number | Instante da alteração. |
| `data.source` | string | Valor documentado `whatsapp`. |
| `data.instanceId` | string | Sessão. |

**Migração obrigatória até 04/11/2026:** enquanto `messages.edited` não estiver habilitado, edições podem continuar chegando em `messages.upsert` como `messageType: editedMessage`. Após habilitar o novo evento, edições deixam de ser entregues pelo formato antigo. A fonte informa remoção do comportamento anterior em **4 de novembro de 2026**.

```json
{
  "event": "messages.edited",
  "instance": "Atendimento01",
  "date_time": "2026-10-27T15:02:00Z",
  "data": {
    "key": {"remoteJid": "5511999988888@s.whatsapp.net", "id": "MSG_001", "fromMe": false},
    "editedMessage": {"conversation": "Preciso de suporte técnico."},
    "messageType": "conversation", "pushName": "Cliente Exemplo",
    "status": "received", "messageTimestamp": 1793113320,
    "source": "whatsapp", "instanceId": "Atendimento01"
  }
}
```

### 7.3 `messages.update`

Notifica mudança de estado da entrega/leitura.

| Campo | Tipo | Interpretação |
|---|---|---|
| `messageId` | string | ID da mensagem. |
| `keyId` | string | ID da chave. |
| `remoteJid` | string | Conversa original. |
| `fromMe` | boolean | Autoria. |
| `participant` | string | Participante em grupos, quando aplicável. |
| `status` | enum | `DELIVERY_ACK` (entregue) ou `READ` (lida). |
| `instanceId` | string | Instância. |

```json
{"event":"messages.update","instance":"Atendimento01","data":{"messageId":"MSG_001","keyId":"MSG_001","remoteJid":"5511999988888@s.whatsapp.net","fromMe":true,"participant":"","status":"READ","instanceId":"Atendimento01"}}
```

### 7.4 `messages.set`

Emitido por **lotes de mensagens antigas** ao fazer sincronização integral na criação da instância. Para obtê-lo, configure `syncFullHistory: true` ao criar e inclua `messages.set` em `webhook.events`. O campo `data` é um **array de mensagens** no mesmo formato de `messages.upsert`, não um objeto isolado.

| Campo | Tipo | Interpretação |
|---|---|---|
| `isLatest` (envelope) | boolean | Último batch; verdadeiro se `progress >= 100`. |
| `progress` (envelope) | number | Avanço da sincronização, de 0 a 100. |
| `data[]` | array | Mensagens antigas. |
| `data[].key` | object | Chave da mensagem. |
| `data[].pushName` | string | Nome do remetente. |
| `data[].message` | object | Conteúdo. |
| `data[].messageType` | string | Tipo. |
| `data[].messageTimestamp` | number | Timestamp histórico. |
| `data[].instanceId` | string | Instância. |

```json
{"event":"messages.set","instance":"Atendimento01","isLatest":true,"progress":100,"data":[]}
```

### 7.5 `connection.update`

Disparado ao conectar, desconectar ou falhar a conexão. Observe que os estados neste **evento** são `open` e `close` (na consulta REST, `closed` pode ser retornado).

| Campo | Tipo | Interpretação |
|---|---|---|
| `instance` | string | Instância. |
| `wuid` | string | Identificador WhatsApp quando conectado. |
| `profileName` | string | Nome público, quando conectado. |
| `profilePictureUrl` | string? | Foto disponível. |
| `state` | enum | `open` ou `close`. |
| `statusReason` | number | Código do estado; `200` indica sucesso, demais podem sinalizar erro. |

```json
{"event":"connection.update","instance":"Atendimento01","data":{"instance":"Atendimento01","wuid":"5511999988888@s.whatsapp.net","profileName":"Equipe","state":"open","statusReason":200}}
```

### 7.6 `contacts.upsert`

Disparado em sincronizações e alterações de contato ou grupo: nome de exibição, nome comercial, foto ou metadados de grupo. `data` é **array**.

| Campo em `data[]` | Tipo | Significado |
|---|---|---|
| `remoteJid` | string | JID individual ou grupo. |
| `remoteLid` | string | LID alternativo. |
| `pushName` | string | Nome exibido. |
| `profilePicUrl` | string | URL da foto. |
| `instanceId` | string | Sessão. |

### 7.7 `messages.delete`

Evento de revogação de mensagem apagada para todos (não equivale a apagar só na visualização do remetente).

| Campo em `data` | Tipo | Significado |
|---|---|---|
| `id` | string | Mensagem apagada. |
| `remoteJid` | string | Conversa. |
| `fromMe` | boolean | Autoria. |
| `participant` | string | Remetente em grupo. |
| `status` | string | Fixo `DELETED`. |
| `instanceId` | string | Sessão. |

### 7.8 `group-participants.update`

Reage a adição, exclusão, promoção e rebaixamento de membros.

| Campo em `data` | Tipo | Significado |
|---|---|---|
| `id` | string | JID do grupo. |
| `author` | string | LID do responsável pela ação. |
| `action` | enum | `add`, `remove`, `promote`, `demote`. |
| `participants` | array | Pessoas afetadas. |
| `participants[].id` | string | LID da pessoa. |
| `participants[].phoneNumber` | string | WhatsApp / telefone da pessoa. |
| `participants[].admin` | boolean / null | `true` promoção, `false` rebaixamento, null para inclusão/remoção. |
| `participantsData` | array | Espelho aninhado dos participantes, compatível com estrutura Evolution (p.ex. `jid`). |
| `instanceId` | string | Instância, quando presente. |

O envelope ilustrado pela plataforma também pode incluir `sender`. Mantenha tolerância a campos opcionais e estruturas redundantes.

### 7.9 `call` (apenas Evolution)

Evento de **sinalização de ligação**, não de mídia. Habilite `call` expressamente na assinatura de webhook. Transições possíveis: `offer`, `preaccept`, `accept`, `transport`, `relaylatency`, `reject` e `terminate`.

| Campo em `data` | Tipo | Significado |
|---|---|---|
| `callId` | string | ID usado para atender/encerrar e conectar áudio. |
| `from` | string? | JID de origem. |
| `callCreator` / `callCreatorAlt` | string? | Identificadores de autoria. |
| `groupJid` | string? | Grupo associado, se houver. |
| `status` | string | Fase atual. |
| `media` | `audio` / `video` / `""` | Tipo anunciado. |
| `isVideo` / `isGroup` | boolean? | Características sinalizadas. |
| `remotePlatform` / `remoteVersion` | string? | Cliente remoto. |
| `reason` | string? | Motivo de término. |
| `rtcMediaAvailable` | boolean | Documentado permanentemente `false` no webhook. |

Nenhum payload `call` fornece áudio ou vídeo bruto, SDP, relay, mídia criptografada ou chaves de sessão; tampouco existe tradução para callback Z-API.

```json
{"event":"call","instance":"Atendimento01","data":{"callId":"CHAMADA01","from":"5511999988888@s.whatsapp.net","status":"offer","media":"audio","isVideo":false,"isGroup":false,"rtcMediaAvailable":false}}
```


## 8. Compatibilidade Z-API e callbacks

A navegação do portal público **lista** as áreas “Compatibilidade Z-API”, “Configurar Webhooks” e “Callbacks”. Entretanto, na representação da página `getting-started` consultada nesta data essas áreas **não contêm descrição textual de contrato, URLs completas, parâmetros ou schemas**. As rotas correspondentes não podem ser reconstruídas com segurança a partir somente do menu; por isso não foram fabricadas.

**Afirmações sustentadas pela documentação acessível:** a API HTTP v2 apresenta compatibilidade com o padrão Evolution; a plataforma menciona uma camada Z-API e callbacks próprios; **ligações** e o evento `call` não possuem equivalentes Z-API. Não confundir a referência REST de webhook (`/webhook/set/:instance`) com um eventual endpoint específico de callback Z-API cuja URL não foi publicada na parte extraível desta página.

Se sua integração usar diretamente o protocolo Z-API, obtenha o contrato específico no portal ou pela ferramenta MCP `get_docs` antes de implementar métodos, payloads ou headers dessa camada.


## 9. Grupos

O nome curto da instância ou o identificador completo pode ser usado nas rotas deste bloco. Operações administrativas requerem as permissões do WhatsApp.

### 1. Criar grupo

**`POST /group/create/:instance`**

Cria grupo com a instância como administradora.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `subject` | `string` | Sim | Nome com 1–25 caracteres |
| `description` | `string` | Não | Descrição |
| `participants` | `string[]` | Não | Números com DDI |
| `promoteParticipants` | `boolean` | Não | Promover convidados a admin |

**Comportamento e limites:** A resposta pode retornar `id` no formato `...@g.us`.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/group/create/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "subject": "Equipe de Produto",
  "description": "Discussões de produto",
  "participants": [
    "5511999988888"
  ]
}'
```

### 2. Renomear grupo

**`POST /group/updateGroupSubject/:instance`**

Muda nome do grupo (exige admin).

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `groupJid` | `string` | Sim | JID do grupo |
| `subject` | `string` | Sim | Novo nome 1–25 caracteres |

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/group/updateGroupSubject/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "groupJid": "120363001234567890@g.us",
  "subject": "Equipe de Engenharia"
}'
```

### 3. Alterar foto

**`POST /group/updateGroupPicture/:instance`**

Atualiza imagem do grupo, para administradores.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `groupJid` | `string` | Sim | Grupo |
| `image` | `string` | Sim | JPEG URL pública ou base64/data URI |

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/group/updateGroupPicture/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "groupJid": "120363001234567890@g.us",
  "image": "https://exemplo.com/logo.jpg"
}'
```

### 4. Alterar descrição

**`POST /group/updateGroupDescription/:instance`**

Define/limpa texto do grupo.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `groupJid` | `string` | Sim | Grupo |
| `description` | `string` | Não | Descrição; string vazia remove |

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/group/updateGroupDescription/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "groupJid": "120363001234567890@g.us",
  "description": ""
}'
```

### 5. Detalhes de grupo

**`GET /group/findGroupInfos/:instance`**

Consulta assunto, tópico, titular, administradores, políticas e membros.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `groupJid` | `string (query)` | Sim | JID alvo |

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/group/findGroupInfos/Atendimento01?groupJid=120363001234567890@g.us' \
  -H 'apikey: SUA_CHAVE_API'
```

### 6. Listar grupos

**`GET /group/fetchAllGroups/:instance`**

Exibe grupos dos quais o telefone participa.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `getParticipants` | `string (query)` | Não | true inclui listas completas, com custo maior |

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/group/fetchAllGroups/Atendimento01?getParticipants=false' \
  -H 'apikey: SUA_CHAVE_API'
```

### 7. Listar participantes

**`GET /group/participants/:instance`**

Devolve membros do grupo, incluindo flags admin/superAdmin.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `groupJid` | `string (query)` | Sim | JID do grupo |

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/group/participants/Atendimento01?groupJid=120363001234567890@g.us' \
  -H 'apikey: SUA_CHAVE_API'
```

### 8. Código de convite

**`GET /group/inviteCode/:instance`**

Recupera/gera código do link de ingresso.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `groupJid` | `string (query)` | Sim | Grupo |

**Comportamento e limites:** Monte link no formato `https://chat.whatsapp.com/{inviteCode}`.

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/group/inviteCode/Atendimento01?groupJid=120363001234567890@g.us' \
  -H 'apikey: SUA_CHAVE_API'
```

### 9. Inspecionar convite

**`GET /group/inviteInfo/:instance`**

Pré-visualiza grupo sem ingressar.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `inviteCode` | `string (query)` | Sim | Código do link |

**Comportamento e limites:** Retorna informações que podem incluir nome, descrição e membros.

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/group/inviteInfo/Atendimento01?inviteCode=CODIGO' \
  -H 'apikey: SUA_CHAVE_API'
```

### 10. Aceitar convite

**`GET /group/acceptInviteCode/:instance`**

Adiciona a instância usando o código do link.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `inviteCode` | `string (query)` | Sim | Código de acesso |

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/group/acceptInviteCode/Atendimento01?inviteCode=CODIGO' \
  -H 'apikey: SUA_CHAVE_API'
```

### 11. Convidar por mensagem privada

**`POST /group/sendInvite/:instance`**

Envia links a uma relação de números.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `groupJid` | `string` | Sim | Grupo |
| `description` | `string` | Não | Texto da mensagem |
| `numbers` | `string[]` | Sim | Destinatários com DDI |

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/group/sendInvite/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "groupJid": "120363001234567890@g.us",
  "description": "Convite para o grupo",
  "numbers": [
    "5511999988888"
  ]
}'
```

### 12. Revogar convite

**`POST /group/revokeInviteCode/:instance`**

Invalida o código de acesso anterior e gera um substituto.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `groupJid` | `string` | Sim | Grupo |

**Comportamento e limites:** Requer permissão de administrador.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/group/revokeInviteCode/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "groupJid": "120363001234567890@g.us"
}'
```

### 13. Gerenciar participantes

**`POST /group/updateParticipant/:instance`**

Adiciona, remove, promove ou rebaixa membros.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `groupJid` | `string` | Sim | Grupo |
| `action` | `string` | Sim | add, remove, promote, demote |
| `participants` | `string[]` | Sim | JIDs ou números com DDI |

**Comportamento e limites:** Em `remove` ou `demote` JIDs inválidos produzem HTTP 400; valide contra a listagem real.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/group/updateParticipant/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "groupJid": "120363001234567890@g.us",
  "action": "promote",
  "participants": [
    "5511999988888@s.whatsapp.net"
  ]
}'
```

### 14. Configurar políticas

**`POST /group/updateSetting/:instance`**

Define quem pode falar e editar metadados.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `groupJid` | `string` | Sim | Grupo |
| `action` | `string` | Sim | announcement, not_announcement, locked, unlocked |

**Comportamento e limites:** `announcement` só admins falam; `not_announcement` todos; `locked` só admins alteram informações; `unlocked` todos.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/group/updateSetting/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "groupJid": "120363001234567890@g.us",
  "action": "locked"
}'
```

### 15. Mensagens efêmeras

**`POST /group/toggleEphemeral/:instance`**

Define prazo de expiração automática.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `groupJid` | `string` | Sim | Grupo |
| `expiration` | `number` | Não | 0, 86400, 604800 ou 7776000 segundos |

**Comportamento e limites:** Omitir expiração equivale a desligar (0). Correspondem a nenhum, 24h, 7d ou 90d.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/group/toggleEphemeral/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "groupJid": "120363001234567890@g.us",
  "expiration": 86400
}'
```

### 16. Sair de grupo

**`DELETE /group/leaveGroup/:instance`**

Desvincula o número do grupo.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `groupJid` | `string (query)` | Sim | Grupo |

**Comportamento e limites:** O retorno depende de novo convite; operação não oferece retorno automático.

**Exemplo:**

```bash
curl -X DELETE 'https://api.whatsmiau.dev/v2/group/leaveGroup/Atendimento01?groupJid=120363001234567890@g.us' \
  -H 'apikey: SUA_CHAVE_API'
```

## 10. Comunidades

Uma comunidade possui grupo de avisos e grupos filhos. Para alterar os participantes de cada grupo, use as rotas de **Grupos**.

### 1. Criar comunidade

**`POST /community/create/:instance`**

Cria comunidade pai e grupo de anúncios automático.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `subject` | `string` | Sim | Nome 1–25 caracteres |
| `description` | `string` | Não | Descrição |

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/community/create/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "subject": "Comunidade do Produto",
  "description": "Avisos e grupos temáticos"
}'
```

### 2. Criar subgrupo

**`POST /community/createSubGroup/:instance`**

Cria um grupo já vinculado à comunidade.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `subject` | `string` | Sim | Nome 1–25 caracteres |
| `parentJid` | `string` | Sim | JID da comunidade |
| `participants` | `string[]` | Não | Participantes iniciais |

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/community/createSubGroup/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "subject": "Dúvidas",
  "parentJid": "120363001234567890@g.us",
  "participants": [
    "5511999988888"
  ]
}'
```

### 3. Vincular grupo existente

**`POST /community/linkGroup/:instance`**

Acopla um grupo como filho de comunidade.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `parentJid` | `string` | Sim | Comunidade |
| `childJid` | `string` | Sim | Grupo existente |

**Comportamento e limites:** A instância precisa administrar a comunidade e o grupo.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/community/linkGroup/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "parentJid": "120363001234567890@g.us",
  "childJid": "120363009876543210@g.us"
}'
```

### 4. Desvincular grupo

**`POST /community/unlinkGroup/:instance`**

Remove vínculo de grupo com comunidade sem apagar o grupo.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `parentJid` | `string` | Sim | Comunidade |
| `childJid` | `string` | Sim | Grupo |

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/community/unlinkGroup/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "parentJid": "120363001234567890@g.us",
  "childJid": "120363009876543210@g.us"
}'
```

### 5. Listar subgrupos

**`GET /community/subGroups/:instance`**

Lista filhos vinculados à comunidade.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `communityJid` | `string (query)` | Sim | JID pai |

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/community/subGroups/Atendimento01?communityJid=120363001234567890@g.us' \
  -H 'apikey: SUA_CHAVE_API'
```

### 6. Participantes vinculados

**`GET /community/linkedGroupsParticipants/:instance`**

Obtém conjunto deduplicado de membros dos subgrupos.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `communityJid` | `string (query)` | Sim | JID pai |

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/community/linkedGroupsParticipants/Atendimento01?communityJid=120363001234567890@g.us' \
  -H 'apikey: SUA_CHAVE_API'
```

### 7. Exigir aprovação de entrada

**`POST /community/setJoinApprovalMode/:instance`**

Habilita fluxo de aprovação quando o usuário ingressa via link.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `communityJid` | `string` | Sim | Comunidade |
| `mode` | `boolean` | Não | true aprova manualmente; false (padrão) dispensa |

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/community/setJoinApprovalMode/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "communityJid": "120363001234567890@g.us",
  "mode": true
}'
```

### 8. Quem pode adicionar grupos

**`POST /community/setGroupAddMode/:instance`**

Controla permissão de adicionar/vincular **grupos** à comunidade.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `communityJid` | `string` | Sim | JID pai (não aceita JID de grupo comum) |
| `mode` | `string` | Sim | admin_add ou all_member_add |

**Comportamento e limites:** Não controla quem pode adicionar pessoas aos grupos filhos.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/community/setGroupAddMode/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "communityJid": "120363001234567890@g.us",
  "mode": "admin_add"
}'
```

### 9. Solicitações de entrada pendentes

**`GET /community/requestParticipants/:instance`**

Busca pedidos aguardando moderação.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `communityJid` | `string (query)` | Sim | JID da comunidade |

**Comportamento e limites:** Depende do modo de aprovação habilitado.

**Exemplo:**

```bash
curl -X GET 'https://api.whatsmiau.dev/v2/community/requestParticipants/Atendimento01?communityJid=120363001234567890@g.us' \
  -H 'apikey: SUA_CHAVE_API'
```

### 10. Aprovar/rejeitar entradas

**`POST /community/requestParticipants/update/:instance`**

Executa decisão sobre solicitações.

| Campo | Tipo | Obrigatório | Detalhe |
|---|---|:---:|---|
| `communityJid` | `string` | Sim | Comunidade |
| `action` | `string` | Sim | approve ou reject |
| `participants` | `string[]` | Não | Lista dos JIDs pendentes |

**Comportamento e limites:** Use os JIDs fornecidos pela listagem de solicitações pendentes.

**Exemplo:**

```bash
curl -X POST 'https://api.whatsmiau.dev/v2/community/requestParticipants/update/Atendimento01' \
  -H 'apikey: SUA_CHAVE_API' \
  -H 'Content-Type: application/json' \
  --data-raw '{
  "communityJid": "120363001234567890@g.us",
  "action": "approve",
  "participants": [
    "5511999988888@s.whatsapp.net"
  ]
}'
```

### Nota sobre “Quem pode adicionar” nos grupos

O menu da página menciona um item **Quem Pode Adicionar**, e o inventário MCP oferece `set_group_member_add_mode`, para decidir se administradores ou membros comuns podem adicionar pessoas. **Não foi encontrado no corpo REST consultado um método/caminho para esta operação**. Portanto o recurso é listado aqui como funcionalidade de MCP sem atribuição de rota HTTP hipotética. Não confunda essa preferência de grupo com `POST /community/setGroupAddMode/:instance`, que regula a vinculação de **grupos a uma comunidade**.

## 11. MCP — Model Context Protocol

O MCP fornece acesso remoto a ações WhatsApp por agentes compatíveis: Hermes, Claude Code, Cursor, Continue, Cline, Codex, OpenClaw e outros clientes. A URL do servidor é **`https://mcp.whatsmiau.dev`**. São aceitos OAuth via navegador ou autenticação via chave API que também serve na interface REST.

### 11.1 Instância, pool e slot

| Conceito | Definição | Implicação |
|---|---|---|
| Instância | Sessão vinculada a um número, identificada por `id`. | Use `id` como `instance` ou `instance_id` nas ferramentas. |
| Pool | Contratação separada que retém dados históricos. | Seu identificador é `pool_id`; não identifica a sessão. |
| Slot | Capacidade de histórico associada a uma instância de cada vez. | Ativa `history_enabled` naquela instância. |

**O pool não é requisito para criar instâncias, autenticar WhatsApp, enviar mensagens, administrar webhook ou consultar comunidades em tempo real.** Para leitura de dados **salvos**, associo uma instância a um slot pago. A limitação de slots é distinta do limite de instâncias do plano.

Fluxo sugerido: executar `list_instances`; usar `id` da sessão; ler `history_enabled` antes de solicitar dados retidos; omitir `pool_id` na criação, exceto se o pool existir e a retenção imediata tiver sido expressamente desejada. `list_communities` e `list_community_subgroups` são consultas online que não dependem de histórico.

A coleta histórica começa **na associação ao pool**, sem backfill automático do passado. Ela depende de webhook interno separado do webhook configurado pela aplicação. Áudios podem registrar `media_url` preexistente no armazenamento de origem, sem transcrição e sem cópia de arquivo pelo MCP. A expiração do link de mídia pode acontecer antes da expiração do histórico. Após cancelamento, acesso/coleta cessam e os dados preservados continuam sujeitos à expiração que já tinham.

### 11.2 Configuração de clientes MCP

#### Hermes (OAuth)

```bash
hermes mcp add whatsmiau --url https://mcp.whatsmiau.dev --auth oauth
hermes mcp login whatsmiau
hermes mcp test whatsmiau
```

#### Hermes (API key)

```bash
hermes mcp add whatsmiau --url https://mcp.whatsmiau.dev --auth header
```

Este modo solicita o segredo de forma interativa, evitando colocá-lo no comando digitado.

#### Cursor, Continue e Cline (OAuth)

```json
{
  "mcpServers": {
    "whatsmiau": {"url": "https://mcp.whatsmiau.dev"}
  }
}
```

#### Cursor, Continue e Cline (chave de API)

```json
{
  "mcpServers": {
    "whatsmiau": {
      "url": "https://mcp.whatsmiau.dev",
      "headers": {"Authorization": "Bearer SUA_CHAVE_API"}
    }
  }
}
```

O menu de clientes do portal também apresenta **Claude Code via OAuth**, **Codex via OAuth** e **OpenClaw com API key**, como opções de cliente HTTP remoto. A página extraída não traz comandos próprios desses três para reproduzir com exatidão.

**Verificação operacional:** recarregue o cliente, veja se o servidor Whatsmiau consta como conectado e peça ao agente para listar as instâncias. O schema exato de entrada de cada ferramenta pode ser descoberto dinamicamente via `tools/list`.

### 11.3 Catálogo de ferramentas MCP

> A página informa “60 ferramentas”. A soma dos subtotais apresentados pelos próprios blocos é **61** (1 + 6 + 7 + 12 + 7 + 17 + 11). A lista abaixo segue os nomes efetivamente exibidos, sem descartar um deles para ajustar a contagem publicitária.


#### 11.3.1 Documentação — 1 tool(s)

| Nome da tool | Finalidade |
|---|---|
| `get_docs` | Consulta trechos da documentação publicada, incluindo contratos e exemplos. |

#### 11.3.2 Dados salvos (exigem histórico habilitado) — 6 tool(s)

| Nome da tool | Finalidade |
|---|---|
| `list_conversations` | Páginas de conversas persistidas, horários, prévia e contadores de não lidas. |
| `get_conversation_messages` | Mensagens armazenadas de um chat_jid; áudio contém media_url quando disponível. |
| `search_messages` | Busca textual em mensagens persistidas; não pesquisa transcrição de áudio. |
| `list_contacts` | Lista contatos conhecidos com JIDs, números e nomes. |
| `list_groups` | Lista grupos e subgrupos registrados no snapshot, incluindo participantes e políticas. |
| `get_group_details` | Mostra metadados e participantes conhecidos de grupo/comunidade em histórico. |

#### 11.3.3 Instâncias — 7 tool(s)

| Nome da tool | Finalidade |
|---|---|
| `list_instances` | Exibe conexões e history_enabled. |
| `create_instance` | Abre uma sessão WhatsApp com pool_id opcional. |
| `get_instance_details` | Detalha uma conexão. |
| `connect_instance` | Inicia pareamento e retorna QR em base64. |
| `logout_instance` | Desconecta sem destruir registro. |
| `delete_instance` | Exclui instância após confirmação explícita. |
| `update_instance` | Altera webhooks e comportamento. |

#### 11.3.4 Mensagens — 12 tool(s)

| Nome da tool | Finalidade |
|---|---|
| `send_text_message` | Mensagem de texto e formatação usual do WhatsApp. |
| `send_media_message` | Mídia ou documento por URL. |
| `send_audio_message` | Voz PTT, com conversão para Ogg/Opus. |
| `send_reaction` | Aplica reação por emoji. |
| `send_list_message` | Lista interativa com opções. |
| `send_button_message` | De um a três botões de resposta rápida. |
| `send_sticker_message` | Sticker a partir de URL WebP. |
| `send_location_message` | Coordenadas e endereço opcional. |
| `send_contact_message` | Vários vCards. |
| `send_poll_message` | Enquete (catálogo MCP indica 2 a 10 alternativas). |
| `send_ptv_message` | Vídeo circular. |
| `send_status_message` | Status de texto ou mídia. |

#### 11.3.5 Chat e Webhook — 7 tool(s)

| Nome da tool | Finalidade |
|---|---|
| `mark_message_as_read` | Confirma recebimento/leitura. |
| `send_typing_indicator` | Indica digitação ou gravação. |
| `check_whatsapp_number` | Identifica números com conta WhatsApp. |
| `fetch_profile_picture_url` | Localiza URL de foto do número/grupo. |
| `delete_message_for_everyone` | Revoga mensagem pela chave exata. |
| `set_webhook` | Atualiza destino, eventos, headers e base64. |
| `get_webhook` | Lê configuração do webhook. |

#### 11.3.6 Grupos — 17 tool(s)

| Nome da tool | Finalidade |
|---|---|
| `create_group` | Cria grupo e opcionalmente adiciona participantes. |
| `update_group_subject` | Altera assunto. |
| `update_group_picture` | Atualiza imagem. |
| `update_group_description` | Altera ou limpa descrição. |
| `get_live_group_info` | Detalhes em tempo real; documentação do MCP exige histórico. |
| `list_live_groups` | Grupos ao vivo; documentação do MCP exige histórico. |
| `list_live_group_participants` | Participantes ao vivo; documentação do MCP exige histórico. |
| `get_group_invite_code` | Código de convite atual. |
| `get_group_invite_info` | Inspeciona link antes de ingressar. |
| `accept_group_invite` | Ingressa por convite. |
| `send_group_invite` | Envia link por mensagem privada. |
| `revoke_group_invite_code` | Gira o código de convite. |
| `update_group_participants` | Adiciona/remove/promove/rebaixa participantes. |
| `update_group_setting` | Permissões de chat e metadados. |
| `set_group_ephemeral` | Habilita/desabilita duração de mensagens. |
| `set_group_member_add_mode` | Controla quem pode adicionar participantes ao grupo; rota REST ausente no trecho consultado. |
| `leave_group` | Deixa grupo. |

#### 11.3.7 Comunidades — 11 tool(s)

| Nome da tool | Finalidade |
|---|---|
| `list_communities` | Detecta comunidades pais ao vivo, sem exigir histórico. |
| `create_community` | Cria comunidade e grupo de avisos. |
| `create_community_subgroup` | Cria grupo vinculado. |
| `link_group_to_community` | Acopla grupo existente. |
| `unlink_group_from_community` | Desvincula sem excluir grupo. |
| `list_community_subgroups` | Mostra filhos e anúncios ao vivo, sem histórico. |
| `list_community_participants` | Combina participantes únicos; exige histórico segundo catálogo. |
| `set_community_join_approval` | Ativa revisão administrativa de entradas. |
| `set_community_group_add_mode` | Configura permissão de vincular grupos. |
| `list_community_join_requests` | Pessoas aguardando aprovação; exige histórico. |
| `update_community_join_requests` | Aceita ou nega pedidos em lote. |

### 11.4 Distinções entre REST e MCP

- A camada MCP descobre seus próprios tipos e campos com `tools/list`; nomes dos parâmetros não devem ser deduzidos a partir da documentação REST.
- Certas ferramentas de grupos e participantes ao vivo requerem histórico habilitado conforme descrito **no catálogo MCP**, embora as rotas REST de grupos existam independentemente na referência REST. Não pressupor paridade integral.
- `set_group_member_add_mode` consta no MCP e no menu, mas não há rota REST descrita no corpo HTML consultado.
- `get_docs` é útil para descoberta e para checagem de eventuais atualizações contratuais.
- Não habilitar pools para executar operações que não necessitam dados persistidos.

## 12. Exemplos de integração

Os exemplos a seguir são originais e ilustram chamadas baseadas no contrato. Não fazem autenticação real nem confirmam existência dos destinatários.

### 12.1 Operação genérica em JavaScript/Node.js

```javascript
const BASE = 'https://api.whatsmiau.dev/v2';
const KEY = process.env.WHATSMIAU_API_KEY;

async function whatsapp(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      apikey: KEY,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; }
  catch { payload = text; }
  if (!response.ok) throw new Error(`Whatsmiau ${response.status}: ${text}`);
  return payload;
}

await whatsapp('/message/sendText/Atendimento01', {
  method: 'POST',
  body: { number: '5511999988888', text: 'Seu chamado foi registrado.' },
});
```

### 12.2 Manipulação segura de um webhook Express

```javascript
import express from 'express';
const app = express();
app.use(express.json({ limit: '4mb' }));

app.post('/whatsmiau/eventos', (req, res) => {
  // Valide cabeçalho de autenticação combinado no webhook com sua aplicação.
  if (req.headers['x-tenant-secret'] !== process.env.WEBHOOK_SECRET) {
    return res.sendStatus(401);
  }
  const { event, instance, data } = req.body ?? {};
  // Idealmente: enfileirar processamento e deduplicar pelo ID da mensagem.
  if (event === 'messages.upsert' && data?.key?.id) {
    console.log(instance, data.key.id, data.messageType);
  }
  res.sendStatus(204);
});
```

**Atenção:** `x-tenant-secret` é um header **definido por você em `webhook.headers`**, não um nome que o serviço garante por padrão. Configure-o no lado emissor e confira via `/webhook/find/:instance`.

### 12.3 WebSocket de chamada em Node.js

```javascript
import WebSocket from 'ws';

const ws = new WebSocket(
  'wss://api.whatsmiau.dev/v2/instance/Atendimento01/calls/CHAMADA01/audio',
  { headers: { apikey: process.env.WHATSMIAU_API_KEY } }
);

ws.on('message', (raw, binary) => {
  if (!binary || raw.length !== 3840) return;
  // Uma mensagem binária representa exatamente 60 ms de PCM float32 LE mono/16kHz.
  // Encaminhe ao pipeline de áudio de sua aplicação.
});
ws.on('close', () => console.log('Reconectar se a ligação permanecer ativa'));
```

## 13. Auditoria de cobertura e ressalvas

**Critério da revisão:** conferência manual de todas as seções e subseções textuais visíveis na página pública consultada, confrontando a navegação, os caminhos REST, os 9 tipos de evento e o inventário de ferramentas MCP. Este controle não equivale a extrair código privado, consultar endpoints autenticados nem executar o MCP com uma chave real.


| Bloco | Itens documentados neste arquivo | Situação |
|---|---:|---|
| Instâncias | 8 endpoints | Rotas, métodos, campos e exemplos incluídos. |
| Mensagens | 11 endpoints | Rotas, métodos, campos e exemplos incluídos. |
| Chat e presença | 8 endpoints | Rotas, métodos, campos e exemplos incluídos. |
| Ligações | 6 endpoints | Rotas, métodos, campos e exemplos incluídos. |
| Webhooks | 2 endpoints | Rotas, métodos, campos e exemplos incluídos. |
| Grupos | 16 endpoints | Rotas, métodos, campos e exemplos incluídos. |
| Comunidades | 10 endpoints | Rotas, métodos, campos e exemplos incluídos. |
| Eventos | 9 eventos | Estruturas, tipos e notas de migração incluídos. |
| MCP | 61 nomes exibidos em 7 categorias | Reproduzidos em ordem temática. A página anuncia 60. |
| Compatibilidade Z-API / callbacks | 3 entradas de navegação | Sem contrato extraível nessa página; explicitamente sinalizado. |
| Quem pode adicionar (grupo) | 1 funcionalidade MCP/menu | Sem endpoint REST verificável no corpo consultado. |

### Pontos que exigem atenção na implementação

1. A documentação REST da enquete permite **2 a 12 opções**, ao passo que o resumo MCP indica **2 a 10**. Respeite o limite da interface escolhida.
2. O portal informa **60 tools**, mas relaciona **61 nomes** somando os blocos. Este arquivo preserva todos os 61.
3. **04/11/2026** é a data informada para descontinuar o formato antigo das edições em `messages.upsert`; migre para `messages.edited`.
4. Em `connection.update`, a transição fechada é indicada por `close`, embora o REST de estado utilize `closed`.
5. As rotas **Z-API/callbacks** e o caminho HTTP de **quem pode adicionar ao grupo** não puderam ser validados apenas com a página indicada. A existência de nomes no menu ou MCP não autoriza inventar uma URL.
6. Operações HTTP de grupo e consultas do MCP podem ter **pré-condições distintas**, como necessidade de histórico em determinadas ferramentas MCP.
7. Esse conteúdo reflete a **versão pública observada em 27/10/2026**. Endpoints podem mudar; para validação dinâmica consulte a fonte e os schemas de `tools/list`.

**Fontes:**

- Documentação pública: https://whatsmiau.dev/docs/getting-started
- Base REST: https://api.whatsmiau.dev/v2
- MCP: https://mcp.whatsmiau.dev
