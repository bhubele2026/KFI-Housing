import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { MOCK_LEASES, MOCK_PROPERTIES } from "@/data/mockData";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";

export default function Leases() {
  const [statusFilter, setStatusFilter] = useState("All");

  const filteredLeases = MOCK_LEASES.filter((l) => {
    return statusFilter === "All" || l.status === statusFilter;
  });

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Leases</h1>
            <p className="text-muted-foreground mt-1">Manage master lease agreements</p>
          </div>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Lease
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex items-center justify-between">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Statuses</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Expired">Expired</SelectItem>
                  <SelectItem value="Upcoming">Upcoming</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead className="text-right">Monthly Rent</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeases.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      No leases found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLeases.map((lease) => {
                    const property = MOCK_PROPERTIES.find(p => p.id === lease.propertyId);
                    
                    return (
                      <TableRow key={lease.id}>
                        <TableCell className="font-medium">{property?.name || "Unknown"}</TableCell>
                        <TableCell>{lease.startDate}</TableCell>
                        <TableCell>{lease.endDate}</TableCell>
                        <TableCell className="text-right">${lease.monthlyRent.toLocaleString()}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={lease.status === "Active" ? "default" : lease.status === "Expired" ? "destructive" : "secondary"}>
                            {lease.status}
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
