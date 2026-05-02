import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const mockData: {
  customers: { id: string; name: string }[];
  isLoading: boolean;
} = {
  customers: [
    { id: "c1", name: "Acme Co" },
    { id: "c2", name: "Globex" },
  ],
  isLoading: false,
};

vi.mock("@/context/data-store", () => ({
  useData: () => mockData,
}));

import {
  CustomerScopeProvider,
  useCustomerScope,
  ALL_CUSTOMERS,
} from "./customer-scope";

const STORAGE_KEY = "housingops:customer-scope";

let captured: { customerId: string; setCustomerId: (id: string) => void } | null =
  null;

function Consumer() {
  const scope = useCustomerScope();
  captured = scope;
  return <div data-testid="current-id">{scope.customerId}</div>;
}

function ProviderUnderTest() {
  return (
    <CustomerScopeProvider>
      <Consumer />
    </CustomerScopeProvider>
  );
}

// jsdom dispatches popstate via a delayed real timer (observed ~10–50ms),
// so waiting a single microtask is not enough — the URL itself does not
// update until the timer fires. Mirror the pattern used in dashboard.test.tsx.
async function waitForUrlChange(initialHref: string, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    if (window.location.href !== initialHref) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("CustomerScopeProvider initial state", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    captured = null;
    mockData.isLoading = false;
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/dashboard");
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

  async function renderAt(url: string) {
    window.history.replaceState({}, "", url);
    await act(async () => {
      root = createRoot(container);
      root.render(<ProviderUnderTest />);
    });
  }

  function getCurrent() {
    const el = container.querySelector(`[data-testid="current-id"]`);
    if (!el) throw new Error("Consumer did not render");
    return el.textContent ?? "";
  }

  it("adopts ?customer=<id> from the URL on first render", async () => {
    await renderAt("/dashboard?customer=c1");

    expect(getCurrent()).toBe("c1");
    expect(captured?.customerId).toBe("c1");
  });

  it("adopts the value from sessionStorage when no URL param is present", async () => {
    window.sessionStorage.setItem(STORAGE_KEY, "c2");

    await renderAt("/dashboard");

    expect(getCurrent()).toBe("c2");
    expect(captured?.customerId).toBe("c2");
  });

  it("URL takes precedence over sessionStorage on initial load", async () => {
    window.sessionStorage.setItem(STORAGE_KEY, "c2");

    await renderAt("/dashboard?customer=c1");

    expect(getCurrent()).toBe("c1");
    // The URL-sourced value should also be propagated INTO storage so
    // future navigations to pages without the param keep the selection.
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe("c1");
  });

  it("falls back to ALL_CUSTOMERS when neither URL nor storage have a value", async () => {
    await renderAt("/dashboard");

    expect(getCurrent()).toBe(ALL_CUSTOMERS);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("normalizes an unknown URL id back to ALL_CUSTOMERS and strips the param", async () => {
    await renderAt("/dashboard?customer=does-not-exist");

    expect(getCurrent()).toBe(ALL_CUSTOMERS);
    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.search).toBe("");
    // Storage shouldn't carry the bogus id forward either.
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does not normalize an unknown id while data is still loading", async () => {
    mockData.isLoading = true;

    await renderAt("/dashboard?customer=pending-id");

    // While loading we don't yet know whether the id is valid — leave it
    // alone so a slow data fetch doesn't blow away a freshly opened deep link.
    expect(getCurrent()).toBe("pending-id");
    expect(new URLSearchParams(window.location.search).get("customer")).toBe(
      "pending-id",
    );
  });

  it("preserves an unknown id from storage that is not in the URL", async () => {
    // The unknown-id cleanup is targeted at the URL — it only rewrites
    // the URL when the param matches the bad id. A stale storage value
    // still gets reset in state because the customer list doesn't include it.
    window.sessionStorage.setItem(STORAGE_KEY, "ghost");

    await renderAt("/dashboard");

    expect(getCurrent()).toBe(ALL_CUSTOMERS);
    expect(window.location.search).toBe("");
  });
});

describe("CustomerScopeProvider sessionStorage updates", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    captured = null;
    mockData.isLoading = false;
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/dashboard");
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

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<ProviderUnderTest />);
    });
  }

  it("writes the new value to sessionStorage when scope changes", async () => {
    await render();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();

    await act(async () => {
      captured!.setCustomerId("c1");
    });

    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe("c1");
  });

  it("removes the storage entry when scope is reset to ALL_CUSTOMERS", async () => {
    window.sessionStorage.setItem(STORAGE_KEY, "c1");
    window.history.replaceState({}, "", "/dashboard?customer=c1");

    await render();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe("c1");

    await act(async () => {
      captured!.setCustomerId(ALL_CUSTOMERS);
    });

    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("CustomerScopeProvider popstate handling", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    captured = null;
    mockData.isLoading = false;
    window.sessionStorage.clear();
    // Each test needs a known baseline since jsdom history persists.
    window.history.pushState({}, "", "/__test_baseline__");
    window.history.pushState({}, "", "/dashboard");
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

  async function renderAt(url: string) {
    window.history.replaceState({}, "", url);
    await act(async () => {
      root = createRoot(container);
      root.render(<ProviderUnderTest />);
    });
  }

  async function goBack() {
    const before = window.location.href;
    window.history.back();
    await waitForUrlChange(before);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("clears the scope to ALL_CUSTOMERS when Back lands on a URL with no param", async () => {
    await renderAt("/dashboard");

    await act(async () => {
      captured!.setCustomerId("c1");
    });
    expect(captured!.customerId).toBe("c1");

    await goBack();

    expect(window.location.search).toBe("");
    expect(captured!.customerId).toBe(ALL_CUSTOMERS);
  });

  it("adopts the URL id when Back lands on a URL that still has the param", async () => {
    await renderAt("/dashboard?customer=c1");
    expect(captured!.customerId).toBe("c1");

    await act(async () => {
      captured!.setCustomerId("c2");
    });
    expect(captured!.customerId).toBe("c2");

    await goBack();

    expect(new URLSearchParams(window.location.search).get("customer")).toBe(
      "c1",
    );
    expect(captured!.customerId).toBe("c1");
  });
});

describe("CustomerScopeProvider history push vs. replace debounce", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let nowMs: number;
  let dateNowSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    captured = null;
    mockData.isLoading = false;
    window.sessionStorage.clear();
    window.history.pushState({}, "", "/__test_baseline__");
    window.history.pushState({}, "", "/dashboard");
    container = document.createElement("div");
    document.body.appendChild(container);
    nowMs = 1_700_000_000_000;
    dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
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
    dateNowSpy?.mockRestore();
    dateNowSpy = null;
  });

  function advanceClockMs(ms: number) {
    nowMs += ms;
  }

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<ProviderUnderTest />);
    });
  }

  async function goBack() {
    const before = window.location.href;
    window.history.back();
    await waitForUrlChange(before);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("pushes a new history entry for the first change so Back undoes it", async () => {
    await render();

    await act(async () => {
      captured!.setCustomerId("c1");
    });
    expect(new URLSearchParams(window.location.search).get("customer")).toBe(
      "c1",
    );

    await goBack();
    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.search).toBe("");
  });

  it("walks back through well-spaced changes one entry at a time", async () => {
    await render();

    await act(async () => {
      captured!.setCustomerId("c1");
    });
    advanceClockMs(1000);
    await act(async () => {
      captured!.setCustomerId("c2");
    });

    expect(captured!.customerId).toBe("c2");

    await goBack();
    expect(new URLSearchParams(window.location.search).get("customer")).toBe(
      "c1",
    );

    await goBack();
    expect(window.location.search).toBe("");
  });

  it("collapses rapid successive changes (within HISTORY_DEBOUNCE_MS) into one entry", async () => {
    await render();

    // Three changes in quick succession: the first should push, the rest
    // should replace because they fall inside the debounce window.
    await act(async () => {
      captured!.setCustomerId("c1");
    });
    advanceClockMs(50);
    await act(async () => {
      captured!.setCustomerId("c2");
    });
    advanceClockMs(50);
    await act(async () => {
      captured!.setCustomerId("c1");
    });

    expect(captured!.customerId).toBe("c1");

    // A single Back should jump straight to the original unfiltered URL,
    // not walk through the intermediate rapid selections.
    await goBack();
    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.search).toBe("");
  });

  it("does not push a no-op history entry when re-selecting the current value", async () => {
    await renderAt("/dashboard");

    // First push so we have a non-empty history above the baseline.
    await act(async () => {
      captured!.setCustomerId("c1");
    });
    expect(new URLSearchParams(window.location.search).get("customer")).toBe(
      "c1",
    );

    // Re-pick the same value — this must not add another history entry.
    advanceClockMs(1000);
    await act(async () => {
      captured!.setCustomerId("c1");
    });

    // A single Back should still land on the original empty URL.
    await goBack();
    expect(window.location.search).toBe("");
  });

  async function renderAt(url: string) {
    window.history.replaceState({}, "", url);
    await act(async () => {
      root = createRoot(container);
      root.render(<ProviderUnderTest />);
    });
  }
});
