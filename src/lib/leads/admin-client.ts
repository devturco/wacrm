import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The service-role client of the lead module.
 *
 * The public capture endpoint has no session — it authenticates with
 * the capture key — and the inbound webhook has no `auth.uid()`
 * either. Both write through the service role, exactly like
 * `src/lib/ai/admin-client.ts` and the two other admin clients of
 * this repo.
 */
let _adminClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}
