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
