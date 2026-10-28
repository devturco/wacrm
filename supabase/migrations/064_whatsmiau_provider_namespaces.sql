-- ============================================================
-- CRMBR (WhatsMiau) — a instância passa a ter DOIS nomes.
--
-- A 060 (já aplicada) criou a tabela 1:1 com a conta, com a chave da
-- API (`api_key_encrypted`) e a URL base (`base_url`) guardadas por
-- linha. O modelo mudou:
--
--   - a credencial é da PLATAFORMA e vive no ambiente do servidor
--     (WHATSMIAU_API_KEY) — nunca no banco, nunca no navegador;
--   - a tabela é 1:N com a conta: a empresa pode ter várias conexões
--     ("Atendimento", "Atendimento 2");
--   - cada linha guarda o nome que o CLIENTE escolheu
--     (`instance_name`) e o nome que a instância carrega no provedor
--     (`provider_instance_name` = `<empresa>_<instancia>`).
--
-- Como a conta do provedor é compartilhada por todos os assinantes,
-- o prefixo é o que impede duas empresas que escolheram o mesmo nome
-- de colidirem — e uma colisão significaria uma empresa assumindo o
-- número de WhatsApp da outra.
--
-- MIGRAÇÃO DE DADOS: as linhas existentes mantêm o nome que já têm no
-- provedor. Renomear lá significaria órfãoizar o número de WhatsApp
-- já pareado, então o `provider_instance_name` recebe o
-- `instance_name` antigo (com um sufixo apenas em caso de colisão
-- entre duas linhas). As instâncias novas, criadas pelo app, já
-- nascem com o prefixo da empresa.
--
-- Idempotente — pode ser reaplicada com segurança.
-- ============================================================

-- 1. A coluna nova, primeiro como NULL: o backfill vem a seguir.
ALTER TABLE whatsmiau_config
  ADD COLUMN IF NOT EXISTS provider_instance_name TEXT;

-- 2. Backfill. O nome legado é o nome da instância no provedor, e é
--    válido por construção (a 060 exigia [A-Za-z0-9._-]+, ≤40).
--    O `row_number()` desempata as linhas que partilham o mesmo
--    nome — o sufixo `_2`, `_3`… cabe nos 40 caracteres.
WITH numbered AS (
  SELECT
    id,
    left(base, 40 - length(rn::text) - 1) || '_' || rn AS final_name
  FROM (
    SELECT
      id,
      instance_name AS base,
      row_number() OVER (
        PARTITION BY instance_name
        ORDER BY created_at, id
      ) AS rn
    FROM whatsmiau_config
  ) src
)
UPDATE whatsmiau_config w
SET provider_instance_name = n.final_name
FROM numbered n
WHERE w.id = n.id AND w.provider_instance_name IS NULL;

-- 3. Toda linha nova precisa do nome — a aplicação sempre o escreve.
ALTER TABLE whatsmiau_config
  ALTER COLUMN provider_instance_name SET NOT NULL;

-- 4. A credencial da plataforma não é mais por linha.
ALTER TABLE whatsmiau_config
  DROP COLUMN IF EXISTS api_key_encrypted;
ALTER TABLE whatsmiau_config
  DROP COLUMN IF EXISTS base_url;

-- 5. A tabela deixa de ser 1:1 com a conta.
ALTER TABLE whatsmiau_config
  DROP CONSTRAINT IF EXISTS whatsmiau_config_account_id_key;

-- 6. O nome do cliente é único DENTRO da conta…
ALTER TABLE whatsmiau_config
  DROP CONSTRAINT IF EXISTS whatsmiau_config_account_id_instance_name_key;
ALTER TABLE whatsmiau_config
  ADD CONSTRAINT whatsmiau_config_account_id_instance_name_key
  UNIQUE (account_id, instance_name);

-- 7. …e o nome no provedor é único no mundo inteiro.
ALTER TABLE whatsmiau_config
  DROP CONSTRAINT IF EXISTS whatsmiau_config_provider_instance_name_key;
ALTER TABLE whatsmiau_config
  ADD CONSTRAINT whatsmiau_config_provider_instance_name_key
  UNIQUE (provider_instance_name);

-- 8. No máximo uma instância por conta é a ATIVA — a que o app envia
--    pelas. O índice parcial torna isso um invariante do banco, e não
--    do código da aplicação.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsmiau_config_one_active
  ON whatsmiau_config (account_id) WHERE is_active;

-- 9. Índice de leitura por conta.
CREATE INDEX IF NOT EXISTS idx_whatsmiau_config_account
  ON whatsmiau_config (account_id);
