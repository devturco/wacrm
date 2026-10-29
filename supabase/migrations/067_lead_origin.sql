-- ============================================================
-- 067_lead_origin.sql
--
-- "Origem do lead": onde cada lead veio (anuncio, post, DM, site).
--
-- Duas tabelas novas:
--
--   lead_settings  -- 1 linha por conta: a capture key, o interruptor,
--                     a allowlist de hosts e os links de campanha.
--                     E CONFIGURACAO da conta, nao dado de negocio.
--
--   lead_origins   -- um TOQUE por linha: o que o lead viu no primeiro
--                     clique (utm_*, click ids, ad/campaign/post).
--                     `contact_id` NULL = origem PENDENTE (o lead ainda
--                     nao falou com a gente). O contato nasce no
--                     inbound, nunca pelo endpoint publico.
--
-- Por que `links` e JSONB e nao uma terceira tabela: um link de
-- campanha e configuracao da conta (poucos, mudam pouco, ninguem
-- consulta "links de outra conta"). O que E dado de negocio -- os
-- toques -- fica em `lead_origins`, com `link_code` em coluna propria
-- para a contagem por link.
--
-- O indice UNICO PARCIAL em `contact_id` garante UMA origem principal
-- por contato no proprio banco, nao por convencao de codigo.
--
-- TABELA NOVA -- nenhuma tabela existente muda de schema.
-- Idempotente -- pode ser reaplicada com seguranca.
-- ============================================================

-- ============================================================
-- 1. lead_settings
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_settings (
  account_id     UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- Identificador PUBLICO (como um measurement id do GA): vai
  -- embutido no <script data-key="..."> do site do cliente. NAO e
  -- credencial -- ele so diz a qual conta a origem pertence.
  capture_key    TEXT NOT NULL UNIQUE,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  -- Allowlist de host do endpoint publico. Vazio = aceita qualquer
  -- origem.
  allowed_hosts  TEXT[] NOT NULL DEFAULT '{}',
  -- Links de campanha (JSONB). Ver o comentario do topo.
  links          JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lead_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read lead settings" ON lead_settings;
CREATE POLICY "Members can read lead settings"
  ON lead_settings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Admins can manage lead settings" ON lead_settings;
CREATE POLICY "Admins can manage lead settings"
  ON lead_settings FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ============================================================
-- 2. lead_origins
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_origins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- NULL = PENDENTE: a origem foi capturada mas o contato ainda nao
  -- nasceu. O primeiro inbound do lead a amarra.
  contact_id    UUID REFERENCES contacts(id) ON DELETE CASCADE,

  -- canal pelo qual o toque aconteceu
  channel       TEXT NOT NULL CHECK (channel IN (
                  'whatsapp','instagram_dm','instagram_comment',
                  'tiktok_dm','tiktok_lead','web','direct')),
  provider      TEXT CHECK (provider IN ('meta', 'whatsmiau', 'tiktok', 'web')),

  -- eixo web
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  utm_content   TEXT,
  utm_term      TEXT,
  landing_path  TEXT,
  referrer      TEXT,
  click_ids     JSONB NOT NULL DEFAULT '{}',

  -- eixo social / anuncios
  ad_id         TEXT,
  adset_id      TEXT,
  campaign_id   TEXT,
  creative_id   TEXT,
  post_id       TEXT,
  external_id   TEXT,

  -- amarração
  lead_token    TEXT,
  link_code     TEXT,
  phone         TEXT,

  is_primary    BOOLEAN NOT NULL DEFAULT false,
  touched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE lead_origins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read lead origins" ON lead_origins;
CREATE POLICY "Members can read lead origins"
  ON lead_origins FOR SELECT
  USING (is_account_member(account_id));
-- Nenhuma policy de escrita: `lead_origins` e escrita SO pelo
-- service role (os endpoints). Um `viewer` da conta le, ninguem da
-- conta escreve por RLS.

-- ============================================================
-- 3. Indices
-- ============================================================

-- A jornada do contato.
CREATE INDEX IF NOT EXISTS idx_lead_origins_account_contact
  ON lead_origins (account_id, contact_id);

-- Amarracao por telefone (o caminho limpo: form do site).
CREATE INDEX IF NOT EXISTS idx_lead_origins_account_phone
  ON lead_origins (account_id, phone);

-- Amarracao pelo codigo de 8 chars.
CREATE INDEX IF NOT EXISTS idx_lead_origins_account_token
  ON lead_origins (account_id, lead_token);

-- UMA origem principal por contato, garantido no banco.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_origins_primary_contact
  ON lead_origins (contact_id)
  WHERE is_primary AND contact_id IS NOT NULL;

-- As contagens que a "Inteligencia de Conteudo" vai ler.
CREATE INDEX IF NOT EXISTS idx_lead_origins_account_campaign
  ON lead_origins (account_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_lead_origins_account_post
  ON lead_origins (account_id, post_id);

-- As origens pendentes (lead que ainda nao falou com a gente).
CREATE INDEX IF NOT EXISTS idx_lead_origins_pending
  ON lead_origins (account_id, touched_at)
  WHERE contact_id IS NULL;

-- O payload cru (texto original, referral inteiro).
CREATE INDEX IF NOT EXISTS idx_lead_origins_meta_gin
  ON lead_origins USING GIN (meta);

-- ============================================================
-- 4. redeem_invitation -- guarda a origem do lead
--
-- A funcao apaga a conta antiga quando o usuario resgata um convite.
-- `lead_settings` e configuracao da conta e `lead_origins` sao dado
-- de negocio: sem esta checagem as linhas seriam removidas em
-- cascata junto com a conta, e a origem do lead seria perdida.
--
-- Recriada a partir da migration 066 (a ultima versao) com as duas
-- linhas do guard.
-- ============================================================

CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;

  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsmiau_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM media_settings WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM lead_settings WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM lead_origins WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
