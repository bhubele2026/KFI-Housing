import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { MOCK_PROPERTIES, MOCK_BEDS, MOCK_LEASES } from "@/data/mockData";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Search, Plus } from "lucide-react";
import { motion } from "framer-motion";

export default function Properties() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const filteredProperties = MOCK_PROPERTIES.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.address.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "All" || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Properties</h1>
            <p className="text-muted-foreground mt-1">Manage your housing portfolio</p>
          </div>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Property
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search properties..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Statuses</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-center">Beds</TableHead>
                  <TableHead className="text-center">Occupied</TableHead>
                  <TableHead className="text-right">Monthly Rent</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProperties.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      No properties found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProperties.map((property) => {
                    const beds = MOCK_BEDS.filter((b) => b.propertyId === property.id);
                    const occupied = beds.filter((b) => b.status === "Occupied").length;
                    
                    return (
                      <Sheet key={property.id}>
                        <SheetTrigger asChild>
                          <TableRow className="cursor-pointer hover:bg-muted/50">
                            <TableCell className="font-medium">{property.name}</TableCell>
                            <TableCell>{property.address}, {property.city}, {property.state}</TableCell>
                            <TableCell className="text-center">{property.totalBeds}</TableCell>
                            <TableCell className="text-center">
                              {occupied} / {property.totalBeds}
                            </TableCell>
                            <TableCell className="text-right">${property.monthlyRent}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant={property.status === "Active" ? "default" : "secondary"}>
                                {property.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        </SheetTrigger>
                        <SheetContent className="sm:max-w-xl">
                          <SheetHeader>
                            <SheetTitle>{property.name}</SheetTitle>
                            <SheetDescription>
                              {property.address}, {property.city}, {property.state}
                            </SheetDescription>
                          </SheetHeader>
                          <div className="mt-6 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Total Beds</p>
                                <p className="text-2xl font-bold">{property.totalBeds}</p>
                              </div>
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Charge per Bed</p>
                                <p className="text-2xl font-bold">${property.monthlyRent}</p>
                              </div>
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Occupied</p>
                                <p className="text-2xl font-bold">{occupied}</p>
                              </div>
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-muted-foreground">Status</p>
                                <Badge variant={property.status === "Active" ? "default" : "secondary"}>
                                  {property.status}
                                </Badge>
                              </div>
                            </div>
                            
                            <div className="space-y-4">
                              <h3 className="font-semibold text-lg border-b pb-2">Active Leases</h3>
                              <div className="space-y-2">
                                {MOCK_LEASES.filter(l => l.propertyId === property.id && l.status === "Active").map(lease => (
                                  <div key={lease.id} className="flex justify-between items-center p-3 rounded-lg border">
                                    <div>
                                      <p className="font-medium">Total Rent: ${lease.monthlyRent}</p>
                                      <p className="text-sm text-muted-foreground">{lease.startDate} to {lease.endDate}</p>
                                    </div>
                                    <Badge>Active</Badge>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </SheetContent>
                      </Sheet>
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
