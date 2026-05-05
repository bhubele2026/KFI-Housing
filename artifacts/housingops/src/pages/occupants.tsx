import { useState } from "react";
import { Link } from "wouter";
import { PropertyNameCell } from "@/components/property-name-cell";
import { shortPropertyName } from "@/lib/property-name";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, UserPlus, Download, Users } from "lucide-react";
import { EmptyStateRow } from "@/components/empty-state";
import { SkeletonRows } from "@/components/skeleton-rows";
import { useToast } from "@/hooks/use-toast";
import { toCsv, downloadCsv, timestampedCsvName } from "@/lib/csv";

export default function Occupants() {
  const { occupants, properties, beds, isLoading } = useData();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const filteredOccupants = occupants.filter((o) => {
    const matchesSearch = o.name.toLowerCase().includes(search.toLowerCase());
    const matchesProperty = propertyFilter === "All" || o.propertyId === propertyFilter;
    const matchesStatus = statusFilter === "All" || o.status === statusFilter;
    return matchesSearch && matchesProperty && matchesStatus;
  });

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
      { header: "Status",            value: (o) => o.status },
    ]);
    downloadCsv(timestampedCsvName("kfi-staffing-occupants"), csv);
    toast({
      title: "Occupants exported",
      description: `Downloaded ${filteredOccupants.length} ${filteredOccupants.length === 1 ? "occupant" : "occupants"} as CSV.`,
    });
  };

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Occupants</h1>
            <p className="text-muted-foreground mt-1">Manage employee housing assignments</p>
          </div>
          <div className="flex items-center gap-2">
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
          </div>
        </div>

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
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Bed</TableHead>
                  <TableHead>Move In</TableHead>
                  <TableHead className="text-right">Charge/Bed</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <SkeletonRows rows={6} columns={6} />
                ) : filteredOccupants.length === 0 ? (
                  <EmptyStateRow
                    colSpan={6}
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
                        <TableCell>{occupant.moveInDate}</TableCell>
                        <TableCell className="text-right">${occupant.chargePerBed}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={occupant.status === "Active" ? "default" : "secondary"}>
                            {occupant.status}
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
