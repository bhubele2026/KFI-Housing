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
  occupants: unknown[];
  customers: { id: string; name: string }[];
  isLoading: boolean;
} = {
  properties: [
    { id: "p1", customerId: "c1", name: "Maple", totalBeds: 2 },
    { id: "p2", customerId: "c1", name: "Oak", totalBeds: 1 },
    { id: "p3", customerId: "c2", name: "Pine", totalBeds: 2 },
  ],
  beds: [
    { id: "b1", propertyId: "p1", status: "Occupied" },
    { id: "b2", propertyId: "p1", status: "Vacant" },
    { id: "b3", propertyId: "p2", status: "Occupied" },
    { id: "b4", propertyId: "p3", status: "Occupied" },
    { id: "b5", propertyId: "p3", status: "Vacant" },
  ],
  leases: [
    { id: "l1", propertyId: "p1", monthlyRent: 300, status: "Active" },
    { id: "l2", propertyId: "p2", monthlyRent: 200, status: "Active" },
    { id: "l3", propertyId: "p3", monthlyRent: 500, status: "Active" },
  ],
  utilities: [
    { id: "u1", propertyId: "p1", monthlyCost: 100 },
    { id: "u2", propertyId: "p2", monthlyCost: 50 },
    { id: "u3", propertyId: "p3", monthlyCost: 200 },
  ],
  occupants: [
    { id: "o1", propertyId: "p1", status: "Active", chargePerBed: 600, billingFrequency: "Monthly" },
    { id: "o2", propertyId: "p2", status: "Active", chargePerBed: 500, billingFrequency: "Monthly" },
    { id: "o3", propertyId: "p3", status: "Active", chargePerBed: 700, billingFrequency: "Monthly" },
    // A "Former" occupant must NOT contribute to revenue:
    { id: "o4", propertyId: "p1", status: "Former", chargePerBed: 999, billingFrequency: "Monthly" },
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

import Finance from "./finance";

const CUSTOMER_FILTER = "select-finance-customer-filter";
const HINT_TESTID = "text-finance-active-customer";

describe("Finance customer filter", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    selectHandlers.clear();
    window.history.replaceState({}, "", "/finance");
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
      root.render(<Finance />);
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
  function financeRowCount() {
    return container.querySelectorAll('[data-testid^="row-finance-"]').length;
  }
  // The three header totals each render as <p> elements directly preceded
  // by their label paragraph. Pull them out by label so we don't have to
  // disambiguate them from values that appear in the table footer too.
  function headerValueFor(label: string) {
    const headings = Array.from(container.querySelectorAll("p"));
    const idx = headings.findIndex((p) => p.textContent === label);
    if (idx === -1 || !headings[idx + 1]) {
      throw new Error(`Could not find header value for "${label}"`);
    }
    return headings[idx + 1].textContent ?? "";
  }

  it("defaults to All Customers, shows every property and no scope hint", async () => {
    await renderPage();

    expect(getCustomerSelect().getAttribute("data-current")).toBe("All");
    expect(financeRowCount()).toBe(3);
    // Revenue: 600+500+700=1800; LeaseCost: 300+200+500=1000; UtilCost: 100+50+200=350
    // TotalCost: 1350; Profit: 450
    expect(headerValueFor("Total Revenue")).toBe("$1,800");
    expect(headerValueFor("Total Costs")).toBe("$1,350");
    expect(headerValueFor("Net Profit")).toBe("+$450");
    expect(container.querySelector(`[data-testid="${HINT_TESTID}"]`)).toBeNull();
  });

  it("selecting a customer scopes rows, totals, and shows the hint", async () => {
    await renderPage();
    await act(async () => {
      getCustomerHandler().onValueChange("c1");
    });

    expect(getCustomerSelect().getAttribute("data-current")).toBe("c1");
    // c1 owns p1 + p2 → 2 visible property rows
    expect(financeRowCount()).toBe(2);
    // Revenue: 600+500=1100; Cost: 300+200+100+50=650; Profit: 450
    expect(headerValueFor("Total Revenue")).toBe("$1,100");
    expect(headerValueFor("Total Costs")).toBe("$650");
    expect(headerValueFor("Net Profit")).toBe("+$450");

    const hint = container.querySelector(`[data-testid="${HINT_TESTID}"]`);
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain("Acme Co");
  });

  it("totals recompute when switching customers (zero-profit case)", async () => {
    await renderPage();
    await act(async () => {
      getCustomerHandler().onValueChange("c2");
    });

    // c2 owns p3 only → 1 visible property row
    expect(financeRowCount()).toBe(1);
    // Revenue: 700; Cost: 500+200=700; Profit: 0
    expect(headerValueFor("Total Revenue")).toBe("$700");
    expect(headerValueFor("Total Costs")).toBe("$700");
    expect(headerValueFor("Net Profit")).toBe("+$0");
    expect(container.querySelector(`[data-testid="${HINT_TESTID}"]`)?.textContent).toContain(
      "Globex",
    );
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
    expect(financeRowCount()).toBe(3);
    expect(headerValueFor("Total Revenue")).toBe("$1,800");
    expect(headerValueFor("Total Costs")).toBe("$1,350");
    expect(headerValueFor("Net Profit")).toBe("+$450");
    expect(container.querySelector(`[data-testid="${HINT_TESTID}"]`)).toBeNull();
  });
});
