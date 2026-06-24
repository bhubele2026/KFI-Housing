import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * A collapsible section on the Property Board. Native <details> so it's
 * keyboard-accessible and reduced-motion safe with no JS state. Warm tokens,
 * compact — reads like a labelled block on the manager's old tab.
 */
export function BoardSection({
  title,
  count,
  right,
  defaultOpen = true,
  children,
  testId,
}: {
  title: string;
  /** Optional count shown next to the title (e.g. number of rows). */
  count?: number;
  /** Optional right-aligned controls (e.g. an Export button). */
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-line bg-panel" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" />
          {title}
          {typeof count === "number" && (
            <span className="ml-1 rounded-full bg-surface px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </span>
        {right && <span onClick={(e) => e.preventDefault()}>{right}</span>}
      </summary>
      <div className="border-t border-line p-3">{children}</div>
    </details>
  );
}
