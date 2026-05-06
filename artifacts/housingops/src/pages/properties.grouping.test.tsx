import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// These tests pin down the customer-grouping behavior added to the
// Properties table view (task #284). The page now groups properties
// under one collapsible row per customer; this file verifies the
// default-collapsed render, click-to-expand interaction, badge counts
// reflecting the active filters, single-customer-scope auto-expand,
// and search-driven auto-expand.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

vi.mock("@workspace/api-client-react", () => ({
  useGetRuntimeConfig: () => ({
    data: {
      googleMapsApiKey: "test-key",
      googleMapsMapId: "test-map-id",
    },
    isPending: false,
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
    status: "success",
    fetchStatus: "idle",
  }),
  getGetRuntimeConfigQueryKey: () => ["/api/config"] as const,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Dialog: Pass,
    DialogTrigger: Pass,
    DialogContent: () => null,
    DialogHeader: Pass,
    DialogTitle: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogClose: Pass,
    DialogPortal: Pass,
    DialogOverlay: () => null,
  };
});

vi.mock("@/components/ui/hover-card", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    HoverCard: Pass,
    HoverCardTrigger: Pass,
    HoverCardContent: () => null,
  };
});

vi.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: () => null,
    DropdownMenuItem: Pass,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: Pass,
  };
});

vi.mock("@/components/ui/select", () => {
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
      const v = props.value;
      const ch = props.children;
      if (typeof v === "string" && (typeof ch === "string" || typeof ch === "number")) {
        out.push({ value: v, label: String(ch) });
      }
      if ("children" in props) collectItems(ch, out);
    }
  }
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  function Select({
    value,
    children,
  }: {
    value: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
  }) {
    const items: Array<{ value: string; label: string }> = [];
    collectItems(children, items);
    return (
      <div data-current={value}>
        {items.map((it) => (
          <span key={it.value} data-item-value={it.value}>{it.label}</span>
        ))}
      </div>
    );
  }
  const Item = ({ value, children }: { value: string; children?: ReactNode }) => (
    <span data-value={value}>{children}</span>
  );
  return {
    Select,
    SelectContent: Pass,
    SelectGroup: Pass,
    SelectItem: Item,
    SelectLabel: Pass,
    SelectScrollDownButton: Pass,
    SelectScrollUpButton: Pass,
    SelectSeparator: Pass,
    SelectTrigger: Pass,
    SelectValue: Pass,
  };
});

type State = {
  customers: Array<Record<string, unknown>>;
  properties: Array<Record<string, unknown>>;
  beds: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
  rooms: Array<Record<string, unknown>>;
};

function baseProperty(over: Record<string, unknown>): Record<string, unknown> {
  return {
    address: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
    totalBeds: 0,
    monthlyRent: 0,
    chargePerBed: 0,
    status: "Active",
    landlordName: "",
    landlordEmail: "",
    landlordPhone: "",
    paymentMethod: "ACH",
    paymentRecipient: "",
    paymentDueDay: 1,
    paymentNotes: "",
    bankName: "",
    bankRouting: "",
    bankAccount: "",
    portalUrl: "",
    notes: "",
    furnishings: [],
    ratings: undefined,
    ...over,
  };
}

// Two customers each with two properties so we can exercise the
// "default collapsed" + "expand one group at a time" + "badge count"
// paths without falling into the single-group auto-expand shortcut.
function makeFreshState(): State {
  return {
    customers: [
      { id: "c1", name: "Adient", contactName: "", email: "", phone: "", notes: "" },
      { id: "c2", name: "Beacon Industries", contactName: "", email: "", phone: "", notes: "" },
    ],
    properties: [
      baseProperty({ id: "p1", customerId: "c1", name: "Maple" }),
      baseProperty({ id: "p2", customerId: "c1", name: "Oak", status: "Inactive" }),
      baseProperty({ id: "p3", customerId: "c2", name: "Pine" }),
      baseProperty({ id: "p4", customerId: "c2", name: "Birch" }),
    ],
    beds: [],
    leases: [],
    rooms: [],
  };
}

let state: State = makeFreshState();

const storeMocks = {
  addProperty: vi.fn(),
  addCustomer: vi.fn(),
  updateProperty: vi.fn(),
};

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    isLoading: false,
    ...storeMocks,
  }),
}));

import Properties from "./properties";
import { CustomerScopeProvider } from "@/context/customer-scope";

function PropertiesUnderTest() {
  return (
    <CustomerScopeProvider>
      <Properties />
    </CustomerScopeProvider>
  );
}

const PREFS_KEY = "housingops:properties:prefs";

describe("Properties customer grouping", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeFreshState();
    Object.values(storeMocks).forEach((m) => m.mockReset());
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/properties");
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
      root.render(<PropertiesUnderTest />);
    });
  }

  function get(testId: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  }

  async function click(el: HTMLElement) {
    await act(async () => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("renders one collapsible row per customer (alphabetical) and hides property rows by default", async () => {
    await renderPage();

    // Both customer headers present.
    const c1Row = get("row-customer-group-c1");
    const c2Row = get("row-customer-group-c2");
    expect(c1Row).not.toBeNull();
    expect(c2Row).not.toBeNull();

    // Default-collapsed: property rows are NOT in the DOM.
    expect(get("row-property-p1")).toBeNull();
    expect(get("row-property-p2")).toBeNull();
    expect(get("row-property-p3")).toBeNull();
    expect(get("row-property-p4")).toBeNull();

    // Group rows expose data-expanded="false" so the assertion has a
    // single source of truth that doesn't depend on chevron icon shape.
    expect(c1Row!.getAttribute("data-expanded")).toBe("false");
    expect(c2Row!.getAttribute("data-expanded")).toBe("false");

    // Alphabetical ordering: Adient (c1) before Beacon Industries (c2).
    const allRows = Array.from(
      container.querySelectorAll('[data-testid^="row-customer-group-"]'),
    );
    expect(allRows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "row-customer-group-c1",
      "row-customer-group-c2",
    ]);

    // Per-group badge reflects the count of properties in that group.
    expect(get("badge-customer-group-count-c1")?.textContent).toContain("2");
    expect(get("badge-customer-group-count-c2")?.textContent).toContain("2");
  });

  it("clicking the customer row toggles its property rows in and out", async () => {
    await renderPage();

    const toggle = get("button-toggle-customer-group-c1");
    expect(toggle).not.toBeNull();

    // Expand: c1's properties appear, c2's stay hidden.
    await click(toggle!);
    expect(get("row-customer-group-c1")?.getAttribute("data-expanded")).toBe("true");
    expect(get("row-property-p1")).not.toBeNull();
    expect(get("row-property-p2")).not.toBeNull();
    expect(get("row-property-p3")).toBeNull();

    // Collapse again: rows go back away. Without round-tripping the
    // operator can't undo a misclick without a refresh.
    await click(get("button-toggle-customer-group-c1")!);
    expect(get("row-customer-group-c1")?.getAttribute("data-expanded")).toBe("false");
    expect(get("row-property-p1")).toBeNull();
  });

  it("badge counts reflect the active filters (Inactive status hides p2)", async () => {
    // Status filter ships from localStorage hydration so we don't need
    // to plumb through the mocked Select handlers — sets statusFilter
    // = "Active" before mount.
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ statusFilter: "Active" }),
    );

    await renderPage();

    // p2 is Inactive → filtered out → c1's group should now report 1
    // property (Maple), not 2.
    expect(get("badge-customer-group-count-c1")?.textContent).toContain("1");
    // c2 is unaffected (both Active).
    expect(get("badge-customer-group-count-c2")?.textContent).toContain("2");
  });

  it("auto-expands the scoped customer's group and hides every other group", async () => {
    // Deep-link with ?customer=c2 — same contract the customer chip
    // uses elsewhere in the app.
    window.history.replaceState({}, "", "/properties?customer=c2");

    await renderPage();

    // c2's group is the only one in view (filtered upstream) and it's
    // auto-expanded so the operator sees their properties without a
    // second click.
    expect(get("row-customer-group-c1")).toBeNull();
    expect(get("row-customer-group-c2")).not.toBeNull();
    expect(get("row-customer-group-c2")?.getAttribute("data-expanded")).toBe("true");
    expect(get("row-property-p3")).not.toBeNull();
    expect(get("row-property-p4")).not.toBeNull();

    // Unrelated customer's properties stay out of the DOM entirely —
    // hidden via `filtered`, not just collapsed.
    expect(get("row-property-p1")).toBeNull();
  });

  it("auto-expands every group containing a search match", async () => {
    await renderPage();

    // Sanity: nothing expanded yet.
    expect(get("row-customer-group-c1")?.getAttribute("data-expanded")).toBe("false");
    expect(get("row-customer-group-c2")?.getAttribute("data-expanded")).toBe("false");

    const searchInput = container.querySelector(
      '[data-testid="input-search-properties"]',
    ) as HTMLInputElement;
    expect(searchInput).not.toBeNull();

    // Search for "Pine" — only matches one property under c2. The c2
    // group must auto-expand so the match is visible without the
    // operator hunting for which collapsed group hides it; c1 stays
    // out of the DOM because it has no matches.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(searchInput, "Pine");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(get("row-customer-group-c1")).toBeNull();
    expect(get("row-customer-group-c2")?.getAttribute("data-expanded")).toBe("true");
    expect(get("row-property-p3")).not.toBeNull();
    expect(get("row-property-p4")).toBeNull();
  });

  it("persists the expanded set under the Properties prefs key", async () => {
    await renderPage();

    await click(get("button-toggle-customer-group-c2")!);

    const raw = window.localStorage.getItem(PREFS_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    expect(parsed.expandedCustomerIds).toEqual(["c2"]);

    // Round-trip: collapsing should clear the persisted entry entirely
    // (no stale `[]` left behind once the toolbar is back to defaults).
    await click(get("button-toggle-customer-group-c2")!);
    expect(window.localStorage.getItem(PREFS_KEY)).toBeNull();
  });

  it("auto-expands when only one customer group is visible (single-group shortcut)", async () => {
    // Drop c2 entirely so only one customer group exists. The grouping
    // header would otherwise be a single mystery row with nothing to
    // hide behind a collapse — the page intentionally auto-expands in
    // that case so the operator isn't forced to click to see anything.
    state.customers = state.customers.filter((c) => c.id === "c1");
    state.properties = state.properties.filter((p) => p.customerId === "c1");

    await renderPage();

    // No persisted expanded set, no scope, no search — but the lone
    // group still shows expanded by virtue of being the only one.
    expect(get("row-customer-group-c1")?.getAttribute("data-expanded")).toBe("true");
    expect(get("row-property-p1")).not.toBeNull();
    expect(get("row-property-p2")).not.toBeNull();
  });

  it("surfaces a shared-housing property under every customer in sharedWithCustomerIds (task #311)", async () => {
    // Ridge Motor Inn is shared by Penda + Trienda — modeled as one
    // property row whose `customerId` is the primary tenant and whose
    // `sharedWithCustomerIds` lists the additional tenants. The
    // Properties page must surface it under EACH customer's group, not
    // just the primary, so scoping by either customer shows the
    // shared property.
    state.customers = [
      { id: "c1", name: "Penda", contactName: "", email: "", phone: "", notes: "" },
      { id: "c2", name: "Trienda", contactName: "", email: "", phone: "", notes: "" },
      { id: "c3", name: "Other Co", contactName: "", email: "", phone: "", notes: "" },
    ];
    state.properties = [
      baseProperty({
        id: "p-ridge",
        customerId: "c1",
        sharedWithCustomerIds: ["c2"],
        name: "Ridge Motor Inn",
      }),
      // A non-shared property under c3 so the test can assert the
      // shared row does NOT bleed into unrelated groups.
      baseProperty({ id: "p-other", customerId: "c3", name: "Other House" }),
    ];

    await renderPage();

    // The shared property's row appears under both Penda and Trienda
    // groups (each gets its own row instance via React keys), and the
    // group counts include it on both sides.
    expect(get("row-customer-group-c1")).not.toBeNull();
    expect(get("row-customer-group-c2")).not.toBeNull();
    expect(get("badge-customer-group-count-c1")?.textContent).toContain("1");
    expect(get("badge-customer-group-count-c2")?.textContent).toContain("1");
    // It does NOT leak into Other Co's group.
    expect(get("badge-customer-group-count-c3")?.textContent).toContain("1");

    // Scoping to Trienda (c2) — historically would have hidden Ridge
    // Motor Inn because its primary customerId is Penda. Now the
    // customer filter checks sharedWithCustomerIds too, so the row
    // surfaces and the group auto-expands the property row.
    window.history.replaceState({}, "", "/properties?customer=c2");
    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    await renderPage();

    expect(get("row-customer-group-c1")).toBeNull();
    expect(get("row-customer-group-c3")).toBeNull();
    expect(get("row-customer-group-c2")?.getAttribute("data-expanded")).toBe("true");
    expect(get("row-property-p-ridge")).not.toBeNull();
  });

  it("hydrates the expanded set from localStorage on mount", async () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ expandedCustomerIds: ["c1"] }),
    );

    await renderPage();

    // c1 hydrates as expanded; c2 stays collapsed.
    expect(get("row-customer-group-c1")?.getAttribute("data-expanded")).toBe("true");
    expect(get("row-customer-group-c2")?.getAttribute("data-expanded")).toBe("false");
    expect(get("row-property-p1")).not.toBeNull();
    expect(get("row-property-p3")).toBeNull();
  });
});
