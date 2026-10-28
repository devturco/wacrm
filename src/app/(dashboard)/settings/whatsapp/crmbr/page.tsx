import { WhatsmiauConfig } from '@/components/settings/whatsmiau-config';

/**
 * The CRMBR (non-official WhatsApp API) settings screen. The route
 * name is the public one — `crmbr` — while everything under the hood
 * (code, tables, routes) speaks `whatsmiau`.
 */
export default function WhatsmiauSettingsPage() {
  return <WhatsmiauConfig />;
}
