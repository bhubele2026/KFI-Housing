import type { ReactNode } from "react";
import { LanguageToggle } from "@/components/language-toggle";
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
        "flex flex-col gap-4 pb-6 border-b border-border/60 sm:flex-row sm:items-start sm:justify-between",
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
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end">
        {actions}
        <LanguageToggle />
      </div>
    </header>
  );
}

