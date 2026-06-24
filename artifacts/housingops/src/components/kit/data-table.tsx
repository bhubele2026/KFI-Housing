import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { EmptyState, type EmptyStateProps } from "@/components/empty-state";
import { cn } from "@/lib/utils";

export interface DataColumn<T> {
  /** Stable key; also the default sort key. */
  key: string;
  header: ReactNode;
  /** Cell renderer. */
  cell: (row: T) => ReactNode;
  /** Value used for sorting + global text filter. Enables sorting when set. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: "left" | "right" | "center";
  /** Tabular figures (money / counts / dates) so columns line up. */
  numeric?: boolean;
  className?: string;
  headClassName?: string;
}

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Show a search box that filters across every column's sortValue. */
  filterable?: boolean;
  filterPlaceholder?: string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  empty?: EmptyStateProps;
  /** Sticky header for long lists. */
  stickyHeader?: boolean;
  className?: string;
  testId?: string;
}

const alignClass = (a?: DataColumn<unknown>["align"]) =>
  a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

/**
 * The one dense, sortable, filterable table every list page uses, so they all
 * behave identically — zebra striping, warm hairlines, tabular numerals,
 * compact rows. Status colors and money badges live in the cell renderers.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  filterable = false,
  filterPlaceholder = "Filter…",
  initialSort,
  empty,
  stickyHeader = false,
  className,
  testId,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    initialSort ?? null,
  );

  const colByKey = useMemo(() => {
    const m = new Map<string, DataColumn<T>>();
    columns.forEach((c) => m.set(c.key, c));
    return m;
  }, [columns]);

  const filtered = useMemo(() => {
    if (!filterable || query.trim() === "") return rows;
    const q = query.trim().toLowerCase();
    return rows.filter((row) =>
      columns.some((c) => {
        const v = c.sortValue?.(row);
        return v != null && String(v).toLowerCase().includes(q);
      }),
    );
  }, [rows, columns, query, filterable]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = colByKey.get(sort.key);
    if (!col?.sortValue) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sort, colByKey]);

  const toggleSort = (key: string) => {
    const col = colByKey.get(key);
    if (!col?.sortValue) return;
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // third click clears
    });
  };

  return (
    <div className={cn("space-y-2", className)} data-testid={testId}>
      {filterable && (
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={filterPlaceholder}
            className="h-8 pl-7 text-sm"
            data-testid={testId ? `${testId}-filter` : undefined}
          />
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-line">
        <Table>
          <TableHeader className={cn(stickyHeader && "sticky top-0 z-10 bg-panel")}>
            <TableRow className="border-line">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const sortable = !!c.sortValue;
                return (
                  <TableHead
                    key={c.key}
                    className={cn(
                      "h-9 bg-panel text-xs font-semibold text-muted-foreground",
                      alignClass(c.align),
                      sortable && "cursor-pointer select-none",
                      c.headClassName,
                    )}
                    onClick={sortable ? () => toggleSort(c.key) : undefined}
                  >
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        c.align === "right" && "flex-row-reverse",
                      )}
                    >
                      {c.header}
                      {sortable &&
                        (active ? (
                          sort!.dir === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-40" />
                        ))}
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
                  <EmptyState
                    title={empty?.title ?? "Nothing here yet"}
                    description={empty?.description}
                    icon={empty?.icon}
                    action={empty?.action}
                    testId={empty?.testId}
                  />
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((row, i) => (
                <TableRow
                  key={getRowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-line",
                    i % 2 === 1 && "bg-surface/60", // subtle zebra
                    onRowClick && "cursor-pointer hover-elevate",
                  )}
                >
                  {columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        "py-1.5 text-sm",
                        alignClass(c.align),
                        c.numeric && "tabular-nums",
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
