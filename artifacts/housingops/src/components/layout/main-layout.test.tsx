import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("./sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock("wouter", () => ({
  Redirect: ({ to }: { to: string }) => (
    <div data-testid="redirect" data-redirect-to={to}>
      {`REDIRECT_TO:${to}`}
    </div>
  ),
}));

// MainLayout reads the active customer scope to render a chip in the
// mobile header. The route-guard tests don't care about that wiring, so
// we replace both contexts with the minimal surface MainLayout uses.
vi.mock("@/context/customer-scope", async () => {
  const actual =
    await vi.importActual<typeof import("@/context/customer-scope")>(
      "@/context/customer-scope",
    );
  return {
    ...actual,
    useCustomerScope: () => ({
      customerId: actual.ALL_CUSTOMERS,
      setCustomerId: vi.fn(),
    }),
  };
});

vi.mock("@/context/data-store", () => ({
  useData: () => ({ customers: [] }),
}));

import { MainLayout } from "./main-layout";
import { AuthProvider } from "@/hooks/use-auth";

const STORAGE_KEY = "housingops_auth";
const PROTECTED_MARKER = "protected-content-marker";

describe("MainLayout route guard", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("does NOT render <Redirect to=\"/login\" /> on first render when the user is already authenticated in storage", () => {
    window.localStorage.setItem(STORAGE_KEY, "true");

    const html = renderToString(
      <AuthProvider>
        <MainLayout>
          <div>{PROTECTED_MARKER}</div>
        </MainLayout>
      </AuthProvider>,
    );

    expect(html).not.toContain("REDIRECT_TO:/login");
    expect(html).not.toContain("data-redirect-to");
    expect(html).toContain(PROTECTED_MARKER);
  });

  it("redirects to /login on first render when storage is empty", () => {
    const html = renderToString(
      <AuthProvider>
        <MainLayout>
          <div>{PROTECTED_MARKER}</div>
        </MainLayout>
      </AuthProvider>,
    );

    expect(html).toContain("REDIRECT_TO:/login");
    expect(html).not.toContain(PROTECTED_MARKER);
  });
});
