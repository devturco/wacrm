import { cn } from "@/lib/utils";

/**
 * The brand lockup (chat-bubble mark + "crmbr" wordmark), swapped by
 * colour mode: the dark-on-light version in light mode, the white one
 * in dark mode.
 *
 * The swap is done in CSS against `html[data-mode]` rather than from
 * React state on purpose. The boot script in the root layout applies
 * `data-mode` before React hydrates, so the right file is painted on
 * the very first frame — a `useTheme()`-driven `src` would render the
 * default mode's logo first and swap it after hydration, which reads
 * as a flash on every page load.
 *
 * The logo is a background image rather than an `<img>`: only the
 * background that actually applies is fetched, so a page load pulls one
 * logo file, not both.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="crmbr"
      className={cn("brand-logo", className)}
    />
  );
}
