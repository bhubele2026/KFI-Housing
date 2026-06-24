import { cn } from "@/lib/utils";
import { StatusDot, type StatusKind } from "./status-dot";

/** Zenople link status → the one status meaning. */
export type ZenopleStatus = "linked" | "pending" | "needs_review" | "not_in_zenople" | string;

export function zenopleStatusToDot(status?: ZenopleStatus): StatusKind {
  switch (status) {
    case "linked":
      return "ok";
    case "needs_review":
      return "warn";
    case "not_in_zenople":
      return "risk";
    default:
      return "neutral"; // pending / unknown
  }
}

function formatWeekly(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export interface DeductionBadgeProps {
  /** Weekly amount actually deducted from pay. 0/null/undefined => not deducted. */
  weeklyAmount?: number | null;
  /** Zenople link status drives the dot color. */
  zenopleStatus?: ZenopleStatus;
  /** Where the figure came from — "payroll" (real deduction) vs manual charge. */
  source?: string;
  /** Compact = badge only, no source hint. */
  size?: "sm" | "md";
  className?: string;
  testId?: string;
}

/**
 * The money fact that rides on EVERY person, everywhere (bed cells, occupant
 * rows, roster, customer roll-up, move ledger). Shows the weekly rent deducted
 * with tabular figures + a payroll-link status dot. A $0 / missing deduction is
 * a money leak, so it renders red "Not deducted" — the loudest thing on the row.
 */
export function DeductionBadge({
  weeklyAmount,
  zenopleStatus,
  source,
  size = "md",
  className,
  testId,
}: DeductionBadgeProps) {
  const hasDeduction = typeof weeklyAmount === "number" && weeklyAmount > 0;

  if (!hasDeduction) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-risk/30 bg-risk-soft px-1.5 py-0.5 text-xs font-medium text-risk tabular-nums",
          className,
        )}
        data-testid={testId}
        title="No housing deduction on this person's pay — unrecovered rent"
      >
        <StatusDot status="risk" size="sm" />
        Not deducted
      </span>
    );
  }

  const dot = zenopleStatusToDot(zenopleStatus);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-1.5 py-0.5 text-xs font-medium text-ink tabular-nums",
        className,
      )}
      data-testid={testId}
      title={
        zenopleStatus
          ? `Weekly rent deducted · payroll link: ${zenopleStatus}`
          : "Weekly rent deducted"
      }
    >
      <StatusDot status={dot} size="sm" />
      {formatWeekly(weeklyAmount as number)}
      <span className="text-muted-foreground">/wk</span>
      {size === "md" && source && source !== "payroll" && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          manual
        </span>
      )}
    </span>
  );
}
