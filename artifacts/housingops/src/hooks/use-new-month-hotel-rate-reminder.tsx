import { useEffect } from "react";
import { Link } from "wouter";
import { useListRoomNightLogs } from "@workspace/api-client-react";
import { useData } from "@/context/data-store";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import {
  currentMonthKey,
  getHotelRateLeasesMissingMonthLog,
  readAcknowledgedReminderMonth,
  writeAcknowledgedReminderMonth,
} from "@/lib/hotel-rate-status";

// Module-level guard so a brief unmount/remount inside the same tab
// session (e.g. the auth gate flipping shells, or React 18 strict-mode
// double-mount) doesn't replay the reminder. Persistence across full
// reloads lives in localStorage; this set is purely for the in-tab
// dedupe — the operator already saw the toast a moment ago.
const remindedMonths = new Set<string>();

// Test-only escape hatch so Vitest cases can start each run from a
// clean dedupe slate without leaking state across tests.
export function __resetNewMonthHotelRateReminderForTest(): void {
  remindedMonths.clear();
}

/**
 * Fires a one-shot toast the first time, per calendar month, that the
 * operator opens the app while one or more hotel-rate leases lack a
 * room-night log for the current month. The /leases page already
 * surfaces the same warning inline, but operators only see it when
 * they happen to navigate there — this lifts the warning to app load
 * so the month-rollover doesn't slip past unnoticed (Task #343).
 *
 * The acknowledgement persists in localStorage as the *month* the
 * operator dismissed (or saw) the reminder. The next calendar month
 * won't match the stored value, so the reminder auto-rolls forward
 * without any cron job or backend involvement. Within the same tab
 * session a module-level set keeps a remount from re-toasting.
 *
 * The toast carries an action that deep-links to /leases?atRisk=1 so
 * the operator can jump straight to the missing rows in one click.
 */
export function useNewMonthHotelRateReminder(): void {
  const { toast } = useToast();
  const { leases } = useData();
  const { data: roomNightLogs } = useListRoomNightLogs();

  useEffect(() => {
    if (!leases || roomNightLogs === undefined) return;
    const month = currentMonthKey();
    if (remindedMonths.has(month)) return;
    if (readAcknowledgedReminderMonth() === month) return;
    const missing = getHotelRateLeasesMissingMonthLog(leases, roomNightLogs, month);
    if (missing.length === 0) return;

    // Mark before dispatching so a synchronous re-render (e.g. the
    // data store emitting a fresh leases reference inside the same
    // microtask) can't re-enter and double-toast.
    remindedMonths.add(month);

    const count = missing.length;
    toast({
      title: `New month — ${count} hotel-rate ${
        count === 1 ? "lease is" : "leases are"
      } missing a ${month} log`,
      description: `Record this month's room-nights so the negotiated rate stays in force.`,
      action: (
        <ToastAction altText="Review hotel-rate leases at risk this month" asChild>
          <Link href="/leases?atRisk=1">Review</Link>
        </ToastAction>
      ),
      onOpenChange: (open) => {
        // Persist on dismiss so a hard reload after acknowledging
        // doesn't show the same reminder again. We don't write on
        // mount (or on first toast emission) because an operator who
        // closes the tab without ever seeing the toast deserves to
        // see it on the next session — only an explicit dismiss /
        // auto-close counts as acknowledgement.
        if (!open) writeAcknowledgedReminderMonth(month);
      },
    });
  }, [leases, roomNightLogs, toast]);
}
