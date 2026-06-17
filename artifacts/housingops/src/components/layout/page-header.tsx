import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared page header used by every top-level page in the app.
 *
 * Standardizes:
 * - A "Back" control (browser history) so an operator is never stuck on a
 *   page with no way back to where they came from.
 * - Type scale (page title size, subtitle color, meta line styling)
 * - Layout (title block on the left, actions on the right; stacks on mobile)
 * - Border separator under the header so the page body has a clean divider
 *
 * Pages render this as the first child of their content wrapper. Page-
 * specific filters/buttons live in `actions`; an optional `meta` slot sits
 * under the subtitle (e.g. the "Showing only X" customer chip).
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
    <div
      className={cn("pb-6 border-b border-border/60", className)}
      data-testid="page-header"
    >
      {/* Universal back control — goes to the previous page in history so
          operators can always follow their trail back up the flow. */}
      <button
        type="button"
        onClick={() => window.history.back()}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        data-testid="page-header-back"
        aria-label="Go back to the previous page"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
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
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">
          {actions}
        </div>
      </div>
    </div>
  );
}
