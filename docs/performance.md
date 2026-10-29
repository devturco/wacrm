# Índices: por que o banco não engasga

> Este documento explica como os índices do banco são escolhidos, o que
> estava faltando, e como verificar o estado real do schema com uma
> consulta — inclusive no banco de produção.

---

## A regra que decide tudo

O Postgres **não usa uma chave estrangeira como índice**. Ela é uma
restrição, não um caminho de leitura. Quando a linha pai é apagada, o
banco executa:

```sql
DELETE FROM filho WHERE fk = $1
UPDATE filho SET fk = NULL WHERE fk = $1   -- ON DELETE SET NULL
```

Sem um índice que tenha a coluna da FK **na frente**, isso é um
_sequential scan_ da tabela inteira. Apagar um contato vira uma
varredura de `lead_origins`; apagar uma conta, de `notifications`.

### O detalhe do índice parcial

Um índice parcial **não resolve** o caso — a menos que o predicado
seja exatamente o que a query implica:

| Índice parcial                         | O `DELETE ... WHERE fk = $1` usa?           |
| -------------------------------------- | ------------------------------------------- |
| `WHERE fk IS NOT NULL`                 | **Sim.** `fk = $1` implica `fk IS NOT NULL` |
| `WHERE fk IS NOT NULL AND outro = 'x'` | **Não.** O `outro` não é implicado          |
| `WHERE aceito = false`                 | **Não.** Nada da query implica isso         |

É por isso que `idx_lead_origins_primary_contact` (parcial, `WHERE
is_primary`) **não** servia o cascade: apagar um contato com histórico
de origem varria a tabela. A migration 068 cria o índice cheio que
falta.

---

## O que a migration 068 criou

Nenhuma tabela mudou de schema — só índices novos.

### 1. Chaves estrangeiras que estavam sem índice

Cada uma delas era um _sequential scan_ no momento em que a linha pai
era apagada:

```
contact_notes(contact_id)              contact_custom_values(custom_field_id)
notifications(account_id)               notifications(conversation_id)
notifications(contact_id)               automation_pending_executions(automation_id)
automation_pending_executions(log_id)   automation_pending_executions(contact_id)
automation_pending_executions(parent_step_id)   automation_logs(contact_id)
broadcast_recipients(contact_id)       deals(contact_id)
deals(conversation_id)                  flow_runs(contact_id)
flow_runs(conversation_id)              flow_runs(last_prompt_message_id)
account_invitations(account_id)         ai_usage_log(conversation_id)
lead_origins(contact_id)
```

As FKs que apontam para `auth.users` **ficaram de fora** de propósito:
apagar um usuário é raro, o custo do índice é permanente (cada escrita
mantém um índice a mais) e o preço não paga.

### 2. O caminho quente das features novas

| Índice                                    | Serve                                                   |
| ----------------------------------------- | ------------------------------------------------------- |
| `idx_lead_origins_contact`                | O cascade que apaga a origem junto com o contato        |
| `idx_lead_origins_pending_phone`          | A captura por telefone — roda a cada mensagem que entra |
| `idx_lead_settings_links_gin`             | Achar a conta pelo link de campanha (contenção JSONB)   |
| `idx_messages_conversation_media_created` | As abas **Mídia** e **Documentos**                      |

O detalhe do último: as abas leem `messages` filtrando por
`content_type`. Com o índice de sempre, `(conversation_id, created_at)`,
o planner percorre a conversa **inteira** tocando o heap de cada
linha até juntar as 60 que casam. O índice parcial só guarda as linhas
de mídia e documento — o filtro vem de graça.

### 3. Um índice que sobrou

`idx_lead_origins_account_token` e `idx_lead_origins_unique_token`
têm as mesmas colunas `(account_id, lead_token)`; o segundo é único e
parcial, e já serve toda busca por token. O primeiro é peso morto na
escrita — mas foi mantido de propósito: derrubar um índice em produção
exige uma janela, e a tabela é de escrita baixa.

---

## Como verificar

A auditoria é uma consulta. Ela roda em qualquer Postgres — inclusive
no **SQL Editor do Supabase**, contra a produção:

```sql
WITH fk AS (
  SELECT
    c.conrelid::regclass::text AS ct,
    (SELECT a.attname FROM pg_attribute a
      WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS cc,
    c.confrelid::regclass::text AS pt
  FROM pg_constraint c
  WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
),
lead AS (
  SELECT
    i.indrelid::regclass::text AS tn,
    (SELECT a.attname FROM pg_attribute a
      WHERE a.attrelid = i.indrelid AND a.attnum = i.indkey[0]) AS lc,
    (i.indpred IS NOT NULL) AS part,
    regexp_replace(pg_get_expr(i.indpred, i.indrelid), '["()\s]', '', 'g') AS pred
  FROM pg_index i
  WHERE i.indkey[0] <> 0
),
agg AS (
  SELECT f.ct, f.cc, f.pt,
    count(*) FILTER (WHERE l.part IS FALSE) AS full_idx,
    count(*) FILTER (WHERE l.part IS TRUE AND l.pred = f.cc || 'ISNOTNULL') AS implied
  FROM fk f
  LEFT JOIN lead l ON l.tn = f.ct AND l.lc = f.cc
  GROUP BY 1, 2, 3
)
SELECT ct || '.' || cc AS fk, pt,
  CASE WHEN full_idx > 0 THEN 'ok'
       WHEN implied  > 0 THEN 'ok (parcial implicado)'
       ELSE 'SEM INDICE' END AS status
FROM agg
WHERE pt <> 'auth.users' AND full_idx = 0 AND implied = 0
ORDER BY ct;
```

Ela devolve as chaves estrangeiras **sem** índice que a possa servir.
Zero linhas é o estado esperado depois da 068.

### O plano, não só o índice

Índice no catálogo não é índice em uso. Para ver o plano de uma query
real:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM messages
WHERE conversation_id = '...' AND content_type IN ('image','video','audio')
ORDER BY created_at DESC LIMIT 60;
```

Com a 068, o plano passa de `idx_messages_conversation_created` + filtro
para `idx_messages_conversation_media_created`.

---

## No CI

[`supabase/ci/verify-schema.sql`](../supabase/ci/verify-schema.sql)
confere a existência dos 22 índices da 068. Como todo índice é criado
com `IF NOT EXISTS`, um nome digitado errado passaria limpo — a
asserção existe justamente para pegar esse caso.

---

## Aplicar em produção

A migration 068 só cria índices. Ela não muda nenhuma tabela, não mexe
em dado e pode ser reaplicada sem risco:

```bash
# no SQL Editor do Supabase, ou via psql
\i supabase/migrations/068_performance_indexes.sql
```

> `CREATE INDEX` toma um lock de escrita na tabela enquanto corre. Numa
> tabela grande, rode a instrução sozinha com `CREATE INDEX CONCURRENTLY`
> — ela não pode ficar dentro de uma transação.
