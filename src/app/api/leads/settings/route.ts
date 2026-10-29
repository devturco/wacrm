// ============================================================
// The account's lead-origin configuration.
//
// GET is readable by any member: the capture key is PUBLIC by
// design — it sits in the `<script data-key="...">` tag the customer
// pastes into their own website. It identifies the account; it does
// NOT authenticate against it.
//
// PUT is admin-only: it decides where every click of every account
// lands.
//
// The route NEVER returns a credential. The capture key is not one.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getT } from '@/lib/i18n/translate';
import { createLeadSettingsStore } from '@/lib/leads/store';
import { generateCaptureKey, generateLeadToken } from '@/lib/leads/token';
import type { CampaignLink, LeadSettings } from '@/lib/leads/types';

const t = getT('Api');

/** What the browser is allowed to see. */
export interface LeadSettingsResponse {
  /** Is the account configured yet? */
  configured: boolean;
  capture_key: string | null;
  enabled: boolean;
  allowed_hosts: string[];
  links: CampaignLink[];
}

function toResponse(settings: LeadSettings | null): LeadSettingsResponse {
  if (!settings) {
    return {
      configured: false,
      capture_key: null,
      enabled: false,
      allowed_hosts: [],
      links: [],
    };
  }
  return {
    configured: true,
    capture_key: settings.capture_key,
    enabled: settings.enabled,
    allowed_hosts: settings.allowed_hosts,
    links: settings.links,
  };
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');

    const store = createLeadSettingsStore(supabase);
    const settings = await store.read(accountId);

    return NextResponse.json(toResponse(settings));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const body = (await request.json().catch(() => null)) as {
      enabled?: unknown;
      allowed_hosts?: unknown;
      links?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json(
        { error: t('common.invalidRequestBody') },
        { status: 400 },
      );
    }

    const enabled = body.enabled === true;

    const allowedHosts = normalizeHosts(body.allowed_hosts);
    if (!allowedHosts) {
      return NextResponse.json(
        { error: t('common.invalidRequestBody') },
        { status: 400 },
      );
    }

    const links = normalizeLinks(body.links);
    if (!links) {
      return NextResponse.json(
        { error: t('common.invalidRequestBody') },
        { status: 400 },
      );
    }

    const store = createLeadSettingsStore(supabase);
    const existing = await store.read(accountId);
    const captureKey = existing?.capture_key ?? generateCaptureKey();

    // The store's `update` is an upsert: on the first save it creates
    // the row, and the capture key travels with it.
    const updated = await store.update(accountId, {
      capture_key: captureKey,
      enabled,
      allowed_hosts: allowedHosts,
      links,
    });

    return NextResponse.json(toResponse(updated));
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * The allowlist of hosts, lowercased and without protocol or path.
 *
 * Empty = any host may call the public endpoint.
 *
 * @returns the hosts, or null when the payload is not a list of
 * strings.
 */
function normalizeHosts(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  const hosts: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const host = normalizeHost(item);
    if (!host) continue;
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/**
 * `https://Site.com.br/oferta` → `site.com.br`.
 *
 * The browser sends the full URL in the `Origin` header, so the
 * allowlist has to compare the bare host.
 */
function normalizeHost(value: string): string | null {
  let host = value.trim().toLowerCase();
  if (!host) return null;
  host = host.replace(/^https?:\/\//, '');
  host = host.split('/')[0];
  host = host.split(':')[0];
  if (!host) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  return host;
}

/**
 * The campaign links.
 *
 * `wa:<number>` and `url:<https://...>` are the only two
 * destinations — the redirect route refuses anything else, and the
 * validation here refuses it before it is ever stored.
 *
 * @returns the links, or null when the payload is not a valid list.
 */
function normalizeLinks(value: unknown): CampaignLink[] | null {
  if (!Array.isArray(value)) return null;

  const links: CampaignLink[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const row = item as Record<string, unknown>;

    const destination = normalizeDestination(row.destination);
    if (!destination) return null;

    const label =
      typeof row.label === 'string' ? row.label.trim().slice(0, 120) : '';
    const message =
      typeof row.message === 'string' ? row.message.trim().slice(0, 500) : '';

    const code = normalizeLinkCode(row.code, seen);
    if (!code) return null;
    seen.add(code);

    links.push({
      code,
      label,
      destination,
      message,
      created_at:
        typeof row.created_at === 'string' && row.created_at
          ? row.created_at
          : new Date().toISOString(),
    });
  }

  return links;
}

/**
 * The code of a link. A new link has none, so one is generated — and
 * regenerated if it collides with a code already in this list.
 */
function normalizeLinkCode(
  value: unknown,
  seen: ReadonlySet<string>,
): string | null {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw) {
    if (!/^[a-z0-9]{4,32}$/.test(raw)) return null;
    return seen.has(raw) ? null : raw;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateLeadToken().toLowerCase();
    if (!seen.has(candidate)) return candidate;
  }
  return null;
}

/**
 * `wa:5511999999999` or `url:https://site.com/oferta`.
 *
 * Anything else — `javascript:`, `data:`, a bare phone number — is
 * refused. The redirect route has the same rule; this is the first
 * of the two.
 */
function normalizeDestination(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  if (raw.startsWith('wa:')) {
    const number = raw.slice(3).replace(/[^0-9]/g, '');
    if (!/^[1-9]\d{6,14}$/.test(number)) return null;
    return `wa:${number}`;
  }

  if (raw.startsWith('url:')) {
    const url = raw.slice(4).trim();
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return null;
      }
      return `url:${url}`;
    } catch {
      return null;
    }
  }

  return null;
}
