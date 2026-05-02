import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

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

  function collectItems(
    node: unknown,
    out: Array<{ value: string; label: string }>,
  ) {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((c) => collectItems(c, out));
      return;
    }
    if (typeof node === "object" && isValidElement(node)) {
      const props = (node as { props: Record<string, unknown> }).props ?? {};
      const value = props.value;
      const children = props.children;
      if (
        typeof value === "string" &&
        (typeof children === "string" || typeof children === "number")
      ) {
        out.push({ value, label: String(children) });
      }
      if ("children" in props) collectItems(children, out);
    }
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
    const items: Array<{ value: string; label: string }> = [];
    collectItems(children, items);
    if (testid) selectHandlers.set(testid, { value, onValueChange });
    return (
      <div data-testid={testid ?? undefined} data-current={value}>
        {items.map((it) => (
          <span key={it.value} data-item-value={it.value}>
            {it.label}
          </span>
        ))}
      </div>
    );
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

const mockData: {
  properties: unknown[];
  rooms: unknown[];
  beds: unknown[];
  leases: unknown[];
  utilities: unknown[];
  occupants: unknown[];
  customers: { id: string; name: string }[];
  isLoading: boolean;
} = {
  properties: [
    { id: "p1", customerId: "c1", name: "Maple", monthlyRent: 1000 },
    { id: "p2", customerId: "c1", name: "Oak", monthlyRent: 1100 },
    { id: "p3", customerId: "c2", name: "Pine", monthlyRent: 1200 },
    { id: "p4", customerId: "c2", name: "Cedar", monthlyRent: 1300 },
  ],
  rooms: [],
  beds: [
    // p1: 2 occupied, 1 vacant
    { id: "b1", propertyId: "p1", bedNumber: 1, status: "Occupied", occupantId: "o1" },
    { id: "b2", propertyId: "p1", bedNumber: 2, status: "Occupied", occupantId: "o2" },
    { id: "b3", propertyId: "p1", bedNumber: 3, status: "Vacant", occupantId: null },
    // p2: 1 vacant
    { id: "b4", propertyId: "p2", bedNumber: 1, status: "Vacant", occupantId: null },
    // p3: 1 occupied, 1 vacant
    { id: "b5", propertyId: "p3", bedNumber: 1, status: "Occupied", occupantId: "o3" },
    { id: "b6", propertyId: "p3", bedNumber: 2, status: "Vacant", occupantId: null },
    // p4: 2 occupied
    { id: "b7", propertyId: "p4", bedNumber: 1, status: "Occupied", occupantId: "o4" },
    { id: "b8", propertyId: "p4", bedNumber: 2, status: "Occupied", occupantId: "o5" },
  ],
  leases: [],
  utilities: [],
  occupants: [
    { id: "o1", name: "Alice" },
    { id: "o2", name: "Bob" },
    { id: "o3", name: "Carol" },
    { id: "o4", name: "Dave" },
    { id: "o5", name: "Eve" },
  ],
  customers: [
    { id: "c1", name: "Acme Co" },
    { id: "c2", name: "Globex" },
  ],
  isLoading: false,
};

vi.mock("@/context/data-store", () => ({
  useData: () => mockData,
}));

import Beds from "./beds";
import { CustomerScopeProvider } from "@/context/customer-scope";

const CUSTOMER_FILTER = "select-beds-customer-filter";
const PROPERTY_FILTER = "select-beds-property-filter";
const HINT_TESTID = "text-beds-active-customer";

function BedsUnderTest() {
  return (
    <CustomerScopeProvider>
      <Beds />
    </CustomerScopeProvider>
  );
}

describe("Beds customer filter", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/beds");
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

  async function renderPage() {
    await act(async () => {
      root = createRoot(container);
      root.render(<BedsUnderTest />);
    });
  }

  function getCustomerSelect() {
    const el = container.querySelector(`[data-testid="${CUSTOMER_FILTER}"]`);
    if (!el) throw new Error(`Could not find ${CUSTOMER_FILTER}`);
    return el;
  }
  function getPropertySelect() {
    const el = container.querySelector(`[data-testid="${PROPERTY_FILTER}"]`);
    if (!el) throw new Error(`Could not find ${PROPERTY_FILTER}`);
    return el;
  }
  function getCustomerHandler() {
    const h = selectHandlers.get(CUSTOMER_FILTER);
    if (!h) throw new Error(`No handler captured for ${CUSTOMER_FILTER}`);
    return h;
  }
  function getPropertyHandler() {
    const h = selectHandlers.get(PROPERTY_FILTER);
    if (!h) throw new Error(`No handler captured for ${PROPERTY_FILTER}`);
    return h;
  }
  function bodyRowCount() {
    return container.querySelectorAll("tbody tr").length;
  }
  function propertyItemValues() {
    return Array.from(getPropertySelect().querySelectorAll("[data-item-value]")).map(
      (el) => el.getAttribute("data-item-value"),
    );
  }

  it("defaults to All Customers, shows every bed and no scope hint", async () => {
    await renderPage();

    expect(getCustomerSelect().getAttribute("data-current")).toBe("All");
    expect(bodyRowCount()).toBe(8);
    // 5 occupied of 8 total
    expect(container.textContent).toContain("5 of 8 beds occupied");
    expect(container.querySelector(`[data-testid="${HINT_TESTID}"]`)).toBeNull();
  });

  it("selecting a customer scopes rows, occupancy totals, and shows the hint", async () => {
    await renderPage();
    await act(async () => {
      getCustomerHandler().onValueChange("c1");
    });

    expect(getCustomerSelect().getAttribute("data-current")).toBe("c1");
    // Acme Co owns p1 (3 beds) and p2 (1 bed) = 4 visible rows
    expect(bodyRowCount()).toBe(4);
    // Occupied: p1 has 2, p2 has 0 → 2 of 4
    expect(container.textContent).toContain("2 of 4 beds occupied");

    const hint = container.querySelector(`[data-testid="${HINT_TESTID}"]`);
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain("Acme Co");
  });

  it("totals recompute when switching to a different customer", async () => {
    await renderPage();

    await act(async () => {
      getCustomerHandler().onValueChange("c2");
    });
    // Globex owns p3 (2) + p4 (2) = 4 beds; 1 + 2 = 3 occupied
    expect(bodyRowCount()).toBe(4);
    expect(container.textContent).toContain("3 of 4 beds occupied");
    expect(container.querySelector(`[data-testid="${HINT_TESTID}"]`)?.textContent).toContain(
      "Globex",
    );
  });

  it("restricts the property sub-filter to the selected customer's properties", async () => {
    await renderPage();

    // Unscoped: All + 4 properties
    expect(propertyItemValues()).toEqual(["All", "p1", "p2", "p3", "p4"]);

    await act(async () => {
      getCustomerHandler().onValueChange("c1");
    });
    expect(propertyItemValues()).toEqual(["All", "p1", "p2"]);

    await act(async () => {
      getCustomerHandler().onValueChange("c2");
    });
    expect(propertyItemValues()).toEqual(["All", "p3", "p4"]);
  });

  it("snaps a stale property selection back to All when the customer changes", async () => {
    await renderPage();

    // Pick a property owned by c2, then switch the customer to c1.
    await act(async () => {
      getPropertyHandler().onValueChange("p3");
    });
    expect(getPropertySelect().getAttribute("data-current")).toBe("p3");

    await act(async () => {
      getCustomerHandler().onValueChange("c1");
    });
    // p3 doesn't belong to c1, so the property filter must reset.
    expect(getPropertySelect().getAttribute("data-current")).toBe("All");
  });

  it("returns to All Customers via the filter and restores totals/hint", async () => {
    await renderPage();
    await act(async () => {
      getCustomerHandler().onValueChange("c1");
    });
    expect(container.querySelector(`[data-testid="${HINT_TESTID}"]`)).not.toBeNull();

    await act(async () => {
      getCustomerHandler().onValueChange("All");
    });

    expect(getCustomerSelect().getAttribute("data-current")).toBe("All");
    expect(bodyRowCount()).toBe(8);
    expect(container.textContent).toContain("5 of 8 beds occupied");
    expect(container.querySelector(`[data-testid="${HINT_TESTID}"]`)).toBeNull();
  });
});

describe("Beds customer filter URL persistence", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/beds");
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
      root.render(<BedsUnderTest />);
    });
  }

  function getCustomerSelect() {
    const el = container.querySelector(`[data-testid="${CUSTOMER_FILTER}"]`);
    if (!el) throw new Error(`Could not find ${CUSTOMER_FILTER}`);
    return el;
  }

  function getCustomerHandler() {
    const h = selectHandlers.get(CUSTOMER_FILTER);
    if (!h) throw new Error(`No handler captured for ${CUSTOMER_FILTER}`);
    return h;
  }

  function getBadge() {
    return container.querySelector('[data-testid="badge-customer-filter"]');
  }

  function getClearBadgeButton() {
    return container.querySelector(
      '[data-testid="button-clear-customer-filter"]',
    ) as HTMLButtonElement | null;
  }

  function getCustomerCellButton(bedId: string) {
    return container.querySelector(
      `[data-testid="button-filter-customer-${bedId}"]`,
    ) as HTMLButtonElement | null;
  }

  it("selecting a customer adds ?customer=<id> to the URL and shows the badge", async () => {
    await renderAt("/beds");

    expect(getCustomerSelect().getAttribute("data-current")).toBe("All");
    expect(window.location.search).toBe("");
    expect(getBadge()).toBeNull();

    await act(async () => {
      getCustomerHandler().onValueChange("c1");
    });

    expect(window.location.pathname).toBe("/beds");
    expect(new URLSearchParams(window.location.search).get("customer")).toBe("c1");
    expect(getCustomerSelect().getAttribute("data-current")).toBe("c1");

    const badge = getBadge();
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("Acme Co");
    expect(getClearBadgeButton()).not.toBeNull();
  });

  it("clicking a customer name in the table filters and updates the URL", async () => {
    await renderAt("/beds");

    expect(window.location.search).toBe("");
    expect(getBadge()).toBeNull();

    // Bed b5 belongs to property p3, owned by Globex (c2). When unfiltered,
    // the Customer column is visible so the click-to-filter button exists.
    const button = getCustomerCellButton("b5");
    expect(button).not.toBeNull();

    await act(async () => {
      button!.click();
    });

    expect(new URLSearchParams(window.location.search).get("customer")).toBe("c2");
    expect(getCustomerSelect().getAttribute("data-current")).toBe("c2");

    const badge = getBadge();
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("Globex");
  });

  it("clearing via the badge X removes the ?customer param", async () => {
    await renderAt("/beds?customer=c1");

    expect(getCustomerSelect().getAttribute("data-current")).toBe("c1");
    const clearBtn = getClearBadgeButton();
    expect(clearBtn).not.toBeNull();

    await act(async () => {
      clearBtn!.click();
    });

    expect(window.location.pathname).toBe("/beds");
    expect(window.location.search).toBe("");
    expect(getCustomerSelect().getAttribute("data-current")).toBe("All");
    expect(getBadge()).toBeNull();
  });

  it("switching back to All Customers via the dropdown removes the ?customer param", async () => {
    await renderAt("/beds?customer=c1");

    expect(getCustomerSelect().getAttribute("data-current")).toBe("c1");

    await act(async () => {
      getCustomerHandler().onValueChange("All");
    });

    expect(window.location.pathname).toBe("/beds");
    expect(window.location.search).toBe("");
    expect(getCustomerSelect().getAttribute("data-current")).toBe("All");
    expect(getBadge()).toBeNull();
  });

  it("loading /beds?customer=<id> pre-selects that customer on first render", async () => {
    await renderAt("/beds?customer=c2");

    expect(getCustomerSelect().getAttribute("data-current")).toBe("c2");
    // The URL should not be rewritten for a known customer.
    expect(new URLSearchParams(window.location.search).get("customer")).toBe("c2");

    const badge = getBadge();
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("Globex");
  });

  it("falls back to All Customers when the URL carries an unknown customer id", async () => {
    await renderAt("/beds?customer=does-not-exist");

    expect(getCustomerSelect().getAttribute("data-current")).toBe("All");
    expect(getBadge()).toBeNull();
  });

  it("preserves other unrelated query params when toggling the filter", async () => {
    await renderAt("/beds?other=keep");

    await act(async () => {
      getCustomerHandler().onValueChange("c1");
    });

    const params1 = new URLSearchParams(window.location.search);
    expect(params1.get("customer")).toBe("c1");
    expect(params1.get("other")).toBe("keep");

    await act(async () => {
      getCustomerHandler().onValueChange("All");
    });

    const params2 = new URLSearchParams(window.location.search);
    expect(params2.get("customer")).toBeNull();
    expect(params2.get("other")).toBe("keep");
  });
});
