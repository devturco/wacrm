// ============================================================
// The journey of ONE contact.
//
// GET /api/leads/origins?contactId=<uuid>
//
// Account-scoped twice over: the query carries `account_id`, and the
// table's RLS only lets a member read their own account's rows. A
// contact from another account has no journey here — the endpoint
// never reveals that the contact exists somewhere else.
//
// The `lead_origins` table has NO write policy: the service role
// writes it, the members read it.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getT } from '@/lib/i18n/translate';
import type { LeadOriginRow } from '@/lib/leads/types';

const t = getT('Api');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('viewer');

    const contactId =
      new URL(request.url).searchParams.get('contactId')?.trim() ?? '';
    if (!UUID_RE.test(contactId)) {
      return NextResponse.json(
        { error: t('common.invalidRequestBody') },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from('lead_origins')
      .select('*')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('touched_at', { ascending: true });

    if (error) {
      console.error('[leads/origins] query error:', error);
      return NextResponse.json(
        { error: t('common.internalServerError') },
        { status: 500 },
      );
    }

    const origins = (data ?? []) as LeadOriginRow[];
    return NextResponse.json({ origins });
  } catch (err) {
    return toErrorResponse(err);
  }
}
