'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { TemplateManager } from '@/components/settings/template-manager';
import { QuickRepliesManager } from '@/components/settings/quick-replies-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { InboxSettings } from '@/components/settings/inbox-settings';
import { MediaSettings } from '@/components/settings/media-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { SettingsShell } from '@/components/settings/settings-shell';
import {
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';

/**
 * The settings panels. The `tab` arrives as a prop from the server
 * page (which redirects `?tab=whatsapp` to `/settings/whatsapp`), so
 * this component never touches `useSearchParams` — no Suspense
 * boundary, no CSR bailout.
 */
export function SettingsPageClient({ tab }: { tab: string | null }) {
  const router = useRouter();

  const section = resolveSection(tab);

  const go = (next: SettingsSection) => {
    if (next === 'whatsapp') {
      router.push('/settings/whatsapp');
      return;
    }
    router.push(`/settings?tab=${next}`);
  };

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: <WhatsAppConfig />,
    templates: <TemplateManager />,
    'quick-replies': <QuickRepliesManager />,
    fields: <FieldsAndTagsPanel />,
    inbox: <InboxSettings />,
    deals: <DealsSettings />,
    media: <MediaSettings />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
  };

  return (
    <SettingsShell active={section} onSelect={go}>
      {panel[section]}
    </SettingsShell>
  );
}
