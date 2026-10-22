/**
 * Currency — single source of truth for deal-value formatting and
 * the currency picker options.
 *
 * Before this module, ~6 components each defined their own
 * `Intl.NumberFormat(..., { currency: "USD" })` helper with USD
 * baked in. The default currency is now configurable per account
 * (accounts.default_currency, migration 021), so every formatter
 * takes a currency and falls back to DEFAULT_CURRENCY only when
 * nothing is known.
 */

import { getT } from "@/lib/i18n/translate";
import { APP_LOCALE } from "@/lib/i18n/locale";

/** App-wide fallback when no account/deal currency is available. */
export const DEFAULT_CURRENCY = "USD";

export interface CurrencyOption {
  /** ISO-4217 code, e.g. "USD". Stored verbatim in the DB. */
  code: string;
  /** Human label for the dropdown, e.g. "US Dollar". */
  label: string;
  /** Symbol for compact display, e.g. "$". */
  symbol: string;
}

const t = getT("Currency");

/**
 * The currencies offered in pickers. Codes must be valid ISO-4217 so
 * `Intl.NumberFormat` renders the right symbol/grouping. Extend this
 * list to offer more — nothing else needs to change.
 */
export const CURRENCIES: CurrencyOption[] = [
  { code: "USD", label: t("USD"), symbol: "$" },
  { code: "EUR", label: t("EUR"), symbol: "€" },
  { code: "GBP", label: t("GBP"), symbol: "£" },
  { code: "INR", label: t("INR"), symbol: "₹" },
  { code: "AUD", label: t("AUD"), symbol: "A$" },
  { code: "CAD", label: t("CAD"), symbol: "C$" },
  { code: "BRL", label: t("BRL"), symbol: "R$" },
  { code: "JPY", label: t("JPY"), symbol: "¥" },
  { code: "CNY", label: t("CNY"), symbol: "¥" },
  { code: "AED", label: t("AED"), symbol: "د.إ" },
  { code: "ZAR", label: t("ZAR"), symbol: "R" },
  { code: "NGN", label: t("NGN"), symbol: "₦" },
  { code: "SGD", label: t("SGD"), symbol: "S$" },
  { code: "MXN", label: t("MXN"), symbol: "$" },
  { code: "COP", label: t("COP"), symbol: "$" },
];

/**
 * Format a deal value as a currency string. Whole-number output
 * (no minor units) — deal values are tracked to the dollar across
 * the app. `currency` defaults to USD so callers with nothing better
 * stay safe, but pass the account/deal currency wherever known.
 *
 * Total by design: `Intl.NumberFormat` throws a RangeError on a
 * structurally invalid currency code, and `deals.currency` carries
 * NO DB CHECK (only `accounts.default_currency` does), so legacy
 * rows, imports, or hand-edited data can hold malformed values like
 * "United States". We never let that crash a render — on a bad code
 * we fall back to "CODE 1,234".
 *
 * The format follows the app's locale (NEXT_PUBLIC_APP_LOCALE), not the
 * runtime's: the runtime would render "1.234" on a pt-BR browser and
 * "1,234" on an en-US one, while the message catalogue stays in a
 * single language. `locale` is a parameter so the tests can pin it.
 */
export function formatCurrency(
  value: number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = APP_LOCALE,
): string {
  const code = (currency || DEFAULT_CURRENCY).trim();
  const amount = Number(value) || 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Invalid ISO code — show the raw code + grouped number so the
    // value is still legible instead of throwing.
    return `${code} ${new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
    }).format(amount)}`;
  }
}

/**
 * Compact currency for tight spaces (donut center, legend rows):
 * "$1.2M" / "€34.5k" / "₹900". Uses the currency's symbol from
 * CURRENCIES, falling back to the code when we don't carry a symbol.
 */
export function formatCurrencyShort(
  value: number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = APP_LOCALE,
): string {
  const code = currency || DEFAULT_CURRENCY;
  const symbol = CURRENCIES.find((c) => c.code === code)?.symbol ?? `${code} `;
  return `${symbol}${formatCompactNumber(value, locale)}`;
}

/**
 * Compact number for tight spaces (chart tiles, legends): 1_234 → "1.2k",
 * 1_200_000 → "1.2M", 900 → "900". The unit-less core shared with
 * {@link formatCurrencyShort}.
 *
 * The digits go through Intl so the decimal separator follows the app
 * locale ("2,5M" in pt, "2.5M" in en) — `toFixed` always produced an
 * English-style dot. The k/M suffix stays as it is: those are the
 * abbreviations the app already used everywhere.
 */
export function formatCompactNumber(
  value: number,
  locale: string = APP_LOCALE,
): string {
  const v = Number(value || 0);
  if (v >= 1_000_000) return `${compact(v / 1_000_000, locale, 1)}M`;
  if (v >= 1_000) return `${compact(v / 1_000, locale, 1)}k`;
  return compact(v, locale, 0);
}

function compact(value: number, locale: string, digits: number): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
