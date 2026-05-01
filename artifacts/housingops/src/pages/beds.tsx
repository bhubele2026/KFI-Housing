import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRows } from "@/components/skeleton-rows";
import { Briefcase } from "lucide-react";

export default function Beds() {
  const { beds, properties, occupants, customers, isLoading } = useData();
  const [customerFilter, setCustomerFilter] = useState("All");
  const [propertyFilter, setPropertyFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const scopedPropertyIds = useMemo(() => {
    if (customerFilter === "All") return null;
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

  // Hide the Customer column when a customer filter is active, since every
  // row already belongs to that customer.
  const showCustomerColumn = customerFilter === "All";
  const columnCount = showCustomerColumn ? 5 : 4;

  const propertiesForFilter = useMemo(() => {
    if (!scopedPropertyIds) return properties;
    return properties.filter((p) => scopedPropertyIds.has(p.id));
  }, [properties, scopedPropertyIds]);

  const scopedBeds = useMemo(() => {
    if (!scopedPropertyIds) return beds;
    return beds.filter((b) => scopedPropertyIds.has(b.propertyId));
  }, [beds, scopedPropertyIds]);

  const filteredBeds = scopedBeds.filter((b) => {
    const matchesProperty = propertyFilter === "All" || b.propertyId === propertyFilter;
    const matchesStatus = statusFilter === "All" || b.status === statusFilter;
    return matchesProperty && matchesStatus;
  });

  const occupiedCount = scopedBeds.filter((b) => b.status === "Occupied").length;
  const occupancyRate = scopedBeds.length > 0 ? (occupiedCount / scopedBeds.length) * 100 : 0;

  const activeCustomerName =
    customerFilter === "All" ? null : customers.find((c) => c.id === customerFilter)?.name ?? null;

  const handleCustomerChange = (next: string) => {
    setCustomerFilter(next);
    // If the previously selected property no longer belongs to the new
    // customer scope, drop it back to "All" so the table isn't stuck empty.
    if (next !== "All" && propertyFilter !== "All") {
      const stillVisible = properties.some(
        (p) => p.id === propertyFilter && p.customerId === next,
      );
      if (!stillVisible) setPropertyFilter("All");
    }
  };

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Beds</h1>
            <p className="text-muted-foreground mt-1">Track individual bed inventory and assignments</p>
            {activeCustomerName && (
              <p
                className="text-xs text-muted-foreground mt-2 flex items-center gap-1"
                data-testid="text-beds-active-customer"
              >
                <Briefcase className="h-3 w-3" />
                Showing only <span className="font-semibold">{activeCustomerName}</span>
              </p>
            )}
          </div>
          <Select value={customerFilter} onValueChange={handleCustomerChange}>
            <SelectTrigger className="w-full sm:w-56" data-testid="select-beds-customer-filter">
              <SelectValue placeholder="Customer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Customers</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
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
                  <TableHead>Bed #</TableHead>
                  <TableHead>Occupant</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <SkeletonRows rows={6} columns={columnCount} />
                ) : filteredBeds.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columnCount} className="h-24 text-center">
                      No beds found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredBeds.map((bed) => {
                    const property = propertyById.get(bed.propertyId);
                    const customerName = property?.customerId
                      ? customerById.get(property.customerId)
                      : undefined;
                    const occupant = bed.occupantId ? occupants.find(o => o.id === bed.occupantId) : null;
                    
                    return (
                      <TableRow key={bed.id}>
                        <TableCell className="font-medium">{property?.name}</TableCell>
                        {showCustomerColumn && (
                          <TableCell className="text-muted-foreground" data-testid={`text-bed-customer-${bed.id}`}>
                            {customerName ?? "—"}
                          </TableCell>
                        )}
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
