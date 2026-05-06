import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyStateRow } from "@/components/empty-state";
import { PropertyNameCell } from "@/components/property-name-cell";
import { KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, DollarSign, FileText, AlertTriangle, Wrench } from "lucide-react";
import { Link, useLocation } from "wouter";
import type { Lease, Customer, Property } from "@/data/mockData";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";

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
  return `$${n.toLocaleString()}`;
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
  emptyMessage = "No leases found.",
  emptyAction,
  placeholderProperties = [],
  originPath,
}: LeasesTableProps) {
  const propertyById = new Map(properties.map((p) => [p.id, p] as const));
  const customerById = new Map((customers ?? []).map((c) => [c.id, c] as const));
  const [, navigate] = useLocation();

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

  // Property + Customer + 7 always-on columns (Start, End, Rent, Deposit,
  // Status, Terms, Notes) + 1 trash column.
  const columnCount =
    (showProperty ? 1 : 0) + (showCustomer ? 1 : 0) + 7 + 1;

  const hasAnyRows = leases.length > 0 || placeholderProperties.length > 0;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showProperty && <TableHead>Property</TableHead>}
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
                  className="cursor-pointer hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {showProperty && (
                    <TableCell className="font-medium">
                      {property ? (
                        onPropertyClick ? (
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
                        )
                      ) : (
                        <span className="italic text-muted-foreground">Unknown</span>
                      )}
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
                    {lease.endDate || "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums" data-testid={`cell-lease-rent-${lease.id}`}>
                    {formatMoney(lease.monthlyRent)}
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
  const hasBuyout = lease.buyoutAvailable ?? false;
  const hasClauses = (lease.clauses ?? "").trim().length > 0;

  if (!hasBuyout && !hasClauses) {
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
      {hasBuyout && (
        <Badge
          variant="secondary"
          className="gap-1 text-[11px] font-medium"
          data-testid={`badge-lease-buyout-${lease.id}`}
        >
          <DollarSign className="h-3 w-3" />
          {lease.buyoutCost == null
            ? "Buyout"
            : `Buyout: $${lease.buyoutCost.toLocaleString()}`}
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
