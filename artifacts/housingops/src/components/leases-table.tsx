import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import type { Lease, Customer, Property } from "@/data/mockData";
import { InlineEdit, NotesEditor } from "@/pages/property-detail";

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
  onUpdate: (id: string, updates: Partial<Lease>) => void;
  onDelete: (id: string) => void;
  /** Custom message for the empty state. */
  emptyMessage?: string;
  /**
   * Properties that have **no** lease records yet. The table renders one
   * "No lease yet" placeholder row per property so the operator sees every
   * property in the list and can fill in the lease terms inline. Placeholders
   * are UI-only — they are never persisted.
   */
  placeholderProperties?: readonly Property[];
  /**
   * Click handler for the "Create lease" CTA on a placeholder row. Invoked
   * with the property id so the parent can open AddLeaseDialog with the
   * property preselected and locked.
   */
  onCreateLeaseForProperty?: (propertyId: string) => void;
}

/**
 * A single source of truth for editing leases. Used both on the global
 * Leases page (with Property/Customer columns) and on the Property Detail
 * page's Leases tab (without them, since context is implicit).
 *
 * Every cell is inline-editable: text/number cells via {@link InlineEdit},
 * status via a `<Select>`, notes via {@link NotesEditor}. Delete is a row
 * action — there's no confirm because deletes are reversible from the
 * server log and the UI is optimistic.
 *
 * In addition to real lease rows, the table can render "placeholder" rows
 * for properties without a lease (see {@link LeasesTableProps.placeholderProperties}).
 * Placeholder rows are clearly muted, replace inline editors with em-dashes,
 * carry a "No lease yet" pill in the status column, and surface a primary
 * "Create lease" CTA in the actions column.
 */
export function LeasesTable({
  leases,
  properties,
  customers,
  showProperty = true,
  showCustomer = false,
  onPropertyClick,
  onCustomerClick,
  onUpdate,
  onDelete,
  emptyMessage = "No leases found.",
  placeholderProperties = [],
  onCreateLeaseForProperty,
}: LeasesTableProps) {
  const propertyById = new Map(properties.map((p) => [p.id, p] as const));
  const customerById = new Map((customers ?? []).map((c) => [c.id, c] as const));

  // Property + Customer + 5 always-on columns + delete action column.
  const columnCount =
    (showProperty ? 1 : 0) + (showCustomer ? 1 : 0) + 5 + 1;

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
          <TableHead>Notes</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {!hasAnyRows ? (
          <TableRow>
            <TableCell colSpan={columnCount} className="h-24 text-center text-muted-foreground">
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          <>
            {leases.map((lease) => {
              const property = propertyById.get(lease.propertyId);
              const customer = property ? customerById.get(property.customerId) : undefined;
              return (
                <TableRow key={lease.id} data-testid={`row-lease-${lease.id}`}>
                  {showProperty && (
                    <TableCell className="font-medium">
                      {property ? (
                        onPropertyClick ? (
                          <button
                            type="button"
                            onClick={() => onPropertyClick(property.id)}
                            className="rounded-sm hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring text-left"
                            data-testid={`link-lease-property-${lease.id}`}
                          >
                            {property.name}
                          </button>
                        ) : (
                          property.name
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
                            onClick={() => onCustomerClick(customer.id)}
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
                  <TableCell>
                    <InlineEdit
                      value={lease.startDate}
                      type="date"
                      onSave={(v) => onUpdate(lease.id, { startDate: v })}
                      testId={`inline-lease-start-${lease.id}`}
                    />
                  </TableCell>
                  <TableCell>
                    <InlineEdit
                      value={lease.endDate}
                      type="date"
                      onSave={(v) => onUpdate(lease.id, { endDate: v })}
                      testId={`inline-lease-end-${lease.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <InlineEdit
                      value={lease.monthlyRent}
                      prefix="$"
                      type="number"
                      onSave={(v) => onUpdate(lease.id, { monthlyRent: parseFloat(v) || 0 })}
                      testId={`inline-lease-rent-${lease.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <InlineEdit
                      value={lease.securityDeposit}
                      prefix="$"
                      type="number"
                      onSave={(v) => onUpdate(lease.id, { securityDeposit: parseFloat(v) || 0 })}
                      testId={`inline-lease-deposit-${lease.id}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          lease.status === "Active"
                            ? "default"
                            : lease.status === "Expired"
                            ? "destructive"
                            : "secondary"
                        }
                        className="hidden lg:inline-flex"
                      >
                        {lease.status}
                      </Badge>
                      <Select
                        value={lease.status}
                        onValueChange={(v) =>
                          onUpdate(lease.id, { status: v as Lease["status"] })
                        }
                      >
                        <SelectTrigger
                          className="h-7 text-xs w-28"
                          data-testid={`select-lease-status-${lease.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Active">Active</SelectItem>
                          <SelectItem value="Expired">Expired</SelectItem>
                          <SelectItem value="Upcoming">Upcoming</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[260px] min-w-[180px]">
                    <NotesEditor
                      value={lease.notes}
                      className="text-sm min-h-[40px]"
                      onSave={(v) => onUpdate(lease.id, { notes: v })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(lease.id)}
                      data-testid={`button-delete-lease-${lease.id}`}
                      aria-label="Delete lease"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {placeholderProperties.map((property) => {
              const customer = customerById.get(property.customerId);
              return (
                <TableRow
                  key={`placeholder-${property.id}`}
                  className="bg-muted/20"
                  data-testid={`row-lease-placeholder-${property.id}`}
                >
                  {showProperty && (
                    <TableCell className="font-medium">
                      {onPropertyClick ? (
                        <button
                          type="button"
                          onClick={() => onPropertyClick(property.id)}
                          className="rounded-sm hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring text-left"
                          data-testid={`link-lease-placeholder-property-${property.id}`}
                        >
                          {property.name}
                        </button>
                      ) : (
                        property.name
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
                  <TableCell className="text-sm text-muted-foreground">—</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => onCreateLeaseForProperty?.(property.id)}
                      disabled={!onCreateLeaseForProperty}
                      data-testid={`button-create-lease-placeholder-${property.id}`}
                    >
                      <Plus className="h-3 w-3" />
                      Create lease
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </>
        )}
      </TableBody>
    </Table>
  );
}
