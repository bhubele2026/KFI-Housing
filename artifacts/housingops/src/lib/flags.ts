/**
 * Front-end feature flags. Read once here so call sites stay clean and the
 * default policy lives in one place.
 */

/**
 * Property Board view (the new single-page property "tab"). Now ON by default
 * everywhere (dev AND prod) — the Board is the property landing. Force it off
 * with VITE_BOARD_VIEW=false. Tests predate the Board and assert the legacy
 * default tab, so it stays off under vitest unless a test opts in explicitly.
 */
export const BOARD_VIEW_ENABLED: boolean = (() => {
  const v = import.meta.env.VITE_BOARD_VIEW;
  if (v === "true") return true;
  if (v === "false") return false;
  if (import.meta.env.MODE === "test") return false;
  return true;
})();
