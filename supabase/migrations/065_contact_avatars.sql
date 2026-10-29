-- ============================================================
-- CRMBR (WhatsMiau) — a foto do contato.
--
-- A API oficial (Meta) não expõe a foto de perfil de um contato: o
-- webhook do Meta entrega nome e número, e acabou. A CRMBR expõe
-- (`POST /chat/fetchProfilePictureUrl/:instance`), então a foto do
-- contato é possível — e a caixa de entrada passa a mostrar a imagem
-- em vez da inicial.
--
-- A URL que o provedor devolve vive no CDN do WhatsApp e EXPIRA. Por
-- isso os bytes são copiados para o bucket `chat-media` (público) e o
-- `contacts.avatar_url` passa a apontar para o NOSSO objeto — durável,
-- servido pelo mesmo bucket que já serve as mídias da conversa.
--
-- Esta tabela guarda o RESULTADO da consulta, para que a foto seja
-- buscada uma vez por contato — e não a cada mensagem de quem não tem
-- foto, que é a maioria. `status`:
--
--   pending  ainda não consultamos (ou a consulta falhou) — tentamos
--            de novo depois da janela;
--   found    a foto foi copiada e o `contacts.avatar_url` aponta para
--            ela;
--   missing  o contato não tem foto (ou escondeu pela privacidade) —
--            não perguntamos de novo antes da janela.
--
-- `checked_at` marca a última tentativa: a janela de 24h impede que
-- cada mensagem de um contato sem foto vire uma chamada ao provedor.
--
-- Por fim, `contacts` entra na publicação do Realtime: sem isso o
-- navegador nunca descobre que a foto chegou, e ela só apareceria no
-- próximo recarregamento da página.
--
-- TABELA NOVA — nenhuma tabela existente muda de schema.
-- Idempotente — pode ser reaplicada com segurança.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_avatars (
  contact_id UUID PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','found','missing')),
  -- Objeto no bucket `chat-media` (caminho com a pasta da conta).
  storage_path TEXT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_avatars_account
  ON contact_avatars (account_id);

ALTER TABLE contact_avatars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read contact avatars" ON contact_avatars;
CREATE POLICY "Members can read contact avatars"
  ON contact_avatars FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Admins can manage contact avatars" ON contact_avatars;
CREATE POLICY "Admins can manage contact avatars"
  ON contact_avatars FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- O Realtime precisa que a tabela esteja na publicação para entregar
-- a alteração. Sem isto, a foto só apareceria no próximo recarregamento.
-- A publicação só existe no Supabase — num Postgres puro o bloco
-- inteiro é ignorado.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'contacts'
    ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
  END IF;
END $$;
