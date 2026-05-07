import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar-stub" />,
}));

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

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { MainLayout } from "./main-layout";
import { AuthProvider } from "@/hooks/use-auth";
import { CustomerScopeProvider } from "@/context/customer-scope";

const AUTH_STORAGE_KEY = "housingops_auth";

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

describe("MainLayout data-issues banner", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(AUTH_STORAGE_KEY, "true");
    window.history.replaceState({}, "", "/dashboard");
    container = document.createElement("div");
    document.body.appendChild(container);
    mockData.dataIssues = [];
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

  async function render() {
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
  }

  it("does not render when there are no data issues", async () => {
    await render();
    expect(
      container.querySelector('[data-testid="banner-data-issues"]'),
    ).toBeNull();
  });

  it("shows the dropped row id, label, and an Open link to the lease detail page", async () => {
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

    await render();

    const banner = container.querySelector(
      '[data-testid="banner-data-issues"]',
    );
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("1 leases hidden");
    expect(banner!.textContent).toContain("L-bad");
    expect(banner!.textContent).toContain("Lease at Maple House");

    const open = container.querySelector(
      '[data-testid="data-issue-row-open-leases-0"]',
    ) as HTMLAnchorElement | null;
    expect(open).not.toBeNull();
    // wouter renders a relative href; check it contains the target.
    expect(open!.getAttribute("href")).toContain("/leases/L-bad");
  });

  it("shows a Copy id button (no Open link) for rows without a routable detail page", async () => {
    mockData.dataIssues = [
      {
        kind: "beds",
        label: "beds",
        dropped: 1,
        rows: [{ id: "B-9", label: "Bed #3 @ Maple House" }],
      },
    ];

    await render();

    expect(
      container.querySelector('[data-testid="data-issue-row-open-beds-0"]'),
    ).toBeNull();
    const copy = container.querySelector(
      '[data-testid="data-issue-row-copy-beds-0"]',
    );
    expect(copy).not.toBeNull();
    expect(copy!.getAttribute("aria-label")).toContain("B-9");
  });

  it("falls back to a 'no id' note when the dropped row had no usable id", async () => {
    mockData.dataIssues = [
      {
        kind: "leases",
        label: "leases",
        dropped: 1,
        rows: [{}],
      },
    ];

    await render();

    const row = container.querySelector(
      '[data-testid="data-issue-row-leases-0"]',
    );
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("no id");
    expect(
      container.querySelector('[data-testid="data-issue-row-open-leases-0"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="data-issue-row-copy-leases-0"]'),
    ).toBeNull();
  });
});
