-- ============================================================
-- 066_media_settings_and_bucket.sql
--
-- Configuracao de storage por conta + a politica que faz o bucket
-- `chat-media` aceitar QUALQUER formato.
--
-- A lista de MIME do bucket era fechada (migration 023, alargada na
-- 039): o Storage RECUSA o upload de tudo que nao estivesse nela. E o
-- fallback do espelho (`application/octet-stream`) tambem nao estava
-- em nenhuma das duas listas -- entao todo anexo de tipo
-- desconhecido era descartado em silencio pelo espelho, a row
-- continuava apontando para a URL do provedor, que EXPIRA. E a causa
-- da reclamacao "as midias se perdem".
--
-- A lista nova e "tipos que podem ser servidos inline + o catch-all
-- application/octet-stream". O app normaliza o `Content-Type` antes
-- de subir (src/lib/media/content-type.ts), entao:
--
--   - nada e jamais rejeitado (o catch-all sempre passa);
--   - nenhum conteudo ativo (text/html, image/svg+xml) e servido
--     inline, porque o app declara `application/octet-stream` para
--     qualquer tipo fora da lista segura.
--
-- O teto sobe de 16 MB para 100 MB -- o mesmo limite que o WhatsApp
-- aplica a documentos.
--
-- `media_settings` guarda a escolha de backend por conta (Supabase ou
-- R2), o bucket, o limite de tamanho e a URL publica base. As
-- credenciais da R2 NAO ficam aqui: sao env, server-only.
--
-- TABELA NOVA -- nenhuma tabela existente muda de schema.
-- Idempotente -- pode ser reaplicada com seguranca.
-- ============================================================

-- ============================================================
-- 1. media_settings
-- ============================================================

CREATE TABLE IF NOT EXISTS media_settings (
  account_id      UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- 'supabase' (bucket do proprio projeto) ou 'r2' (Cloudflare).
  backend         TEXT NOT NULL DEFAULT 'supabase'
                    CHECK (backend IN ('supabase','r2')),
  bucket          TEXT NOT NULL DEFAULT 'chat-media',
  -- Teto por conta. O teto efetivo e o menor entre este valor, o
  -- limite por tipo e o teto do bucket (100 MB).
  max_file_bytes  BIGINT NOT NULL DEFAULT 104857600,
  -- URL publica base do backend (ex.: https://media.crmbr.com).
  -- Vazio = usar a URL do proprio bucket.
  public_base_url TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE media_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read media settings" ON media_settings;
CREATE POLICY "Members can read media settings"
  ON media_settings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Admins can manage media settings" ON media_settings;
CREATE POLICY "Admins can manage media settings"
  ON media_settings FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ============================================================
-- 2. chat-media: 100 MB + lista segura com o catch-all
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  TRUE,
  104857600, -- 100 MB (limite de documento do WhatsApp)
  ARRAY[
    -- Imagem
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
    -- Video
    'video/mp4', 'video/3gpp', 'video/quicktime',
    -- Audio
    'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr',
    -- Documento
    'application/pdf', 'text/plain',
    -- Office legado
    'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
    -- Office OOXML
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    -- OpenDocument (LibreOffice) -- comum no Brasil
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'application/vnd.oasis.opendocument.graphics',
    -- Catch-all: qualquer formato entra por aqui e o browser BAIXA
    -- o arquivo em vez de renderizar.
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 3. redeem_invitation -- guarda a `media_settings`
--
-- A funcao apaga a conta antiga quando o usuario resgata um convite.
-- `media_settings` e config escopada por conta: sem esta checagem a
-- linha seria removida em cascata junto com a conta, e a conta nova
-- perderia o backend de storage escolhido.
--
-- Recriada a partir da migration 061 (a ultima versao) com a linha
-- do guard.
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
