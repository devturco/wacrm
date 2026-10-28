-- ============================================================
-- CRMBR (WhatsMiau) — second WhatsApp API provider, one row per
-- account.
--
-- Deliberately a SEPARATE table from `whatsapp_config` (the Meta
-- row): `whatsapp_config` is read with .single()/.maybeSingle() per
-- account in ~30 places, so a second row there would break the whole
-- app — including the Meta path. This table is 1:1 with the account
-- and leaves `whatsapp_config` untouched.
--
-- The `instance_settings` JSONB stores WhatsMiau's own field names
-- verbatim (alwaysOnline, readMessages, rejectCall, msgCall,
-- groupsIgnore, saveMedia, webhook) so "apply to instance" is a
-- literal push of this JSON to PUT /instance/update/:name — no
-- translation table to keep in sync.
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsmiau_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instance_name     TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  base_url          TEXT NOT NULL DEFAULT 'https://api.whatsmiau.dev/v2',
  webhook_secret    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'disconnected'
                      CHECK (status IN ('disconnected','connecting','connected','error')),
  phone_number      TEXT,
  wuid              TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT false,
  instance_settings JSONB NOT NULL DEFAULT
    '{"alwaysOnline":false,"readMessages":false,"rejectCall":true,"msgCall":"","groupsIgnore":true,"saveMedia":true,"webhook":{"enabled":true,"url":"","headers":{},"events":["messages.upsert","messages.edited","messages.update","messages.delete","connection.update"],"base64":false}}'::jsonb,
  connected_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsmiau_config_instance
  ON whatsmiau_config (instance_name);

DROP TRIGGER IF EXISTS set_updated_at ON whatsmiau_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsmiau_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE whatsmiau_config ENABLE ROW LEVEL SECURITY;

-- Idempotent — DROP first so the migration can be re-applied.
DROP POLICY IF EXISTS whatsmiau_config_select ON whatsmiau_config;
CREATE POLICY whatsmiau_config_select ON whatsmiau_config
  FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS whatsmiau_config_insert ON whatsmiau_config;
CREATE POLICY whatsmiau_config_insert ON whatsmiau_config
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS whatsmiau_config_update ON whatsmiau_config;
CREATE POLICY whatsmiau_config_update ON whatsmiau_config
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS whatsmiau_config_delete ON whatsmiau_config;
CREATE POLICY whatsmiau_config_delete ON whatsmiau_config
  FOR DELETE USING (is_account_member(account_id, 'admin'));
