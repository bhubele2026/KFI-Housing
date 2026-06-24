/**
 * HousingOps component kit — the shared building blocks every screen reuses,
 * so the app reads as one warm, consistent ledger (see the Master Build Brief
 * Design System). Import from "@/components/kit".
 */
export { StatusDot, type StatusKind, type StatusDotProps } from "./status-dot";
export {
  DeductionBadge,
  zenopleStatusToDot,
  type ZenopleStatus,
  type DeductionBadgeProps,
} from "./deduction-badge";
export {
  MoneyTile,
  buildPropertyMoneyStats,
  type MoneyStat,
  type MoneyTileProps,
} from "./money-tile";
export {
  DataTable,
  type DataColumn,
  type DataTableProps,
} from "./data-table";
export { PrintView, type PrintViewProps } from "./print-view";

// Re-export the already-existing kit members so callers have one import surface.
export { EmptyState, EmptyStateRow, type EmptyStateProps } from "../empty-state";
