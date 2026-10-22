import { getRequestConfig } from 'next-intl/server';
import { APP_LOCALE } from '@/lib/i18n/locale';

export default getRequestConfig(async () => {
  // The locale is fixed at build time (NEXT_PUBLIC_APP_LOCALE) and
  // validated in one place — see src/lib/i18n/locale.ts. It also
  // decides how numbers and dates are formatted, so the messages and
  // the formatting can never disagree.
  const locale = APP_LOCALE;

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    // Fallback to English if the dictionary for the requested locale doesn't exist yet
    messages = (await import(`../../messages/en.json`)).default;
  }

  return {
    locale,
    messages
  };
});
