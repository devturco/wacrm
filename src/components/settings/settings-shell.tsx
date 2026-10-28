'use client';

import { useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from './settings-rail';
import type { SettingsSection } from './settings-sections';

/**
 * The settings chrome — title, rail and the two-column grid.
 *
 * It lives here (instead of inside `settings/page.tsx`) because the
 * WhatsApp section owns a dedicated route: `/settings/whatsapp` and
 * its children (`/meta`, `/crmbr`) need the SAME rail and title, but
 * they are separate routes in the App Router, so the chrome has to be
 * a component both can render.
 */
export function SettingsShell({
  active,
  children,
  onSelect,
}: {
  active: SettingsSection;
  children: ReactNode;
  onSelect?: (section: SettingsSection) => void;
}) {
  const router = useRouter();
  const { defaultCurrency } = useAuth();
  const { mode } = useTheme();
  const t = useTranslations('Settings');

  // Cheap, fetch-free rail hints — the Overview landing carries the
  // full live status; the rail just surfaces what is already in
  // context.
  const hints = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency],
  );

  const go = onSelect ?? ((next: SettingsSection) => {
    if (next === 'whatsapp') {
      router.push('/settings/whatsapp');
      return;
    }
    router.push(`/settings?tab=${next}`);
  });

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('pageDesc')}</p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail active={active} onSelect={go} hints={hints} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
