import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Switch, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// Regression coverage for task #275 / #279: every surface that should fall
// through to the shared friendly NotFoundScreen must actually render it AND
// expose the primary "Back to dashboard" button. The customer-detail page
// already has its own coverage in customer-detail.test.tsx; this file pins
// the three remaining surfaces:
//
//   1. The catch-all router fallback (`/not-found` and any unknown URL).
//   2. /properties/<bad-id> — the "Property not found" branch.
//   3. /leases/<bad-id>     — the "Lease not found" branch.
//
// If any of these regress to the bare 404 (or drop the dashboard CTA), the
// recovery flow operators rely on after a stale bookmark / "redirect to
// last route on login" lands them on a missing record breaks silently.

// MainLayout wraps the not-found surface on the property and lease pages.
// Render it as a passthrough so the test sees the NotFoundScreen markup
// directly without having to stand up the sidebar / route-guard.
vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// framer-motion isn't exercised on the early-return paths, but the page
// modules import it at top level, so swap it for a benign mock to keep
// jsdom happy and the test fast.
vi.mock("framer-motion", async () => {
  const { createMotionMock } = await import("@/test-utils/framer-motion-mock");
  return createMotionMock();
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] }),
}));

// LeaseDetail calls useUnsavedChangesPrompt() *before* its not-found early
// return. The real hook patches window.history; replace it with a no-op so
// the test stays isolated and doesn't tangle with other tests that mount
// later in the same process.
vi.mock("@/hooks/use-unsaved-changes-prompt", () => ({
  useUnsavedChangesPrompt: () => ({ bypassNextNavigation: vi.fn() }),
}));

// Empty data store with isLoading false — every lookup misses, so the
// property and lease detail pages take their not-found branches.
vi.mock("@workspace/api-client-react", () => ({
  useListRoomNightLogs: () => ({ data: [] }),
  useListPropertyViolations: () => ({ data: [] }),
  useCreatePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeletePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  getListPropertyViolationsQueryKey: () => [],
}));

vi.mock("@/context/data-store", () => ({
  useData: () => ({
    customers: [],
    properties: [],
    leases: [],
    rooms: [],
    beds: [],
    occupants: [],
    utilities: [],
    isLoading: false,
    updateProperty: vi.fn(),
    updateLease: vi.fn(),
    addLease: vi.fn(),
    deleteLease: vi.fn(),
    addRoom: vi.fn(),
    updateRoom: vi.fn(),
    deleteRoom: vi.fn(),
    addBed: vi.fn(),
    deleteBed: vi.fn(),
    updateBed: vi.fn(),
    updateOccupant: vi.fn(),
    addOccupant: vi.fn(),
    deleteOccupant: vi.fn(),
    updateUtility: vi.fn(),
    addUtility: vi.fn(),
    deleteUtility: vi.fn(),
  }),
  RoomInUseError: class RoomInUseError extends Error {},
}));

// Imports MUST come after the mocks above.
import NotFound from "./not-found";
import PropertyDetail from "./property-detail";
import LeaseDetail from "./lease-detail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeHarness(initialPath: string) {
  const memory = memoryLocation({ path: initialPath, record: true });
  function Harness() {
    return (
      <Router hook={memory.hook}>
        <Switch>
          <Route path="/properties/:id" component={PropertyDetail} />
          <Route path="/leases/:id" component={LeaseDetail} />
          <Route component={NotFound} />
        </Switch>
      </Router>
    );
  }
  return { Harness };
}

describe("Friendly 'Page not found' screen — recovery to dashboard", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
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

  async function renderAt(initialPath: string) {
    const { Harness } = makeHarness(initialPath);
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
  }

  function byTestId(id: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${id}"]`);
  }

  function requireTestId(id: string): HTMLElement {
    const el = byTestId(id);
    if (!el) throw new Error(`Could not find [data-testid="${id}"]`);
    return el;
  }

  // The shared NotFoundScreen renders the dashboard CTA as a wouter
  // <Link href="/dashboard"><Button data-testid="button-not-found-dashboard">.
  // We assert on both the anchor href AND the visible label so a future
  // refactor that swaps Link for a plain <button onClick=navigate(...)>
  // (which would silently break right-click / new-tab) still trips this.
  function assertDashboardCta(scope: HTMLElement) {
    const btn = scope.querySelector(
      '[data-testid="button-not-found-dashboard"]',
    );
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toContain("Back to dashboard");
    const anchor = btn?.closest('a[href="/dashboard"]');
    expect(anchor).not.toBeNull();
  }

  it("renders the friendly screen with a dashboard link for an unknown URL", async () => {
    await renderAt("/this-route-does-not-exist");

    const screen = requireTestId("page-not-found");
    expect(screen.textContent).toContain("Page not found");
    assertDashboardCta(screen);
  });

  it("renders the friendly screen with a dashboard link at /not-found", async () => {
    // /not-found is not a registered route — it falls through the same
    // catch-all that any unknown URL hits.
    await renderAt("/not-found");

    const screen = requireTestId("page-not-found");
    expect(screen.textContent).toContain("Page not found");
    assertDashboardCta(screen);
  });

  it("/properties/<bad-id> shows the friendly screen with both the dashboard CTA and the list-back link", async () => {
    await renderAt("/properties/does-not-exist");

    const screen = requireTestId("property-detail-not-found");
    expect(screen.textContent).toContain("Property not found");

    // Primary CTA: back to dashboard.
    assertDashboardCta(screen);

    // Secondary CTA preserved: back to the Properties list.
    const back = screen.querySelector(
      '[data-testid="button-back-to-properties"]',
    );
    expect(back).not.toBeNull();
    expect(back?.textContent).toContain("Back to Properties");
    expect(back?.closest('a[href="/properties"]')).not.toBeNull();
  });

  it("/leases/<bad-id> shows the friendly screen with both the dashboard CTA and the list-back link", async () => {
    await renderAt("/leases/does-not-exist");

    const screen = requireTestId("lease-detail-not-found");
    expect(screen.textContent).toContain("Lease not found");

    // Primary CTA: back to dashboard.
    assertDashboardCta(screen);

    // Secondary CTA preserved: back to the Leases list (no `?from=` was
    // provided, so the back-link falls back to /leases).
    const back = screen.querySelector(
      '[data-testid="button-back-to-leases"]',
    );
    expect(back).not.toBeNull();
    expect(back?.textContent).toContain("Back to Leases");
    expect(back?.closest('a[href="/leases"]')).not.toBeNull();
  });
});
