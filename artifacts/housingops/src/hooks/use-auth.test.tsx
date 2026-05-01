import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { AuthProvider, useAuth } from "./use-auth";

const STORAGE_KEY = "housingops_auth";

function AuthProbe({ onRender }: { onRender: (v: boolean) => void }) {
  const { isAuthenticated } = useAuth();
  onRender(isAuthenticated);
  return <span data-testid="auth-state">{String(isAuthenticated)}</span>;
}

describe("AuthProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("exposes isAuthenticated: true on its very first render when storage already says authenticated (no effect-driven flip)", () => {
    window.localStorage.setItem(STORAGE_KEY, "true");

    const renders: boolean[] = [];

    const html = renderToString(
      <AuthProvider>
        <AuthProbe onRender={(v) => renders.push(v)} />
      </AuthProvider>,
    );

    expect(renders.length).toBeGreaterThan(0);
    expect(renders[0]).toBe(true);
    expect(renders.every((v) => v === true)).toBe(true);
    expect(html).toContain(">true<");
  });

  it("exposes isAuthenticated: false on first render when storage is empty", () => {
    const renders: boolean[] = [];

    renderToString(
      <AuthProvider>
        <AuthProbe onRender={(v) => renders.push(v)} />
      </AuthProvider>,
    );

    expect(renders[0]).toBe(false);
  });

  it("flips isAuthenticated to false when the auth key is cleared in another tab", async () => {
    window.localStorage.setItem(STORAGE_KEY, "true");

    const container = document.createElement("div");
    document.body.appendChild(container);
    let root!: Root;
    const renders: boolean[] = [];

    await act(async () => {
      root = createRoot(container);
      root.render(
        <AuthProvider>
          <AuthProbe onRender={(v) => renders.push(v)} />
        </AuthProvider>,
      );
    });

    expect(renders[renders.length - 1]).toBe(true);

    await act(async () => {
      window.localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: null,
          oldValue: "true",
        }),
      );
    });

    expect(renders[renders.length - 1]).toBe(false);

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("also reacts to a global storage clear (event.key === null)", async () => {
    window.localStorage.setItem(STORAGE_KEY, "true");

    const container = document.createElement("div");
    document.body.appendChild(container);
    let root!: Root;
    const renders: boolean[] = [];

    await act(async () => {
      root = createRoot(container);
      root.render(
        <AuthProvider>
          <AuthProbe onRender={(v) => renders.push(v)} />
        </AuthProvider>,
      );
    });

    expect(renders[renders.length - 1]).toBe(true);

    await act(async () => {
      window.localStorage.clear();
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: null,
          newValue: null,
          oldValue: null,
        }),
      );
    });

    expect(renders[renders.length - 1]).toBe(false);

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });
});
