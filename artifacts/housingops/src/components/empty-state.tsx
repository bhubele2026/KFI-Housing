import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Optional data-testid to anchor regression tests. */
  testId?: string;
}

/**
 * Branded empty-state block used wherever a table or list has no rows.
 * Visually richer than a single "No data" line so the demo doesn't feel
 * dead when an operator filters everything away.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  testId,
}: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center"
      data-testid={testId}
    >
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1 max-w-sm">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * Convenience wrapper for tables: drops an EmptyState inside a single
 * full-width cell so it sits inside <TableBody> without breaking
 * column layout.
 */
export function EmptyStateRow({
  colSpan,
  ...props
}: EmptyStateProps & { colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="p-0">
        <EmptyState {...props} />
      </TableCell>
    </TableRow>
  );
}
