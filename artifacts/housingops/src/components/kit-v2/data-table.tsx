import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
}

/** The mockup's `table.t` look — right-aligned tabular columns, uppercase
 *  faint headers, hairline row borders, hover row tint. First column left. */
export function DataTable<T>({
  columns,
  rows,
  getKey,
  onRowClick,
  empty,
  testId,
}: {
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T, i: number) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  testId?: string;
}) {
  return (
    <table className="w-full border-collapse text-[13px]" data-testid={testId}>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th
              key={i}
              className={cn(
                "border-b border-line p-2.5 text-[10.5px] font-bold uppercase tracking-[0.5px] text-faint",
                i === 0 || c.align === "left" ? "text-left" : "text-right",
                c.className,
              )}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="p-6 text-center text-muted-foreground">
              {empty ?? "Nothing here yet."}
            </td>
          </tr>
        ) : (
          rows.map((row, ri) => (
            <tr
              key={getKey(row, ri)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn("hover:bg-[#F8FAFD]", onRowClick && "cursor-pointer")}
            >
              {columns.map((c, ci) => (
                <td
                  key={ci}
                  className={cn(
                    "border-b border-line p-[11px_10px] tabular-nums",
                    ci === 0 || c.align === "left" ? "text-left" : "text-right",
                    c.className,
                  )}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
