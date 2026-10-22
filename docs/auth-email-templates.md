# E-mails de autenticação: templates próprios + Resend

Dois emails saem do Supabase Auth neste app: a **confirmação de
e-mail** (cadastro) e a **recuperação de senha**. Os dois têm template
pronto em [`supabase/auth-templates/`](../supabase/auth-templates/), com
a marca do crmbr, em português, e com modo escuro.

Este documento é o passo a passo para plugá-los. O redirect em si está
em [auth-emails.md](./auth-emails.md) — leia os dois.

---

## Antes de começar: o Site URL

**Os templates não funcionam se o Site URL não for a origem real da sua
deploy.** O logo é buscado em `{{ .SiteURL }}/brand/logo-color.png` e,
no reset de senha, o link sai inteiro de lá. Com o Site URL no padrão
(`http://localhost:3000`), os emails chegam com imagem quebrada e link
apontando para o nada.

Configure **depois** de publicar no Railway, ou edite os dois
arquivos apontando para o domínio provisório:

Dashboard → **Authentication → URL Configuration** → Site URL →
`https://seu-dominio.up.railway.app`

E adicione o mesmo origin (com `/**`) em **Redirect URLs** — o motivo
está em [auth-emails.md](./auth-emails.md#what-supabase-needs).

---

## Passo 1 — Resend

1. Crie a conta em [resend.com](https://resend.com) e verifique o e-mail.
2. **Domains → Add Domain**, com o domínio que você usará como
   remetente (ex.: `seudominio.com.br`). A Resend publica os registros
   DNS — SPF e DKIM — para você copiar.
3. Adicione esses registros no seu provedor de DNS. É a etapa que leva
   alguns minutos para validar; o status na Resend muda para
   *Verified*.
4. Crie uma **API key** em [resend.com/api-keys](https://resend.com/api-keys).
   É a senha do SMTP. Guarde-a no `.env.local`, em `RESEND_API_KEY` —
   que o app **não lê**, serve só de registro para você não perder a
   chave (veja o passo 2).

Plano gratuito: **3.000 emails/mês e 100/dia**. Para um CRM com
convites e resets, sobra com folga.

> Um remetente em domínio próprio é o que separa "e-mail customizado"
> de "e-mail customizado de verdade": o SMTP do Supabase manda como
> `noreply@supabase.com`, e Gmail/Outlook mostram o remetente real
> (com SPF/DKIM) ou jogam em spam. Com a Resend, aparece
> `nao-responda@seudominio.com.br`.

---

## Passo 2 — SMTP no Supabase

Dashboard → **Authentication → Emails** → seção **SMTP Settings** →
*Enable Custom SMTP*:

| Campo | Valor |
|---|---|
| SMTP Host | `smtp.resend.com` |
| SMTP Port | `465` (TLS) — ou `587` se o provedor recusar `465` |
| Username | `resend` (fixo, não é o seu e-mail) |
| Password | a API key `re_...` do passo 1 |
| Sender Email | `nao-responda@seudominio.com.br` |

O campo **Sender Email** é obrigatório e precisa estar num domínio
verificado na Resend — o Supabase recusa a save se não estiver.

Salve e **envie um email de teste** pelo próprio dashboard antes de
sair para o resto — ele ainda sai com o template antigo.

Ao ativar o SMTP custom, os limites baixos do SMTP embutido caem. Ainda
vale olhar **Authentication → Rate Limits** se você espera convites em
lote.

---

## Passo 3 — Colar os templates

Dashboard → **Authentication → Emails → Templates**:

| Template do Supabase | Arquivo para colar |
|---|---|
| Confirm signup | [`confirm-signup.html`](../supabase/auth-templates/confirm-signup.html) |
| Reset password | [`reset-password.html`](../supabase/auth-templates/reset-password.html) |

Copie tudo entre `<html>` e `</html>`. Não mexa nas chaves `{{ ... }}` —
são substituídas pelo GoTrue na hora do envio.

Cada arquivo é autossuficiente de propósito: o dashboard não aceita
includes nem partials, então o cabeçalho (estilos, logo, botão) está
duplicado nos dois. Mudou a paleta, mudou nos dois.

Deixe *Confirm email* ligado em **Authentication → Emails** — é o que
dispara o primeiro email no cadastro.

---

## Passo 4 — Testar de verdade

Cadastre-se pelo `/signup` normal e **não** pelo link que você já tem no
histórico: o botão *Save* do dashboard só afeta emails enviados depois
dele.

Confira:

- [ ] O logo carrega (imagem quebrada = Site URL errado, veja o topo).
- [ ] O botão de confirmação aponta para `…supabase.co/auth/confirm?token=…`
      — se mostrar só `app.crmbr.com/auth/callback?next=…`, falta o token.
- [ ] Clicar no botão passa pelo GoTrue e cai no `/dashboard`.
- [ ] O email **Reset password**, pelo `/forgot-password`, abre a tela de
      nova senha.
- [ ] No Gmail, "Mostrar original": o remetente é o do seu domínio e o
      SPF/DKIM passa (`mailed-by`/`signed-by` sem `fail`).
- [ ] Num celular com tema escuro, o logo aparece branco, não invisível.

A Resend tem uma aba de **Logs** com cada envio e o erro, se houver.

---

## Por que os dois templates não são iguais

Parece inconsistente, mas cada um usa o que precisa:

**Reset password → `{{ .TokenHash }}` (link sem cookie).**
É o fluxo em que a pessoa recebe o email no celular e digita a senha
no notebook. Com o PKCE padrão do Supabase isso **falha**: o código de
verificação mora num cookie do navegador que pediu o link, e o outro
navegador não tem. Aqui o link é autossuficiente e funciona em
qualquer dispositivo. O `/auth/callback` do app aceita essa forma.

**Confirm signup → `{{ .ConfirmationURL }}` (link do GoTrue).**
Esse é o link que carrega o token e, depois de validar, salta para o
destino que o app pediu no `emailRedirectTo`
([`signup/page.tsx`](../src/app/(auth)/signup/page.tsx#L77-L79)):
`/dashboard` no caso normal, mas `/join/<token>` quando a pessoa está
entrando por um convite.

Não use `{{ .RedirectTo }}` aqui. Ele é **só o destino**, sem token
anexado — o link sairia como `https://app.crmbr.com/auth/callback?next=%2Fdashboard`,
sem `code` e sem `token_hash`. O `/auth/callback` receberia um link sem
credencial nenhuma, o `parseEmailLink` devolveria `null` e o usuário
cairia no `/login` com *"não foi possível entrar com esse link"* — que
é o sintoma descrito na tabela do final deste documento.

Se você não usa convites e quer o link livre de navegador também no
cadastro, troque o `href` do botão por:

```html
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=email&amp;next=/dashboard
```

O custo é perder o `next` dinâmico — todo convidado cairia no
dashboard em vez de ser adicionado à conta compartilhada.

---

## Ajustes finos

**Validade do link.** O texto diz "válido por 1 hora", que é o padrão
do Supabase. Se mudar em **Authentication → Authentication → Settings →
Email → Email OTP expiry**, ajuste a frase do
`reset-password.html` junto.

**Nome no email.** `{{ .Data.full_name }}` é o que o app manda no
`options.data.full_name` no cadastro. Queda para "Olá!" quando vazio.
Um nome cadastrado com HTML aparece cru no email — só afeta quem se
cadastrou, então não é um vetor útil contra terceiros.

**Nome e logo.** A marca vem de `public/brand/`, servida pelo próprio
app. Trocar os arquivos lá troca o logo dos dois emails no próximo
envio. O `.brand-logo` do `globals.css` (que faz a troca por
`data-mode`) não tem efeito aqui — o template replica a lógica com
`<img>` + `prefers-color-scheme`, porque cliente de email não roda
JavaScript.

**Outros templates.** *Magic link*, *Change email* e *Invite* seguem no
padrão do Supabase. O app não usa magic link nem change email; o
*Invite* é gerado pelo app, não pelo Supabase
([`/api/account/invitations`](../src/app/api/account/invitations)) —
então não precisa de template. Se um dia precisar, é só copiar a
estrutura de um dos dois arquivos.

---

## Problemas → causas

| Sintoma | Causa |
|---|---|
| Logo quebrado no email | Site URL ainda é `localhost` — ajuste o template ou publique antes |
| Email não chega | remetente em domínio não verificado na Resend; ou SPF/DKIM ainda pendente; ou o Supabase nem salvou o SMTP (e-mail de erro ao salvar) |
| Link dá 404 | domínio do app não está em **Redirect URLs** com `/**` |
| `/login` diz que o link expirou | link de uso único e com prazo; peça outro |
| `/login` diz que o link não pôde ser usado | email de confirmação aberto em outro navegador (PKCE) — é o comportamento esperado, ver acima |
| `/login` diz que o link não pôde ser usado **logo após criar a conta, no mesmo navegador** | o botão do template aponta para `{{ .RedirectTo }}` em vez de `{{ .ConfirmationURL }}` — chega em `/auth/callback` sem `code` nem `token_hash`. confira no preview: o link tem de conter `/auth/confirm?token=` |