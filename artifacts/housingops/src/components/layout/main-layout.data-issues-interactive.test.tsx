import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router, Switch, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const mockData: {
  customers: { id: string; name: string }[];
  isLoading: boolean;
  dataIssues: {
    kind: string;
    label: string;
    dropped: number;
    rows: { id?: string; label?: string; href?: string }[];
  }[];
} = {
  customers: [],
  isLoading: false,
  dataIssues: [],
};
vi.mock("@/context/data-store", () => ({
  useData: () => mockData,
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { MainLayout } from "./main-layout";
import { AuthProvider } from "@/hooks/use-auth";
import { CustomerScopeProvider } from "@/context/customer-scope";

const AUTH_STORAGE_KEY = "housingops_auth";

describe("DataIssuesBanner interactive behaviour", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(AUTH_STORAGE_KEY, "true");
    container = document.createElement("div");
    document.body.appendChild(container);
    mockData.dataIssues = [];
    mockToast.mockClear();
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

  it("clicking the Open link navigates to the lease detail page", async () => {
    mockData.dataIssues = [
      {
        kind: "leases",
        label: "leases",
        dropped: 1,
        rows: [
          { id: "L-bad", label: "Lease at Maple House", href: "/leases/L-bad" },
        ],
      },
    ];

    const memory = memoryLocation({ path: "/dashboard", record: true });

    function Harness() {
      return (
        <AuthProvider>
          <CustomerScopeProvider>
            <Router hook={memory.hook}>
              <MainLayout>
                <Switch>
                  <Route path="/dashboard">
                    <div data-testid="page-dashboard">Dashboard</div>
                  </Route>
                  <Route path="/leases/:id">
                    {(params) => (
                      <div data-testid="page-lease-detail">{params.id}</div>
                    )}
                  </Route>
                </Switch>
              </MainLayout>
            </Router>
          </CustomerScopeProvider>
        </AuthProvider>
      );
    }

    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });

    expect(
      container.querySelector('[data-testid="page-dashboard"]'),
    ).not.toBeNull();

    const open = container.querySelector(
      '[data-testid="data-issue-row-open-leases-0"]',
    ) as HTMLAnchorElement | null;
    expect(open).not.toBeNull();

    await act(async () => {
      open!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      );
    });

    expect(memory.history).toContain("/leases/L-bad");
    expect(
      container.querySelector('[data-testid="page-lease-detail"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="page-lease-detail"]')!.textContent,
    ).toBe("L-bad");
  });

  it("clicking Copy id writes the id to the clipboard and shows a toast", async () => {
    mockData.dataIssues = [
      {
        kind: "beds",
        label: "beds",
        dropped: 1,
        rows: [{ id: "B-9", label: "Bed #3 @ Maple House" }],
      },
    ];

    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextSpy, readText: vi.fn() },
    });

    function Harness() {
      return (
        <AuthProvider>
          <CustomerScopeProvider>
            <MainLayout>
              <div data-testid="page-body">page-body</div>
            </MainLayout>
          </CustomerScopeProvider>
        </AuthProvider>
      );
    }

    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });

    const copy = container.querySelector(
      '[data-testid="data-issue-row-copy-beds-0"]',
    ) as HTMLButtonElement | null;
    expect(copy).not.toBeNull();

    await act(async () => {
      copy!.click();
    });

    expect(writeTextSpy).toHaveBeenCalledWith("B-9");
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Copied",
        description: "Copied id B-9 to clipboard.",
      }),
    );
  });

  it("shows a fallback toast when clipboard API is unavailable", async () => {
    mockData.dataIssues = [
      {
        kind: "rooms",
        label: "rooms",
        dropped: 1,
        rows: [{ id: "R-7", label: "Room A" }],
      },
    ];

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("not allowed")),
        readText: vi.fn(),
      },
    });

    document.execCommand = vi.fn().mockReturnValue(true);
    const execSpy = vi.spyOn(document, "execCommand");

    function Harness() {
      return (
        <AuthProvider>
          <CustomerScopeProvider>
            <MainLayout>
              <div>page-body</div>
            </MainLayout>
          </CustomerScopeProvider>
        </AuthProvider>
      );
    }

    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });

    const copy = container.querySelector(
      '[data-testid="data-issue-row-copy-rooms-0"]',
    ) as HTMLButtonElement | null;
    expect(copy).not.toBeNull();

    await act(async () => {
      copy!.click();
    });

    expect(execSpy).toHaveBeenCalledWith("copy");
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Copied",
        description: "Copied id R-7 to clipboard.",
      }),
    );

    execSpy.mockRestore();
  });
});
