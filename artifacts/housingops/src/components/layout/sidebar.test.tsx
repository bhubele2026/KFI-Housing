import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// ── Mocks ───────────────────────────────────────────────────────────────
//
// The sidebar pulls in a number of unrelated concerns (auth, toasts, the
// full data-store) just to render its layout. For the badge tests we only
// care about the customer scope wiring, so we replace everything else with
// minimal stand-ins.

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ logout: vi.fn(), login: vi.fn(), isAuthenticated: true }),
}));

// Mutable mock data so individual tests can rename / delete the active
// scoped customer between renders and verify the badge reacts.
const resetToSampleDataMock =
  vi.fn<(opts?: { onSuccess?: () => void }) => void>();
const mockData: {
  customers: { id: string; name: string }[];
  isLoading: boolean;
  resetToSampleData: typeof resetToSampleDataMock;
  exportData: () => unknown;
  importData: () => unknown;
} = {
  customers: [],
  isLoading: false,
  resetToSampleData: resetToSampleDataMock,
  exportData: vi.fn(),
  importData: vi.fn(),
};

vi.mock("@/context/data-store", () => ({
  useData: () => mockData,
  // The sidebar imports these for its import-data flow. The badge tests
  // never trigger that flow, so trivial stand-ins are enough.
  inspectImportPayload: vi.fn(),
  totalImportSummary: vi.fn(() => 0),
  UnsupportedImportError: class UnsupportedImportError extends Error {},
}));

import { Sidebar } from "./sidebar";
import { CustomerScopeProvider } from "@/context/customer-scope";

const BADGE = "sidebar-customer-scope";
const NAME = "text-sidebar-customer-name";
const CLEAR_BTN = "button-sidebar-clear-customer";

function SidebarUnderTest() {
  return (
    <CustomerScopeProvider>
      <Sidebar />
    </CustomerScopeProvider>
  );
}

describe("Sidebar customer scope badge", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    mockData.customers = [
      { id: "c1", name: "Acme Co" },
      { id: "c2", name: "Globex" },
    ];
    mockData.isLoading = false;
    window.sessionStorage.clear();
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
      root.render(<SidebarUnderTest />);
    });
  }

  // Force React to re-render the same tree so effects pick up the new
  // mockData.customers reference (simulates the data-store emitting a
  // fresh customers array after a rename or delete).
  async function rerender() {
    if (!root) throw new Error("rerender called before initial render");
    const r = root;
    await act(async () => {
      r.render(<SidebarUnderTest />);
    });
  }

  function badge() {
    return container.querySelector(`[data-testid="${BADGE}"]`);
  }
  function nameEl() {
    return container.querySelector(`[data-testid="${NAME}"]`);
  }
  function clearBtn() {
    return container.querySelector(
      `[data-testid="${CLEAR_BTN}"]`,
    ) as HTMLButtonElement | null;
  }

  it("hides the badge while scope is All Customers", async () => {
    await renderAt("/dashboard");

    expect(badge()).toBeNull();
    expect(nameEl()).toBeNull();
    expect(clearBtn()).toBeNull();
  });

  it("renders the badge with the active customer's name when a scope is set", async () => {
    await renderAt("/dashboard?customer=c1");

    expect(badge()).not.toBeNull();
    expect(nameEl()?.textContent).toBe("Acme Co");
    expect(clearBtn()).not.toBeNull();
  });

  it("renders the second customer's name when scoped to a different id", async () => {
    await renderAt("/dashboard?customer=c2");

    expect(badge()).not.toBeNull();
    expect(nameEl()?.textContent).toBe("Globex");
  });

  it("clear button resets the scope to All Customers and hides the badge", async () => {
    await renderAt("/dashboard?customer=c2");
    expect(nameEl()?.textContent).toBe("Globex");

    await act(async () => {
      clearBtn()!.click();
    });

    expect(badge()).toBeNull();
    expect(nameEl()).toBeNull();
    expect(clearBtn()).toBeNull();
    expect(
      new URLSearchParams(window.location.search).get("customer"),
    ).toBeNull();
  });

  it("badge follows the customer name when the underlying record is renamed", async () => {
    await renderAt("/dashboard?customer=c1");
    expect(nameEl()?.textContent).toBe("Acme Co");

    // Simulate the data-store emitting a renamed customer record. The
    // id stays the same so the scope must remain active and the badge
    // must show the new name.
    mockData.customers = [
      { id: "c1", name: "Acme Holdings" },
      { id: "c2", name: "Globex" },
    ];
    await rerender();

    expect(badge()).not.toBeNull();
    expect(nameEl()?.textContent).toBe("Acme Holdings");
    expect(
      new URLSearchParams(window.location.search).get("customer"),
    ).toBe("c1");
  });

  it("renders the dev-only Reset demo data button when import.meta.env.DEV is true", async () => {
    vi.stubEnv("DEV", true);
    try {
      await renderAt("/dashboard");
      const btn = container.querySelector(
        '[data-testid="button-reset-demo-data"]',
      );
      expect(btn).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("hides the dev-only Reset demo data button in production builds", async () => {
    vi.stubEnv("DEV", false);
    try {
      await renderAt("/dashboard");
      const btn = container.querySelector(
        '[data-testid="button-reset-demo-data"]',
      );
      expect(btn).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("opens the confirm dialog and triggers reset + success toast on confirm", async () => {
    vi.stubEnv("DEV", true);
    resetToSampleDataMock.mockReset();
    resetToSampleDataMock.mockImplementation((opts) => {
      opts?.onSuccess?.();
    });
    toastMock.mockReset();
    try {
      await renderAt("/dashboard");

      const openBtn = container.querySelector(
        '[data-testid="button-reset-demo-data"]',
      ) as HTMLButtonElement | null;
      expect(openBtn).not.toBeNull();

      await act(async () => {
        openBtn!.click();
      });

      // The AlertDialog portals into document.body, not the test container.
      const confirmBtn = document.querySelector(
        '[data-testid="button-reset-demo-confirm"]',
      ) as HTMLButtonElement | null;
      expect(confirmBtn).not.toBeNull();

      await act(async () => {
        confirmBtn!.click();
      });

      expect(resetToSampleDataMock).toHaveBeenCalledTimes(1);
      expect(toastMock).toHaveBeenCalledTimes(1);
      const arg = toastMock.mock.calls[0][0];
      expect(arg.title).toBe("Demo data reset");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("badge disappears automatically when the underlying customer is deleted", async () => {
    await renderAt("/dashboard?customer=c1");
    expect(nameEl()?.textContent).toBe("Acme Co");

    // Simulate the active scoped customer being deleted from the data
    // store. The scope must fall back to All and the badge must vanish
    // — including stripping the now-stale ?customer= param from the URL.
    mockData.customers = [{ id: "c2", name: "Globex" }];
    await rerender();

    expect(badge()).toBeNull();
    expect(nameEl()).toBeNull();
    expect(clearBtn()).toBeNull();
    expect(
      new URLSearchParams(window.location.search).get("customer"),
    ).toBeNull();
  });
});
