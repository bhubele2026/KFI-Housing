import { useState } from "react";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { getRenewalInfo } from "@/data/mockData";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, ChevronRight, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";

export default function Properties() {
  const [, navigate] = useLocation();
  const { properties, beds, leases } = useData();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const filtered = properties.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.address.toLowerCase().includes(search.toLowerCase()) ||
      p.city.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "All" || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <MainLayout>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="p-8 max-w-7xl mx-auto space-y-8"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Properties</h1>
            <p className="text-muted-foreground mt-1">Select a property to manage it</p>
          </div>
          <Button data-testid="button-add-property">
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
                  data-testid="input-search-properties"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40" data-testid="select-status-filter">
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
                  <TableHead>City</TableHead>
                  <TableHead className="text-center">Total Beds</TableHead>
                  <TableHead className="text-center">Occupied</TableHead>
                  <TableHead className="text-center">Vacant</TableHead>
                  <TableHead className="text-right">Charge / Bed</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead>Lease Renewal</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                      No properties found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((property, i) => {
                    const propBeds = beds.filter((b) => b.propertyId === property.id);
                    const occupied = propBeds.filter((b) => b.status === "Occupied").length;
                    const vacant = propBeds.length - occupied;
                    const activeLease = leases.find((l) => l.propertyId === property.id && l.status === "Active");
                    const renewal = activeLease ? getRenewalInfo(activeLease.endDate) : null;
                    const showRenewal = renewal && renewal.level !== "ok";

                    return (
                      <motion.tr
                        key={property.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="cursor-pointer hover:bg-muted/50 border-b transition-colors group"
                        onClick={() => navigate(`/properties/${property.id}`)}
                        data-testid={`row-property-${property.id}`}
                      >
                        <td className="p-4 font-semibold">{property.name}</td>
                        <td className="p-4 text-sm text-muted-foreground">{property.address}</td>
                        <td className="p-4 text-sm text-muted-foreground">{property.city}, {property.state}</td>
                        <td className="p-4 text-center text-sm">{propBeds.length}</td>
                        <td className="p-4 text-center">
                          <span className="text-sm font-medium text-green-600">{occupied}</span>
                        </td>
                        <td className="p-4 text-center">
                          <span className={`text-sm font-medium ${vacant > 0 ? "text-amber-500" : "text-muted-foreground"}`}>{vacant}</span>
                        </td>
                        <td className="p-4 text-right text-sm font-medium">${property.chargePerBed.toLocaleString()}</td>
                        <td className="p-4 text-center">
                          <Badge variant={property.status === "Active" ? "default" : "secondary"}>
                            {property.status}
                          </Badge>
                        </td>
                        <td className="p-4">
                          {showRenewal && renewal ? (
                            <Badge variant="outline" className={`text-[11px] font-medium ${renewal.badgeClass}`}>
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              {renewal.label}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </td>
                      </motion.tr>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </motion.div>
    </MainLayout>
  );
}
