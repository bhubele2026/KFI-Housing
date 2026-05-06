import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// These tests pin down two behaviors of the global Leases page that are easy
// to break together because they share state:
//
//   1. Every property in the active customer scope shows up as a row — real
//      lease rows where they exist, and a clearly-marked "No lease yet"
//      placeholder row for properties without one. Placeholders are UI-only
//      (never persisted), so a regression that filtered them out would silently
//      hide the workflow this whole feature exists to enable.
//
//   2. Clicking a placeholder row navigates to `/leases/new?propertyId=…` so
//      the lease detail page can host the create flow with the property
//      pre-selected and locked. The previous flow opened an inline dialog with
//      a controlled `propertyId`; that wiring is gone. The navigation contract
//      now is the single thing the rest of the app depends on for placeholder
//      "Create lease" — if it regresses, the operator's primary path to
//      onboard a lease for an empty property silently breaks.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// framer-motion's motion.<tag> becomes a plain element of the same tag,
// preserving table semantics so `tbody tr` queries still resolve.
vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

// Replace dialog/popover portals with passthroughs so the page renders
// without crashing — none of the assertions inspect dialog content.
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

// Mock Radix Accordion so AccordionContent renders inline when open.
vi.mock("@/components/ui/accordion", () => {
  const React = require("react");
  type Ctx = {
    open: Set<string>;
    toggle: (v: string) => void;
  };
  const AccordionCtx = React.createContext<Ctx | null>(null);
  const ItemCtx = React.createContext<string | null>(null);
  function Accordion({
    children,
    ...rest
  }: { children?: ReactNode; [k: string]: unknown }) {
    const [open, setOpen] = React.useState<Set<string>>(new Set());
    const ctx: Ctx = {
      open,
      toggle: (v: string) =>
        setOpen((prev) => {
          const next = new Set(prev);
          if (next.has(v)) next.delete(v);
          else next.add(v);
          return next;
        }),
    };
    return (
      <AccordionCtx.Provider value={ctx}>
        <div {...rest}>{children}</div>
      </AccordionCtx.Provider>
    );
  }
  function AccordionItem({
    value,
    children,
    ...rest
  }: { value: string; children?: ReactNode; [k: string]: unknown }) {
    return (
      <ItemCtx.Provider value={value}>
        <div data-accordion-item={value} {...rest}>{children}</div>
      </ItemCtx.Provider>
    );
  }
  function AccordionTrigger({
    children,
    ...rest
  }: { children?: ReactNode; [k: string]: unknown }) {
    const ctx = React.useContext(AccordionCtx);
    const value = React.useContext(ItemCtx);
    return (
      <button
        type="button"
        onClick={() => value && ctx?.toggle(value)}
        {...rest}
      >
        {children}
      </button>
    );
  }
  function AccordionContent({
    children,
    ...rest
  }: { children?: ReactNode; [k: string]: unknown }) {
    const ctx = React.useContext(AccordionCtx);
    const value = React.useContext(ItemCtx);
    if (!value || !ctx?.open.has(value)) return null;
    return <div {...rest}>{children}</div>;
  }
  return { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
});

vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: () => null,
  };
});

// Select mock — same shape used by the other Leases-area tests. Keeps the
// status / customer filters renderable without a real Radix portal, and
// preserves the on-screen "current value" so the placeholder count assertions
// stay deterministic.
vi.mock("@/components/ui/select", () => {
  function findTestId(node: unknown): string | null {
    if (node == null || typeof node === "string" || typeof node === "number") return null;
    if (Array.isArray(node)) {
      for (const c of node) {
        const id = findTestId(c);
        if (id) return id;
      }
      return null;
    }
    if (typeof node === "object" && isValidElement(node)) {
      const props = (node as { props: Record<string, unknown> }).props ?? {};
      if (typeof props["data-testid"] === "string") return props["data-testid"] as string;
      if ("children" in props) return findTestId(props.children);
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
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange?: (v: string) => void;
    children?: ReactNode;
  }) {
    const testid = findTestId(children);
    const items: Array<{ value: string; label: string }> = [];
    collectItems(children, items);
    return (
      <div data-testid={testid ?? undefined} data-current={value}>
        {items.map((it) => (
          <button
            key={it.value}
            type="button"
            data-select-item={it.value}
            onClick={() => onValueChange?.(it.value)}
          >
            {it.label}
          </button>
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

// Capture every AddLeaseDialog prop set the page renders so we can assert on
// the controlled-open + locked-propertyId combination triggered by the
// placeholder row's "Create lease" CTA. The mock renders nothing visible so
// the rest of the page DOM stays free of dialog noise.
type AddLeaseDialogPropsCapture = {
  propertyId?: string;
  open?: boolean;
};
const addLeaseDialogPropsLog: AddLeaseDialogPropsCapture[] = [];
vi.mock("@/components/add-lease-dialog", () => ({
  AddLeaseDialog: (props: AddLeaseDialogPropsCapture) => {
    addLeaseDialogPropsLog.push({
      propertyId: props.propertyId,
      open: props.open,
    });
    return null;
  },
}));

vi.mock("@/components/upload-lease-pdf-dialog", () => ({
  UploadLeasePdfDialog: () => null,
}));

// The real ImportMasterLeasesButton uses TanStack Query (useQueryClient and
// a generated mutation hook). The Leases page tests don't exercise that
// flow, and wiring up a QueryClientProvider just to satisfy this button
// would mean also stubbing out the generated API client. Stubbing the
// component itself is the smallest change that keeps these tests focused
// on the page's own behavior.
vi.mock("@/components/import-master-leases-button", () => ({
  ImportMasterLeasesButton: () => null,
}));

vi.mock("@/components/renew-lease-popover", () => ({
  RenewLeasePopover: ({ trigger }: { trigger?: ReactNode }) => <>{trigger}</>,
}));

// The leases page reads room-night logs to surface the hotel-rate
// "at risk this month" tile + per-row "Below min / No log yet" pill
// (task #319). Tests in this file don't exercise that signal directly,
// but the hook must still resolve cleanly — return an empty array.
vi.mock("@workspace/api-client-react", () => ({
  useListRoomNightLogs: () => ({ data: [] }),
}));

// ── Mock data store ─────────────────────────────────────────────────────
type State = {
  customers: Array<Record<string, unknown>>;
  properties: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
  rooms: Array<Record<string, unknown>>;
  beds: Array<Record<string, unknown>>;
  occupants: Array<Record<string, unknown>>;
  utilities: Array<Record<string, unknown>>;
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

// Three properties chosen so the placeholder logic has every interesting
// shape on screen at once:
//   p1 → has an Active lease       (real row)
//   p2 → has no leases              (placeholder row)
//   p3 → has no leases              (placeholder row, second one)
function makeFreshState(): State {
  return {
    customers: [
      { id: "c1", name: "Acme Co", contactName: "", email: "", phone: "", notes: "" },
    ],
    properties: [
      baseProperty({ id: "p1", customerId: "c1", name: "Maple", address: "1 Maple Way" }),
      baseProperty({ id: "p2", customerId: "c1", name: "Oak",   address: "2 Oak Ln" }),
      baseProperty({ id: "p3", customerId: "c1", name: "Pine",  address: "3 Pine Rd" }),
      // p4 hosts l2 below — a real lease row that has neither buyout nor
      // clauses, used to exercise the Terms-column empty cell and the
      // buyout filter's "Yes" path. Kept distinct from p2/p3 so the
      // existing placeholder-count tests still see two empty properties.
      baseProperty({ id: "p4", customerId: "c1", name: "Cedar", address: "4 Cedar St" }),
    ],
    leases: [
      {
        id: "l1",
        propertyId: "p1",
        startDate: "2025-01-01",
        endDate: "2026-01-01",
        monthlyRent: 1500,
        securityDeposit: 0,
        status: "Active",
        notes: "",
        // Extended lease fields exercised by the Terms-column / buyout-filter
        // tests below. l1 has buyout + clauses, l2 below has neither so the
        // filter and badge render code paths are both covered.
        clauses: "Tenant must give 30 days notice.",
        buyoutAvailable: true,
        buyoutCost: 5000,
      },
      {
        // l2 belongs to p4 (Cedar) so p2 and p3 stay placeholder-only.
        // Crucially, l2 has NO buyout and NO clauses so the buyout filter
        // ("Yes" hides this row) and the Terms-column empty-state both
        // have a target.
        id: "l2",
        propertyId: "p4",
        startDate: "2025-02-01",
        endDate: "2026-02-01",
        monthlyRent: 2000,
        securityDeposit: 0,
        status: "Active",
        notes: "",
        clauses: "",
        buyoutAvailable: false,
        buyoutCost: null,
      },
    ],
    rooms: [],
    beds: [],
    occupants: [],
    utilities: [],
  };
}

let state: State = makeFreshState();

const storeMocks = {
  addLease: vi.fn(),
  updateLease: vi.fn(),
  deleteLease: vi.fn(),
};

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    isLoading: false,
    ...storeMocks,
  }),
  RoomInUseError: class RoomInUseError extends Error {},
}));

// Use the real customer-scope context — it reads from sessionStorage which is
// available in jsdom and defaults to ALL_CUSTOMERS, so no extra setup needed.

// Imports that consume the mocks above MUST come after vi.mock calls.
import Leases from "./leases";
import { CustomerScopeProvider } from "@/context/customer-scope";

// Vitest's React-19 act helper looks for this global; without it the page
// hits an "act(...) is not configured" warning that hides real failures.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeHarness(initialPath: string) {
  const memory = memoryLocation({ path: initialPath, record: true });
  function Harness() {
    return (
      <CustomerScopeProvider>
        <Router hook={memory.hook}>
          <Switch>
            <Route path="/leases" component={Leases} />
          </Switch>
        </Router>
      </CustomerScopeProvider>
    );
  }
  return { memory, Harness };
}

// ── Tests ───────────────────────────────────────────────────────────────
describe("Leases page — placeholder rows for properties without a lease", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeFreshState();
    Object.values(storeMocks).forEach((m) => m.mockReset());
    toastMock.mockReset();
    addLeaseDialogPropsLog.length = 0;
    // Make sure the customer-scope context starts at "All Customers" so the
    // placeholder query covers every property.
    sessionStorage.clear();
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
    const { Harness } = makeHarness("/leases");
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
  }

  // We also need a page renderer that exposes the memoryLocation handle so
  // navigation-based tests below can read the recorded history and check
  // that clicking a row actually pushed onto the router.
  async function renderPageWithMemory() {
    const memory = memoryLocation({ path: "/leases", record: true });
    function Harness() {
      return (
        <CustomerScopeProvider>
          <Router hook={memory.hook}>
            <Switch>
              <Route path="/leases" component={Leases} />
            </Switch>
          </Router>
        </CustomerScopeProvider>
      );
    }
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
    return memory;
  }

  it("clicking a lease row navigates to the lease detail page with `?from=/leases` (so the back link can return here)", async () => {
    // Row-level navigation is the primary way to open a lease — the
    // explicit ExternalLink button is a fallback for mouse-only users.
    // The query param is what lets the lease detail page know to
    // restore "Back to Leases" on the breadcrumb.
    const memory = await renderPageWithMemory();

    const row = container.querySelector(
      '[data-testid="row-lease-l1"]',
    ) as HTMLTableRowElement;
    expect(row).not.toBeNull();

    await act(async () => row.click());

    // memoryLocation.history records the path string after each navigate().
    // The most recent entry should be the lease detail URL with the from
    // origin attached.
    const last = memory.history[memory.history.length - 1];
    expect(last).toBe(`/leases/l1?from=${encodeURIComponent("/leases")}`);
  });

  it("renders no inline editors on lease rows (the list is read-only; editing happens on the lease detail page)", async () => {
    // The whole list is now navigation-only — no inline rent / status / notes
    // editors. A regression that re-introduced an editor would also re-introduce
    // the row-vs-editor click conflict that motivated this redesign, so the
    // simplest guard is: assert the editor testids do not exist at all.
    await renderPage();

    expect(
      container.querySelector('[data-testid="inline-lease-rent-l1"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inline-lease-notes-l1"]'),
    ).toBeNull();
    // No status select on the row either — status is read-only badge only.
    expect(
      container.querySelector('[data-testid="select-lease-status-l1"]'),
    ).toBeNull();
  });

  it("renders one placeholder row for every property that has no lease, alongside the real lease rows", async () => {
    // Three properties total: one with a real lease (p1) and two without
    // (p2, p3). The page should show one row of each kind in the table —
    // a regression that filtered out placeholders would only show p1.
    await renderPage();

    // Real lease row is present.
    expect(
      container.querySelector('[data-testid="row-lease-l1"]'),
    ).not.toBeNull();

    // Both placeholder rows are present, identifiable by per-property testid.
    const placeholderP2 = container.querySelector(
      '[data-testid="row-lease-placeholder-p2"]',
    );
    const placeholderP3 = container.querySelector(
      '[data-testid="row-lease-placeholder-p3"]',
    );
    expect(placeholderP2).not.toBeNull();
    expect(placeholderP3).not.toBeNull();

    // The placeholder for p2 carries the property's name, address, and the
    // "No lease yet" status pill — without the name the operator wouldn't
    // know which property the row is for.
    expect(placeholderP2!.textContent).toContain("Oak");
    expect(placeholderP2!.textContent).toContain("2 Oak Ln");
    expect(placeholderP2!.textContent).toContain("No lease yet");

    // The footer count line tells the operator how many properties still
    // need a lease — distinct from the existing "X of Y leases" count.
    expect(
      container.querySelector('[data-testid="text-placeholder-count"]')?.textContent,
    ).toContain("2");
  });

  it("does NOT render placeholder rows for properties that already have at least one lease", async () => {
    // p1 has an Active lease, so no placeholder should ever exist for it
    // even though only one lease is on file. A regression that dedupes
    // by status (instead of by "any lease") would render a placeholder
    // here and double the page's row count.
    await renderPage();

    expect(
      container.querySelector('[data-testid="row-lease-placeholder-p1"]'),
    ).toBeNull();
  });

  it("clicking a placeholder row navigates to /leases/new with the property locked via ?propertyId and the origin threaded through ?from", async () => {
    // The placeholder row IS the CTA now — the whole row is clickable and
    // takes the operator to the create-mode lease detail page. The query
    // string carries (a) the locked property id and (b) the origin so the
    // back link returns here. Both pieces are required: without propertyId
    // the create form would render with no property pre-selected; without
    // `from` the back button would default to /leases even when the user
    // came from a property's leases tab.
    const memory = await renderPageWithMemory();

    const placeholderRow = container.querySelector(
      '[data-testid="row-lease-placeholder-p2"]',
    ) as HTMLTableRowElement | null;
    expect(placeholderRow).not.toBeNull();

    await act(async () => placeholderRow!.click());

    const last = memory.history[memory.history.length - 1];
    expect(last).toBe(
      `/leases/new?propertyId=p2&from=${encodeURIComponent("/leases")}`,
    );
  });

  // ── Terms column: at-a-glance buyout/clauses signals (task #122) ─────
  // The Terms column surfaces two extended lease fields without forcing the
  // operator to open the lease detail page. l1 has both a buyout (with cost)
  // and clauses; l2 has neither. The badge testids are stable so the cell
  // can be asserted without coupling to copy.
  it("renders the Buyout and Clauses badges in the Terms column for a lease that has them", async () => {
    await renderPage();

    const buyoutBadge = container.querySelector(
      '[data-testid="badge-lease-buyout-l1"]',
    );
    const clausesBadge = container.querySelector(
      '[data-testid="badge-lease-clauses-l1"]',
    );

    expect(buyoutBadge).not.toBeNull();
    // The buyout badge embeds the formatted cost so operators can triage
    // without opening the lease.
    expect(buyoutBadge!.textContent).toContain("$5,000");

    expect(clausesBadge).not.toBeNull();
    expect(clausesBadge!.textContent).toContain("Clauses");
  });

  it("renders an em-dash placeholder in the Terms column for a lease with no buyout and no clauses", async () => {
    // The empty-state matters because, without it, the column would
    // silently collapse and the table layout would jitter row-to-row.
    // l2 is the lease that intentionally has neither field set.
    await renderPage();

    expect(
      container.querySelector('[data-testid="lease-terms-empty-l2"]'),
    ).not.toBeNull();
    // And it must NOT carry the badge testids — those would imply we
    // surfaced data that isn't there.
    expect(
      container.querySelector('[data-testid="badge-lease-buyout-l2"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="badge-lease-clauses-l2"]'),
    ).toBeNull();
  });

  // ── Buyout filter (task #122) ────────────────────────────────────────
  // The dropdown lives next to Status; "Yes" / "No" map directly onto the
  // lease's buyoutAvailable flag. Placeholder rows are hidden whenever a
  // value-based filter is active because they have no lease state to test.
  it("filtering by Buyout=Yes hides leases without a buyout AND hides placeholder rows", async () => {
    await renderPage();

    // Sanity: both real lease rows are rendered before filtering, and the
    // placeholder rows for p2/p3 are present too.
    expect(container.querySelector('[data-testid="row-lease-l1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-lease-l2"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="row-lease-placeholder-p2"]'),
    ).not.toBeNull();

    // Click the "Buyout available" option in our select-mock.
    const yesOption = container.querySelector(
      '[data-testid="select-buyout-filter"] [data-select-item="Yes"]',
    ) as HTMLButtonElement | null;
    expect(yesOption).not.toBeNull();
    await act(async () => {
      yesOption!.click();
    });

    // l1 has buyout → still visible. l2 doesn't → gone. Placeholders are
    // suppressed while a value filter is active.
    expect(container.querySelector('[data-testid="row-lease-l1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-lease-l2"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="row-lease-placeholder-p2"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="row-lease-placeholder-p3"]'),
    ).toBeNull();
  });

  // ── Needs review filter (?needsReview=1) (tasks #276, #301) ──────────
  // The dashboard "Needs review" tile deep-links to /leases?needsReview=1
  // and the Leases page is expected to (a) filter to leases the master
  // importer flagged via `needsReview: true` on first paint and (b)
  // reflect that selection in the "Needs review" select so the operator
  // can see why the list is short. Without the URL→state sync the deep
  // link would land on a full list with no indication of why some rows
  // are missing.
  it("?needsReview=1 filters to importer-flagged leases and the Needs review select stays in sync", async () => {
    // Add a third lease flagged by the master importer (task #301). l1 and
    // l2 both have `needsReview: false` (the default), so they should be
    // hidden when the filter is active.
    state.leases.push({
      id: "l3",
      propertyId: "p2",
      startDate: "2025-03-01",
      endDate: "",
      monthlyRent: 1000,
      securityDeposit: 0,
      // Status intentionally NOT Active/Upcoming — the renewal-alerts
      // panel computes days-until-end on those statuses and would throw
      // on this row's empty endDate. Real "needs review" leases tend
      // to be partial imports without enough data to be active anyway.
      status: "Expired",
      notes: "Needs review: weekly cost not numeric: \"$69.23???\". Source: master file row 12.",
      clauses: "",
      buyoutAvailable: false,
      buyoutCost: null,
      weeklyCost: 0,
      vendor: "",
      needsReview: true,
    });

    const { Harness } = makeHarness("/leases?needsReview=1");
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });

    // Only the importer-flagged lease (l3) is visible.
    expect(container.querySelector('[data-testid="row-lease-l3"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-lease-l1"]')).toBeNull();
    expect(container.querySelector('[data-testid="row-lease-l2"]')).toBeNull();

    // The Needs review select reflects the URL state — without this a
    // deep-link from the dashboard would silently leave the dropdown on
    // "All End Dates", making the truncated list look like a bug.
    expect(
      container
        .querySelector('[data-testid="select-needs-review-filter"]')
        ?.getAttribute("data-current"),
    ).toBe("NeedsReview");
  });

  it("filtering by Buyout=No hides leases that have a buyout", async () => {
    await renderPage();

    const noOption = container.querySelector(
      '[data-testid="select-buyout-filter"] [data-select-item="No"]',
    ) as HTMLButtonElement | null;
    expect(noOption).not.toBeNull();
    await act(async () => {
      noOption!.click();
    });

    // l1 has buyout → hidden. l2 has none → still visible.
    expect(container.querySelector('[data-testid="row-lease-l1"]')).toBeNull();
    expect(container.querySelector('[data-testid="row-lease-l2"]')).not.toBeNull();
  });

  it("by-customer view shows one collapsible row per customer with at least one Active lease, badged with the active count", async () => {
    await renderPage();

    const byCustomerBtn = container.querySelector(
      '[data-testid="button-view-mode-by-customer"]',
    ) as HTMLButtonElement | null;
    expect(byCustomerBtn).not.toBeNull();
    await act(async () => byCustomerBtn!.click());

    const accordion = container.querySelector(
      '[data-testid="leases-by-customer-accordion"]',
    );
    expect(accordion).not.toBeNull();

    const item = container.querySelector(
      '[data-testid="accordion-customer-c1"]',
    );
    expect(item).not.toBeNull();
    // Customer name on the trigger and the active-count badge are the
    // two pieces of information the operator needs at-a-glance before
    // expanding the group.
    expect(item!.textContent).toContain("Acme Co");
    const badge = container.querySelector(
      '[data-testid="badge-customer-active-count-c1"]',
    );
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("2");

    expect(container.querySelector('[data-testid="row-lease-l1"]')).toBeNull();
  });

  it("expanding a customer group reveals that customer's leases via LeasesTable", async () => {
    await renderPage();

    await act(async () =>
      (container.querySelector(
        '[data-testid="button-view-mode-by-customer"]',
      ) as HTMLButtonElement).click(),
    );

    const trigger = container.querySelector(
      '[data-testid="accordion-customer-trigger-c1"]',
    ) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    await act(async () => trigger!.click());

    expect(container.querySelector('[data-testid="row-lease-l1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-lease-l2"]')).not.toBeNull();

    // Switching back to flat keeps placeholders reachable.
    await act(async () =>
      (container.querySelector(
        '[data-testid="button-view-mode-flat"]',
      ) as HTMLButtonElement).click(),
    );
    expect(
      container.querySelector('[data-testid="row-lease-placeholder-p2"]'),
    ).not.toBeNull();
  });

  it("by-customer view respects the status filter — Status=Expired collapses every group", async () => {
    await renderPage();
    await act(async () =>
      (container.querySelector(
        '[data-testid="button-view-mode-by-customer"]',
      ) as HTMLButtonElement).click(),
    );
    expect(
      container.querySelector('[data-testid="accordion-customer-c1"]'),
    ).not.toBeNull();
    const expiredOption = container.querySelector(
      '[data-testid="select-status-filter"] [data-select-item="Expired"]',
    ) as HTMLButtonElement | null;
    expect(expiredOption).not.toBeNull();
    await act(async () => expiredOption!.click());

    expect(
      container.querySelector('[data-testid="accordion-customer-c1"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="leases-by-customer-empty"]'),
    ).not.toBeNull();
  });

  it("by-customer view respects the customer filter — selecting one customer hides every other group", async () => {
    state.customers.push({
      id: "c2",
      name: "Beta Co",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    state.properties.push(
      baseProperty({
        id: "pY",
        customerId: "c2",
        name: "Birch",
        address: "9 Birch Ct",
      }),
    );
    state.leases.push({
      id: "lActiveBeta",
      propertyId: "pY",
      startDate: "2025-06-01",
      endDate: "2026-06-01",
      monthlyRent: 1100,
      securityDeposit: 0,
      status: "Active",
      notes: "",
      clauses: "",
      buyoutAvailable: false,
      buyoutCost: null,
    });

    await renderPage();
    await act(async () =>
      (container.querySelector(
        '[data-testid="button-view-mode-by-customer"]',
      ) as HTMLButtonElement).click(),
    );
    expect(
      container.querySelector('[data-testid="accordion-customer-c1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="accordion-customer-c2"]'),
    ).not.toBeNull();

    const c1Option = container.querySelector(
      '[data-testid="select-customer-filter"] [data-select-item="c1"]',
    ) as HTMLButtonElement | null;
    expect(c1Option).not.toBeNull();
    await act(async () => c1Option!.click());

    expect(
      container.querySelector('[data-testid="accordion-customer-c1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="accordion-customer-c2"]'),
    ).toBeNull();
  });

  it("by-customer view hides customers whose only filtered leases are non-Active", async () => {
    state.customers.push({
      id: "c2",
      name: "Beta Co",
      contactName: "",
      email: "",
      phone: "",
      notes: "",
    });
    state.properties.push(
      baseProperty({
        id: "pX",
        customerId: "c2",
        name: "Birch",
        address: "9 Birch Ct",
      }),
    );
    state.leases.push({
      id: "lExpired",
      propertyId: "pX",
      startDate: "2024-01-01",
      endDate: "2024-12-31",
      monthlyRent: 1200,
      securityDeposit: 0,
      status: "Expired",
      notes: "",
      clauses: "",
      buyoutAvailable: false,
      buyoutCost: null,
    });

    await renderPage();
    await act(async () =>
      (container.querySelector(
        '[data-testid="button-view-mode-by-customer"]',
      ) as HTMLButtonElement).click(),
    );

    expect(
      container.querySelector('[data-testid="accordion-customer-c1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="accordion-customer-c2"]'),
    ).toBeNull();
  });
});
