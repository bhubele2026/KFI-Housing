import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { useUnsavedChangesPrompt } from "./use-unsaved-changes-prompt";

// These tests pin down the three navigation channels the unsaved-changes
// guard has to cover for the new-lease form (task #124):
//   1. In-app navigation via patched history.pushState — wouter's <Link> /
//      navigate() ultimately call this, so blocking pushState catches every
//      route change without per-link instrumentation.
//   2. The one-shot bypass — Save handlers must be able to skip the prompt
//      for THE next navigation only, so the post-save replace doesn't
//      double-confirm. Stale bypasses must not silently allow a later
//      genuinely-unsaved navigation through.
//   3. beforeunload (tab close / refresh) — sets `returnValue` only while
//      armed.
//
// `popstate` (browser back/forward) is harder to drive end-to-end inside
// jsdom because window.history mutations aren't fully wired into popstate;
// we cover it implicitly by exercising the same code path through pushState.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
let confirmSpy: ReturnType<typeof vi.spyOn>;

// Captured handle exposed by the test harness component below — gives each
// test direct access to the hook's return value (specifically
// `bypassNextNavigation`) without needing to render its own button.
let lastResult: ReturnType<typeof useUnsavedChangesPrompt> | null = null;

function Harness({ when }: { when: boolean }) {
  lastResult = useUnsavedChangesPrompt(when);
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // Default to "Cancel" — tests that want to allow the navigation flip the
  // mock per-call. Using a spy keeps the original window.confirm restorable
  // on cleanup so other test files aren't affected.
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  lastResult = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  confirmSpy.mockRestore();
});

describe("useUnsavedChangesPrompt — pushState guard", () => {
  it("does NOT prompt when `when` is false", () => {
    act(() => root.render(<Harness when={false} />));

    act(() => {
      window.history.pushState(null, "", "/some-other-route");
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    // Navigation went through.
    expect(window.location.pathname).toBe("/some-other-route");
  });

  it("prompts and BLOCKS navigation when `when` is true and the user cancels", () => {
    // Anchor the URL so we can assert it didn't change.
    window.history.replaceState(null, "", "/start");
    act(() => root.render(<Harness when={true} />));

    act(() => {
      window.history.pushState(null, "", "/blocked-route");
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // Cancel returns false → navigation dropped, URL unchanged.
    expect(window.location.pathname).toBe("/start");
  });

  it("prompts and ALLOWS navigation when `when` is true and the user confirms", () => {
    window.history.replaceState(null, "", "/start");
    confirmSpy.mockReturnValue(true);
    act(() => root.render(<Harness when={true} />));

    act(() => {
      window.history.pushState(null, "", "/allowed-route");
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/allowed-route");
  });

  it("restores the original pushState/replaceState on unmount", () => {
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;

    act(() => root.render(<Harness when={true} />));
    // While mounted the methods are patched (different reference).
    expect(window.history.pushState).not.toBe(originalPush);
    expect(window.history.replaceState).not.toBe(originalReplace);

    act(() => root.unmount());
    // Re-create the root so afterEach's unmount is a no-op (avoids a double
    // unmount on an already-detached tree).
    root = createRoot(document.createElement("div"));

    expect(window.history.pushState).toBe(originalPush);
    expect(window.history.replaceState).toBe(originalReplace);
  });
});

describe("useUnsavedChangesPrompt — bypassNextNavigation", () => {
  it("skips the confirm exactly once after bypassNextNavigation()", () => {
    window.history.replaceState(null, "", "/start");
    act(() => root.render(<Harness when={true} />));
    expect(lastResult).not.toBeNull();

    // Arm the bypass and navigate — confirm must NOT fire.
    act(() => lastResult!.bypassNextNavigation());
    act(() => {
      window.history.pushState(null, "", "/post-save");
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/post-save");

    // Second navigation (no fresh bypass) must prompt again — the bypass is
    // one-shot, so a stale arming can't quietly let a later truly-unsaved
    // navigation slip through.
    act(() => {
      window.history.pushState(null, "", "/another-route");
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // User cancelled (default mock) → URL stays at the post-save route.
    expect(window.location.pathname).toBe("/post-save");
  });
});

describe("useUnsavedChangesPrompt — beforeunload", () => {
  it("calls preventDefault on beforeunload when armed", () => {
    act(() => root.render(<Harness when={true} />));

    const event = new Event("beforeunload", {
      cancelable: true,
    }) as BeforeUnloadEvent;
    window.dispatchEvent(event);

    // The browser uses defaultPrevented (alongside a non-empty returnValue)
    // to decide whether to show its native "Leave site?" dialog.
    expect(event.defaultPrevented).toBe(true);
  });

  it("does NOT preventDefault on beforeunload when NOT armed", () => {
    act(() => root.render(<Harness when={false} />));

    const event = new Event("beforeunload", {
      cancelable: true,
    }) as BeforeUnloadEvent;
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
