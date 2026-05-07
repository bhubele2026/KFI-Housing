import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { PropertyNameCell } from "@/components/property-name-cell";
import { shortPropertyName } from "@/lib/property-name";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, UserPlus, Download, Users, Trash2 } from "lucide-react";
import { EmptyStateRow } from "@/components/empty-state";
import { SkeletonRows } from "@/components/skeleton-rows";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { useToast } from "@/hooks/use-toast";
import { toCsv, downloadCsv, timestampedCsvName } from "@/lib/csv";
import { toWeeklyCharge, toMonthlyCharge, formatUsd } from "@/data/mockData";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { useMemo } from "react";

export default function Occupants() {
  const { occupants, properties, beds, isLoading, deleteOccupant, updateOccupant } = useData();
  const { toast } = useToast();
  const { customerId: customerScope } = useCustomerScope();
  const customerScopedPropertyIds = useMemo(() => {
    if (customerScope === ALL_CUSTOMERS) return null;
    return new Set(
      properties
        .filter(
          (p) =>
            p.customerId === customerScope ||
            (p.sharedWithCustomerIds ?? []).includes(customerScope),
        )
        .map((p) => p.id),
    );
  }, [properties, customerScope]);
  // Move-in filter is URL-driven so the dashboard "Needs review" card can deep
  // link straight into the missing-move-in subset (`?needsReview=1`). We seed
  // state from the search string and write back on change so refresh/back work.
  // The dashboard "Recently reconciled from payroll" card (Task #351) also
  // deep-links here with `?q=<name>` so the operator lands with the search
  // box pre-filled on the just-touched occupant.
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState(
    () => new URLSearchParams(searchString).get("q") ?? "",
  );
  const [propertyFilter, setPropertyFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState(() =>
    new URLSearchParams(searchString).get("chargeSource") === "manual"
      ? "Active"
      : "All",
  );
  const [shiftFilter, setShiftFilter] = useState<"All" | "1st" | "2nd" | "Unassigned">(() => {
    const raw = new URLSearchParams(searchString).get("shift");
    return raw === "1st" || raw === "2nd" || raw === "Unassigned" ? raw : "All";
  });
  const [moveInFilter, setMoveInFilter] = useState<"All" | "NeedsReview">(() =>
    new URLSearchParams(searchString).get("needsReview") === "1"
      ? "NeedsReview"
      : "All",
  );
  const [chargeSourceFilter, setChargeSourceFilter] = useState<"All" | "manual" | "payroll">(() => {
    const v = new URLSearchParams(searchString).get("chargeSource");
    return v === "manual" || v === "payroll" ? v : "All";
  });

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const next =
      params.get("needsReview") === "1" ? "NeedsReview" : "All";
    setMoveInFilter((prev) => (prev === next ? prev : next));
    const rawShift = params.get("shift");
    const nextShift: "All" | "1st" | "2nd" | "Unassigned" =
      rawShift === "1st" || rawShift === "2nd" || rawShift === "Unassigned"
        ? rawShift
        : "All";
    setShiftFilter((prev) => (prev === nextShift ? prev : nextShift));
    const q = params.get("q") ?? "";
    setSearch((prev) => (prev === q || prev !== "" && q === "" ? prev : q));
    const cs = params.get("chargeSource");
    const nextCs = cs === "manual" || cs === "payroll" ? cs : "All";
    setChargeSourceFilter((prev) => (prev === nextCs ? prev : nextCs));
  }, [searchString]);

  const updateUrlParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    navigate(qs ? `/occupants?${qs}` : "/occupants", { replace: true });
  };

  const updateMoveInFilter = (value: "All" | "NeedsReview") => {
    setMoveInFilter(value);
    updateUrlParam("needsReview", value === "NeedsReview" ? "1" : null);
  };

  const updateShiftFilter = (value: "All" | "1st" | "2nd" | "Unassigned") => {
    setShiftFilter(value);
    updateUrlParam("shift", value === "All" ? null : value);
  };

  const updateChargeSourceFilter = (value: "All" | "manual" | "payroll") => {
    setChargeSourceFilter(value);
    updateUrlParam("chargeSource", value === "All" ? null : value);
  };

  const filteredOccupants = occupants.filter((o) => {
    const matchesSearch = o.name.toLowerCase().includes(search.toLowerCase());
    const matchesProperty = propertyFilter === "All" || o.propertyId === propertyFilter;
    const matchesStatus = statusFilter === "All" || o.status === statusFilter;
    const matchesMoveIn =
      moveInFilter === "All" ? true : !o.moveInDate;
    const matchesShift =
      shiftFilter === "All"
        ? true
        : shiftFilter === "Unassigned"
          ? !o.shift
          : o.shift === shiftFilter;
    const matchesChargeSource =
      chargeSourceFilter === "All"
        ? true
        : chargeSourceFilter === "manual"
          ? o.chargeSource !== "payroll"
          : o.chargeSource === "payroll";
    const matchesCustomer =
      customerScopedPropertyIds === null ||
      (o.propertyId !== null && customerScopedPropertyIds.has(o.propertyId));
    return matchesSearch && matchesProperty && matchesStatus && matchesMoveIn && matchesShift && matchesChargeSource && matchesCustomer;
  });

  const shiftCounts = occupants.reduce(
    (acc, o) => {
      if (o.shift === "1st") acc["1st"]++;
      else if (o.shift === "2nd") acc["2nd"]++;
      else acc.Unassigned++;
      return acc;
    },
    { "1st": 0, "2nd": 0, Unassigned: 0 },
  );

  const handleDownloadCsv = () => {
    const csv = toCsv(filteredOccupants, [
      { header: "Name",              value: (o) => o.name },
      { header: "Email",             value: (o) => o.email },
      { header: "Phone",             value: (o) => o.phone },
      { header: "Company",           value: (o) => o.company },
      { header: "Employee ID",       value: (o) => o.employeeId },
      { header: "Property",          value: (o) => (o.propertyId ? properties.find((p) => p.id === o.propertyId)?.name ?? "" : "") },
      { header: "Bed",               value: (o) => {
          if (!o.bedId) return "";
          const bed = beds.find((b) => b.id === o.bedId);
          return bed ? `Bed ${bed.bedNumber}` : "";
        } },
      { header: "Move In",           value: (o) => o.moveInDate },
      { header: "Move Out",          value: (o) => o.moveOutDate ?? "" },
      { header: "Charge per Bed",    value: (o) => o.chargePerBed },
      { header: "Billing Frequency", value: (o) => o.billingFrequency },
      { header: "Shift",             value: (o) => o.shift ?? "" },
      { header: "Status",            value: (o) => o.status },
    ]);
    downloadCsv(timestampedCsvName("housingops-occupants"), csv);
    toast({
      title: "Occupants exported",
      description: `Downloaded ${filteredOccupants.length} ${filteredOccupants.length === 1 ? "occupant" : "occupants"} as CSV.`,
    });
  };

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <PageHeader
          title="Occupants"
          description="Manage employee housing assignments"
          actions={
            <>
              <Button
                variant="outline"
                onClick={handleDownloadCsv}
                disabled={isLoading || filteredOccupants.length === 0}
                data-testid="button-download-occupants-csv"
              >
                <Download className="mr-2 h-4 w-4" />
                Download CSV
              </Button>
              <Button
                asChild
                disabled={properties.length === 0}
                data-testid="button-add-occupant"
                title={
                  properties.length === 0
                    ? "Add a property first — occupants are assigned to beds inside a property."
                    : "Open a property to assign an occupant to one of its beds."
                }
              >
                <Link href={properties.length === 0 ? "/properties" : `/properties/${properties[0].id}`}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Add Occupant
                </Link>
              </Button>
            </>
          }
        />

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search occupants..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Property" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Properties</SelectItem>
                  {properties.map(p => (
                    <SelectItem key={p.id} value={p.id}>{shortPropertyName(p.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Statuses</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Former">Former</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={shiftFilter}
                onValueChange={(v) => updateShiftFilter(v as "All" | "1st" | "2nd" | "Unassigned")}
              >
                <SelectTrigger
                  className="w-full sm:w-44"
                  data-testid="select-shift-filter"
                >
                  <SelectValue placeholder="Shift" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Shifts</SelectItem>
                  <SelectItem value="1st">1st shift ({shiftCounts["1st"]})</SelectItem>
                  <SelectItem value="2nd">2nd shift ({shiftCounts["2nd"]})</SelectItem>
                  <SelectItem value="Unassigned">Unassigned ({shiftCounts.Unassigned})</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={moveInFilter}
                onValueChange={(v) => updateMoveInFilter(v as "All" | "NeedsReview")}
              >
                <SelectTrigger
                  className="w-full sm:w-44"
                  data-testid="select-move-in-filter"
                >
                  <SelectValue placeholder="Move-in" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Move-ins</SelectItem>
                  <SelectItem value="NeedsReview">Needs review</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={chargeSourceFilter}
                onValueChange={(v) => updateChargeSourceFilter(v as "All" | "manual" | "payroll")}
              >
                <SelectTrigger
                  className="w-full sm:w-44"
                  data-testid="select-charge-source-filter"
                >
                  <SelectValue placeholder="Charge source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Sources</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="payroll">Payroll</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Bed</TableHead>
                  <TableHead>Move In</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead className="text-right">Weekly Deduction</TableHead>
                  <TableHead className="text-right">Monthly Equivalent</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <SkeletonRows rows={6} columns={9} />
                ) : filteredOccupants.length === 0 ? (
                  <EmptyStateRow
                    colSpan={9}
                    icon={Users}
                    title="No occupants found"
                    description={
                      occupants.length === 0
                        ? "Assign your first occupant to a bed to see them here."
                        : "Try clearing your search or filters above."
                    }
                    action={
                      occupants.length === 0 ? (
                        <Button asChild data-testid="button-empty-occupants-cta">
                          <Link href={properties.length === 0 ? "/properties" : `/properties/${properties[0].id}`}>
                            {properties.length === 0 ? "Add Property" : "Assign Occupant"}
                          </Link>
                        </Button>
                      ) : undefined
                    }
                    testId="empty-occupants-table"
                  />
                ) : (
                  filteredOccupants.map((occupant) => {
                    const property = occupant.propertyId ? properties.find(p => p.id === occupant.propertyId) : null;
                    const bed = occupant.bedId ? beds.find(b => b.id === occupant.bedId) : null;
                    
                    return (
                      <TableRow key={occupant.id}>
                        <TableCell className="font-medium">{occupant.name}</TableCell>
                        <TableCell>{property ? <PropertyNameCell name={property.name} /> : <span className="italic text-muted-foreground">—</span>}</TableCell>
                        <TableCell>{bed ? `Bed ${bed.bedNumber}` : "-"}</TableCell>
                        <TableCell>
                          {occupant.moveInDate ? (
                            occupant.moveInDate
                          ) : (
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className="border-amber-500 text-amber-700 dark:text-amber-400"
                                data-testid={`badge-move-in-needs-review-${occupant.id}`}
                              >
                                Needs review
                              </Badge>
                              <Input
                                type="date"
                                aria-label={`Set move-in date for ${occupant.name}`}
                                title="Set a move-in date"
                                className="h-7 w-36 text-xs"
                                data-testid={`input-move-in-date-${occupant.id}`}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  // Optimistic update — `updateOccupant` already
                                  // toasts on mutation failure (captureRollback),
                                  // so we deliberately don't fire a success toast
                                  // here to avoid a false-positive when the API
                                  // write later fails.
                                  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                                    updateOccupant(occupant.id, { moveInDate: v });
                                  }
                                }}
                              />
                            </div>
                          )}
                        </TableCell>
                        <TableCell data-testid={`cell-occupant-shift-${occupant.id}`}>
                          {occupant.shift ? (
                            <Badge variant="outline" className="font-normal">{occupant.shift} shift</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-right tabular-nums"
                          data-testid={`cell-occupant-weekly-${occupant.id}`}
                        >
                          {formatUsd(
                            toWeeklyCharge(
                              occupant.chargePerBed,
                              occupant.billingFrequency ?? "Monthly",
                            ),
                          )}
                        </TableCell>
                        <TableCell
                          className="text-right tabular-nums text-muted-foreground"
                          data-testid={`cell-occupant-monthly-${occupant.id}`}
                          title="Monthly equivalent = weekly × 52 / 12"
                        >
                          {formatUsd(
                            toMonthlyCharge(
                              occupant.chargePerBed,
                              occupant.billingFrequency ?? "Monthly",
                            ),
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={occupant.status === "Active" ? "default" : "secondary"}>
                            {occupant.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <ConfirmDeleteButton
                            title={`Delete ${occupant.name}?`}
                            description="This permanently removes the occupant record. Any bed currently assigned to them will be cleared. You can't undo this."
                            onConfirm={() => deleteOccupant(occupant.id)}
                            testId={`dialog-confirm-delete-occupant-${occupant.id}`}
                            trigger={
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                data-testid={`button-delete-occupant-${occupant.id}`}
                                title="Delete occupant"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
