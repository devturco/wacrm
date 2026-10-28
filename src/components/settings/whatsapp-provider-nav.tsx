'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/settings/whatsapp', key: 'hub' },
  { href: '/settings/whatsapp/meta', key: 'meta' },
  { href: '/settings/whatsapp/crmbr', key: 'crmbr' },
] as const;

/**
 * Sub-navigation inside the WhatsApp section: the hub, the official
 * API and the non-official one. A segmented control rather than a
 * second rail — the left rail already belongs to Settings.
 */
export function WhatsAppProviderNav() {
  const pathname = usePathname();
  const t = useTranslations('Settings.whatsappHub');

  return (
    <nav
      aria-label={t('navLabel')}
      className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
    >
      {ITEMS.map((item) => {
        const active =
          item.href === '/settings/whatsapp'
            ? pathname === item.href
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-primary-soft text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t(`nav.${item.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
