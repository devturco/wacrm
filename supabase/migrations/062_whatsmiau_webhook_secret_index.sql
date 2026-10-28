-- The webhook secret is the routing key of the inbound webhook: it is
-- 32 random bytes generated once per account row, and it identifies
-- exactly one account. The unique index makes that invariant
-- enforceable — two rows sharing a secret would make the lookup
-- ambiguous and lock both accounts out.
--
-- Idempotent — safe to re-apply.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsmiau_config_webhook_secret
  ON whatsmiau_config (webhook_secret);
