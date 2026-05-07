import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router as WouterRouter } from "wouter";

import {
  useNewMonthHotelRateReminder,
  __resetNewMonthHotelRateReminderForTest,
} from "./use-new-month-hotel-rate-reminder";
import { useToast } from "./use-toast";
import {
  HOTEL_RATE_REMINDER_STORAGE_KEY,
  currentMonthKey,
} from "@/lib/hotel-rate-status";
import type { Lease, RoomNightLog } from "@/data/mockData";

// Integration-flavoured pin for Task #343 — exercises the *real*
// `useToast` queue (not a mock) so a regression in toast.ts that drops
// the caller's `onOpenChange` (the bug the code review caught) shows
// up here as a missing localStorage write. The peer
// use-new-month-hotel-rate-reminder.test.tsx still mocks `useToast`
// for ergonomic prop assertions.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let mockLeases: ReadonlyArray<Pick<Lease, "id" | "monthlyRoomNightMin"> & { status: Lease["status"] }> = [];
let mockLogs: ReadonlyArray<RoomNightLog> | undefined = [];

vi.mock("@/context/data-store", () => ({
  useData: () => ({ leases: mockLeases }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListRoomNightLogs: () => ({ data: mockLogs }),
}));

// Probe also subscribes to the real toast queue so the test can grab
// the live `onOpenChange` Radix would invoke and trigger it directly.
let capturedOnOpenChange: ((open: boolean) => void) | undefined;
function Probe() {
  // Subscribe to the toast queue BEFORE invoking the reminder hook so
  // the listener-registering effect (declared first wins in React's
  // effect order) is in place by the time the reminder's effect fires
  // its `toast(...)` dispatch — without this the Probe never re-renders
  // and `toasts[0]` stays empty.
  const { toasts } = useToast();
  useNewMonthHotelRateReminder();
  capturedOnOpenChange = toasts[0]?.onOpenChange;
  return null;
}

describe("useNewMonthHotelRateReminder (real toast pipeline)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    __resetNewMonthHotelRateReminderForTest();
    window.localStorage.removeItem(HOTEL_RATE_REMINDER_STORAGE_KEY);
    mockLeases = [];
    mockLogs = [];
    capturedOnOpenChange = undefined;
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
      root.render(
        <WouterRouter>
          <Probe />
        </WouterRouter>,
      );
    });
  }

  it("persists the current month when the live toast's onOpenChange fires close", async () => {
    mockLeases = [{ id: "l1", monthlyRoomNightMin: 30, status: "Active" }];
    mockLogs = [];
    await mount();
    // Second flush so the Probe's listener callback (queued when the
    // hook's effect dispatched the toast) re-renders and exposes the
    // live `onOpenChange` from the toaster state.
    await act(async () => {});

    expect(window.localStorage.getItem(HOTEL_RATE_REMINDER_STORAGE_KEY)).toBeNull();
    expect(typeof capturedOnOpenChange).toBe("function");

    await act(async () => {
      capturedOnOpenChange?.(false);
    });

    // The real toast pipeline must have invoked the caller's
    // onOpenChange — without composition in `toast()`, this assertion
    // fails because the persistence callback was overwritten.
    expect(window.localStorage.getItem(HOTEL_RATE_REMINDER_STORAGE_KEY)).toBe(
      currentMonthKey(),
    );
  });
});
