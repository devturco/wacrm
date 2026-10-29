-- Post-migration assertions for the CI job in
-- `.github/workflows/migrations.yml`.
--
-- `supabase db reset` already fails on any statement Postgres rejects,
-- so this is not about syntax. It's about the quieter failure: a
-- migration that applies cleanly and does nothing. Every DDL statement
-- in this repo is guarded with IF NOT EXISTS / ON CONFLICT so the files
-- can be re-run safely, and that same guard turns a typo'd object name
-- into a silent no-op with a green checkmark.
--
-- Keep this thin. It is a smoke test for "did the migrations actually
-- build the schema", not a spec of it — asserting every column here
-- would just be the migrations restated in a second place, drifting.
DO $$
DECLARE
  missing_index TEXT;
BEGIN
  -- The core tables, from 001.
  IF to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'public.messages is missing — migrations did not apply';
  END IF;
  IF to_regclass('public.whatsapp_config') IS NULL THEN
    RAISE EXCEPTION 'public.whatsapp_config is missing — migrations did not apply';
  END IF;

  -- Supabase provides the storage schema; migrations 016/020/023 write
  -- to it. If it is absent the bucket migrations silently accomplish
  -- nothing, which is precisely the case a plain "no errors" run hides.
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION
      'storage.buckets is missing — the storage schema was not available when the bucket migrations ran';
  END IF;

  -- Buckets are UPSERTed, so their absence means the INSERT never ran.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chat-media') THEN
    RAISE EXCEPTION 'the chat-media bucket row was not created (migration 023)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'flow-media') THEN
    RAISE EXCEPTION 'the flow-media bucket row was not created (migration 016)';
  END IF;

  -- Account scoping (017) is load-bearing for every RLS policy.
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'public.accounts is missing — migration 017 did not apply';
  END IF;

  -- The BSUID index (040) is the only thing stopping a username-only
  -- WhatsApp sender from forking a new contact per inbound message. A
  -- typo in its name would apply cleanly and guarantee nothing.
  IF to_regclass('public.idx_contacts_account_wa_user_id') IS NULL THEN
    RAISE EXCEPTION
      'idx_contacts_account_wa_user_id is missing — migration 040 did not apply';
  END IF;

  -- 041 repairs create_broadcast_with_recipients, which 037/038 shipped
  -- with an ambiguous bare `RETURNING id, contact_id` (SQLSTATE 42702 on
  -- first call — plpgsql resolves names at execution, not CREATE, so a
  -- plain replay can't catch it). Assert the qualified form is what's
  -- actually installed.
  IF pg_get_functiondef(
       'public.create_broadcast_with_recipients(uuid,uuid,text,text,text,integer,uuid[],jsonb)'::regprocedure
     ) NOT LIKE '%RETURNING id, broadcast_recipients.contact_id%' THEN
    RAISE EXCEPTION
      'create_broadcast_with_recipients still has the ambiguous RETURNING — migration 041 did not apply';
  END IF;

  IF to_regprocedure(
       'public.create_broadcast_with_recipients(uuid,uuid,text,text,text,integer,uuid[],jsonb[])'
     ) IS NOT NULL THEN
    RAISE EXCEPTION
      'the JSONB[] overload of create_broadcast_with_recipients still exists — migration 049 did not apply';
  END IF;

  -- The failure-reason columns (042) are only ever written by the
  -- status webhook, which uses an untyped update — a missing column
  -- there is a runtime PostgREST error on every failed send, not a
  -- compile error.
  IF (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages'
      AND column_name IN ('error_code', 'error_title', 'error_details')
  ) <> 3 THEN
    RAISE EXCEPTION
      'messages.error_code/error_title/error_details are missing — migration 042 did not apply';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd IN ('SELECT', 'ALL')
      AND (roles && ARRAY['public', 'anon']::name[])
      AND (qual LIKE '%avatars%' OR qual LIKE '%flow-media%' OR qual LIKE '%chat-media%')
  ) THEN
    RAISE EXCEPTION
      'a storage SELECT policy on avatars/flow-media/chat-media still applies to anon — migration 043 did not apply';
  END IF;
  IF (
    SELECT COUNT(*) FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND policyname IN (
        'Users can read their own avatar',
        'Members can read flow media',
        'Members can read chat media'
      )
  ) <> 3 THEN
    RAISE EXCEPTION
      'the scoped storage SELECT policies are missing — migration 043 did not apply';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'public._bcast_bump(uuid,text,integer)',
      'public.recompute_broadcast_counts(uuid)',
      'public.claim_ai_reply_slot(uuid,integer)',
      'public.record_webhook_failure(uuid,integer)',
      'public.merge_duplicate_contacts()',
      'public.merge_duplicate_conversations()'
    ]::regprocedure[]) AS f(fn)
    WHERE has_function_privilege('anon', f.fn, 'EXECUTE')
       OR has_function_privilege('authenticated', f.fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f.fn, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION
      'an internal SECURITY DEFINER function is still executable by anon/authenticated — migration 044 did not apply';
  END IF;

  -- 045 widens the automation_pending_executions status CHECK. It is a
  -- DROP + ADD by name, so a wrong constraint name would leave the old
  -- CHECK in place and every "wait for reply" park would be rejected at
  -- runtime, not at migration time.
  IF pg_get_constraintdef(
       (SELECT oid FROM pg_constraint
        WHERE conname = 'automation_pending_executions_status_check')
     ) NOT LIKE '%awaiting_reply%' THEN
    RAISE EXCEPTION
      'automation_pending_executions_status_check does not allow awaiting_reply — migration 045 did not apply';
  END IF;
  IF to_regclass('public.idx_automation_pending_awaiting_reply') IS NULL THEN
    RAISE EXCEPTION
      'idx_automation_pending_awaiting_reply is missing — migration 045 did not apply';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_default LIKE '%uuid_generate_v%'
  ) THEN
    RAISE EXCEPTION
      'a public column default still calls uuid-ossp; use gen_random_uuid() so a fresh hosted db push does not hit 42883';
  END IF;

  IF to_regprocedure('public.dashboard_overview(integer,text)') IS NULL THEN
    RAISE EXCEPTION 'public.dashboard_overview(integer, text) is missing — migration 059 did not apply';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'messages_track_conversation_times') THEN
    RAISE EXCEPTION 'messages_track_conversation_times trigger is missing — migration 059 did not apply';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'conversations_stamp_closed_at')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'deals_stamp_closed_at') THEN
    RAISE EXCEPTION 'closed_at triggers are missing — migration 059 did not apply';
  END IF;
  IF has_function_privilege('anon', 'public.dashboard_overview(integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute dashboard_overview — migration 059 grants are wrong';
  END IF;

  -- 067 -- the lead origin tables. The campaign link looks a code up
  -- with a JSONB containment (`links @> '{"code":"..."}'`), so `links`
  -- has to be jsonb: with `json` the containment operator does not
  -- exist and every /r/<code> request fails at runtime.
  IF to_regclass('public.lead_settings') IS NULL THEN
    RAISE EXCEPTION 'public.lead_settings is missing — migration 067 did not apply';
  END IF;
  IF to_regclass('public.lead_origins') IS NULL THEN
    RAISE EXCEPTION 'public.lead_origins is missing — migration 067 did not apply';
  END IF;
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lead_settings'
      AND column_name = 'links'
  ) IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION
      'lead_settings.links is not jsonb — the campaign link lookup needs the JSONB containment';
  END IF;

  -- The capture endpoint finds the account by the capture key. Two
  -- accounts sharing one key would make the capture ambiguous.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.lead_settings'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%capture_key%'
  ) THEN
    RAISE EXCEPTION 'lead_settings.capture_key is not unique — migration 067 did not apply';
  END IF;

  -- The token is the bridge between the click and the first message.
  -- Without the UNIQUE index a collision would be a silent
  -- misattribution instead of a visible error.
  IF to_regclass('public.idx_lead_origins_unique_token') IS NULL THEN
    RAISE EXCEPTION 'idx_lead_origins_unique_token is missing — migration 067 did not apply';
  END IF;

  -- ONE origin primary per contact, guaranteed by the database.
  IF to_regclass('public.idx_lead_origins_primary_contact') IS NULL THEN
    RAISE EXCEPTION 'idx_lead_origins_primary_contact is missing — migration 067 did not apply';
  END IF;

  -- redeem_invitation was recreated with the two lead tables in the
  -- "does the old account still hold data" guard. A typo there would
  -- delete a client's lead history along with the account.
  IF pg_get_functiondef('public.redeem_invitation(text)'::regprocedure)
       NOT LIKE '%lead_settings%'
     OR pg_get_functiondef('public.redeem_invitation(text)'::regprocedure)
       NOT LIKE '%lead_origins%' THEN
    RAISE EXCEPTION
      'redeem_invitation does not guard the lead tables — migration 067 did not apply';
  END IF;

  -- 068 -- the performance indexes. A foreign key without an index
  -- is a sequential scan of the whole child table every time the
  -- parent row is deleted, and every one of these is created with
  -- IF NOT EXISTS -- so a typo'd name applies cleanly and does
  -- nothing. These are the ones the app leans on:
  --
  --   idx_lead_origins_contact         the contact cascade
  --   idx_lead_origins_pending_phone   the capture path (hot)
  --   idx_lead_settings_links_gin      the campaign link lookup
  --   idx_messages_conversation_media_created   the media tabs
  FOREACH missing_index IN ARRAY ARRAY[
    'idx_contact_notes_contact',
    'idx_contact_custom_values_field',
    'idx_notifications_account',
    'idx_notifications_conversation',
    'idx_notifications_contact',
    'idx_automation_pending_automation',
    'idx_automation_pending_log',
    'idx_automation_pending_contact',
    'idx_automation_pending_parent_step',
    'idx_automation_logs_contact',
    'idx_broadcast_recipients_contact',
    'idx_deals_contact',
    'idx_deals_conversation',
    'idx_flow_runs_contact',
    'idx_flow_runs_conversation',
    'idx_flow_runs_last_prompt',
    'idx_account_invitations_account',
    'idx_ai_usage_log_conversation',
    'idx_lead_origins_contact',
    'idx_lead_origins_pending_phone',
    'idx_lead_settings_links_gin',
    'idx_messages_conversation_media_created'
  ] LOOP
    IF to_regclass('public.' || missing_index) IS NULL THEN
      RAISE EXCEPTION '% is missing — migration 068 did not apply', missing_index;
    END IF;
  END LOOP;

  RAISE NOTICE 'schema verification passed';
END
$$;

-- Two things this file has already been burned by, both verified in CI
-- rather than assumed:
--
-- 1. It must contain EXACTLY ONE statement. `supabase db query --file`
--    sends the whole file as a prepared statement, and a second
--    top-level statement fails with the distinctly unhelpful "cannot
--    insert multiple commands into a prepared statement" (commit
--    f91a6c8). Add assertions INSIDE the DO block above; do not append
--    a second one.
--
-- 2. A RAISE in here really does fail the job. A deliberately false
--    assertion (commit 42c7db0, run 31579334056) surfaced as
--    `failed to execute query: error: ...` and exited 1. This is not a
--    decorative green tick.
