-- ============================================================
-- 068_performance_indexes.sql
--
-- Os indices que faltavam para o banco nao engasgar.
--
-- A auditoria cruzou TODA chave estrangeira do schema public com
-- os indices existentes e com as queries que o app realmente roda.
-- Duas familias de problema:
--
-- 1. CHAVE ESTRANGEIRA SEM INDICE
--    Quando o pai e apagado, o Postgres NAO usa a FK para achar as
--    linhas do filho: ele roda `DELETE FROM filho WHERE fk = $1`.
--    Sem um indice que tenha a coluna da FK NA FRENTE, isso e um
--    SEQUENTIAL SCAN da tabela inteira. Apagar um contato varre
--    `lead_origins`; apagar uma conta, `notifications`.
--
--    Um indice PARCIAL nao resolve o caso. O cascade consulta
--    `WHERE fk = $1`, e isso so implica `fk IS NOT NULL` -- nao
--    implica as outras condicoes do predicado. Por isso
--    `idx_lead_origins_primary_contact` (parcial, `WHERE is_primary`)
--    NAO serve o DELETE: faltava um indice cheio em `contact_id`.
--
-- 2. O CAMINHO QUENTE DAS FEATURES NOVAS
--    - as abas Midia/Documentos leem `messages` filtrando por
--      `content_type`; o indice atual traz a conversa INTEIRA e
--      filtra depois, tocando o heap de cada linha.
--    - a captura do lead amarra a origem pelo telefone; o indice
--      atual obriga o planner a escolher entre dois maus planos.
--    - o link de campanha acha a conta por contencao JSONB, sem
--      indice GIN.
--
-- As FKs que apontam para `auth.users` NAO entram aqui. Apagar um
-- usuario e raro, o custo do indice e permanente (cada escrita
-- mantem um indice a mais) e a tabela e pequena -- o preco nao
-- paga. As FKs de negocio, essas sim acontecem todo dia: apagar um
-- contato, fechar uma conta.
--
-- Nenhuma tabela existente muda de schema: so indices novos.
-- Idempotente -- pode ser reaplicada com seguranca.
-- ============================================================

-- ============================================================
-- 1. As chaves estrangeiras que nao tinham indice
-- ============================================================

-- Apagar um contato varria a tabela de notas.
CREATE INDEX IF NOT EXISTS idx_contact_notes_contact
  ON contact_notes (contact_id);

-- Apagar um campo personalizado varria os valores.
CREATE INDEX IF NOT EXISTS idx_contact_custom_values_field
  ON contact_custom_values (custom_field_id);

-- Notificacoes: a conta, a conversa e o contato.
CREATE INDEX IF NOT EXISTS idx_notifications_account
  ON notifications (account_id);
CREATE INDEX IF NOT EXISTS idx_notifications_conversation
  ON notifications (conversation_id);
CREATE INDEX IF NOT EXISTS idx_notifications_contact
  ON notifications (contact_id);

-- Execucoes pendentes: a automacao, o log, o contato e o passo.
CREATE INDEX IF NOT EXISTS idx_automation_pending_automation
  ON automation_pending_executions (automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_pending_log
  ON automation_pending_executions (log_id);
CREATE INDEX IF NOT EXISTS idx_automation_pending_contact
  ON automation_pending_executions (contact_id);
CREATE INDEX IF NOT EXISTS idx_automation_pending_parent_step
  ON automation_pending_executions (parent_step_id);

-- Logs de automacao: o contato.
CREATE INDEX IF NOT EXISTS idx_automation_logs_contact
  ON automation_logs (contact_id);

-- Destinatarios do broadcast: o contato.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_contact
  ON broadcast_recipients (contact_id);

-- Negocios: o contato e a conversa.
CREATE INDEX IF NOT EXISTS idx_deals_contact
  ON deals (contact_id);
CREATE INDEX IF NOT EXISTS idx_deals_conversation
  ON deals (conversation_id);

-- Execucoes de flow: o contato, a conversa e a mensagem que disparou.
CREATE INDEX IF NOT EXISTS idx_flow_runs_contact
  ON flow_runs (contact_id);
CREATE INDEX IF NOT EXISTS idx_flow_runs_conversation
  ON flow_runs (conversation_id);
CREATE INDEX IF NOT EXISTS idx_flow_runs_last_prompt
  ON flow_runs (last_prompt_message_id);

-- Convites: a conta. O indice que existe e parcial
-- (`WHERE accepted_at IS NULL`) e o DELETE por conta nao implica
-- essa condicao -- os convites aceitos ficavam fora do indice.
CREATE INDEX IF NOT EXISTS idx_account_invitations_account
  ON account_invitations (account_id);

-- Log de uso da IA: a conversa.
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_conversation
  ON ai_usage_log (conversation_id);

-- ============================================================
-- 2. A origem do lead (migration 067)
-- ============================================================

-- O CONTATO apaga a origem junto (ON DELETE CASCADE). O indice
-- parcial da origem principal nao serve esse DELETE, entao apagar
-- um contato com historico de origem varria a tabela inteira.
CREATE INDEX IF NOT EXISTS idx_lead_origins_contact
  ON lead_origins (contact_id);

-- A captura amarra a origem pelo telefone: e o caminho QUENTE, roda
-- a cada mensagem que entra. O indice por telefone que existe
-- ((account_id, phone)) obriga o planner a escolher entre ele e o
-- das pendentes -- e os dois planos sao ruins: um filtra depois de
-- varrer a conta, o outro varre a conversa das pendentes ate achar
-- o telefone.
--
-- Este indice tem a forma EXATA da query: a conta, o telefone, e o
-- `contact_id IS NULL` que a query ja exige. O `touched_at` fecha a
-- ordenacao, entao o `ORDER BY touched_at DESC LIMIT 1` sai sem
-- ordenar nada.
CREATE INDEX IF NOT EXISTS idx_lead_origins_pending_phone
  ON lead_origins (account_id, phone, touched_at)
  WHERE contact_id IS NULL;

-- O link de campanha acha a conta por CONTENCAO JSONB
-- (`links @> '{"code":"..."}'`). Sem GIN, cada capturada varre a
-- tabela de configuracao de todas as contas. A tabela tem uma linha
-- por conta e muda pouquissimo -- o indice e barato de manter e
-- deixa a captura em tempo constante.
CREATE INDEX IF NOT EXISTS idx_lead_settings_links_gin
  ON lead_settings USING GIN (links);

-- ============================================================
-- 3. As abas Midia / Documentos do painel do contato
-- ============================================================

-- As duas abas leem as MESMAS linhas de `messages`, filtrando por
-- `content_type` e paginando de 60 em 60.
--
-- O indice de hoje, `(conversation_id, created_at)`, serve a
-- ORDENACAO, mas o `content_type` vira filtro: o planner percorre a
-- conversa inteira, tocando o heap de cada linha, ate juntar as 60
-- que casam. Numa conversa com 5.000 mensagens e 3% de imagem, sao
-- ~3.000 leituras de heap para entregar 60 linhas.
--
-- Este indice so guarda as linhas de midia e documento -- e o
-- `content_type` ja vem filtrado de graca.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_media_created
  ON messages (conversation_id, created_at)
  WHERE content_type IN ('image','video','audio','document');
