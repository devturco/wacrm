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

/** The units a duration can be rendered in, coarsest last. */
type DurationUnit = "second" | "minute" | "hour" | "day";

/**
 * Elapsed time — "2 minutos" in pt, "2 minutes" in en.
 *
 * `Intl.NumberFormat` in the "unit" style renders the number and its
 * unit together ("2 minutos"), which is what a duration needs: the
 * unit travels with the number instead of being glued on as a word.
 */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.round(Math.abs(milliseconds) / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);

  let value = seconds;
  let unit: DurationUnit = "second";
  if (seconds >= 60) {
    value = minutes;
    unit = "minute";
    if (minutes >= 60) {
      value = hours;
      unit = "hour";
      if (hours >= 24) {
        value = days;
        unit = "day";
      }
    }
  }

  return value.toLocaleString(APP_LOCALE, {
    style: "unit",
    unit,
    unitDisplay: "long",
  });
}
