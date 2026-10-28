// ============================================================
// The account's WhatsMiau instances.
//
// GET lists every instance the api key can see. POST creates one and
// wires our webhook to it.
//
// The api key is the ACCOUNT's — two companies never share it, so one
// company can never reach another's instance.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { whatsmiauConnectionFromConfig } from '@/lib/whatsapp/providers/connection';
import {
  createInstance,
  listInstances,
  setWebhook,
  validateInstanceName,
} from '@/lib/whatsapp/providers/whatsmiau/instances';
import {
  buildWebhookConfig,
  providerErrorResponse,
  webhookUrlFor,
} from '@/lib/whatsapp/providers/whatsmiau/management';
import {
  loadWhatsmiauConfig,
  upsertWhatsmiauConfig,
} from '@/lib/whatsapp/whatsmiau-config';

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const row = await loadWhatsmiauConfig(supabase, accountId);
    if (!row) {
      return NextResponse.json(
        { error: 'The CRMBR (non-official) API is not configured yet.', instances: [] },
        { status: 400 },
      );
    }
    const instances = await listInstances(whatsmiauConnectionFromConfig(row));
    return NextResponse.json({ instances }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    console.error('[whatsmiau/instances] could not list the instances:', error);
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = await request.json();
    const instanceName =
      typeof body?.instance_name === 'string' ? body.instance_name.trim() : '';

    const nameCheck = validateInstanceName(instanceName);
    if (!nameCheck.ok) {
      return NextResponse.json(
        { error: nameCheck.error, field: 'instance_name' },
        { status: 400 },
      );
    }

    const row = await loadWhatsmiauConfig(supabase, accountId);
    if (!row) {
      return NextResponse.json(
        { error: 'Save the API key and the instance name first.', code: 'whatsapp_not_configured' },
        { status: 400 },
      );
    }

    const conn = whatsmiauConnectionFromConfig(row);
    const webhookUrl = webhookUrlFor(request);

    // TWO webhook configs on purpose:
    //   - `storedSettings` is what we keep in the database. It holds the
    //     url and the user's own headers, NEVER the locked
    //     `Authorization` header — the browser reads this row back, and
    //     the webhook secret must not travel there.
    //   - `webhook` is what we push to the provider, with the secret in
    //     the locked header.
    const storedSettings = {
      ...row.instance_settings,
      webhook: { ...row.instance_settings.webhook, url: webhookUrl },
    };
    const webhook = buildWebhookConfig(
      { ...row, instance_settings: storedSettings },
      webhookUrl,
    );

    // `syncFullHistory` is a creation-only flag — the provider refuses
    // to change it later, so it only rides along with the create call.
    await createInstance(conn, {
      instanceName,
      settings: { ...storedSettings, webhook },
      ...(body?.sync_full_history ? { syncFullHistory: true } : {}),
    });
    await setWebhook(conn, instanceName, webhook);

    await upsertWhatsmiauConfig(supabase, accountId, {
      instance_name: instanceName,
      instance_settings: storedSettings,
      status: 'connecting',
      connected_at: null,
    });

    return NextResponse.json({ success: true, instance_name: instanceName }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.name === 'WhatsmiauApiError') {
      return providerErrorResponse(error);
    }
    console.error('[whatsmiau/instances] could not create the instance:', error);
    return toErrorResponse(error);
  }
}
