import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// These tests pin down the Customers listing's *search* behavior. The
// search filter lives in the `filtered` memo on customers.tsx and runs
// before the sort. It checks four fields with a case-insensitive
// substring match against the trimmed query:
//   • customer.name
//   • customer.contactName
//   • customer.email
//   • customer.phone
//
// Each field is easy to drop from the OR chain by accident, and the
// existing sort tests don't type into the search box at all, so a
// regression here would slip through. The fixture is hand-tuned so
// every field has a unique substring that only matches one customer —
// when a field is dropped from the filter, exactly the assertion for
// that field fails (instead of cascading false positives).

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

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

vi.mock("@/components/ui/alert-dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    AlertDialog: Pass,
    AlertDialogTrigger: Pass,
    AlertDialogContent: () => null,
    AlertDialogHeader: Pass,
    AlertDialogTitle: Pass,
    AlertDialogDescription: Pass,
    AlertDialogFooter: Pass,
    AlertDialogAction: Pass,
    AlertDialogCancel: Pass,
    AlertDialogPortal: Pass,
    AlertDialogOverlay: () => null,
  };
});

vi.mock("@/components/ui/tooltip", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Tooltip: Pass,
    TooltipTrigger: Pass,
    TooltipContent: () => null,
    TooltipProvider: Pass,
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

// ── Mock data store ──────────────────────────────────────────────────
//
// Each customer has a substring unique to one searchable field so we
// can prove that field is wired into the filter:
//
//   c1 → name     "Alpha Corp"        unique token: "alpha"
//   c2 → contact  "Mike Chen"         unique token: "chen"
//   c3 → email    "ops@gamma.co"      unique token: "gamma.co"
//   c1 → phone    "555-111-2222"      unique token: "111"  (overlaps
//                                     none of the other rows' phones)
//
// Names/contacts/emails/phones across the other customers are chosen
// so none of them accidentally collide with these tokens.
type State = {
  customers: Array<Record<string, unknown>>;
  properties: Array<Record<string, unknown>>;
  beds: Array<Record<string, unknown>>;
  occupants: Array<Record<string, unknown>>;
};

function makeFreshState(): State {
  const customer = (
    id: string,
    name: string,
    contactName: string,
    email: string,
    phone: string,
  ) => ({ id, name, contactName, email, phone, notes: "" });

  return {
    customers: [
      customer("c1", "Alpha Corp", "Dana Rivera", "billing@first.test", "555-111-2222"),
      customer("c2", "Northwind", "Mike Chen", "billing@second.test", "555-333-4444"),
      customer("c3", "Westwood", "Sara Patel", "ops@gamma.co", "555-777-8888"),
    ],
    properties: [],
    beds: [],
    occupants: [],
  };
}

let state: State = makeFreshState();

const storeMocks = {
  addCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
};

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    ...state,
    isLoading: false,
    ...storeMocks,
  }),
  CustomerInUseError: class CustomerInUseError extends Error {},
}));

import Customers from "./customers";

describe("Customers listing — search behavior", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    state = makeFreshState();
    Object.values(storeMocks).forEach((m) => m.mockReset());
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/customers");
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
      root.render(<Customers />);
    });
  }

  function rowOrder(): string[] {
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid^="row-customer-"]'),
    );
    return rows.map((r) => {
      const id = r.getAttribute("data-testid") ?? "";
      return id.replace("row-customer-", "");
    });
  }

  function countBadgeText(): string {
    // The badge sits next to the search input and is the only
    // "<n> of <m> customer(s)" string on the page.
    const span = Array.from(container.querySelectorAll("span")).find((s) =>
      /\d+ of \d+ customer/.test(s.textContent ?? ""),
    );
    if (!span) throw new Error("count badge not found");
    return (span.textContent ?? "").trim();
  }

  async function type(value: string) {
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="input-search-customers"]',
    );
    if (!input) throw new Error("search input not found");
    // React tracks the previous value on the DOM node; bypass that
    // tracker so a programmatic value assignment fires onChange.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("matches against the customer name", async () => {
    await renderPage();
    await type("alpha");
    expect(rowOrder()).toEqual(["c1"]);
  });

  it("matches against the primary contact name", async () => {
    await renderPage();
    await type("chen");
    expect(rowOrder()).toEqual(["c2"]);
  });

  it("matches against the email address", async () => {
    await renderPage();
    await type("gamma.co");
    expect(rowOrder()).toEqual(["c3"]);
  });

  it("matches against the phone number", async () => {
    await renderPage();
    await type("111");
    expect(rowOrder()).toEqual(["c1"]);
  });

  it("matches case-insensitively across fields", async () => {
    // Upper-case query should still hit lower-case stored values, and
    // a query with mixed casing against a name should match too. This
    // catches a regression where someone drops the `.toLowerCase()`
    // on either side of the comparison.
    await renderPage();
    await type("ALPHA");
    expect(rowOrder()).toEqual(["c1"]);
    await type("ChEn");
    expect(rowOrder()).toEqual(["c2"]);
  });

  it("trims surrounding whitespace before matching", async () => {
    // Without the trim, "  chen  " would match nothing because no
    // field contains those spaces. Locking this down protects users
    // who paste a value with stray whitespace.
    await renderPage();
    await type("  chen  ");
    expect(rowOrder()).toEqual(["c2"]);
  });

  it("updates the 'N of M customers' count badge as the filter narrows", async () => {
    await renderPage();
    expect(countBadgeText()).toBe("3 of 3 customers");
    await type("alpha");
    expect(countBadgeText()).toBe("1 of 3 customers");
    await type("zzz-no-match");
    expect(countBadgeText()).toBe("0 of 3 customers");
    await type("");
    expect(countBadgeText()).toBe("3 of 3 customers");
  });
});
