import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, isValidElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router as WouterRouter } from "wouter";

import {
  useNewMonthHotelRateReminder,
  __resetNewMonthHotelRateReminderForTest,
} from "./use-new-month-hotel-rate-reminder";
import {
  HOTEL_RATE_REMINDER_STORAGE_KEY,
  currentMonthKey,
  writeAcknowledgedReminderMonth,
} from "@/lib/hotel-rate-status";
import type { Lease, RoomNightLog } from "@/data/mockData";

// Pin down Task #343: when a new calendar month starts and at least
// one hotel-rate lease still has no log for that month, exactly one
// reminder toast fires. Dismissing it persists the month so a reload
// stays silent until the calendar rolls forward again.

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

vi.mock("./use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }),
}));

let mockLeases: ReadonlyArray<Pick<Lease, "id" | "monthlyRoomNightMin"> & { status: Lease["status"] }> = [];
let mockLogs: ReadonlyArray<RoomNightLog> | undefined = [];

vi.mock("@/context/data-store", () => ({
  useData: () => ({ leases: mockLeases }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListRoomNightLogs: () => ({ data: mockLogs }),
  useListPropertyViolations: () => ({ data: [] }),
  useCreatePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeletePropertyViolation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  getListPropertyViolationsQueryKey: () => [],
}));

function Probe() {
  useNewMonthHotelRateReminder();
  return null;
}

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

describe("useNewMonthHotelRateReminder", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
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
  });

  async function mount() {
    await act(async () => {
      root = createRoot(container);
      // Wrap in WouterRouter so the toast action's <Link> finds a
      // router context — without it React throws at render time.
      root.render(
        <WouterRouter>
          <Probe />
        </WouterRouter>,
      );
    });
  }

  it("stays silent when every hotel-rate lease already has a current-month log", async () => {
    const month = currentMonthKey();
    mockLeases = [{ id: "l1", monthlyRoomNightMin: 30, status: "Active" }];
    mockLogs = [{ id: "rnl-1", leaseId: "l1", month, roomNights: 5, notes: "" }];
    await mount();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("stays silent when there are no hotel-rate leases at all", async () => {
    mockLeases = [{ id: "l1", monthlyRoomNightMin: 0, status: "Active" }];
    mockLogs = [];
    await mount();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("fires one reminder toast when a hotel-rate lease lacks this month's log", async () => {
    const month = currentMonthKey();
    mockLeases = [
      { id: "l1", monthlyRoomNightMin: 30, status: "Active" },
      { id: "l2", monthlyRoomNightMin: 30, status: "Active" },
    ];
    mockLogs = [];
    await mount();

    expect(toastMock).toHaveBeenCalledTimes(1);
    const t = lastToast();
    // Title surfaces the count + month so an operator triaging a
    // backlog of toasts can act without opening each one.
    expect(String(t?.title)).toContain("2");
    expect(String(t?.title)).toContain(month);
    // Action deep-links to the existing /leases?atRisk=1 view that
    // already groups the same risk rows — no new screen needed.
    expect(actionHrefOf(t)).toBe("/leases?atRisk=1");
  });

  it("does NOT re-toast within the same session after a remount", async () => {
    mockLeases = [{ id: "l1", monthlyRoomNightMin: 30, status: "Active" }];
    mockLogs = [];
    await mount();
    expect(toastMock).toHaveBeenCalledTimes(1);

    if (root) {
      const r = root;
      await act(async () => {
        r.unmount();
      });
      root = null;
    }
    await mount();
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the operator already acknowledged this month in a prior session", async () => {
    // Persisted ack from a previous tab: a hard reload must not
    // re-show the same reminder for the same calendar month.
    writeAcknowledgedReminderMonth(currentMonthKey());
    mockLeases = [{ id: "l1", monthlyRoomNightMin: 30, status: "Active" }];
    mockLogs = [];
    await mount();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("persists the current month when the toast is dismissed", async () => {
    mockLeases = [{ id: "l1", monthlyRoomNightMin: 30, status: "Active" }];
    mockLogs = [];
    await mount();

    const t = lastToast();
    expect(t?.onOpenChange).toBeTypeOf("function");
    expect(window.localStorage.getItem(HOTEL_RATE_REMINDER_STORAGE_KEY)).toBeNull();
    await act(async () => {
      t?.onOpenChange?.(false);
    });
    expect(window.localStorage.getItem(HOTEL_RATE_REMINDER_STORAGE_KEY)).toBe(
      currentMonthKey(),
    );
  });

  it("waits for room-night logs to load before deciding", async () => {
    // While the logs query is still pending we don't know whether the
    // operator has already logged this month — toasting prematurely
    // would cry wolf the first time the page hydrates.
    mockLeases = [{ id: "l1", monthlyRoomNightMin: 30, status: "Active" }];
    mockLogs = undefined;
    await mount();
    expect(toastMock).not.toHaveBeenCalled();
  });
});
