import type { ReactNode } from "react";
import { Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { CARD_SHADOW } from "./primitives";

/** Clean per-property sheet for print/export. Screen = bordered card with a
 *  Print button; @media print (in index.css) drops .print-hide chrome. */
export function PrintView({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("print-sheet rounded-[18px] bg-panel", CARD_SHADOW, className)}>
      <div className="flex items-start justify-between gap-4 border-b border-line p-4">
        <div>
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          {subtitle != null && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="print-hide inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
        >
          <Printer className="h-3.5 w-3.5" /> Print / Export
        </button>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
