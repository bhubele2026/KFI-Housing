import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { PropertyNameCell } from "@/components/property-name-cell";
import { shortPropertyName } from "@/lib/property-name";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRows } from "@/components/skeleton-rows";
import { Briefcase, Download, X, BedDouble } from "lucide-react";
import { EmptyStateRow } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { toCsv, downloadCsv, timestampedCsvName } from "@/lib/csv";

export default function Beds() {
  const { beds, properties, rooms, occupants, customers, isLoading } = useData();
  const { toast } = useToast();
  const { customerId: customerFilter, setCustomerId: updateCustomerFilter } =
    useCustomerScope();
  const [propertyFilter, setPropertyFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const scopedPropertyIds = useMemo(() => {
    if (customerFilter === ALL_CUSTOMERS) return null;
    return new Set(
      properties.filter((p) => p.customerId === customerFilter).map((p) => p.id),
    );
  }, [properties, customerFilter]);

  const customerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name);
    return map;
  }, [customers]);

  const propertyById = useMemo(() => {
    const map = new Map(properties.map((p) => [p.id, p] as const));
    return map;
  }, [properties]);

  const roomById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rooms) map.set(r.id, r.name);
    return map;
  }, [rooms]);

  // Hide the Customer column when a customer filter is active, since every
  // row already belongs to that customer.
  const showCustomerColumn = customerFilter === ALL_CUSTOMERS;
  // +1 column for Room (always shown).
  const columnCount = showCustomerColumn ? 6 : 5;

  const propertiesForFilter = useMemo(() => {
    if (!scopedPropertyIds) return properties;
    return properties.filter((p) => scopedPropertyIds.has(p.id));
  }, [properties, scopedPropertyIds]);

  const scopedBeds = useMemo(() => {
    if (!scopedPropertyIds) return beds;
    return beds.filter((b) => scopedPropertyIds.has(b.propertyId));
  }, [beds, scopedPropertyIds]);

  // If the active customer scope changes (locally or because we arrived
  // here with the scope already set on another page), drop a stale
  // property selection back to "All" so the table isn't stuck empty for
  // a property the user can no longer see.
  useEffect(() => {
    if (propertyFilter === "All") return;
    if (customerFilter === ALL_CUSTOMERS) return;
    const stillVisible = properties.some(
      (p) => p.id === propertyFilter && p.customerId === customerFilter,
    );
    if (!stillVisible) setPropertyFilter("All");
  }, [customerFilter, propertyFilter, properties]);

  const filteredBeds = scopedBeds.filter((b) => {
    const matchesProperty = propertyFilter === "All" || b.propertyId === propertyFilter;
    const matchesStatus = statusFilter === "All" || b.status === statusFilter;
    return matchesProperty && matchesStatus;
  });

  const occupiedCount = scopedBeds.filter((b) => b.status === "Occupied").length;
  const occupancyRate = scopedBeds.length > 0 ? (occupiedCount / scopedBeds.length) * 100 : 0;

  const activeCustomerName =
    customerFilter === ALL_CUSTOMERS
      ? null
      : customers.find((c) => c.id === customerFilter)?.name ?? null;

  const handleDownloadCsv = () => {
    const csv = toCsv(filteredBeds, [
      { header: "Property",  value: (b) => properties.find((p) => p.id === b.propertyId)?.name ?? "" },
      { header: "Customer",  value: (b) => {
          const property = properties.find((p) => p.id === b.propertyId);
          return property ? customers.find((c) => c.id === property.customerId)?.name ?? "" : "";
        } },
      { header: "Bed Number", value: (b) => b.bedNumber },
      { header: "Room",       value: (b) => roomById.get(b.roomId) ?? "" },
      { header: "Occupant",   value: (b) => (b.occupantId ? occupants.find((o) => o.id === b.occupantId)?.name ?? "" : "") },
      { header: "Status",     value: (b) => b.status },
    ]);
    downloadCsv(timestampedCsvName("housingops-beds"), csv);
    toast({
      title: "Beds exported",
      description: `Downloaded ${filteredBeds.length} ${filteredBeds.length === 1 ? "bed" : "beds"} as CSV.`,
    });
  };

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <PageHeader
          title="Beds"
          description="Track individual bed inventory and assignments"
          meta={
            activeCustomerName ? (
              <p
                className="text-xs text-muted-foreground flex items-center gap-1"
                data-testid="text-beds-active-customer"
              >
                <Briefcase className="h-3 w-3" />
                Showing only <span className="font-semibold">{activeCustomerName}</span>
              </p>
            ) : null
          }
          actions={<>
            <Select value={customerFilter} onValueChange={updateCustomerFilter}>
              <SelectTrigger className="w-full sm:w-56" data-testid="select-beds-customer-filter">
                <SelectValue placeholder="Customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CUSTOMERS}>All Customers</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={isLoading || filteredBeds.length === 0}
              data-testid="button-download-beds-csv"
            >
              <Download className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
          </>}
        />

        {activeCustomerName && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 px-2 py-1" data-testid="badge-customer-filter">
              <Briefcase className="h-3 w-3" />
              Filtered by customer: <span className="font-semibold">{activeCustomerName}</span>
              <button
                type="button"
                onClick={() => updateCustomerFilter(ALL_CUSTOMERS)}
                className="ml-1 rounded-sm p-0.5 hover:bg-background/40"
                aria-label="Clear customer filter"
                data-testid="button-clear-customer-filter"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          </div>
        )}

        <Card>
          <CardContent className="p-6">
            {isLoading ? (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-48" />
                </div>
                <Skeleton className="h-3 w-full" />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">Total Occupancy</span>
                  <span className="text-muted-foreground">{occupiedCount} of {scopedBeds.length} beds occupied ({occupancyRate.toFixed(1)}%)</span>
                </div>
                <Progress value={occupancyRate} className="h-3" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center">
              <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                <SelectTrigger className="w-full sm:w-64" data-testid="select-beds-property-filter">
                  <SelectValue placeholder="Property" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Properties</SelectItem>
                  {propertiesForFilter.map(p => (
                    <SelectItem key={p.id} value={p.id}>{shortPropertyName(p.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Statuses</SelectItem>
                  <SelectItem value="Occupied">Occupied</SelectItem>
                  <SelectItem value="Vacant">Vacant</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  {showCustomerColumn && <TableHead>Customer</TableHead>}
                  <TableHead>Room</TableHead>
                  <TableHead>Bed #</TableHead>
                  <TableHead>Occupant</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <SkeletonRows rows={6} columns={columnCount} />
                ) : filteredBeds.length === 0 ? (
                  <EmptyStateRow
                    colSpan={columnCount}
                    icon={BedDouble}
                    title="No beds found"
                    description={
                      beds.length === 0
                        ? "Add a property and its rooms to start tracking beds."
                        : "Try clearing your search or filters above."
                    }
                    action={
                      beds.length === 0 ? (
                        <Button asChild data-testid="button-empty-beds-cta">
                          <Link href={properties.length === 0 ? "/properties" : `/properties/${properties[0].id}`}>
                            {properties.length === 0 ? "Add Property" : "Add Beds"}
                          </Link>
                        </Button>
                      ) : undefined
                    }
                    testId="empty-beds-table"
                  />
                ) : (
                  filteredBeds.map((bed) => {
                    const property = propertyById.get(bed.propertyId);
                    const customerName = property?.customerId
                      ? customerById.get(property.customerId)
                      : undefined;
                    const occupant = bed.occupantId ? occupants.find(o => o.id === bed.occupantId) : null;
                    
                    return (
                      <TableRow key={bed.id}>
                        <TableCell><PropertyNameCell name={property?.name} /></TableCell>
                        {showCustomerColumn && (
                          <TableCell className="text-muted-foreground" data-testid={`text-bed-customer-${bed.id}`}>
                            {property?.customerId && customerName ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateCustomerFilter(property.customerId);
                                }}
                                className="rounded-sm hover:underline hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                data-testid={`button-filter-customer-${bed.id}`}
                                aria-label={`Filter by customer ${customerName}`}
                              >
                                {customerName}
                              </button>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        )}
                        <TableCell className="text-muted-foreground" data-testid={`text-bed-room-${bed.id}`}>
                          {roomById.get(bed.roomId) ?? "—"}
                        </TableCell>
                        <TableCell>Bed {bed.bedNumber}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {occupant ? occupant.name : "-"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={bed.status === "Occupied" ? "default" : "outline"} className={bed.status === "Vacant" ? "text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30" : ""}>
                            {bed.status}
                          </Badge>
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
