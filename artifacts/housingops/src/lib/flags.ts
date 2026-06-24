/**
 * Front-end feature flags. Read once here so call sites stay clean and the
 * default policy lives in one place.
 */

/**
 * Property Board view (the new single-page property "tab" — Stage 1).
 * Default ON in dev so we build against it; OFF in production until Stage 7
 * sign-off flips it. Override either way with VITE_BOARD_VIEW=true|false.
 */
export const BOARD_VIEW_ENABLED: boolean = (() => {
  const v = import.meta.env.VITE_BOARD_VIEW;
  if (v === "true") return true;
  if (v === "false") return false;
  return Boolean(import.meta.env.DEV);
})();
