import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { getRenewalInfo } from "@/data/mockData";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, AlertTriangle, ChevronRight, Calendar, CalendarPlus, Briefcase, X, Download } from "lucide-react";
import { motion } from "framer-motion";
import { RenewLeasePopover } from "@/components/renew-lease-popover";
import { useToast } from "@/hooks/use-toast";
import { toCsv, downloadCsv, timestampedCsvName } from "@/lib/csv";

export default function Leases() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("All");
  const [customerFilter, setCustomerFilter] = useState("All");
  const { leases, properties, customers, updateLease } = useData();

  const customerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name);
    return map;
  }, [customers]);

  const propertyById = useMemo(() => {
    const map = new Map(properties.map((p) => [p.id, p] as const));
    return map;
  }, [properties]);

  // Sync ?customer=<id> URL parameter into the filter state.
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const param = params.get("customer");
    if (param && customers.some((c) => c.id === param)) {
      setCustomerFilter(param);
    } else if (!param && customerFilter !== "All") {
      setCustomerFilter("All");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchString, customers]);

  const updateCustomerFilter = (next: string) => {
    setCustomerFilter(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "All") params.delete("customer");
    else params.set("customer", next);
    const qs = params.toString();
    const base = window.location.pathname;
    navigate(qs ? `${base}?${qs}` : base, { replace: true });
  };

  const filteredLeases = leases.filter((l) => {
    const matchesStatus = statusFilter === "All" || l.status === statusFilter;
    if (!matchesStatus) return false;
    if (customerFilter === "All") return true;
    const property = propertyById.get(l.propertyId);
    return property?.customerId === customerFilter;
  });

  // Renewal alerts: leases that are Active or Upcoming and either expired or expire within 90 days
  const renewalAlerts = leases
    .filter((l) => l.status === "Active" || l.status === "Upcoming")
    .filter((l) => {
      if (customerFilter === "All") return true;
      const property = propertyById.get(l.propertyId);
      return property?.customerId === customerFilter;
    })
    .map((l) => ({ lease: l, info: getRenewalInfo(l.endDate) }))
    .filter(({ info }) => info.level !== "ok")
    .sort((a, b) => a.info.days - b.info.days);

  const activeCustomerName =
    customerFilter === "All" ? null : customerById.get(customerFilter) ?? null;

  const handleDownloadCsv = () => {
    const csv = toCsv(filteredLeases, [
      { header: "Property",         value: (l) => propertyById.get(l.propertyId)?.name ?? "Unknown" },
      { header: "Customer",         value: (l) => {
          const property = propertyById.get(l.propertyId);
          return property ? customerById.get(property.customerId) ?? "" : "";
        } },
      { header: "Start Date",       value: (l) => l.startDate },
      { header: "End Date",         value: (l) => l.endDate },
      { header: "Days Left",        value: (l) => getRenewalInfo(l.endDate).days },
      { header: "Monthly Rent",     value: (l) => l.monthlyRent },
      { header: "Security Deposit", value: (l) => l.securityDeposit },
      { header: "Status",           value: (l) => l.status },
      { header: "Notes",            value: (l) => l.notes },
    ]);
    downloadCsv(timestampedCsvName("housingops-leases"), csv);
    toast({
      title: "Leases exported",
      description: `Downloaded ${filteredLeases.length} ${filteredLeases.length === 1 ? "lease" : "leases"} as CSV.`,
    });
  };

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Leases</h1>
            <p className="text-muted-foreground mt-1">Manage master lease agreements</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={filteredLeases.length === 0}
              data-testid="button-download-leases-csv"
            >
              <Download className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Lease
            </Button>
          </div>
        </div>

        {activeCustomerName && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 px-2 py-1" data-testid="badge-customer-filter">
              <Briefcase className="h-3 w-3" />
              Filtered by customer: <span className="font-semibold">{activeCustomerName}</span>
              <button
                type="button"
                onClick={() => updateCustomerFilter("All")}
                className="ml-1 rounded-sm p-0.5 hover:bg-background/40"
                aria-label="Clear customer filter"
                data-testid="button-clear-customer-filter"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          </div>
        )}

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
                    const customer = property ? customers.find((c) => c.id === property.customerId) : undefined;
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
                            {customer && (
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5">{customer.name}</p>
                            )}
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
                              currentStatus={lease.status}
                              propertyName={property?.name}
                              onRenew={(newEndDate, newStatus) =>
                                updateLease(lease.id, {
                                  endDate: newEndDate,
                                  status: newStatus,
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
            <div className="p-4 border-b flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Select value={customerFilter} onValueChange={updateCustomerFilter}>
                  <SelectTrigger className="w-full sm:w-56" data-testid="select-customer-filter">
                    <SelectValue placeholder="Customer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Customers</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-48" data-testid="select-status-filter">
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
              <span className="text-xs text-muted-foreground">
                {filteredLeases.length} of {leases.length} lease{leases.length === 1 ? "" : "s"}
              </span>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Customer</TableHead>
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
                    <TableCell colSpan={7} className="h-24 text-center">
                      No leases found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLeases.map((lease) => {
                    const property = properties.find(p => p.id === lease.propertyId);
                    const customer = property ? customers.find(c => c.id === property.customerId) : undefined;
                    const info = getRenewalInfo(lease.endDate);
                    return (
                      <TableRow key={lease.id} data-testid={`row-lease-${lease.id}`}>
                        <TableCell className="font-medium">{property?.name || "Unknown"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {customer ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateCustomerFilter(customer.id);
                              }}
                              className="rounded-sm hover:underline hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              data-testid={`button-filter-customer-${lease.id}`}
                              aria-label={`Filter by customer ${customer.name}`}
                            >
                              {customer.name}
                            </button>
                          ) : (
                            <span className="italic">—</span>
                          )}
                        </TableCell>
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
