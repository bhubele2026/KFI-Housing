import type { ReactNode } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PrintViewProps {
  title: string;
  subtitle?: string;
  /** Right-aligned meta shown in the printed header (e.g. period, date). */
  meta?: ReactNode;
  children: ReactNode;
  /** Hide the on-screen Print button (e.g. when embedding). */
  hideButton?: boolean;
  className?: string;
  testId?: string;
}

/**
 * Clean per-property layout that prints/exports to look like the manager's old
 * spreadsheet tab. On screen it's a bordered "sheet"; when printed, the global
 * `.print-hide` rule drops the app chrome and only the sheet remains. Trigger
 * with the built-in button (window.print) — the browser's "Save as PDF" gives
 * the external hand-off file.
 */
export function PrintView({
  title,
  subtitle,
  meta,
  children,
  hideButton,
  className,
  testId,
}: PrintViewProps) {
  return (
    <div className={cn("print-sheet rounded-lg border border-line bg-panel", className)} data-testid={testId}>
      <div className="flex items-start justify-between gap-4 border-b border-line p-4">
        <div>
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {meta && <div className="text-right text-xs text-muted-foreground tabular-nums">{meta}</div>}
          {!hideButton && (
            <Button
              variant="outline"
              size="sm"
              className="print-hide gap-1.5"
              onClick={() => window.print()}
              data-testid={testId ? `${testId}-print` : undefined}
            >
              <Printer className="h-3.5 w-3.5" />
              Print / Export
            </Button>
          )}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
