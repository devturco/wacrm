import type { ReactNode } from 'react';

import { SettingsShell } from '@/components/settings/settings-shell';
import { WhatsAppProviderNav } from '@/components/settings/whatsapp-provider-nav';

/**
 * The WhatsApp section of Settings. The shell (title + rail) is the
 * same one the tabbed page uses, so the section reads as part of
 * Settings instead of a different app.
 */
export default function WhatsAppSettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <SettingsShell active="whatsapp">
      <div className="space-y-5">
        <WhatsAppProviderNav />
        {children}
      </div>
    </SettingsShell>
  );
}
