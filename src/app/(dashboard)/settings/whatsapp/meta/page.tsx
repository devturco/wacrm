import { WhatsAppConfig } from '@/components/settings/whatsapp-config';

/**
 * The official API screen. The component itself is untouched — the
 * upstream maintainer owns it and this route only gives it a home
 * inside the new section.
 */
export default function WhatsAppMetaSettingsPage() {
  return <WhatsAppConfig />;
}
