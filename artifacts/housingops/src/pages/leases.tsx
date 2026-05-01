import { useState } from "react";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { getRenewalInfo } from "@/data/mockData";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, AlertTriangle, ChevronRight, Calendar, CalendarPlus } from "lucide-react";
import { motion } from "framer-motion";
import { RenewLeasePopover } from "@/components/renew-lease-popover";

export default function Leases() {
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState("All");
  const { leases, properties, updateLease } = useData();

  const filteredLeases = leases.filter((l) => {
    return statusFilter === "All" || l.status === statusFilter;
  });

  // Renewal alerts: leases that are Active or Upcoming and either expired or expire within 90 days
  const renewalAlerts = leases
    .filter((l) => l.status === "Active" || l.status === "Upcoming")
    .map((l) => ({ lease: l, info: getRenewalInfo(l.endDate) }))
    .filter(({ info }) => info.level !== "ok")
    .sort((a, b) => a.info.days - b.info.days);

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

        {renewalAlerts.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            <Card className="border-amber-200 bg-amber-50/40">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-1.5 rounded-md bg-amber-100">
                    <AlertTriangle className="h-4 w-4 text-amber-700" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold">Renewal Alerts</h2>
                    <p className="text-xs text-muted-foreground">
                      {renewalAlerts.length} lease{renewalAlerts.length !== 1 ? "s" : ""} expiring within 90 days or already past
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {renewalAlerts.map(({ lease, info }) => {
                    const property = properties.find((p) => p.id === lease.propertyId);
                    return (
                      <motion.div
                        key={lease.id}
                        whileHover={{ y: -2 }}
                        onClick={() => property && navigate(`/properties/${property.id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && property) {
                            e.preventDefault();
                            navigate(`/properties/${property.id}`);
                          }
                        }}
                        className={`cursor-pointer text-left bg-white rounded-lg border ${info.rowAccentClass.replace("border-l-4", "border-l-[3px]")} p-3 hover:shadow-md transition-all group`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate">{property?.name ?? "Unknown property"}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Calendar className="h-3 w-3" />
                              ends {lease.endDate}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
                        </div>
                        <div className="flex items-center justify-between mt-2.5 gap-2">
                          <Badge variant="outline" className={`text-[11px] font-medium ${info.badgeClass}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${info.dotClass} mr-1.5 inline-block`} />
                            {info.label}
                          </Badge>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs font-medium text-muted-foreground">${lease.monthlyRent.toLocaleString()}/mo</span>
                            <RenewLeasePopover
                              currentEndDate={lease.endDate}
                              propertyName={property?.name}
                              onRenew={(newEndDate) =>
                                updateLease(lease.id, {
                                  endDate: newEndDate,
                                  status: lease.status === "Expired" ? "Active" : lease.status,
                                })
                              }
                              trigger={
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs gap-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <CalendarPlus className="h-3 w-3" />
                                  Renew
                                </Button>
                              }
                            />
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

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
                  <TableHead>Time Left</TableHead>
                  <TableHead className="text-right">Monthly Rent</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeases.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      No leases found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLeases.map((lease) => {
                    const property = properties.find(p => p.id === lease.propertyId);
                    const info = getRenewalInfo(lease.endDate);
                    return (
                      <TableRow key={lease.id}>
                        <TableCell className="font-medium">{property?.name || "Unknown"}</TableCell>
                        <TableCell>{lease.startDate}</TableCell>
                        <TableCell>{lease.endDate}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-xs font-medium ${info.badgeClass}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${info.dotClass} mr-1.5 inline-block`} />
                            {info.label}
                          </Badge>
                        </TableCell>
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
