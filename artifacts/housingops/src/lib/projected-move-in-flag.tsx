import { Badge } from "@/components/ui/badge";

const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whole days between today (UTC midnight) and a YYYY-MM-DD string.
 * Negative values mean the date is already in the past. Returns
 * null when the input isn't a strict YYYY-MM-DD calendar date.
 *
 * Uses UTC arithmetic because every projected move-in date in the
 * system is a calendar date (no time component), so DST/local-tz
 * shifts would otherwise misclassify "today" as -1 in the wrong
 * timezone.
 *
 * Shared between the per-property Projected Move-Ins card on the
 * Beds tab and the portfolio-wide "Upcoming move-ins" roll-up on
 * the Dashboard (Task #578) so both surfaces bucket dates the same
 * way.
 */
export function projectedMoveInDaysFromToday(ymd: string): number | null {
  if (!STRICT_DATE_RE.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / (24 * 60 * 60 * 1000));
}

export interface ProjectedMoveInFlag {
  label: string;
  cls: string;
  bucket: "overdue" | "today" | "soon" | "later";
}

export function projectedMoveInFlag(ymd: string): ProjectedMoveInFlag | null {
  const days = projectedMoveInDaysFromToday(ymd);
  if (days === null) return null;
  if (days < 0) {
    return {
      label: `Overdue · ${Math.abs(days)}d ago`,
      cls: "bg-rose-100 text-rose-900 border-rose-200",
      bucket: "overdue",
    };
  }
  if (days === 0) {
    return {
      label: "Today",
      cls: "bg-emerald-100 text-emerald-900 border-emerald-200",
      bucket: "today",
    };
  }
  if (days <= 7) {
    return {
      label: `In ${days}d`,
      cls: "bg-amber-100 text-amber-900 border-amber-200",
      bucket: "soon",
    };
  }
  return {
    label: `In ${days}d`,
    cls: "bg-muted text-muted-foreground border-border",
    bucket: "later",
  };
}

interface MoveInDateBadgeProps {
  date: string;
  testId?: string;
}

/** Small reusable date-flag pill, used by both the per-property
 * Beds-tab row and the portfolio dashboard roll-up so both surfaces
 * share the exact same colour + label conventions. */
export function MoveInDateBadge({ date, testId }: MoveInDateBadgeProps) {
  const flag = projectedMoveInFlag(date);
  if (!flag) return null;
  return (
    <Badge className={flag.cls} data-testid={testId}>
      {flag.label}
    </Badge>
  );
}
