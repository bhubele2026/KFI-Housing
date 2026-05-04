import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RuntimeConfigStaleWarning } from "./runtime-config-stale-warning";

// Component-level pin for the in-page warning. The hook that drives
// `isStale` is exercised separately in
// `src/hooks/use-runtime-config-stale.test.tsx`; this file just pins
// the surface contract so the maps that consume it can rely on:
//
//   • `isStale={false}` is a no-op (so callers can render it
//     unconditionally inside their own branch markup without paying
//     for any DOM in the silent case),
//   • `isStale={true}` produces the well-known `runtime-config-stale-warning`
//     testid (so tests on the parent maps can detect the warning
//     without re-implementing the copy match), and
//   • the operator-facing copy actually names `/api/config` — without
//     that, the warning would tell an operator "something is wrong"
//     without telling them where to start looking.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("RuntimeConfigStaleWarning", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    container.remove();
  });

  async function render(node: React.ReactElement) {
    await act(async () => {
      root = createRoot(container);
      root.render(node);
    });
  }

  it("renders nothing at all when isStale is false (no-op so callers can render unconditionally)", async () => {
    await render(<RuntimeConfigStaleWarning isStale={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the warning surface with the pinned testid when isStale is true", async () => {
    await render(<RuntimeConfigStaleWarning isStale={true} />);
    const banner = container.querySelector(
      '[data-testid="runtime-config-stale-warning"]',
    );
    expect(banner).not.toBeNull();
  });

  it("names /api/config in the operator-facing copy so the operator knows where to start looking", async () => {
    await render(<RuntimeConfigStaleWarning isStale={true} />);
    const text = container.querySelector(
      '[data-testid="runtime-config-stale-warning-text"]',
    );
    expect(text).not.toBeNull();
    const copy = text!.textContent ?? "";
    expect(copy).toContain("/api/config");
    // Tells the operator *what* is at risk (not just that something
    // failed) — they should know rotated keys/Map IDs may not have
    // landed in this tab.
    expect(copy.toLowerCase()).toMatch(/refresh|rotat|key/);
  });
});
