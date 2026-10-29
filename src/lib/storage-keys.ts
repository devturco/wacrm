/**
 * localStorage keys that were renamed with the product rebrand.
 *
 * The product shipped as "wacrm" before the rename to "crmbr", and
 * every device that used it before the rename still holds its
 * settings under the old key names. Renaming the keys without a
 * fallback would silently reset the accent theme, the light/dark
 * mode, the browser-notification opt-in, the inbox panel state and
 * the flow editor's canvas/list choice on every browser that had
 * already visited the app — including, worst of all, switching
 * notifications back off without the user ever touching a setting.
 *
 * So each renamed key is read from its new name first and from the
 * legacy name second. This module is the ONLY place in the codebase
 * that still spells the old brand; delete it once the migration has
 * had time to reach every device.
 */

/** Legacy accent-theme key. */
export const LEGACY_THEME_KEY = "wacrm.theme";

/** Legacy light/dark mode key. */
export const LEGACY_MODE_KEY = "wacrm.mode";

/** Legacy browser-notification opt-in key. */
export const LEGACY_BROWSER_NOTIFY_KEY = "wacrm:browser-notifications";

/** Legacy inbox contact-panel state key. */
export const LEGACY_CONTACT_PANEL_KEY = "wacrm:inbox:contact-panel-open";

/** Legacy flow editor canvas/list choice key. */
export const LEGACY_FLOW_EDITOR_VIEW_KEY = "wacrm.flowEditor.view";

/** The slice of the `Storage` interface these helpers need. */
type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem" | "removeItem">;

/**
 * Read `key`, falling back to `legacyKey` when the new one was never
 * written.
 *
 * Read-only on purpose: copying forward would mean writing during
 * render, and the copy only matters the next time the user changes
 * the setting anyway — until then the legacy value IS the answer.
 */
export function readWithLegacy(
  storage: StorageReader | undefined | null,
  key: string,
  legacyKey: string,
): string | null {
  if (!storage) return null;
  try {
    const current = storage.getItem(key);
    if (current !== null) return current;
    return storage.getItem(legacyKey);
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
    return null;
  }
}

/**
 * Write `value` to `key` and drop the legacy entry.
 *
 * Clearing the legacy key matters: without it, opting OUT of a setting
 * that was opted IN under the old name would read the stale legacy
 * value back on the next read and silently undo the change.
 */
export function writeKey(
  storage: StorageWriter | undefined | null,
  key: string,
  legacyKey: string,
  value: string | null,
): void {
  if (!storage) return;
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
    storage.removeItem(legacyKey);
  } catch {
    // Best-effort; the caller's in-memory state still applies for the
    // lifetime of the page.
  }
}
