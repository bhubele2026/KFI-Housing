import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

const selectHandlers = new Map<
  string,
  { value: string; onValueChange: (v: string) => void }
>();

vi.mock("@/components/ui/select", () => {
  function findTestId(node: unknown): string | null {
    if (node == null || typeof node === "string" || typeof node === "number") return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const id = findTestId(child);
        if (id) return id;
      }
      return null;
    }
    if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
      const props = (node as { props: Record<string, unknown> }).props;
      if (typeof props["data-testid"] === "string") {
        return props["data-testid"] as string;
      }
      if ("children" in props) {
        return findTestId(props.children);
      }
    }
    return null;
  }

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children?: ReactNode;
  }) {
    const testid = findTestId(children);
    if (testid) {
      selectHandlers.set(testid, { value, onValueChange });
    }
    return <div data-testid={testid ?? undefined} data-current={value} />;
  }

  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Item = ({ value, children }: { value: string; children?: ReactNode }) => (
    <div data-value={value}>{children}</div>
  );

  return {
    Select,
    SelectContent: Passthrough,
    SelectGroup: Passthrough,
    SelectItem: Item,
    SelectLabel: Passthrough,
    SelectScrollDownButton: Passthrough,
    SelectScrollUpButton: Passthrough,
    SelectSeparator: Passthrough,
    SelectTrigger: Passthrough,
    SelectValue: Passthrough,
  };
});

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("framer-motion", () => {
  const Motion = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const motion = new Proxy(
    {},
    { get: () => Motion },
  );
  return { motion };
});

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Stub,
    Bar: Stub,
    XAxis: Stub,
    YAxis: Stub,
    CartesianGrid: Stub,
    Tooltip: Stub,
    Legend: Stub,
    ResponsiveContainer: Stub,
  };
});

const mockData: {
  properties: unknown[];
  beds: unknown[];
  leases: unknown[];
  utilities: unknown[];
  customers: { id: string; name: string }[];
  isLoading: boolean;
} = {
  properties: [],
  beds: [],
  leases: [],
  utilities: [],
  customers: [
    { id: "c1", name: "Acme Co" },
    { id: "c2", name: "Globex" },
  ],
  isLoading: false,
};

vi.mock("@/context/data-store", () => ({
  useData: () => mockData,
}));

import Dashboard from "./dashboard";

const FILTER_TESTID = "select-dashboard-customer-filter";

describe("Dashboard customer filter URL persistence", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    mockData.isLoading = false;
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
      root.render(<Dashboard />);
    });
  }

  function getFilterSelect() {
    const el = container.querySelector(`[data-testid="${FILTER_TESTID}"]`);
    if (!el) throw new Error(`Could not find ${FILTER_TESTID}`);
    return el;
  }

  function getHandler() {
    const h = selectHandlers.get(FILTER_TESTID);
    if (!h) throw new Error(`No handler captured for ${FILTER_TESTID}`);
    return h;
  }

  it("selecting a customer adds ?customer=<id> to the URL", async () => {
    await renderAt("/dashboard");

    expect(getFilterSelect().getAttribute("data-current")).toBe("All");
    expect(window.location.search).toBe("");

    await act(async () => {
      getHandler().onValueChange("c1");
    });

    expect(window.location.pathname).toBe("/dashboard");
    expect(new URLSearchParams(window.location.search).get("customer")).toBe("c1");
    expect(getFilterSelect().getAttribute("data-current")).toBe("c1");
  });

  it("switching back to All Customers removes the ?customer param", async () => {
    await renderAt("/dashboard?customer=c1");

    expect(getFilterSelect().getAttribute("data-current")).toBe("c1");

    await act(async () => {
      getHandler().onValueChange("All");
    });

    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.search).toBe("");
    expect(getFilterSelect().getAttribute("data-current")).toBe("All");
  });

  it("loading /dashboard?customer=<id> pre-selects that customer", async () => {
    await renderAt("/dashboard?customer=c2");

    expect(getFilterSelect().getAttribute("data-current")).toBe("c2");
    // The URL should not be rewritten for a known customer.
    expect(new URLSearchParams(window.location.search).get("customer")).toBe("c2");
  });

  it("falls back to All Customers when the URL carries an unknown customer id", async () => {
    await renderAt("/dashboard?customer=does-not-exist");

    expect(getFilterSelect().getAttribute("data-current")).toBe("All");
    // The unknown id should also be normalized out of the URL.
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("preserves other unrelated query params when toggling the filter", async () => {
    await renderAt("/dashboard?other=keep");

    await act(async () => {
      getHandler().onValueChange("c1");
    });

    const params1 = new URLSearchParams(window.location.search);
    expect(params1.get("customer")).toBe("c1");
    expect(params1.get("other")).toBe("keep");

    await act(async () => {
      getHandler().onValueChange("All");
    });

    const params2 = new URLSearchParams(window.location.search);
    expect(params2.get("customer")).toBeNull();
    expect(params2.get("other")).toBe("keep");
  });
});

describe("Dashboard customer filter back/forward navigation", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let nowMs: number;
  let dateNowSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    mockData.isLoading = false;
    // jsdom's history persists across tests; push a sentinel marker we
    // can walk back to so each test has a clean, known baseline regardless
    // of where prior tests left the history pointer.
    window.history.pushState({}, "", "/__test_baseline__");
    window.history.pushState({}, "", "/dashboard");
    container = document.createElement("div");
    document.body.appendChild(container);
    // Drive the debounce window deterministically by spying on Date.now
    // instead of using fake timers (we still need real setTimeout for
    // jsdom popstate to flush).
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

  async function renderAt(url: string) {
    window.history.replaceState({}, "", url);
    await act(async () => {
      root = createRoot(container);
      root.render(<Dashboard />);
    });
  }

  function getFilterSelect() {
    const el = container.querySelector(`[data-testid="${FILTER_TESTID}"]`);
    if (!el) throw new Error(`Could not find ${FILTER_TESTID}`);
    return el;
  }

  function getHandler() {
    const h = selectHandlers.get(FILTER_TESTID);
    if (!h) throw new Error(`No handler captured for ${FILTER_TESTID}`);
    return h;
  }

  // jsdom dispatches popstate via a delayed real timer (observed ~10–50ms),
  // so waiting a single microtask is not enough — the URL itself does not
  // update until the timer fires. Wait long enough for the URL to change,
  // then flush React inside act so wouter re-renders the new state.
  // Note: Date.now is spied to a frozen value, so we count poll iterations
  // for the timeout instead of using wall-clock time.
  async function waitForUrlChange(initialHref: string, maxAttempts = 60) {
    for (let i = 0; i < maxAttempts; i++) {
      if (window.location.href !== initialHref) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async function goBack() {
    const before = window.location.href;
    window.history.back();
    await waitForUrlChange(before);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function goForward() {
    const before = window.location.href;
    window.history.forward();
    await waitForUrlChange(before);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("pushes a new history entry when the user picks a customer", async () => {
    await renderAt("/dashboard");

    await act(async () => {
      getHandler().onValueChange("c1");
    });
    expect(new URLSearchParams(window.location.search).get("customer")).toBe("c1");

    // The new entry must be undoable: a single Back returns to the
    // unfiltered URL (which only happens if pushState — not replaceState
    // — was used).
    await goBack();
    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.search).toBe("");
  });

  it("Back restores the previous All filter after picking a customer", async () => {
    await renderAt("/dashboard");

    await act(async () => {
      getHandler().onValueChange("c1");
    });
    expect(getFilterSelect().getAttribute("data-current")).toBe("c1");

    await goBack();

    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.search).toBe("");
    expect(getFilterSelect().getAttribute("data-current")).toBe("All");
  });

  it("Back then Forward re-applies the customer filter", async () => {
    await renderAt("/dashboard");

    await act(async () => {
      getHandler().onValueChange("c2");
    });

    await goBack();
    expect(getFilterSelect().getAttribute("data-current")).toBe("All");

    await goForward();
    expect(new URLSearchParams(window.location.search).get("customer")).toBe("c2");
    expect(getFilterSelect().getAttribute("data-current")).toBe("c2");
  });

  it("walks back through deliberate, well-spaced filter changes one at a time", async () => {
    await renderAt("/dashboard");

    await act(async () => {
      getHandler().onValueChange("c1");
    });
    advanceClockMs(1000);
    await act(async () => {
      getHandler().onValueChange("c2");
    });

    expect(getFilterSelect().getAttribute("data-current")).toBe("c2");

    await goBack();
    expect(getFilterSelect().getAttribute("data-current")).toBe("c1");

    await goBack();
    expect(getFilterSelect().getAttribute("data-current")).toBe("All");
  });

  it("collapses rapid successive filter changes into one history entry", async () => {
    await renderAt("/dashboard");

    // Three changes in quick succession (all within the debounce window):
    // the first should push, the next two should replace.
    await act(async () => {
      getHandler().onValueChange("c1");
    });
    advanceClockMs(50);
    await act(async () => {
      getHandler().onValueChange("c2");
    });
    advanceClockMs(50);
    await act(async () => {
      getHandler().onValueChange("c1");
    });

    expect(getFilterSelect().getAttribute("data-current")).toBe("c1");

    // A single Back should jump straight to the original All state, not
    // walk through the intermediate rapid selections (c2 and the first c1).
    await goBack();
    expect(window.location.pathname).toBe("/dashboard");
    expect(window.location.search).toBe("");
    expect(getFilterSelect().getAttribute("data-current")).toBe("All");
  });
});
