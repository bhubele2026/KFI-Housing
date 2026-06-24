import type { ReactNode } from "react";
import { Link } from "wouter";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Badge } from "./primitives";

/**
 * Self-explaining badge (refinement #2). A wrapper around the kit Badge that,
 * for a problem state, becomes clickable and opens a popover explaining WHY in
 * plain English + a one-click fix link. Fully ADDITIVE — the base Badge/Pill
 * API is unchanged; existing call sites keep working. Use this only where you
 * want the explainer (a $0 / not-in-payroll badge).
 */
export type ExplainKind = "no_deduction" | "not_in_payroll";

const EXPLAIN: Record<
  ExplainKind,
  { title: string; body: string; fixLabel: string; fixHref: (occupantId?: string) => string }
> = {
  no_deduction: {
    title: "$0 — not deducted",
    body:
      "This person is housed in a bed, but payroll isn't deducting any rent for them. Every week like this is rent we pay out and don't recover.",
    fixLabel: "Open their profile to set the charge",
    fixHref: (occupantId) => (occupantId ? `/occupants/${occupantId}` : "/roster"),
  },
  not_in_payroll: {
    title: "Not in payroll yet",
    body:
      "We're housing this person, but Zenople doesn't show them on the last payroll run — so no housing deduction can be matched to them yet.",
    fixLabel: "Review & match them in Zenople",
    fixHref: () => "/zenople-review",
  },
};

export function ExplainBadge({
  explain,
  kind = "grey",
  children,
  occupantId,
  className,
}: {
  /** Which problem this badge represents — drives the popover copy + fix link. */
  explain: ExplainKind;
  kind?: "ok" | "risk" | "grey";
  children: ReactNode;
  /** Occupant id, so the "$0" fix can deep-link to the right person. */
  occupantId?: string;
  className?: string;
}) {
  const info = EXPLAIN[explain];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full", className)}
          aria-label={`${info.title} — why?`}
        >
          <Badge kind={kind}>{children}</Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 text-sm">
        <div className="mb-1 font-semibold text-ink">{info.title}</div>
        <p className="mb-2 text-xs text-muted-foreground">{info.body}</p>
        <Link
          href={info.fixHref(occupantId)}
          className="text-xs font-semibold text-brand hover:underline"
        >
          {info.fixLabel} →
        </Link>
      </PopoverContent>
    </Popover>
  );
}
