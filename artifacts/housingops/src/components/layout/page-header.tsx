import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared page header used by every top-level page in the app.
 *
 * Standardizes:
 * - Type scale (page title size, subtitle color, meta line styling)
 * - Vertical rhythm (title -> subtitle -> meta)
 * - Layout (title block on the left, actions on the right; stacks on mobile)
 * - Border separator under the header so the page body has a clean divider
 *
 * Pages should render this as the first child of their content wrapper. Any
 * page-specific filters/buttons live in `actions`; an optional `meta` slot
 * sits under the subtitle for things like the "Showing only X" customer chip.
 */
export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        // `flex-wrap` at sm+ lets the actions row drop to its own line
        // when the title + actions don't fit side-by-side, instead of
        // overflowing on top of the title (the previous `sm:flex-nowrap`
        // on the actions row forced a single line of buttons that
        // collided with long titles like Leases).
        "flex flex-col gap-4 pb-6 border-b border-border/60 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between",
        className,
      )}
      data-testid="page-header"
    >
      <div className="min-w-0">
        <h1
          className="text-2xl sm:text-[28px] font-semibold tracking-tight text-foreground leading-tight"
          data-testid="page-header-title"
        >
          {title}
        </h1>
        {description ? (
          <p
            className="mt-1.5 text-sm text-muted-foreground max-w-2xl"
            data-testid="page-header-description"
          >
            {description}
          </p>
        ) : null}
        {meta ? <div className="mt-2">{meta}</div> : null}
      </div>
      {/*
        `sm:ml-auto` keeps the actions cluster pinned to the right edge
        whether it sits next to the title (wide viewports) or wraps
        below it (narrow viewports). Internal `flex-wrap` lets the
        buttons themselves reflow if even the actions row alone is
        wider than the available width.
      */}
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">
        {actions}
        <LanguageToggle />
      </div>
    </header>
  );
}

