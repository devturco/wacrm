import { redirect } from 'next/navigation';

import { SettingsPageClient } from '@/components/settings/settings-page-client';

/**
 * The settings page is a server component so the WhatsApp tab can
 * redirect SERVER-side: `?tab=whatsapp` now owns a dedicated route
 * (`/settings/whatsapp`), and every old link to `?tab=whatsapp` still
 * lands in the right place — with a real redirect instead of a
 * client-side flash of the Meta panel.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = params.tab;
  const tab = Array.isArray(raw) ? raw[0] : raw;

  if (tab === 'whatsapp') redirect('/settings/whatsapp');

  return <SettingsPageClient tab={tab ?? null} />;
}
