import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRows } from "@/components/skeleton-rows";

export default function Beds() {
  const { beds, properties, occupants, isLoading } = useData();
  const [propertyFilter, setPropertyFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const filteredBeds = beds.filter((b) => {
    const matchesProperty = propertyFilter === "All" || b.propertyId === propertyFilter;
    const matchesStatus = statusFilter === "All" || b.status === statusFilter;
    return matchesProperty && matchesStatus;
  });

  const occupiedCount = beds.filter(b => b.status === "Occupied").length;
  const occupancyRate = beds.length > 0 ? (occupiedCount / beds.length) * 100 : 0;

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Beds</h1>
            <p className="text-muted-foreground mt-1">Track individual bed inventory and assignments</p>
          </div>
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
                  <span className="text-muted-foreground">{occupiedCount} of {beds.length} beds occupied ({occupancyRate.toFixed(1)}%)</span>
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
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue placeholder="Property" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Properties</SelectItem>
                  {properties.map(p => (
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
                  <TableHead>Bed #</TableHead>
                  <TableHead>Occupant</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <SkeletonRows rows={6} columns={4} />
                ) : filteredBeds.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center">
                      No beds found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredBeds.map((bed) => {
                    const property = properties.find(p => p.id === bed.propertyId);
                    const occupant = bed.occupantId ? occupants.find(o => o.id === bed.occupantId) : null;
                    
                    return (
                      <TableRow key={bed.id}>
                        <TableCell className="font-medium">{property?.name}</TableCell>
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
