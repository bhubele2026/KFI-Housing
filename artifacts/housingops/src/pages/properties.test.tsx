import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// These tests pin down the Total Sqft column on the Properties listing.
// The column reads `computeRoomTotals(propRooms).totalSqft` per row, so
// regressions can come from three places:
//   • The helper itself (covered by mockData.test.ts).
//   • The page filtering rooms by propertyId.
//   • The cell's "0 → em-dash" placeholder branch.
// A test that only checked one row would let "rows quietly all show the
// same number" bugs through; we render multiple rows on purpose.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// framer-motion's motion.<tag> becomes a plain element of the same tag,
// preserving table semantics so `tbody tr` queries still resolve.
vi.mock("framer-motion", () => {
  const motionPropKeys = new Set([
    "initial", "animate", "exit", "transition",
    "whileHover", "whileTap", "whileFocus", "whileDrag", "whileInView",
    "variants", "layout", "layoutId", "drag", "dragConstraints",
    "onAnimationStart", "onAnimationComplete", "onUpdate", "viewport",
  ]);
  const motion = new Proxy({} as Record<string, unknown>, {
    get: (_t, tag: string) => {
      const Component = ({ children, ...rest }: Record<string, unknown> & { children?: ReactNode }) => {
        const dom: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rest)) {
          if (!motionPropKeys.has(k)) dom[k] = v;
        }
        return React.createElement(tag, dom, children);
      };
      return Component;
    },
  });
  return {
    motion,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

// Dialogs / hover cards / dropdowns all render via Radix portals which
// don't behave well in jsdom. Replace them with simple passthroughs;
// none of the tests below open or read them.
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

// Select mock — renders each SelectItem as a plain span so the toolbar
// doesn't crash. The test never picks a customer / status filter, so the
// Select doesn't need to be interactive.
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

// ── Mock data store ─────────────────────────────────────────────────────
//
// Three properties chosen so the Total Sqft column has every interesting
// shape on screen at once:
//   p1 → two rooms (200 + 320 = 520 sqft)
//   p2 → one room  (150 sqft)
//   p3 → no rooms  (must render the em-dash placeholder)
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

function makeFreshState(): State {
  return {
    customers: [
      { id: "c1", name: "Acme Co", contactName: "", email: "", phone: "", notes: "" },
    ],
    properties: [
      baseProperty({ id: "p1", customerId: "c1", name: "Maple" }),
      baseProperty({ id: "p2", customerId: "c1", name: "Oak" }),
      baseProperty({ id: "p3", customerId: "c1", name: "Pine" }),
    ],
    beds: [],
    leases: [],
    rooms: [
      { id: "r1", propertyId: "p1", name: "Master", sqft: 200, bathrooms: 1, monthlyRent: 1000 },
      { id: "r2", propertyId: "p1", name: "Guest",  sqft: 320, bathrooms: 1, monthlyRent: 1200 },
      { id: "r3", propertyId: "p2", name: "Only",   sqft: 150, bathrooms: 1, monthlyRent: 700 },
      // p3 intentionally has no rooms.
    ],
  };
}

let state: State = makeFreshState();

const storeMocks = {
  addProperty: vi.fn(),
  addCustomer: vi.fn(),
};

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    isLoading: false,
    ...storeMocks,
  }),
}));

// Imports that consume the mocks above MUST come after vi.mock calls.
import Properties from "./properties";
import { CustomerScopeProvider } from "@/context/customer-scope";

function PropertiesUnderTest() {
  return (
    <CustomerScopeProvider>
      <Properties />
    </CustomerScopeProvider>
  );
}

describe("Properties listing — Total Sqft column", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeFreshState();
    Object.values(storeMocks).forEach((m) => m.mockReset());
    // Each test starts on /properties with no persisted scope so the
    // CustomerScopeProvider defaults to "All Customers".
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

  function getTotalSqftCell(propertyId: string): HTMLElement {
    const el = container.querySelector(
      `[data-testid="cell-total-sqft-${propertyId}"]`,
    );
    if (!el) throw new Error(`cell-total-sqft-${propertyId} not found`);
    return el as HTMLElement;
  }

  it("renders the Total Sqft column header", async () => {
    // Sanity check: if a future refactor renames or removes the column
    // header (e.g. swaps it for "Square footage"), the per-row tests
    // below would still pass via testid but the user-facing label would
    // have silently changed. This guards the visible header text too.
    // The header now doubles as the $/sqft sort trigger, so its
    // visible label is "Total Sqft / $/sqft".
    await renderPage();
    const headerCells = Array.from(container.querySelectorAll("thead th"));
    const labels = headerCells.map((c) => c.textContent?.trim() ?? "");
    expect(labels).toContain("Total Sqft / $/sqft");
  });

  it("sums sqft across every room of a property (multi-room row)", async () => {
    // p1 has two rooms: 200 + 320 = 520. The cell renders
    // `520.toLocaleString()` followed by a "sqft" suffix.
    await renderPage();
    const cell = getTotalSqftCell("p1");
    expect(cell.textContent).toContain("520");
    expect(cell.textContent).toContain("sqft");
    // The em-dash placeholder must NOT appear on a non-zero row.
    expect(cell.textContent).not.toContain("—");
  });

  it("shows the single room's sqft on a single-room row", async () => {
    // Guards against a regression that summed across the wrong key
    // (e.g. summing every room in `state.rooms` instead of filtering
    // by propertyId) — that bug would put 670 (200+320+150) here.
    await renderPage();
    const cell = getTotalSqftCell("p2");
    expect(cell.textContent).toContain("150");
    expect(cell.textContent).toContain("sqft");
    expect(cell.textContent).not.toContain("520");
    expect(cell.textContent).not.toContain("670");
  });

  it("renders an em-dash (—) and no sqft suffix when the property has no rooms", async () => {
    // p3 has zero rooms → totalSqft is 0 → cell falls into the
    // placeholder branch. A regression that always rendered
    // "0.toLocaleString() sqft" would put "0 sqft" in front of the
    // user, which reads as "we measured this and it's zero" rather than
    // the truthful "we don't know yet".
    await renderPage();
    const cell = getTotalSqftCell("p3");
    expect(cell.textContent?.trim()).toBe("—");
    expect(cell.textContent).not.toContain("0 sqft");
    expect(cell.textContent).not.toContain("sqft");
  });

  it("formats sqft totals ≥ 1,000 with a thousands separator", async () => {
    // Bump p1's rooms so the total crosses 1,000 → toLocaleString should
    // add the comma. Without it the column reads "1234 sqft" instead of
    // "1,234 sqft" — a minor but visible regression we'd rather catch
    // here than from a customer screenshot.
    state.rooms = [
      { id: "r1", propertyId: "p1", name: "Master", sqft: 800, bathrooms: 1, monthlyRent: 0 },
      { id: "r2", propertyId: "p1", name: "Guest",  sqft: 434, bathrooms: 1, monthlyRent: 0 },
    ];
    await renderPage();

    const cell = getTotalSqftCell("p1");
    expect(cell.textContent).toContain("1,234");
    expect(cell.textContent).toContain("sqft");
  });
});
