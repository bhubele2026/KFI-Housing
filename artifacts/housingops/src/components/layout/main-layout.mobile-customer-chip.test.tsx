import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// ── Mocks ───────────────────────────────────────────────────────────────
//
// The real Sidebar pulls in the auth + data-store + toast stack just to
// render its layout. None of that matters for the mobile header chip, so
// we replace it with a tiny marker. The same component is reused inside
// the drawer (Sheet) — seeing the marker portaled into document.body is
// how the "tap the chip opens the drawer" assertion knows the drawer
// actually opened.
vi.mock("./sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar-stub" />,
}));

// Lightweight data-store stand-in. CustomerScopeProvider needs `customers`
// and `isLoading`; MainLayout needs `customers` to look up the scoped
// customer's display name. Tests mutate `mockData.customers` between
// renders to drive the chip.
const mockData: {
  customers: { id: string; name: string }[];
  isLoading: boolean;
  dataIssues: { kind: string; label: string; dropped: number; rows: never[] }[];
} = {
  customers: [],
  isLoading: false,
  dataIssues: [],
};
vi.mock("@/context/data-store", () => ({
  useData: () => mockData,
}));

import { MainLayout } from "./main-layout";
import { AuthProvider } from "@/hooks/use-auth";
import { CustomerScopeProvider, useCustomerScope } from "@/context/customer-scope";

const AUTH_STORAGE_KEY = "housingops_auth";
const CHIP = "mobile-header-customer-scope";
const CHIP_NAME = "text-mobile-header-customer-name";
const CHIP_CLEAR = "button-mobile-header-clear-customer";
const DRAWER = "sidebar-mobile-drawer";

// Stand-in for the customer picker that the real Sidebar renders inside
// the mobile drawer. It calls into the same `useCustomerScope` context
// the production drawer uses, so a click here drives the chip through
// the exact code path the operator hits when they pick a customer from
// the drawer — not through a URL bootstrap.
function ScopePicker() {
  const { setCustomerId } = useCustomerScope();
  return (
    <button
      type="button"
      data-testid="harness-pick-c1"
      onClick={() => setCustomerId("c1")}
    >
      pick c1
    </button>
  );
}

function Harness() {
  return (
    <AuthProvider>
      <CustomerScopeProvider>
        <MainLayout>
          <div data-testid="page-body">page-body</div>
          <ScopePicker />
        </MainLayout>
      </CustomerScopeProvider>
    </AuthProvider>
  );
}

describe("MainLayout mobile header customer chip (e2e)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let originalInnerWidth: number;

  beforeEach(() => {
    // Pin the viewport to a phone width. Tailwind's `md:hidden` /
    // `hidden md:flex` classes don't actually evaluate in jsdom, so the
    // mobile header element is in the DOM regardless — but setting the
    // viewport keeps the test honest about the surface it represents
    // and protects future code that might branch on window.innerWidth.
    originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390,
    });

    window.localStorage.clear();
    window.sessionStorage.clear();
    // MainLayout redirects to /login when not authenticated, so prime
    // the auth flag the same way the real login flow does.
    window.localStorage.setItem(AUTH_STORAGE_KEY, "true");

    mockData.customers = [
      { id: "c1", name: "Acme Co" },
      { id: "c2", name: "Globex" },
    ];
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
    // Radix portals (Sheet) sometimes leave nodes attached to body if a
    // test bails before unmount — clean them up so the next test starts
    // with a pristine document.
    document.body
      .querySelectorAll(`[data-testid="${DRAWER}"]`)
      .forEach((n) => n.remove());
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });
  });

  async function renderAt(url: string) {
    window.history.replaceState({}, "", url);
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
  }

  function chip() {
    return container.querySelector(`[data-testid="${CHIP}"]`);
  }
  function chipName() {
    return container.querySelector(`[data-testid="${CHIP_NAME}"]`);
  }
  function chipBody() {
    return container.querySelector(
      `[data-testid="${CHIP}"] button[aria-label^="Filtered by customer"]`,
    ) as HTMLButtonElement | null;
  }
  function clearBtn() {
    return container.querySelector(
      `[data-testid="${CHIP_CLEAR}"]`,
    ) as HTMLButtonElement | null;
  }
  function pickC1Btn() {
    return container.querySelector(
      `[data-testid="harness-pick-c1"]`,
    ) as HTMLButtonElement | null;
  }
  function drawer() {
    // Radix Sheet portals its content into document.body, not into our
    // local container — only renders when open.
    return document.body.querySelector(`[data-testid="${DRAWER}"]`);
  }

  it("hides the chip when no customer scope is set", async () => {
    await renderAt("/dashboard");

    expect(chip()).toBeNull();
    expect(chipName()).toBeNull();
    expect(clearBtn()).toBeNull();
  });

  it("renders the chip with the scoped customer's name when ?customer= is in the URL", async () => {
    await renderAt("/dashboard?customer=c1");

    expect(chip()).not.toBeNull();
    expect(chipName()?.textContent).toBe("Acme Co");
    expect(clearBtn()).not.toBeNull();
  });

  it("setting the scope through the drawer makes the chip appear and writes ?customer= to the URL", async () => {
    // Start with no scope — chip must be hidden.
    await renderAt("/dashboard");
    expect(chip()).toBeNull();
    expect(
      new URLSearchParams(window.location.search).get("customer"),
    ).toBeNull();

    // Operator picks a customer from the drawer. The picker calls the
    // same `useCustomerScope().setCustomerId(...)` the production
    // sidebar uses, so this drives the chip via the real context path
    // rather than via a URL bootstrap.
    await act(async () => {
      pickC1Btn()!.click();
    });

    expect(chip()).not.toBeNull();
    expect(chipName()?.textContent).toBe("Acme Co");
    expect(clearBtn()).not.toBeNull();
    expect(
      new URLSearchParams(window.location.search).get("customer"),
    ).toBe("c1");
  });

  it("clear button removes the chip and strips ?customer= from the URL", async () => {
    await renderAt("/dashboard?customer=c2");
    expect(chipName()?.textContent).toBe("Globex");

    await act(async () => {
      clearBtn()!.click();
    });

    expect(chip()).toBeNull();
    expect(chipName()).toBeNull();
    expect(clearBtn()).toBeNull();
    expect(
      new URLSearchParams(window.location.search).get("customer"),
    ).toBeNull();
  });

  it("tapping the chip body opens the navigation drawer", async () => {
    await renderAt("/dashboard?customer=c1");
    // Drawer is closed on first render — Radix Sheet only mounts its
    // portaled content while `open` is true.
    expect(drawer()).toBeNull();

    await act(async () => {
      chipBody()!.click();
    });

    expect(drawer()).not.toBeNull();
    // The chip itself stays put — opening the drawer must not clear or
    // hide the active customer scope.
    expect(chip()).not.toBeNull();
    expect(chipName()?.textContent).toBe("Acme Co");
    expect(
      new URLSearchParams(window.location.search).get("customer"),
    ).toBe("c1");
  });
});
