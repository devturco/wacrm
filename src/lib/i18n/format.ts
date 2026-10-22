/**
 * Date and number formatting, pinned to the app's locale.
 *
 * Every `toLocaleDateString()` / `toLocaleString()` in the app goes
 * through here. The reason is in `locale.ts`: with no explicit locale
 * those follow the *runtime* — the server's on the first render, the
 * visitor's browser after hydration — so the same value appeared as
 * "1,234" in the server-rendered HTML and "1.234" once hydrated, and
 * the format changed with the visitor's machine instead of with the
 * app's language.
 *
 * The timezone is a separate question and deliberately not touched
 * here: a date is rendered in the *viewer's* timezone, wherever they
 * are, while the format of that date follows the app's locale.
 */
import { APP_LOCALE } from "@/lib/i18n/locale";

export type DateInput = string | number | Date;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Date only — "22 out. 2026" in pt, "Oct 22, 2026" in en. */
export function formatDate(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
): string {
  return toDate(value).toLocaleDateString(APP_LOCALE, options);
}

/** Date and time — "22/10/2026, 14:32". */
export function formatDateTime(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
): string {
  return toDate(value).toLocaleString(APP_LOCALE, options);
}

/** Grouped number — "1.234" in pt, "1,234" in en. */
export function formatNumber(value: number): string {
  return value.toLocaleString(APP_LOCALE);
}
