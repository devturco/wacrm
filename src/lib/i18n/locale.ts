/**
 * The app's locale — one per deployment, fixed at build time.
 *
 * `NEXT_PUBLIC_APP_LOCALE` already decides the message catalogue (see
 * `next.config.ts` and `src/i18n/request.ts`). It now also decides how
 * numbers, dates and currency are rendered, because those used to
 * follow the *runtime* locale instead: `toLocaleDateString()` with no
 * argument means "whatever the host is set to" — the server's locale
 * (en-US in the container) on the first render, the visitor's browser
 * locale after hydration. The same screen then rendered in two
 * formats, and the server HTML disagreed with the hydrated one.
 *
 * `NEXT_PUBLIC_*` variables are inlined at build time (Next.js docs:
 * environment variables), so this value is frozen into the bundle
 * exactly like the messages are — which also means the locale has to
 * be set as a *build* variable, not only as a runtime one.
 */

/** The locales the app ships message catalogues for. */
export const APP_LOCALES = ["en", "pt", "es", "ko"] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

// Static member access on purpose: this is the form Next.js inlines
// into the client bundle. A dynamic lookup (env["NEXT_PUBLIC_…"]) is
// NOT inlined and would read `undefined` in the browser.
const configured = process.env.NEXT_PUBLIC_APP_LOCALE ?? "";

/**
 * The locale in force for this deployment. Anything outside the
 * supported set falls back to English, the same way the message
 * catalogue does.
 */
export const APP_LOCALE: AppLocale = (
  APP_LOCALES as readonly string[]
).includes(configured)
  ? (configured as AppLocale)
  : "en";
