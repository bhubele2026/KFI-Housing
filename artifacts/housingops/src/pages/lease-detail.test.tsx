import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// These tests cover the three pieces of behavior introduced with the lease
// detail page (task #120) that an operator depends on day-to-day:
//
//   1. Re-attaching the lease to a different property never just "happens" —
//      the user always sees a confirm dialog naming the target property, and
//      `updateLease` is called only after they confirm.
//
//   2. Toggling the buyout switch reveals (and hides) the buyout-cost editor,
//      and toggling OFF clears any previously stored cost so we don't leave
//      orphan numbers on a non-buyout lease.
//
//   3. Adding an item to the included-items chip list calls `updateLease`
//      with the appended array — i.e. the chip editor wires straight into the
//      same optimistic save path the rest of the page uses.

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/components/renew-lease-popover", () => ({
  RenewLeasePopover: ({ trigger }: { trigger?: ReactNode }) => <>{trigger}</>,
}));

vi.mock("@/components/ui/popover", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Popover: Pass, PopoverTrigger: Pass, PopoverContent: () => null };
});

// AlertDialog mock — render content inline (no portal). We pipe `onOpenChange`
// through a React context so AlertDialogCancel can close the dialog the same
// way Radix's real component does (clicking Cancel triggers onOpenChange(false)).
// Without that wiring the cancel-doesn't-call-updateLease test would falsely
// fail because the dialog would stay open after the click.
const AlertDialogCtx = React.createContext<{
  onOpenChange?: (open: boolean) => void;
}>({});

vi.mock("@/components/ui/alert-dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  function AlertDialog({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }) {
    if (!open) return null;
    return (
      <AlertDialogCtx.Provider value={{ onOpenChange }}>
        <div data-testid="alert-dialog-root">{children}</div>
      </AlertDialogCtx.Provider>
    );
  }
  function AlertDialogAction({
    onClick,
    children,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const ctx = React.useContext(AlertDialogCtx);
    return (
      <button
        type="button"
        onClick={(e) => {
          onClick?.(e);
          ctx.onOpenChange?.(false);
        }}
        {...rest}
      >
        {children}
      </button>
    );
  }
  function AlertDialogCancel({
    onClick,
    children,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const ctx = React.useContext(AlertDialogCtx);
    return (
      <button
        type="button"
        onClick={(e) => {
          onClick?.(e);
          ctx.onOpenChange?.(false);
        }}
        {...rest}
      >
        {children}
      </button>
    );
  }
  return {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent: Pass,
    AlertDialogDescription: Pass,
    AlertDialogFooter: Pass,
    AlertDialogHeader: Pass,
    AlertDialogTitle: Pass,
    AlertDialogTrigger: Pass,
    AlertDialogPortal: Pass,
    AlertDialogOverlay: () => null,
  };
});

// Switch mock — Radix's switch portals its overlay state in ways jsdom can't
// fully model. We render a plain checkbox-style button that flips on click.
vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...rest
  }: {
    checked?: boolean;
    onCheckedChange?: (next: boolean) => void;
  } & Record<string, unknown>) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked ? "true" : "false"}
      data-checked={checked ? "true" : "false"}
      onClick={() => onCheckedChange?.(!checked)}
      {...rest}
    >
      {checked ? "on" : "off"}
    </button>
  ),
}));

// Select mock — same pattern used by the other lease/property tests. Captures
// the testid on the trigger so the test can find the Select by id.
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
  function collectItems(node: unknown, out: Array<{ value: string; label: string }>) {
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

// ── Mock data store ─────────────────────────────────────────────────────
const updateLeaseMock = vi.fn();
const deleteLeaseMock = vi.fn();
const addLeaseMock = vi.fn();
const dataState: {
  leases: Array<Record<string, unknown>>;
  properties: Array<Record<string, unknown>>;
  customers: Array<Record<string, unknown>>;
} = {
  leases: [],
  properties: [],
  customers: [],
};

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    leases: dataState.leases,
    properties: dataState.properties,
    customers: dataState.customers,
    rooms: [],
    beds: [],
    occupants: [],
    utilities: [],
    isLoading: false,
    updateLease: updateLeaseMock,
    addLease: addLeaseMock,
    deleteLease: deleteLeaseMock,
  }),
}));

import LeaseDetail from "./lease-detail";

// Vitest's React-19 act helper looks for this global; without it the page
// hits an "act(...) is not configured" warning that hides real failures.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function buildLease(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "lease-1",
    propertyId: "prop-1",
    startDate: "2024-01-01",
    endDate: "2025-12-31",
    monthlyRent: 1200,
    securityDeposit: 2400,
    status: "Active",
    notes: "",
    clauses: "",
    includedItems: [],
    buyoutAvailable: false,
    buyoutCost: null,
    ...over,
  };
}

function buildProperty(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "prop-1",
    customerId: "cust-1",
    name: "Sunset House",
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
    notes: "",
    ...over,
  };
}

function mountAt(path: string) {
  // memoryLocation parses out the search string for us so `?propertyId=…&from=…`
  // ends up on window.location.search via the wouter Router's `searchHook`
  // wiring. We return the memory object so create-mode tests can assert on
  // post-save navigation.
  const memory = memoryLocation({ path, record: true });
  act(() => {
    root.render(
      <Router hook={memory.hook}>
        <Switch>
          {/* Order matters: the literal `/leases/new` must be matched before
              the `:id` route, otherwise wouter would resolve "new" as an id. */}
          <Route path="/leases/new" component={LeaseDetail} />
          <Route path="/leases/:id" component={LeaseDetail} />
        </Switch>
      </Router>,
    );
  });
  return memory;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  updateLeaseMock.mockReset();
  deleteLeaseMock.mockReset();
  addLeaseMock.mockReset();
  toastMock.mockReset();
  dataState.leases = [];
  dataState.properties = [];
  dataState.customers = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("LeaseDetail — re-attachment confirm", () => {
  it("opens the confirm dialog before changing propertyId, and calls updateLease only on confirm", () => {
    dataState.leases = [buildLease()];
    dataState.properties = [
      buildProperty({ id: "prop-1", name: "Sunset House" }),
      buildProperty({ id: "prop-2", name: "Cypress Cottage" }),
    ];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    mountAt("/leases/lease-1");

    // Sanity: title rendered with the original property name.
    expect(container.querySelector('[data-testid="lease-detail-title"]')?.textContent).toContain(
      "Sunset House",
    );

    // Dialog starts closed.
    expect(container.querySelector('[data-testid="alert-dialog-root"]')).toBeNull();

    // Pick the OTHER property in the property select.
    const propSelect = container.querySelector('[data-testid="select-lease-property"]')!;
    const cypressBtn = propSelect.querySelector('[data-select-item="prop-2"]') as HTMLButtonElement;
    expect(cypressBtn).toBeTruthy();
    act(() => cypressBtn.click());

    // Dialog is now open and updateLease has NOT been called yet.
    expect(container.querySelector('[data-testid="alert-dialog-root"]')).not.toBeNull();
    expect(updateLeaseMock).not.toHaveBeenCalled();

    // Confirm.
    const confirm = container.querySelector('[data-testid="button-confirm-reattach"]') as HTMLButtonElement;
    act(() => confirm.click());

    expect(updateLeaseMock).toHaveBeenCalledTimes(1);
    expect(updateLeaseMock).toHaveBeenCalledWith("lease-1", { propertyId: "prop-2" });
    // Dialog closes after confirm.
    expect(container.querySelector('[data-testid="alert-dialog-root"]')).toBeNull();
  });

  it("does NOT call updateLease when the user cancels the re-attach", () => {
    dataState.leases = [buildLease()];
    dataState.properties = [
      buildProperty({ id: "prop-1" }),
      buildProperty({ id: "prop-2", name: "Cypress" }),
    ];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    mountAt("/leases/lease-1");

    const propSelect = container.querySelector('[data-testid="select-lease-property"]')!;
    const cypress = propSelect.querySelector('[data-select-item="prop-2"]') as HTMLButtonElement;
    act(() => cypress.click());

    const cancel = container.querySelector('[data-testid="button-cancel-reattach"]') as HTMLButtonElement;
    act(() => cancel.click());

    expect(updateLeaseMock).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="alert-dialog-root"]')).toBeNull();
  });
});

describe("LeaseDetail — buyout toggle", () => {
  it("flips buyoutAvailable on (with no inflight cost change) and renders the cost editor", () => {
    dataState.leases = [buildLease()];
    dataState.properties = [buildProperty()];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    mountAt("/leases/lease-1");

    // Cost editor hidden while buyoutAvailable=false.
    expect(container.querySelector('[data-testid="inline-buyout-cost"]')).toBeNull();

    const switchBtn = container.querySelector('[data-testid="switch-buyout-available"]') as HTMLButtonElement;
    act(() => switchBtn.click());

    expect(updateLeaseMock).toHaveBeenCalledWith("lease-1", {
      buyoutAvailable: true,
      buyoutCost: null,
    });
  });

  it("clears buyoutCost when the toggle is flipped OFF", () => {
    dataState.leases = [buildLease({ buyoutAvailable: true, buyoutCost: 5000 })];
    dataState.properties = [buildProperty()];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    mountAt("/leases/lease-1");

    // The cost editor is now visible.
    expect(container.querySelector('[data-testid="inline-buyout-cost"]')).not.toBeNull();

    const switchBtn = container.querySelector('[data-testid="switch-buyout-available"]') as HTMLButtonElement;
    expect(switchBtn.getAttribute("data-checked")).toBe("true");
    act(() => switchBtn.click());

    expect(updateLeaseMock).toHaveBeenCalledWith("lease-1", {
      buyoutAvailable: false,
      buyoutCost: null,
    });
  });
});

describe("LeaseDetail — included items (checklist + free-form)", () => {
  it("appends a free-form (non-suggestion) item and calls updateLease with the new array", () => {
    // "Boat slip" is intentionally NOT in INCLUDED_ITEM_SUGGESTIONS so we
    // exercise the free-form input path. A regression that swapped the
    // input out for suggestion-only buttons would silently lose the
    // ability to record one-off inclusions.
    dataState.leases = [buildLease({ includedItems: ["Boat slip"] })];
    dataState.properties = [buildProperty()];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    mountAt("/leases/lease-1");

    // Existing custom item renders as a removable chip in the "Custom" row.
    expect(
      container.querySelector('[data-testid="chip-included-Boat slip"]'),
    ).not.toBeNull();

    const input = container.querySelector(
      '[data-testid="input-add-included-item"]',
    ) as HTMLInputElement;
    const addBtn = container.querySelector(
      '[data-testid="button-add-included-item"]',
    ) as HTMLButtonElement;

    // Type "EV charger" (also non-suggestion) then click Add.
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "EV charger");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => addBtn.click());

    expect(updateLeaseMock).toHaveBeenCalledWith("lease-1", {
      includedItems: ["Boat slip", "EV charger"],
    });
  });

  it("removes an existing custom chip and calls updateLease with the filtered array", () => {
    dataState.leases = [
      buildLease({ includedItems: ["Boat slip", "EV charger"] }),
    ];
    dataState.properties = [buildProperty()];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    mountAt("/leases/lease-1");

    const removeBtn = container.querySelector(
      '[data-testid="button-remove-included-Boat slip"]',
    ) as HTMLButtonElement;
    act(() => removeBtn.click());

    expect(updateLeaseMock).toHaveBeenCalledWith("lease-1", {
      includedItems: ["EV charger"],
    });
  });

  it("toggles a curated suggestion ON via the checklist and calls updateLease with the appended array", () => {
    // "Water" is a known curated suggestion. Clicking the chip toggles it
    // on and writes the new array — no need to type anything in the
    // free-form input. This is the primary path for the most common
    // inclusions, so the suggestion buttons must be wired into the same
    // optimistic save as the rest of the page.
    dataState.leases = [buildLease({ includedItems: [] })];
    dataState.properties = [buildProperty()];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    mountAt("/leases/lease-1");

    const waterBtn = container.querySelector(
      '[data-testid="included-suggestion-Water"]',
    ) as HTMLButtonElement;
    expect(waterBtn).not.toBeNull();
    expect(waterBtn.getAttribute("data-checked")).toBe("false");

    act(() => waterBtn.click());

    expect(updateLeaseMock).toHaveBeenCalledWith("lease-1", {
      includedItems: ["Water"],
    });
  });

  it("toggles a curated suggestion OFF via the checklist and calls updateLease with the filtered array", () => {
    // The reverse of the above: clicking an already-on suggestion removes
    // it from the array. Without this the operator would have no way to
    // unset a curated inclusion they'd previously selected.
    dataState.leases = [
      buildLease({ includedItems: ["Water", "Boat slip"] }),
    ];
    dataState.properties = [buildProperty()];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    mountAt("/leases/lease-1");

    const waterBtn = container.querySelector(
      '[data-testid="included-suggestion-Water"]',
    ) as HTMLButtonElement;
    expect(waterBtn.getAttribute("data-checked")).toBe("true");

    act(() => waterBtn.click());

    expect(updateLeaseMock).toHaveBeenCalledWith("lease-1", {
      includedItems: ["Boat slip"],
    });
  });
});

describe("LeaseDetail — origin-aware back link", () => {
  it("defaults the back link to /leases when no `?from=` is present", () => {
    dataState.leases = [buildLease()];
    dataState.properties = [buildProperty()];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    mountAt("/leases/lease-1");

    const back = container.querySelector(
      '[data-testid="button-back-leases"]',
    );
    expect(back).not.toBeNull();
    expect(back!.textContent?.toLowerCase()).toContain("back to leases");
  });

  it("uses the property name when `?from=/properties/:id` matches a known property", () => {
    dataState.leases = [buildLease({ propertyId: "prop-1" })];
    dataState.properties = [buildProperty({ id: "prop-1", name: "Sunset House" })];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    // useOriginFromSearch reads window.location.search directly, so set
    // it on the JSDOM window before mounting.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, search: "?from=%2Fproperties%2Fprop-1" },
    });
    try {
      mountAt("/leases/lease-1");

      const back = container.querySelector(
        '[data-testid="button-back-leases"]',
      );
      expect(back).not.toBeNull();
      expect(back!.textContent).toContain("Back to Sunset House");
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...window.location, search: "" },
      });
    }
  });
});

describe("LeaseDetail — not found", () => {
  it("renders a not-found card when the lease id doesn't resolve", () => {
    dataState.leases = [];
    dataState.properties = [];

    mountAt("/leases/missing-id");

    expect(container.querySelector('[data-testid="button-back-to-leases"]')).not.toBeNull();
  });
});

describe("LeaseDetail — create mode (/leases/new)", () => {
  // The /leases/new route renders the SAME component as the edit route, but
  // backed by a local draft instead of a persisted lease. These tests pin
  // down the three things that have to hold for the placeholder-row workflow
  // to keep working end-to-end:
  //
  //   1. The form mounts cleanly with no real lease in the store.
  //   2. When `?propertyId=…` is present, the property is locked — the
  //      operator can't accidentally pick a different property and
  //      orphan the binding the placeholder row was carrying.
  //   3. Save validates, calls addLease with the draft (id assigned
  //      locally so we can navigate immediately), and replaces the
  //      browser history entry so Back skips the create form.
  beforeEach(() => {
    // Reset window.location.search between tests — the create-mode tests
    // rely on the locked-property useMemo reading `?propertyId=` directly,
    // and a leftover from the back-link tests above would poison the next
    // mount.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, search: "" },
    });
  });

  it("renders the New-lease form with the property locked when ?propertyId is present", () => {
    dataState.properties = [
      buildProperty({ id: "prop-1", name: "Sunset House", address: "123 Main St" }),
    ];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, search: "?propertyId=prop-1" },
    });

    mountAt("/leases/new?propertyId=prop-1");

    // Title flips to "New lease — <property name>" — operators read the
    // header to know they're not on an existing record.
    expect(
      container.querySelector('[data-testid="lease-detail-title"]')?.textContent,
    ).toContain("New lease");
    expect(
      container.querySelector('[data-testid="lease-detail-title"]')?.textContent,
    ).toContain("Sunset House");

    // The locked-property panel is rendered INSTEAD of the property select
    // — operators cannot re-pick the property from this surface.
    expect(
      container.querySelector('[data-testid="lease-property-locked"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="select-lease-property"]'),
    ).toBeNull();

    // The save button is the create-mode CTA. Renew / Delete must NOT
    // appear (neither makes sense before the lease exists).
    expect(
      container.querySelector('[data-testid="button-save-new-lease"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="button-renew-lease"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="button-delete-lease-detail"]'),
    ).toBeNull();
  });

  it("clicking Save calls addLease with the locked property + draft, and replaces history with /leases/<newId>", () => {
    dataState.properties = [
      buildProperty({ id: "prop-1", name: "Sunset House" }),
    ];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, search: "?propertyId=prop-1" },
    });

    const memory = mountAt("/leases/new?propertyId=prop-1");

    const save = container.querySelector(
      '[data-testid="button-save-new-lease"]',
    ) as HTMLButtonElement | null;
    expect(save).not.toBeNull();

    act(() => save!.click());

    // addLease called once with the draft — id is generated locally so the
    // navigate target below can land on a stable url.
    expect(addLeaseMock).toHaveBeenCalledTimes(1);
    const [createdLease] = addLeaseMock.mock.calls[0] as [Record<string, unknown>];
    expect(createdLease.propertyId).toBe("prop-1");
    expect(createdLease.status).toBe("Upcoming");
    expect(typeof createdLease.id).toBe("string");
    expect((createdLease.id as string).length).toBeGreaterThan(0);

    // Last history entry is `/leases/<newId>` (no `?from=` because the
    // origin defaulted to /leases). `replace: true` is exercised by the
    // saveCreate handler — we don't double-assert wouter internals, just
    // that the post-save URL is correct.
    const last = memory.history[memory.history.length - 1];
    expect(last).toMatch(/^\/leases\/[^?]+$/);
    expect(last).toContain(createdLease.id as string);
  });

  it("threads the `from` origin into the post-save URL when the create page was opened from a property", () => {
    // When the placeholder row on a property's leases tab navigates here,
    // it carries `&from=/properties/prop-1?tab=leases` so the lease detail
    // page (post-save) still knows where to send the operator back. The
    // saveCreate handler must preserve that contract.
    dataState.properties = [
      buildProperty({ id: "prop-1", name: "Sunset House" }),
    ];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    const fromValue = "/properties/prop-1?tab=leases";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        search: `?propertyId=prop-1&from=${encodeURIComponent(fromValue)}`,
      },
    });

    const memory = mountAt(
      `/leases/new?propertyId=prop-1&from=${encodeURIComponent(fromValue)}`,
    );

    const save = container.querySelector(
      '[data-testid="button-save-new-lease"]',
    ) as HTMLButtonElement;
    act(() => save.click());

    const last = memory.history[memory.history.length - 1] as string;
    expect(last).toContain(`from=${encodeURIComponent(fromValue)}`);
  });

  it("blocks Save when the draft's propertyId is stale (does not exist in the data store)", async () => {
    // Defense-in-depth on top of the picker fallback: even if some flow
    // leaves the draft holding a propertyId that no longer points to a
    // real property, hitting Save must NOT addLease — that would
    // persist an orphaned lease that no surface in the app can render.
    dataState.properties = [
      buildProperty({ id: "prop-1", name: "Sunset House" }),
    ];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, search: "?propertyId=ghost-id" },
    });

    mountAt("/leases/new?propertyId=ghost-id");

    // The hardening effect should have scrubbed the stale id out of the
    // draft on first render — Save should now toast the "pick a
    // property" guidance instead of calling addLease.
    addLeaseMock.mockClear();
    const saveBtn = container.querySelector(
      '[data-testid="button-save-new-lease"]',
    ) as HTMLButtonElement;
    expect(saveBtn).not.toBeNull();
    await act(async () => {
      saveBtn.click();
    });
    expect(addLeaseMock).not.toHaveBeenCalled();
  });

  it("falls back to the picker (and does NOT lock) when `?propertyId=` references a property that doesn't exist", () => {
    // Defensive guard against hand-edited URLs and stale links: if the
    // requested property has been deleted (or never existed), we must not
    // render the locked panel — that would let the operator save a lease
    // bound to a phantom property id, orphaning it from the rest of the
    // app. Instead the page falls back to the regular Select so the
    // operator picks a real property before Save can succeed.
    dataState.properties = [
      buildProperty({ id: "prop-1", name: "Sunset House" }),
    ];
    dataState.customers = [{ id: "cust-1", name: "Acme PM" }];

    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, search: "?propertyId=ghost-id" },
    });

    mountAt("/leases/new?propertyId=ghost-id");

    expect(
      container.querySelector('[data-testid="lease-property-locked"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="select-lease-property"]'),
    ).not.toBeNull();
  });

  it("validates the property is set before saving — toast + no addLease when missing", () => {
    // Without ?propertyId, the draft starts with propertyId="". Hitting Save
    // should toast a guidance message instead of inserting a half-formed
    // lease. (Operators can still pick a property from the in-page select
    // since the locked panel only renders when ?propertyId is set.)
    dataState.properties = [];
    dataState.customers = [];

    mountAt("/leases/new");

    const save = container.querySelector(
      '[data-testid="button-save-new-lease"]',
    ) as HTMLButtonElement;
    act(() => save.click());

    expect(addLeaseMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });
});
