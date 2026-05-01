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

vi.mock("framer-motion", () => {
  // Forward HTML props (notably data-testid, className, onClick) so the
  // tests can still query the rendered rows. Drop motion-only props that
  // would otherwise generate React DOM warnings.
  function Motion({
    children,
    initial: _i,
    animate: _a,
    exit: _e,
    transition: _t,
    variants: _v,
    whileHover: _wh,
    whileTap: _wt,
    whileFocus: _wf,
    whileDrag: _wd,
    whileInView: _wiv,
    layout: _l,
    layoutId: _li,
    ...rest
  }: Record<string, unknown> & { children?: ReactNode }) {
    return <div {...rest}>{children}</div>;
  }
  const motion = new Proxy(
    {},
    { get: () => Motion },
  );
  return { motion };
});

const mockData: {
  properties: unknown[];
  beds: unknown[];
  leases: unknown[];
  utilities: unknown[];
  occupants: unknown[];
  customers: { id: string; name: string }[];
  isLoading: boolean;
} = {
  properties: [
    { id: "p1", customerId: "c1", name: "Maple" },
    { id: "p2", customerId: "c1", name: "Oak" },
    { id: "p3", customerId: "c2", name: "Pine" },
  ],
  beds: [],
  leases: [],
  utilities: [
    { id: "u1", propertyId: "p1", type: "Electric", company: "TXU", monthlyCost: 100, accountNumber: "A1", notes: "" },
    { id: "u2", propertyId: "p1", type: "Water", company: "City", monthlyCost: 80, accountNumber: "A2", notes: "" },
    { id: "u3", propertyId: "p2", type: "Internet", company: "ISP", monthlyCost: 50, accountNumber: "A3", notes: "" },
    { id: "u4", propertyId: "p3", type: "Electric", company: "TXU", monthlyCost: 200, accountNumber: "A4", notes: "" },
  ],
  occupants: [],
  customers: [
    { id: "c1", name: "Acme Co" },
    { id: "c2", name: "Globex" },
  ],
  isLoading: false,
};

vi.mock("@/context/data-store", () => ({
  useData: () => mockData,
}));

import Utilities from "./utilities";

const CUSTOMER_FILTER = "select-utilities-customer-filter";
const PROPERTY_FILTER = "select-utilities-property-filter";
const HINT_TESTID = "text-utilities-active-customer";

describe("Utilities customer filter", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    window.history.replaceState({}, "", "/utilities");
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
      root.render(<Utilities />);
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
  function utilityRowCount() {
    return container.querySelectorAll('[data-testid^="row-utility-"]').length;
  }
  function propertyItemValues() {
    return Array.from(getPropertySelect().querySelectorAll("[data-item-value]")).map(
      (el) => el.getAttribute("data-item-value"),
    );
  }
  // Total Monthly is shown twice (header and table footer); pick the header
  // one by reading the bold paragraph next to its label.
  function headerTotalMonthly() {
    const headings = Array.from(container.querySelectorAll("p"));
    const idx = headings.findIndex((p) => p.textContent === "Total Monthly");
    if (idx === -1 || !headings[idx + 1]) {
      throw new Error("Could not find Total Monthly value");
    }
    return headings[idx + 1].textContent ?? "";
  }

  it("defaults to All Customers, shows every utility and no scope hint", async () => {
    await renderPage();

    expect(getCustomerSelect().getAttribute("data-current")).toBe("All");
    expect(utilityRowCount()).toBe(4);
    // 100 + 80 + 50 + 200 = 430
    expect(headerTotalMonthly()).toBe("$430");
    expect(container.querySelector(`[data-testid="${HINT_TESTID}"]`)).toBeNull();
  });

  it("selecting a customer scopes rows, total, and shows the hint", async () => {
    await renderPage();
    await act(async () => {
      getCustomerHandler().onValueChange("c1");
    });

    expect(getCustomerSelect().getAttribute("data-current")).toBe("c1");
    // Acme Co owns p1 (2 utilities) + p2 (1 utility) = 3 rows
    expect(utilityRowCount()).toBe(3);
    // 100 + 80 + 50 = 230
    expect(headerTotalMonthly()).toBe("$230");

    const hint = container.querySelector(`[data-testid="${HINT_TESTID}"]`);
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain("Acme Co");
  });

  it("totals recompute when switching customers", async () => {
    await renderPage();
    await act(async () => {
      getCustomerHandler().onValueChange("c2");
    });
    // Globex owns p3 (1 utility, $200)
    expect(utilityRowCount()).toBe(1);
    expect(headerTotalMonthly()).toBe("$200");
    expect(container.querySelector(`[data-testid="${HINT_TESTID}"]`)?.textContent).toContain(
      "Globex",
    );
  });

  it("restricts the property sub-filter to the selected customer's properties", async () => {
    await renderPage();

    // Unscoped: All + 3 properties
    expect(propertyItemValues()).toEqual(["All", "p1", "p2", "p3"]);

    await act(async () => {
      getCustomerHandler().onValueChange("c1");
    });
    expect(propertyItemValues()).toEqual(["All", "p1", "p2"]);

    await act(async () => {
      getCustomerHandler().onValueChange("c2");
    });
    expect(propertyItemValues()).toEqual(["All", "p3"]);
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
    expect(utilityRowCount()).toBe(4);
    expect(headerTotalMonthly()).toBe("$430");
    expect(container.querySelector(`[data-testid="${HINT_TESTID}"]`)).toBeNull();
  });
});
