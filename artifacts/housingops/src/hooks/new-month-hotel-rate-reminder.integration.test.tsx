import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  __resetNewMonthHotelRateReminderForTest,
} from "./use-new-month-hotel-rate-reminder";
import {
  HOTEL_RATE_REMINDER_STORAGE_KEY,
  currentMonthKey,
} from "@/lib/hotel-rate-status";
import type { Lease, RoomNightLog } from "@/data/mockData";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface CapturedToast {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}

const toastMock = vi.fn((_props: CapturedToast) => ({
  id: "stub",
  dismiss: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

vi.mock("@/components/ui/toaster", () => ({
  Toaster: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/error-boundary", () => ({
  ErrorBoundary: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-google-maps-key-error", () => ({
  useGoogleMapsKeyErrorToastListener: () => {},
}));

vi.mock("@/pages/not-found", () => ({ default: () => <div data-testid="page-not-found" /> }));
vi.mock("@/pages/login", () => ({ default: () => <div data-testid="page-login" /> }));
vi.mock("@/pages/dashboard", () => ({ default: () => <div data-testid="page-dashboard" /> }));
vi.mock("@/pages/customers", () => ({ default: () => <div data-testid="page-customers" /> }));
vi.mock("@/pages/customer-detail", () => ({ default: () => <div data-testid="page-customer-detail" /> }));
vi.mock("@/pages/properties", () => ({ default: () => <div data-testid="page-properties" /> }));
vi.mock("@/pages/property-detail", () => ({ default: () => <div data-testid="page-property-detail" /> }));
vi.mock("@/pages/leases", () => ({ default: () => <div data-testid="page-leases" /> }));
vi.mock("@/pages/lease-detail", () => ({ default: () => <div data-testid="page-lease-detail" /> }));
vi.mock("@/pages/beds", () => ({ default: () => <div data-testid="page-beds" /> }));
vi.mock("@/pages/occupants", () => ({ default: () => <div data-testid="page-occupants" /> }));
vi.mock("@/pages/utilities", () => ({ default: () => <div data-testid="page-utilities" /> }));
vi.mock("@/pages/finance", () => ({ default: () => <div data-testid="page-finance" /> }));

let mockLeases: ReadonlyArray<
  Pick<Lease, "id" | "monthlyRoomNightMin"> & { status: Lease["status"] }
> = [];
let mockLogs: ReadonlyArray<RoomNightLog> | undefined = [];

vi.mock("@/context/data-store", () => ({
  DataProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useData: () => ({
    leases: mockLeases,
    customers: [],
    properties: [],
    rooms: [],
    beds: [],
    occupants: [],
    utilities: [],
    isLoading: false,
    addLease: vi.fn(),
    updateLease: vi.fn(),
    deleteLease: vi.fn(),
    addOccupant: vi.fn(),
    updateBed: vi.fn(),
    updateOccupant: vi.fn(),
  }),
  RoomInUseError: class RoomInUseError extends Error {},
}));

vi.mock("@workspace/api-client-react", () => ({
  useListRoomNightLogs: () => ({ data: mockLogs }),
  useListAllProjectedMoveIns: () => ({ data: [] }),
  getListAllProjectedMoveInsQueryKey: () => ["/projected-move-ins"],
  useListPropertyViolations: () => ({ data: [] }),
  useCreatePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeletePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  getListPropertyViolationsQueryKey: () => [],
  useListUnplacedPayroll: () => ({
    data: { unmatched: [], lowConfidenceMatches: [] },
  }),
  getListUnplacedPayrollQueryKey: () => ["/payroll/unplaced"],
  useGetLastAutoMasterImport: () => ({ data: undefined, isLoading: false, isError: false }),
}));

vi.mock("@/context/customer-scope", () => ({
  CustomerScopeProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-auth", () => ({
  AuthProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  readLastRoute: () => "/dashboard",
  useAuth: () => ({ isAuthenticated: true, login: vi.fn(), logout: vi.fn() }),
}));

import App from "@/App";

function lastToast(): CapturedToast | undefined {
  const calls = toastMock.mock.calls;
  if (calls.length === 0) return undefined;
  return calls[calls.length - 1][0] as CapturedToast;
}

function actionHrefOf(t: CapturedToast | undefined): string {
  if (!t?.action || !isValidElement(t.action)) return "";
  const actionEl = t.action as ReactElement<{ children?: unknown }>;
  const child = actionEl.props.children;
  if (!isValidElement(child)) return "";
  const linkEl = child as ReactElement<{ href?: string }>;
  return linkEl.props.href ?? "";
}

describe("NewMonthHotelRateReminder integration — real App tree", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    toastMock.mockClear();
    __resetNewMonthHotelRateReminderForTest();
    window.localStorage.removeItem(HOTEL_RATE_REMINDER_STORAGE_KEY);
    mockLeases = [];
    mockLogs = [];
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
    window.localStorage.removeItem(HOTEL_RATE_REMINDER_STORAGE_KEY);
    __resetNewMonthHotelRateReminderForTest();
    vi.useRealTimers();
  });

  it("fires a reminder toast via the App tree when hotel-rate leases lack the current-month log, dismisses across reload, and deep-links to /leases?atRisk=1", async () => {
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
    const marchKey = "2026-03";

    mockLeases = [
      { id: "l1", monthlyRoomNightMin: 30, status: "Active" },
      { id: "l2", monthlyRoomNightMin: 20, status: "Upcoming" },
    ];
    mockLogs = [];

    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });

    expect(toastMock).toHaveBeenCalledTimes(1);
    const t = lastToast();
    expect(String(t?.title)).toContain("2");
    expect(String(t?.title)).toContain(marchKey);

    expect(actionHrefOf(t)).toBe("/leases?atRisk=1");

    expect(
      window.localStorage.getItem(HOTEL_RATE_REMINDER_STORAGE_KEY),
    ).toBeNull();
    await act(async () => {
      t?.onOpenChange?.(false);
    });
    expect(
      window.localStorage.getItem(HOTEL_RATE_REMINDER_STORAGE_KEY),
    ).toBe(marchKey);

    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }

    __resetNewMonthHotelRateReminderForTest();
    toastMock.mockClear();

    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });

    expect(toastMock).not.toHaveBeenCalled();
  });

  it("auto-rolls the reminder when the calendar month advances", async () => {
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
    const marchKey = "2026-03";

    mockLeases = [
      { id: "l1", monthlyRoomNightMin: 30, status: "Active" },
    ];
    mockLogs = [];

    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(String(lastToast()?.title)).toContain(marchKey);

    await act(async () => {
      lastToast()?.onOpenChange?.(false);
    });
    expect(
      window.localStorage.getItem(HOTEL_RATE_REMINDER_STORAGE_KEY),
    ).toBe(marchKey);

    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }

    __resetNewMonthHotelRateReminderForTest();
    toastMock.mockClear();

    vi.setSystemTime(new Date("2026-04-01T08:00:00Z"));
    const aprilKey = "2026-04";

    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(String(lastToast()?.title)).toContain(aprilKey);
    expect(actionHrefOf(lastToast())).toBe("/leases?atRisk=1");
  });
});
