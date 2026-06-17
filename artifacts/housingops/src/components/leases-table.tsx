import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyStateRow } from "@/components/empty-state";
import { PropertyNameCell } from "@/components/property-name-cell";
import { KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, DollarSign, FileText, AlertTriangle, Wrench, Briefcase, Hotel, CheckCircle2, CalendarClock, Zap, Building2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Lease, Customer, Property, RoomNightLog, OtherCost, Building } from "@/data/mockData";
import { formatUsd } from "@/data/mockData";
import { getHotelRateRiskStatus } from "@/lib/hotel-rate-status";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  extractSourcePdfFilename,
  sourcePdfHref,
  sourcePdfThumbnailHref,
} from "@/lib/lease-source-pdf";
import { isBlankYMD } from "@/lib/lease-dates";
import { RenewLeasePopover } from "@/components/renew-lease-popover";
import { BuildingPicker } from "@/components/building-picker";

export interface LeasesTableProps {
  leases: readonly Lease[];
  /** Used to render the Property column (and the Customer column, if shown). */
  properties: readonly Property[];
  /** Used to render the Customer column when {@link showCustomer} is true. */
  customers?: readonly Customer[];
  /** Show the Property column. Defaults to true on the global Leases page. */
  showProperty?: boolean;
  /** Show the Customer column. Mutually exclusive with the per-property view. */
  showCustomer?: boolean;
  /** Optional click handler when a property name is clicked (used on global page). */
  onPropertyClick?: (propertyId: string) => void;
  /** Optional click handler when a customer name is clicked. */
  onCustomerClick?: (customerId: string) => void;
  onDelete: (id: string) => void;
  /**
   * Optional handler for the per-row "Mark as reviewed" quick-action that
   * appears next to the Fix shortcut on flagged rows. Wired in pages that
   * have access to the data store's `updateLease` (Leases page, Property
   * detail's Leases tab) so operators can clear `needsReview` without
   * opening each lease (Task #329). When omitted the icon is hidden — the
   * mockup sandbox / unit tests that don't pass it keep the original two
   * actions only.
   */
  onMarkReviewed?: (id: string) => void;
  /**
   * Optional handler that lets the End column render an inline date
   * editor on rows whose `endDate` is blank (Task #430). When wired,
   * the cell shows a clickable "No end date" pill that opens the same
   * RenewLeasePopover used by the per-property header — saving updates
   * the lease via this callback (which the page maps to the data
   * store's `updateLease`). When omitted (mockup sandbox / unit tests)
   * blank-end rows fall back to a plain em-dash.
   */
  onUpdateLease?: (id: string, updates: Partial<Lease>) => void;
  /**
   * Optional handler for the bulk "Mark selected as reviewed" toolbar
   * action (Task #360 — stretch from #329). When wired, the table renders
   * a leftmost checkbox column on flagged rows plus a header master
   * checkbox, and a toolbar above the grid showing the selection count
   * and a "Mark N selected as reviewed" button. The handler receives the
   * list of selected lease ids; the table clears its own selection
   * afterwards. When omitted (mockup sandbox / unit tests) the column
   * and toolbar are hidden so the surface keeps its original shape.
   */
  onBulkMarkReviewed?: (ids: string[]) => void;
  /** Custom message for the empty state. */
  emptyMessage?: string;
  /** Optional CTA rendered inside the empty-state block (e.g. "Add Lease"). */
  emptyAction?: import("react").ReactNode;
  /**
   * Properties that have **no** lease records yet. The table renders one
   * "No lease yet" placeholder row per property so the operator sees every
   * property in the list. The whole row is clickable and navigates to the
   * lease-detail "create" page (`/leases/new?propertyId=…`). Placeholders
   * are UI-only — they are never persisted.
   */
  placeholderProperties?: readonly Property[];
  /**
   * All room-night logs across hotel-rate leases (from `useListRoomNightLogs`).
   * When provided, the Status column adds a "Below min" or "No log yet"
   * pill for hotel-rate leases (`monthlyRoomNightMin > 0`) whose latest
   * month is short of the minimum or missing entirely. Defaults to an
   * empty array so callers that don't care about this signal (e.g. the
   * per-property Leases tab) keep their current behaviour.
   */
  roomNightLogs?: readonly RoomNightLog[];
  /**
   * Per-property recurring non-rent costs (task #497). When a lease's
   * property has `rentFree: true`, the Rent column shows the sum of
   * that property's `OtherCost` rows instead of the lease's stored $0
   * `monthlyRent`. Defaults to an empty array so callers that don't
   * care (sandbox / unit tests) keep their current behaviour.
   */
  otherCosts?: readonly OtherCost[];
  /**
   * Buildings keyed by property (Task #587). When a lease's property
   * has more than one building, the Property cell renders a small
   * "Building X" label beneath the property name so operators can tell
   * which building the lease applies to without opening the lease.
   * Defaults to an empty array so callers that don't care (sandbox /
   * unit tests) keep their current behaviour.
   */
  buildings?: readonly Building[];
  /**
   * Page path (no leading hash) the user is currently on. Threaded through
   * to the lease detail page via the `?from=` query string so the back
   * link there can return to the *exact* surface the user came from
   * (global Leases page vs. a specific Property's Leases tab) instead of
   * defaulting to /leases. Examples: `/leases`, `/properties/p1`.
   */
  originPath?: string;
}

/**
 * CSS selector that identifies "interactive" cell elements. Used by the
 * row-level click and Enter-key handlers so that clicks landing on the
 * Property/Customer name buttons or the trash icon don't ALSO trigger row
 * navigation. Even though the table no longer hosts inline editors, the
 * Property/Customer name links and the per-row trash button are still
 * interactive — those keep their native behaviour.
 */
const INTERACTIVE_SELECTOR =
  'button, input, select, textarea, a, [role="combobox"], [contenteditable="true"]';

const NOTES_PREVIEW_LIMIT = 60;

function truncateNotes(notes: string): string {
  const trimmed = notes.trim();
  if (trimmed.length <= NOTES_PREVIEW_LIMIT) return trimmed;
  return trimmed.slice(0, NOTES_PREVIEW_LIMIT - 1).trimEnd() + "…";
}

/**
 * The master importer prefixes the explanation of why a row was flagged with
 * `Needs review:` in the lease's notes (see `buildLeaseNotes` in
 * `artifacts/api-server/src/lib/import-master-leases.ts`). Pull just that
 * sentence out so the badge tooltip can show the operator-friendly reason
 * without the rest of the import metadata. Falls back to a generic message
 * when the notes were edited or the row was flagged via another path.
 */
function extractNeedsReviewReason(notes: string): string {
  // Capture everything between "Needs review:" and the next importer
  // sentence ("Source: master file row …"), or to end-of-string when the
  // notes were trimmed. The reason itself can contain periods (e.g.
  // `weekly cost not numeric: "$69.23???"`), so a simple `[^.]+` cuts the
  // text in half — match against the known follow-on sentence instead.
  const match = notes.match(/Needs review:\s*(.+?)(?:\s*Source:|$)/is);
  if (match && match[1]) return match[1].trim().replace(/\.$/, "");
  return "This lease was flagged during import. Open it to clean up the data.";
}

function formatMoney(n: number): string {
  return `${formatUsd(n)}`;
}

/**
 * Inline-editable monthly rent. Click the amount to type a new one; Enter or
 * blur saves via `onSave`. Surfaces a clear "Set rent" affordance when rent
 * is $0 (the top lease-cleanup task — 50+ leases imported with no rent).
 */
function EditableRent({ value, onSave }: { value: number; onSave: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value || ""));
  if (editing) {
    const save = () => {
      const n = Math.round(parseFloat(val) || 0);
      if (n !== value) onSave(n);
      setEditing(false);
    };
    return (
      <input
        autoFocus
        type="number"
        min={0}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") { setVal(String(value || "")); setEditing(false); }
        }}
        className="h-7 w-24 rounded-md border bg-background px-2 text-right text-sm tabular-nums"
        data-testid="input-lease-rent"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => { setVal(String(value || "")); setEditing(true); }}
      className="rounded px-1 hover:bg-muted/60 hover:underline"
      title="Click to edit rent"
    >
      {value > 0 ? formatMoney(value) : <span className="text-amber-600">Set rent</span>}
    </button>
  );
}

/**
 * Compact "Building X" label that renders beneath the property name on
 * each lease row when the lease's parent property has more than one
 * building (Task #587). For single-building properties — by far the
 * common case — this returns null so the row stays unchanged.
 *
 * If the lease has a `buildingId` we render that building's name. If
 * the field is blank/null on a multi-building property (legacy / not-
 * yet-assigned rows) we render a muted "Building unassigned" hint so
 * operators can spot the gap without opening the lease.
 */
function LeaseBuildingLabel({
  lease,
  propertyBuildings,
  buildingById,
  onUpdateLease,
}: {
  lease: Lease;
  propertyBuildings: readonly Building[];
  buildingById: Map<string, Building>;
  /**
   * When provided, the label becomes an inline building picker (Task #591)
   * so operators can assign / change a lease's building right from the
   * leases table. When omitted (sandbox / unit tests) the label remains
   * read-only.
   */
  onUpdateLease?: (id: string, updates: Partial<Lease>) => void;
}) {
  if (propertyBuildings.length <= 1) return null;
  const building = lease.buildingId ? buildingById.get(lease.buildingId) : null;
  const baseClass =
    "inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground";
  const labelText = building ? building.name : "Building unassigned";
  const labelTitle = building
    ? onUpdateLease
      ? `Building: ${building.name} — click to change`
      : `Building: ${building.name}`
    : onUpdateLease
    ? "Click to assign a building"
    : "This lease isn't assigned to a building yet.";

  if (!onUpdateLease) {
    return (
      <span
        className={cn(baseClass, !building && "italic")}
        data-testid={`lease-building-label-${lease.id}`}
        title={labelTitle}
      >
        <Building2 className="h-3 w-3 opacity-60" aria-hidden />
        {labelText}
      </span>
    );
  }

  return (
    <BuildingPicker
      buildings={propertyBuildings}
      selectedId={lease.buildingId ?? null}
      onSelect={(buildingId) => onUpdateLease(lease.id, { buildingId })}
      contentTestId={`lease-building-picker-${lease.id}`}
      trigger={
        <button
          type="button"
          className={cn(
            baseClass,
            "rounded-sm hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !building && "italic",
          )}
          data-testid={`lease-building-label-${lease.id}`}
          title={labelTitle}
          onClick={(e) => e.stopPropagation()}
        >
          <Building2 className="h-3 w-3 opacity-60" aria-hidden />
          {labelText}
        </button>
      }
    />
  );
}

/**
 * A single source of truth for *listing* leases. Used both on the global
 * Leases page (with a Property column) and on the Property Detail page's
 * Leases tab (without it, since context is implicit).
 *
 * Every cell is read-only on this surface — to edit a lease the user opens
 * its detail page by clicking anywhere on the row. The trash icon stays as
 * a fast row-level action; placeholder rows omit it (there's nothing to
 * delete yet).
 *
 * In addition to real lease rows, the table can render "placeholder" rows
 * for properties without a lease (see {@link LeasesTableProps.placeholderProperties}).
 * Placeholder rows render em-dashes for the missing fields, carry a
 * "No lease yet" pill in the status column, and navigate to the
 * lease-detail page in create mode (`/leases/new?propertyId=…`) when
 * clicked.
 */
export function LeasesTable({
  leases,
  properties,
  customers,
  showProperty = true,
  showCustomer = false,
  onPropertyClick,
  onCustomerClick,
  onDelete,
  onMarkReviewed,
  onUpdateLease,
  onBulkMarkReviewed,
  emptyMessage = "No leases found.",
  emptyAction,
  placeholderProperties = [],
  roomNightLogs,
  otherCosts = [],
  buildings = [],
  originPath,
}: LeasesTableProps) {
  const propertyById = new Map(properties.map((p) => [p.id, p] as const));
  // Building lookups for the "Building X" sub-label under each property
  // name (Task #587). We need both `byPropertyId` (to know how many a
  // property has — single-building properties skip the label entirely)
  // and `byId` (to render the matching building's name from the
  // lease's `buildingId`).
  const buildingsByPropertyId = useMemo(() => {
    const m = new Map<string, Building[]>();
    for (const b of buildings) {
      const list = m.get(b.propertyId) ?? [];
      list.push(b);
      m.set(b.propertyId, list);
    }
    return m;
  }, [buildings]);
  const buildingById = useMemo(
    () => new Map(buildings.map((b) => [b.id, b] as const)),
    [buildings],
  );
  // Pre-aggregate OtherCost rows per property so the Rent column lookup
  // is O(1) per row instead of O(n) per render.
  const otherCostsByPropertyId = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of otherCosts) {
      m.set(c.propertyId, (m.get(c.propertyId) ?? 0) + (c.monthlyCost || 0));
    }
    return m;
  }, [otherCosts]);
  const customerById = new Map((customers ?? []).map((c) => [c.id, c] as const));
  const [, navigate] = useLocation();

  // Bulk-select state for the "Mark selected as reviewed" toolbar
  // (Task #360). Selection is internal to the table — the parent only
  // hands us a handler — so we can clear it ourselves after the bulk
  // action without round-tripping through the data store.
  const bulkEnabled = !!onBulkMarkReviewed;
  const flaggedIds = useMemo(
    () => leases.filter((l) => l.needsReview).map((l) => l.id),
    [leases],
  );
  const flaggedIdSet = useMemo(() => new Set(flaggedIds), [flaggedIds]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // Drop selections for ids that are no longer in the (possibly filtered)
  // flagged set so the toolbar count never lies. Runs whenever the set of
  // flagged ids in this table changes (filter swap, parent refetch, etc.).
  useEffect(() => {
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (flaggedIdSet.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [flaggedIdSet]);
  const selectedFlaggedCount = selectedIds.size;
  const allFlaggedSelected =
    flaggedIds.length > 0 && selectedFlaggedCount === flaggedIds.length;
  const someFlaggedSelected =
    selectedFlaggedCount > 0 && selectedFlaggedCount < flaggedIds.length;
  const headerCheckedState: boolean | "indeterminate" = allFlaggedSelected
    ? true
    : someFlaggedSelected
    ? "indeterminate"
    : false;
  const toggleRowSelected = (id: string, checked: boolean | "indeterminate") => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked === true) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const toggleAllSelected = (checked: boolean | "indeterminate") => {
    if (checked === true) setSelectedIds(new Set(flaggedIds));
    else setSelectedIds(new Set());
  };
  const handleBulkMarkReviewed = () => {
    if (!onBulkMarkReviewed) return;
    const ids = flaggedIds.filter((id) => selectedIds.has(id));
    if (ids.length === 0) return;
    onBulkMarkReviewed(ids);
    setSelectedIds(new Set());
  };

  const fromSuffix = originPath ? `?from=${encodeURIComponent(originPath)}` : "";
  const leaseHref = (leaseId: string) => `/leases/${leaseId}${fromSuffix}`;
  const newLeaseHref = (propertyId: string) =>
    `/leases/new?propertyId=${encodeURIComponent(propertyId)}` +
    (originPath ? `&from=${encodeURIComponent(originPath)}` : "");

  // Row-level click → navigate. Bails out when the click target is itself
  // (or lives inside) an interactive element so the Property/Customer name
  // buttons and the trash icon keep their native click behaviour.
  // Non-primary clicks (middle/right) and modified clicks are also ignored
  // so operators can still middle-click the Property name link to open it
  // in a new tab.
  const handleRowClick =
    (href: string) => (e: React.MouseEvent<HTMLTableRowElement>) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest(INTERACTIVE_SELECTOR)) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      navigate(href);
    };

  // Keyboard parity for the row-as-button: Enter (and Space) opens the
  // detail / create page just like a click. We only act when the focused
  // element is the row itself; if focus is on a nested button (the
  // trash icon, a name link), let that element's own handler take over.
  const handleRowKeyDown =
    (href: string) => (e: React.KeyboardEvent<HTMLTableRowElement>) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target !== e.currentTarget) return;
      e.preventDefault();
      navigate(href);
    };

  // Standalone Building column (Task #587). Only rendered when the
  // Property column is hidden (e.g., the Property Detail → Leases tab,
  // where every row shares the same property) AND at least one row's
  // property has more than one building. Without this, the per-property
  // Leases tab would have nowhere to display building context.
  const showBuilding = useMemo(() => {
    if (showProperty) return false;
    for (const lease of leases) {
      const propBuildings = buildingsByPropertyId.get(lease.propertyId) ?? [];
      if (propBuildings.length > 1) return true;
    }
    for (const placeholder of placeholderProperties) {
      const propBuildings = buildingsByPropertyId.get(placeholder.id) ?? [];
      if (propBuildings.length > 1) return true;
    }
    return false;
  }, [showProperty, leases, placeholderProperties, buildingsByPropertyId]);

  // (optional) 1 bulk-select column + 1 PDF thumbnail column + Property +
  // (optional) Building + Customer + 7 always-on columns (Start, End,
  // Rent, Deposit, Status, Terms, Notes) + 1 trash column.
  const columnCount =
    (bulkEnabled ? 1 : 0) +
    1 +
    (showProperty ? 1 : 0) +
    (showBuilding ? 1 : 0) +
    (showCustomer ? 1 : 0) +
    7 +
    1;

  const hasAnyRows = leases.length > 0 || placeholderProperties.length > 0;

  return (
    <>
      {bulkEnabled && selectedFlaggedCount > 0 && (
        <div
          className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 mx-2 mt-2"
          data-testid="leases-bulk-toolbar"
          role="toolbar"
          aria-label="Bulk lease actions"
        >
          <span
            className="text-sm font-medium text-amber-900"
            data-testid="text-bulk-selected-count"
          >
            {selectedFlaggedCount} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
              data-testid="button-clear-bulk-selection"
            >
              Clear
            </Button>
            <Button
              size="sm"
              onClick={handleBulkMarkReviewed}
              data-testid="button-bulk-mark-reviewed"
              className="gap-1"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Mark {selectedFlaggedCount} as reviewed
            </Button>
          </div>
        </div>
      )}
      <Table>
      <TableHeader>
        <TableRow>
          {bulkEnabled && (
            <TableHead className="w-10">
              {flaggedIds.length > 0 ? (
                <Checkbox
                  checked={headerCheckedState}
                  onCheckedChange={toggleAllSelected}
                  aria-label="Select all flagged leases"
                  data-testid="checkbox-select-all-flagged-leases"
                />
              ) : (
                <span className="sr-only">Select</span>
              )}
            </TableHead>
          )}
          <TableHead className="w-12">
            <span className="sr-only">Source PDF</span>
          </TableHead>
          {showProperty && <TableHead>Property</TableHead>}
          {showBuilding && <TableHead>Building</TableHead>}
          {showCustomer && <TableHead>Customer</TableHead>}
          <TableHead>Start Date</TableHead>
          <TableHead>End Date</TableHead>
          <TableHead className="text-right">Monthly Rent</TableHead>
          <TableHead className="text-right">Security Deposit</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Terms</TableHead>
          <TableHead>Notes</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {!hasAnyRows ? (
          <EmptyStateRow
            colSpan={columnCount}
            icon={KeyRound}
            title={emptyMessage}
            description="Leases you create or import will appear here."
            action={emptyAction}
            testId="empty-leases-table"
          />
        ) : (
          <>
            {leases.map((lease) => {
              const property = propertyById.get(lease.propertyId);
              const customer = property ? customerById.get(property.customerId) : undefined;
              const href = leaseHref(lease.id);
              return (
                <TableRow
                  key={lease.id}
                  data-testid={`row-lease-${lease.id}`}
                  onClick={handleRowClick(href)}
                  onKeyDown={handleRowKeyDown(href)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open lease for ${property?.name ?? "unknown property"}`}
                  className={cn(
                    "cursor-pointer hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring",
                    // De-emphasize expired leases so active rows read first.
                    lease.status === "Expired" && "opacity-60",
                  )}
                >
                  {bulkEnabled && (
                    <TableCell
                      className="w-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {lease.needsReview ? (
                        <Checkbox
                          checked={selectedIds.has(lease.id)}
                          onCheckedChange={(checked) =>
                            toggleRowSelected(lease.id, checked)
                          }
                          aria-label={`Select lease ${lease.id} for bulk review`}
                          data-testid={`checkbox-select-lease-${lease.id}`}
                        />
                      ) : null}
                    </TableCell>
                  )}
                  <TableCell className="w-12 py-1">
                    <LeaseSourceThumbnail
                      lease={lease}
                      originPath={originPath}
                    />
                  </TableCell>
                  {showProperty && (
                    <TableCell className="font-medium">
                      {property ? (
                        <div className="flex flex-col gap-0.5">
                          {onPropertyClick ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onPropertyClick(property.id);
                              }}
                              className="rounded-sm hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring text-left"
                              data-testid={`link-lease-property-${lease.id}`}
                            >
                              <PropertyNameCell name={property.name} />
                            </button>
                          ) : (
                            <PropertyNameCell name={property.name} />
                          )}
                          <LeaseBuildingLabel
                            lease={lease}
                            propertyBuildings={
                              buildingsByPropertyId.get(lease.propertyId) ?? []
                            }
                            buildingById={buildingById}
                            onUpdateLease={onUpdateLease}
                          />
                          {lease.unit?.trim() && (
                            // Show the unit so multi-unit properties don't
                            // read as duplicate rows (same property name +
                            // dates on every line).
                            <span
                              className="text-[11px] font-normal text-muted-foreground tabular-nums"
                              data-testid={`lease-unit-${lease.id}`}
                            >
                              Unit {lease.unit}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="italic text-muted-foreground">Unknown</span>
                      )}
                    </TableCell>
                  )}
                  {showBuilding && (
                    <TableCell className="text-sm">
                      <LeaseBuildingLabel
                        lease={lease}
                        propertyBuildings={
                          buildingsByPropertyId.get(lease.propertyId) ?? []
                        }
                        buildingById={buildingById}
                        onUpdateLease={onUpdateLease}
                      />
                    </TableCell>
                  )}
                  {showCustomer && (
                    <TableCell className="text-sm text-muted-foreground">
                      {customer ? (
                        onCustomerClick ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onCustomerClick(customer.id);
                            }}
                            className="rounded-sm hover:underline hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring text-left"
                            data-testid={`button-filter-customer-${lease.id}`}
                            aria-label={`Filter by customer ${customer.name}`}
                          >
                            {customer.name}
                          </button>
                        ) : (
                          customer.name
                        )
                      ) : (
                        <span className="italic">—</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-sm" data-testid={`cell-lease-start-${lease.id}`}>
                    {lease.startDate || "—"}
                  </TableCell>
                  <TableCell className="text-sm" data-testid={`cell-lease-end-${lease.id}`}>
                    {isBlankYMD(lease.endDate) ? (
                      onUpdateLease ? (
                        // Inline end-date editor for master-import /
                        // month-to-month rows that ship with no endDate
                        // (Task #430). Reuses the same RenewLeasePopover
                        // the property-detail header uses, so a single
                        // click on the pill opens a date input the
                        // operator can fill in without leaving the row.
                        <RenewLeasePopover
                          currentEndDate={lease.endDate}
                          currentStatus={lease.status}
                          propertyName={property?.name}
                          onRenew={(newEndDate, newStatus) =>
                            onUpdateLease(lease.id, {
                              endDate: newEndDate,
                              status: newStatus,
                            })
                          }
                          align="start"
                          trigger={
                            <button
                              type="button"
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`badge-lease-no-end-date-${lease.id}`}
                              title="Month-to-month — click to set a fixed end date if this lease has one"
                              className="inline-flex items-center rounded-md border border-dashed border-input bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              Month-to-month
                            </button>
                          }
                        />
                      ) : (
                        "—"
                      )
                    ) : (
                      lease.endDate
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums" data-testid={`cell-lease-rent-${lease.id}`}>
                    {(() => {
                      // Rent-free properties (task #497) store $0 rent on
                      // each lease by design — surface the property's
                      // recurring "other costs" total instead so this
                      // column never shows a perpetual $0 for cleaning-
                      // fee-only sites.
                      const property = propertyById.get(lease.propertyId);
                      if (property?.rentFree) {
                        const total = otherCostsByPropertyId.get(lease.propertyId) ?? 0;
                        return total > 0 ? formatMoney(total) : "—";
                      }
                      // Inline rent editing for monthly leases when the data
                      // store is wired (room-night leases price by nightly
                      // rate, so leave those read-only here).
                      if (onUpdateLease && (lease.rateType ?? "monthly") === "monthly") {
                        return (
                          <EditableRent
                            value={lease.monthlyRent}
                            onSave={(n) =>
                              onUpdateLease(lease.id, n > 0 ? { monthlyRent: n, needsReview: false } : { monthlyRent: n })
                            }
                          />
                        );
                      }
                      return formatMoney(lease.monthlyRent);
                    })()}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums" data-testid={`cell-lease-deposit-${lease.id}`}>
                    {formatMoney(lease.securityDeposit)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge
                        variant={
                          lease.status === "Active"
                            ? "default"
                            : lease.status === "Expired"
                            ? "destructive"
                            : "secondary"
                        }
                        data-testid={`badge-lease-status-${lease.id}`}
                      >
                        {lease.status}
                      </Badge>
                      {isBlankYMD(lease.startDate) && !isBlankYMD(lease.endDate) && (
                        // Only flag a genuinely incomplete fixed-term lease
                        // (has an end date but no start). A lease with NO end
                        // date is month-to-month, not "missing dates", so it
                        // shows the neutral Month-to-month pill instead and
                        // never nags here (operator request).
                        // Blank-date triage flag (task #363) — master-import
                        // and Ridge Motor Inn seed rows can land with empty
                        // start/end dates, so we surface a dedicated amber
                        // pill so operators can spot them without scanning
                        // every row's term cells. The badge is itself a
                        // link to the lease detail page with the Start
                        // Date editor pre-focused (mirrors the per-row
                        // "Fix dates" icon below) so a single click on
                        // the badge takes the operator straight into the
                        // edit flow.
                        <Link
                          href={
                            `/leases/${lease.id}?focus=dates` +
                            (originPath ? `&from=${encodeURIComponent(originPath)}` : "")
                          }
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`badge-lease-needs-dates-${lease.id}`}
                          title="This lease is missing a start or end date — click to fill them in."
                          className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                        >
                          <CalendarClock className="h-3 w-3" />
                          Needs dates
                        </Link>
                      )}
                      {lease.needsReview && (
                        // Title attribute pulls the importer's reason out of
                        // notes so a hover preview answers "why is this
                        // flagged?" without coupling to the App-root Tooltip
                        // provider (which is absent in unit tests).
                        <Badge
                          variant="outline"
                          className="gap-1 text-[11px] font-medium border-amber-300 bg-amber-50 text-amber-800"
                          title={extractNeedsReviewReason(lease.notes)}
                          data-testid={`badge-lease-needs-review-${lease.id}`}
                        >
                          <AlertTriangle className="h-3 w-3" />
                          Needs review
                        </Badge>
                      )}
                      {(() => {
                        // Hotel-rate at-risk pill — surfaces the same "Below
                        // min" warning that lives on the lease detail page so
                        // operators can spot at-risk months across every
                        // hotel-rate agreement at a glance (task #319).
                        // Hidden entirely when the caller didn't wire the
                        // logs prop (per-property Leases tab) — without the
                        // logs we can't tell "no log yet" apart from "didn't
                        // fetch", so we say nothing rather than risk a
                        // false-positive alarm.
                        if (!roomNightLogs) return null;
                        const risk = getHotelRateRiskStatus(lease, roomNightLogs);
                        if (!risk) return null;
                        const label =
                          risk.kind === "missing"
                            ? "No log yet"
                            : `Below min · ${risk.latestNights}/${risk.monthlyMin}`;
                        const title =
                          risk.kind === "missing"
                            ? `No room-night log yet — minimum is ${risk.monthlyMin} nights/month.`
                            : `Latest month ${risk.latestMonth}: ${risk.latestNights} of ${risk.monthlyMin} required nights.`;
                        return (
                          <Badge
                            variant="outline"
                            className="gap-1 text-[11px] font-medium border-rose-300 bg-rose-50 text-rose-800"
                            title={title}
                            data-testid={`badge-lease-room-night-risk-${lease.id}`}
                          >
                            <Hotel className="h-3 w-3" />
                            {label}
                          </Badge>
                        );
                      })()}
                    </div>
                  </TableCell>
                  <TableCell>
                    <LeaseTermsBadges lease={lease} />
                  </TableCell>
                  <TableCell className="max-w-[260px] min-w-[180px]">
                    {lease.notes.trim().length === 0 ? (
                      <span className="text-sm italic text-muted-foreground">—</span>
                    ) : (
                      <span
                        className="text-sm text-muted-foreground"
                        title={lease.notes}
                        data-testid={`notes-preview-${lease.id}`}
                      >
                        {truncateNotes(lease.notes)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {/*
                        "View source PDF" quick action — every seeded lease
                        records its originating PDF filename in notes/clauses
                        (e.g. `Source: Lease_-1331_..._kfi-staff_…pdf`). When
                        present, render a small external-link icon that opens
                        the bundled file via the api-server's attached-assets
                        route in a new tab (Task #308). Hidden for leases
                        with no source — no broken UI.
                      */}
                      {(() => {
                        const sourcePdf = extractSourcePdfFilename(
                          lease.notes,
                          lease.clauses,
                        );
                        if (!sourcePdf) return null;
                        return (
                          <a
                            href={sourcePdfHref(sourcePdf)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`link-lease-source-pdf-${lease.id}`}
                            title={`Open source PDF: ${sourcePdf}`}
                          >
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 px-2 text-xs"
                              aria-label="View source PDF"
                              tabIndex={-1}
                            >
                              <FileText className="h-3.5 w-3.5" />
                              PDF
                            </Button>
                          </a>
                        );
                      })()}
                      {lease.needsReview && onMarkReviewed && (
                        // Per-row "Mark as reviewed" quick-action (Task #329)
                        // — clears `needsReview` via the same updateLease
                        // path the lease detail page's button uses, so
                        // operators can triage a long list of flagged rows
                        // without opening each one. Mirrors the styling of
                        // the lease-detail header button (amber outline +
                        // CheckCircle2 icon) so the two surfaces feel like
                        // the same action.
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-amber-700 hover:text-amber-800"
                          onClick={(e) => {
                            e.stopPropagation();
                            onMarkReviewed(lease.id);
                          }}
                          data-testid={`button-mark-lease-reviewed-${lease.id}`}
                          aria-label="Mark lease as reviewed"
                          title="Mark as reviewed"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {isBlankYMD(lease.startDate) && !isBlankYMD(lease.endDate) && (
                        // "Fix dates" shortcut for blank-date triage rows
                        // (task #363). Threads the origin path through (so
                        // the back-link returns here) and adds
                        // `?focus=dates` so lease-detail opens with the
                        // Start Date inline editor pre-focused and
                        // scrolled into view.
                        <Link
                          href={
                            `/leases/${lease.id}?focus=dates` +
                            (originPath ? `&from=${encodeURIComponent(originPath)}` : "")
                          }
                        >
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-amber-700 hover:text-amber-800"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`button-fix-lease-dates-${lease.id}`}
                            aria-label="Fix missing lease dates"
                            title="Fix missing dates"
                          >
                            <CalendarClock className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      )}
                      {lease.needsReview && (
                        // Quick-fix shortcut for flagged leases. Threads the
                        // origin path through (so the back-link returns
                        // here) and adds `?focus=rent` so lease-detail
                        // opens with the rent inline editor pre-focused.
                        <Link
                          href={
                            `/leases/${lease.id}?focus=rent` +
                            (originPath ? `&from=${encodeURIComponent(originPath)}` : "")
                          }
                        >
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-amber-700 hover:text-amber-800"
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`button-fix-lease-${lease.id}`}
                            aria-label="Fix flagged lease"
                            title="Fix flagged lease"
                          >
                            <Wrench className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      )}
                      {/* AlertDialog confirms the delete so a stray row-trash
                          click doesn't permanently remove a lease during the
                          demo. The trigger Button still calls stopPropagation
                          so the row's click handler doesn't ALSO navigate to
                          the lease detail page when opening the dialog. */}
                      <ConfirmDeleteButton
                      title="Delete this lease?"
                      description={
                        <>
                          You're about to delete the lease for{" "}
                          <span className="font-medium text-foreground">
                            {property?.name ?? "this property"}
                          </span>
                          {customer ? (
                            <>
                              {" "}(<span>{customer.name}</span>)
                            </>
                          ) : null}
                          . This can't be undone.
                        </>
                      }
                      onConfirm={() => onDelete(lease.id)}
                      testId={`dialog-confirm-delete-lease-${lease.id}`}
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`button-delete-lease-${lease.id}`}
                          aria-label="Delete lease"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      }
                    />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {placeholderProperties.map((property) => {
              const customer = customerById.get(property.customerId);
              const href = newLeaseHref(property.id);
              return (
                <TableRow
                  key={`placeholder-${property.id}`}
                  className="bg-muted/20 cursor-pointer hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring"
                  data-testid={`row-lease-placeholder-${property.id}`}
                  onClick={handleRowClick(href)}
                  onKeyDown={handleRowKeyDown(href)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Create lease for ${property.name}`}
                >
                  {bulkEnabled && <TableCell className="w-10" />}
                  {/* Placeholder rows have no lease record (and therefore
                      no source PDF), so the thumbnail column renders an
                      empty cell to keep grid alignment with real rows. */}
                  <TableCell className="w-12" />
                  {showProperty && (
                    <TableCell className="font-medium">
                      {onPropertyClick ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPropertyClick(property.id);
                          }}
                          className="rounded-sm hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring text-left"
                          data-testid={`link-lease-placeholder-property-${property.id}`}
                        >
                          <PropertyNameCell name={property.name} />
                        </button>
                      ) : (
                        <PropertyNameCell name={property.name} />
                      )}
                      {property.address && (
                        <p className="text-[11px] font-normal text-muted-foreground mt-0.5">
                          {property.address}
                        </p>
                      )}
                    </TableCell>
                  )}
                  {showBuilding && (
                    <TableCell className="text-sm text-muted-foreground">—</TableCell>
                  )}
                  {showCustomer && (
                    <TableCell className="text-sm text-muted-foreground">
                      {customer ? customer.name : <span className="italic">—</span>}
                    </TableCell>
                  )}
                  <TableCell className="text-sm text-muted-foreground">—</TableCell>
                  <TableCell className="text-sm text-muted-foreground">—</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">—</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">—</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="text-[11px] font-medium text-muted-foreground"
                      data-testid={`badge-lease-placeholder-${property.id}`}
                    >
                      No lease yet
                    </Badge>
                  </TableCell>
                  {/* Placeholder rows have no underlying lease state, so the
                      Terms and Notes columns render an em-dash to keep the
                      grid aligned. */}
                  <TableCell className="text-sm text-muted-foreground">—</TableCell>
                  <TableCell className="text-sm text-muted-foreground">—</TableCell>
                  {/* No trash on placeholder rows — there's nothing to
                      delete yet, and offering one here would suggest the
                      property itself could be removed from this view. */}
                  <TableCell />
                </TableRow>
              );
            })}
          </>
        )}
      </TableBody>
    </Table>
    </>
  );
}

/**
 * Page-1 PDF thumbnail (or a clear PDF icon fallback) rendered inside the
 * leases-table's leftmost column (Task #344). The thumbnail is fetched
 * from the api-server's `/api/attached-assets/:filename/thumbnail` route
 * (rendered server-side via pdfjs-dist + @napi-rs/canvas) so an operator
 * can scan a long leases list and recognise the right document at a
 * glance without opening each row.
 *
 *   • No source PDF on the lease → renders nothing (the cell stays empty
 *     so rows without an attached document don't pretend to have one).
 *   • Source PDF present → fetches a 120px-wide PNG and renders it inside
 *     a clickable button. Clicking jumps to the lease detail page with
 *     `?focus=preview` so the inline iframe preview is pre-expanded and
 *     scrolled into view.
 *   • Server-side render fails (PDF removed, pdfjs error, …) → the
 *     `<img>` `onError` handler swaps in a neutral PDF icon so operators
 *     still get a clear visual marker that the row carries a document.
 */
function LeaseSourceThumbnail({
  lease,
  originPath,
}: {
  lease: Lease;
  originPath?: string;
}) {
  const [imageBroken, setImageBroken] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const sourcePdf = extractSourcePdfFilename(lease.notes, lease.clauses);
  if (!sourcePdf) return null;

  const previewHref =
    `/leases/${lease.id}?focus=preview` +
    (originPath ? `&from=${encodeURIComponent(originPath)}` : "");
  const thumbnailSrc = sourcePdfThumbnailHref(sourcePdf, 120);
  // Show the shimmer placeholder until the lazy-loaded thumbnail finishes
  // decoding (or errors out to the fallback icon). Sized to match the link's
  // 9×12 box so swapping it for the image/icon causes no layout shift.
  const showSkeleton = !imageBroken && !imageLoaded;

  return (
    <Link
      href={previewHref}
      onClick={(e) => e.stopPropagation()}
      data-testid={`link-lease-source-thumbnail-${lease.id}`}
      title={`Open inline preview: ${sourcePdf}`}
      aria-label={`Open inline preview of source PDF for lease ${lease.id}`}
      className="relative inline-flex h-12 w-9 items-center justify-center overflow-hidden rounded border border-border bg-muted/40 hover:border-primary/40 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {showSkeleton && (
        <Skeleton
          className="absolute inset-0 h-full w-full rounded-none"
          data-testid={`skeleton-lease-source-thumbnail-${lease.id}`}
          aria-hidden="true"
        />
      )}
      {imageBroken ? (
        <FileText
          className="h-5 w-5 text-muted-foreground"
          data-testid={`icon-lease-source-thumbnail-fallback-${lease.id}`}
          aria-hidden="true"
        />
      ) : (
        <img
          src={thumbnailSrc}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setImageLoaded(true)}
          onError={() => {
            setImageBroken(true);
            setImageLoaded(false);
          }}
          data-testid={`img-lease-source-thumbnail-${lease.id}`}
          className={cn(
            "h-full w-full object-cover object-top transition-opacity",
            imageLoaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </Link>
  );
}

/**
 * Compact at-a-glance signals for two extended lease fields that otherwise
 * only show up after opening the lease detail page:
 *   • Buyout availability (with the cost when set) — operators triaging
 *     "can this tenant exit early and for how much?" need this without
 *     drilling in.
 *   • Clauses present — a non-empty free-form clauses field gets a small
 *     "Clauses" pill so reviewers know there is custom legalese to read.
 *
 * Renders an em-dash when neither signal applies so the cell stays
 * vertically aligned with peers in the column.
 */
function LeaseTermsBadges({ lease }: { lease: Lease }) {
  const { t } = useTranslation();
  const hasBuyout = lease.buyoutAvailable ?? false;
  const hasClauses = (lease.clauses ?? "").trim().length > 0;
  // Hotel-rate (room-night) agreements are surfaced as a distinct pill so
  // operators can tell at a glance which rows are billed per night vs.
  // monthly. The nightly rate (when set) is rolled into the badge label so
  // the most useful number is visible without opening the lease detail.
  const isRateBased = lease.rateType === "room-night";
  const nightlyRate = lease.nightlyRate ?? 0;
  // Corporate-responsibility flag (task #313) — when true the customer
  // (not the occupant) is on the hook for rent, utilities, and damages.
  // Surfaced as a pill so operators can scan the table for which rows
  // their customer must invoice or chase up directly.
  const isCustomerResponsible = lease.customerResponsibleForRent ?? false;
  // Utilities-included flag (task #518) — surfaced as a small pill so
  // operators can see at a glance which leases bundle utility costs
  // into the rent (and so won't double-count utilities on the P&L).
  const utilitiesIncluded = lease.utilitiesIncludedInRent ?? false;

  if (
    !hasBuyout &&
    !hasClauses &&
    !isRateBased &&
    !isCustomerResponsible &&
    !utilitiesIncluded
  ) {
    return (
      <span
        className="text-sm text-muted-foreground"
        data-testid={`lease-terms-empty-${lease.id}`}
      >
        —
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {isRateBased && (
        <Badge
          variant="default"
          className="gap-1 text-[11px] font-medium"
          data-testid={`badge-lease-hotel-rate-${lease.id}`}
        >
          <DollarSign className="h-3 w-3" />
          {nightlyRate > 0
            ? t("leasesTable.hotelRateNightly", { rate: formatUsd(nightlyRate) })
            : t("leasesTable.hotelRate")}
        </Badge>
      )}
      {hasBuyout && (
        <Badge
          variant="secondary"
          className="gap-1 text-[11px] font-medium"
          data-testid={`badge-lease-buyout-${lease.id}`}
        >
          <DollarSign className="h-3 w-3" />
          {lease.buyoutCost == null
            ? t("leasesTable.buyout")
            : t("leasesTable.buyoutWithCost", { cost: formatUsd(lease.buyoutCost) })}
        </Badge>
      )}
      {isCustomerResponsible && (
        <Badge
          variant="outline"
          className="gap-1 text-[11px] font-medium border-indigo-300 bg-indigo-50 text-indigo-800"
          title="The customer (not the occupant) is on the hook for rent, utilities, and damages on this lease."
          data-testid={`badge-lease-customer-responsible-${lease.id}`}
        >
          <Briefcase className="h-3 w-3" />
          Customer pays
        </Badge>
      )}
      {utilitiesIncluded && (
        <Badge
          variant="outline"
          className="gap-1 text-[11px] font-medium border-amber-300 bg-amber-50 text-amber-800"
          title="Rent already includes utility costs — Finance / Dashboard P&L skip this property's utilities for this lease."
          data-testid={`badge-lease-utilities-included-${lease.id}`}
        >
          <Zap className="h-3 w-3" />
          Utils incl.
        </Badge>
      )}
      {hasClauses && (
        // Title attribute gives a native browser preview of the clauses
        // text on hover, without coupling this cell to the Tooltip
        // provider that lives at the App root (and is absent from
        // unit-test harnesses). Operators who need to read the full
        // text still click through to the lease detail page.
        <Badge
          variant="outline"
          className="gap-1 text-[11px] font-medium"
          title={lease.clauses}
          data-testid={`badge-lease-clauses-${lease.id}`}
        >
          <FileText className="h-3 w-3" />
          Clauses
        </Badge>
      )}
    </div>
  );
}
