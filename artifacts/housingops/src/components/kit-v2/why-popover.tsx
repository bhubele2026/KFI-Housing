import { type ReactNode } from "react";
import { Link } from "wouter";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface WhyRow {
  k: string;
  v: string | number;
}

export interface WhyPopoverProps {
  /** The inline value the user sees + clicks (a number, count, $ figure, chip). */
  children: ReactNode;
  /** Short title, e.g. "Net spread". */
  title?: string;
  /** The formula in plain words, e.g. "Collected − Rent − Utilities". */
  formula?: string;
  /** The actual numbers that went into it. */
  rows?: WhyRow[];
  /** Link to the source rows (the people / lease / deductions behind the number). */
  href?: string;
  hrefLabel?: string;
  className?: string;
}

/**
 * The "why" pattern (Consolidated Fix §0). Wrap ANY stat / number / chip so a
 * click explains itself: the formula in words, the actual numbers, and a link to
 * the source rows. Built on the existing ui/popover. Keyboard + esc accessible.
 */
/** Coerce any cell value to a safe, printable string (never throws). */
function cell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  if (typeof v === "string") return v;
  try {
    return String(v);
  } catch {
    return "—";
  }
}

export function WhyPopover({
  children,
  title,
  formula,
  rows,
  href,
  hrefLabel = "View source →",
  className,
}: WhyPopoverProps) {
  // Phase 14 — bullet-proofing. The "red box" was this popover's content
  // throwing (an undefined `rows`, a bad `.map`) and tripping the page
  // ErrorBoundary. Every field is now defensively coerced so the content can
  // NEVER throw; the worst case is an empty-but-styled white card.
  const safeRows = Array.isArray(rows) ? rows.filter((r) => r && typeof r === "object") : [];
  const safeHref = typeof href === "string" && href.length > 0 ? href : undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "cursor-help underline decoration-dotted decoration-[hsl(var(--line))] underline-offset-2 transition-colors hover:decoration-[hsl(var(--brand))]",
            className,
          )}
          aria-label={title ? `Why: ${title}` : "Why"}
        >
          {children}
        </button>
      </PopoverTrigger>
      {/* side=top + collisionPadding so the card sits ABOVE the number (never
          covering it) and flips below / shifts in at viewport edges. */}
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="w-72 rounded-xl border-line bg-panel p-3 text-ink shadow-lg"
      >
        {title ? (
          <div className="text-[11px] font-bold uppercase tracking-wide text-faint">
            {cell(title)}
          </div>
        ) : null}
        {formula ? (
          <div className="mt-1 text-[13px] leading-snug text-ink2">{cell(formula)}</div>
        ) : null}
        {safeRows.length > 0 ? (
          <div className="mt-2 space-y-1 border-t border-line pt-2">
            {safeRows.map((r, i) => (
              <div key={`${cell(r.k)}-${i}`} className="flex justify-between gap-3 text-[12.5px]">
                <span className="text-muted-foreground">{cell(r.k)}</span>
                <span className="font-medium tabular-nums">{cell(r.v)}</span>
              </div>
            ))}
          </div>
        ) : null}
        {safeHref ? (
          <Link
            href={safeHref}
            className="mt-2 inline-block text-[12.5px] font-semibold text-brand hover:underline"
          >
            {cell(hrefLabel)}
          </Link>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
