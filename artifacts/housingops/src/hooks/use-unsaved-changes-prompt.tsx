import { useEffect, useRef } from "react";

/**
 * Default copy for both the in-app `window.confirm` dialog and the browser's
 * `beforeunload` channel. Modern browsers ignore the custom string for
 * beforeunload (they show their own "Leave site?" UI), but we still set it
 * so the spec'd `returnValue` is non-empty — which is what triggers the
 * native prompt in the first place.
 */
const DEFAULT_MESSAGE = "You have unsaved changes — discard?";

export interface UseUnsavedChangesPromptResult {
  /**
   * Mark the next navigation as "expected" so the guard does NOT prompt for
   * it. Call this from a Save / Submit handler immediately before
   * `navigate(...)` so the post-save replace doesn't trigger a false-positive
   * confirm.
   *
   * The flag is consumed on the next intercepted navigation (one-shot) so a
   * stale bypass can't accidentally let a later, truly unsaved navigation
   * slip through.
   */
  bypassNextNavigation: () => void;
}

/**
 * Warn the operator before they leave the current page if `when` is true.
 *
 * Covers three navigation channels operators actually use:
 *   1. **In-app navigation** (wouter `<Link>`, `navigate()`, sidebar links) —
 *      handled by patching `window.history.pushState` / `replaceState` so any
 *      route change goes through `window.confirm` first. This is the same
 *      hook wouter's `useBrowserLocation` ultimately calls, so we don't have
 *      to teach every individual `<Link>` about the guard.
 *   2. **Browser back/forward** — `popstate` fires AFTER the URL has already
 *      changed, so the guard re-pushes the previous URL on cancel to undo
 *      the navigation.
 *   3. **Tab close / refresh / cross-origin nav** — `beforeunload` triggers
 *      the browser's native "Leave site?" dialog when `returnValue` is set.
 *
 * The returned `bypassNextNavigation` is the escape hatch for "I just saved,
 * please don't prompt me on the redirect" flows.
 *
 * Note: tests that mount components with wouter's `memoryLocation` won't
 * exercise the history-patching path (memoryLocation never calls
 * `history.pushState`). Cover the integration logic by mocking this hook in
 * page-level tests and exercise the patching itself in this hook's own
 * tests.
 */
export function useUnsavedChangesPrompt(
  when: boolean,
  message: string = DEFAULT_MESSAGE,
): UseUnsavedChangesPromptResult {
  // Refs let the patched history methods (set up once on mount) always read
  // the *current* `when` value without re-patching on every dirty toggle —
  // re-patching is fragile because some other code may have stacked another
  // patch on top of ours in between.
  const whenRef = useRef(when);
  whenRef.current = when;
  const messageRef = useRef(message);
  messageRef.current = message;

  // One-shot bypass flag. Persisted on a ref (not state) so the consumer can
  // toggle it synchronously inside an event handler immediately before the
  // navigation it wants to allow — state updates wouldn't have flushed by
  // then.
  const bypassNextRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const consumeBypass = (): boolean => {
      if (bypassNextRef.current) {
        bypassNextRef.current = false;
        return true;
      }
      return false;
    };

    // Browser-level: tab close, hard refresh, cross-origin nav. The custom
    // string is largely ignored by modern browsers (they show a generic
    // "Leave site?" prompt), but `returnValue` must be non-empty for the
    // prompt to render at all.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!whenRef.current) return;
      if (consumeBypass()) return;
      e.preventDefault();
      e.returnValue = messageRef.current;
      return messageRef.current;
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    // Capture the *truly-original* method references so we can restore them
    // verbatim on unmount (without an extra layer of `.bind` wrapping). The
    // call-through paths use locally-bound copies because the patched
    // function is detached from `window.history` when invoked.
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    const callPushState = originalPushState.bind(window.history);
    const callReplaceState = originalReplaceState.bind(window.history);

    const guardedPushState: typeof window.history.pushState = function (
      ...args
    ) {
      if (whenRef.current && !consumeBypass()) {
        // window.confirm is synchronous: returns false if the user picks
        // Cancel, in which case we silently drop the navigation.
        if (!window.confirm(messageRef.current)) return;
      }
      return callPushState(...args);
    };
    const guardedReplaceState: typeof window.history.replaceState = function (
      ...args
    ) {
      if (whenRef.current && !consumeBypass()) {
        if (!window.confirm(messageRef.current)) return;
      }
      return callReplaceState(...args);
    };

    window.history.pushState = guardedPushState;
    window.history.replaceState = guardedReplaceState;

    // popstate fires AFTER the URL has already changed, so we have to undo
    // a cancelled back/forward by pushing the previous URL back on. We track
    // `prevUrl` ourselves because once popstate fires `window.location` is
    // already the destination.
    let prevUrl = window.location.href;
    const onPopState = () => {
      // Always update the prev pointer when the guard isn't blocking —
      // otherwise we'd snap back to a URL the operator doesn't remember
      // visiting after they've navigated through several pages cleanly.
      if (!whenRef.current || consumeBypass()) {
        prevUrl = window.location.href;
        return;
      }
      if (window.confirm(messageRef.current)) {
        prevUrl = window.location.href;
        return;
      }
      // Cancelled — push the previous URL back. Use the *original*
      // pushState so we don't re-trigger our own guard.
      callPushState(null, "", prevUrl);
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
      // Restore the originals only if nothing else has stacked another patch
      // on top of ours — otherwise we'd clobber that other patch and leave
      // the page in a broken state.
      if (window.history.pushState === guardedPushState) {
        window.history.pushState = originalPushState;
      }
      if (window.history.replaceState === guardedReplaceState) {
        window.history.replaceState = originalReplaceState;
      }
    };
  }, []);

  return {
    bypassNextNavigation: () => {
      bypassNextRef.current = true;
    },
  };
}
