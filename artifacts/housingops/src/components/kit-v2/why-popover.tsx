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
export function WhyPopover({
  children,
  title,
  formula,
  rows,
  href,
  hrefLabel = "View source →",
  className,
}: WhyPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "cursor-help underline decoration-dotted decoration-[hsl(var(--line))] underline-offset-2 hover:decoration-[hsl(var(--brand))]",
            className,
          )}
          aria-label={title ? `Why: ${title}` : "Why"}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 rounded-xl border-line bg-panel p-3 text-ink shadow-lg">
        {title && (
          <div className="text-[11px] font-bold uppercase tracking-wide text-faint">
            {title}
          </div>
        )}
        {formula && <div className="mt-1 text-[13px] leading-snug text-ink2">{formula}</div>}
        {rows && rows.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-line pt-2">
            {rows.map((r, i) => (
              <div key={`${r.k}-${i}`} className="flex justify-between gap-3 text-[12.5px]">
                <span className="text-muted-foreground">{r.k}</span>
                <span className="font-medium tabular-nums">{r.v}</span>
              </div>
            ))}
          </div>
        )}
        {href && (
          <Link
            href={href}
            className="mt-2 inline-block text-[12.5px] font-semibold text-brand hover:underline"
          >
            {hrefLabel}
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}
