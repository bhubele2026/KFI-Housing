import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Briefcase, ChevronRight, X, Zap, Download } from "lucide-react";
import { UTILITY_TYPES } from "@/data/mockData";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRows } from "@/components/skeleton-rows";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { toCsv, downloadCsv, timestampedCsvName } from "@/lib/csv";

const TYPE_COLORS: Record<string, string> = {
  Electric: "bg-yellow-100 text-yellow-800",
  Gas:      "bg-orange-100 text-orange-800",
  Propane:  "bg-amber-100 text-amber-800",
  Water:    "bg-blue-100 text-blue-800",
  Garbage:  "bg-slate-100 text-slate-700",
  Internet: "bg-purple-100 text-purple-800",
  Other:    "bg-gray-100 text-gray-700",
};

export default function Utilities() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const { utilities, properties, customers, isLoading } = useData();
  const { toast } = useToast();
  const [propertyFilter, setPropertyFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [customerFilter, setCustomerFilter] = useState("All");

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

  const filtered = utilities.filter(u => {
    const matchesProp = propertyFilter === "All" || u.propertyId === propertyFilter;
    const matchesType = typeFilter === "All" || u.type === typeFilter;
    if (!matchesProp || !matchesType) return false;
    if (customerFilter === "All") return true;
    const property = propertyById.get(u.propertyId);
    return property?.customerId === customerFilter;
  });

  const totalMonthly = filtered.reduce((s, u) => s + u.monthlyCost, 0);

  const handleDownloadCsv = () => {
    const csv = toCsv(filtered, [
      { header: "Property",     value: (u) => propertyById.get(u.propertyId)?.name ?? "" },
      { header: "Customer",     value: (u) => {
          const property = propertyById.get(u.propertyId);
          return property ? customerById.get(property.customerId) ?? "" : "";
        } },
      { header: "Type",         value: (u) => u.type },
      { header: "Company",      value: (u) => u.company },
      { header: "Account #",    value: (u) => u.accountNumber },
      { header: "Monthly Cost", value: (u) => u.monthlyCost },
      { header: "Notes",        value: (u) => u.notes },
    ]);
    downloadCsv(timestampedCsvName("housingops-utilities"), csv);
    toast({
      title: "Utilities exported",
      description: `Downloaded ${filtered.length} utility ${filtered.length === 1 ? "service" : "services"} as CSV.`,
    });
  };

  const activeCustomerName =
    customerFilter === "All" ? null : customerById.get(customerFilter) ?? null;

  // Hide the Customer column when a customer filter is active, since every
  // row already belongs to that customer.
  const showCustomerColumn = customerFilter === "All";
  const columnCount = showCustomerColumn ? 8 : 7;

  // Restrict the property dropdown to properties owned by the active customer.
  const availableProperties = useMemo(() => {
    if (customerFilter === "All") return properties;
    return properties.filter((p) => p.customerId === customerFilter);
  }, [properties, customerFilter]);

  // If the selected property is no longer valid under the active customer,
  // snap the property filter back to "All" so the table doesn't appear empty
  // for a stale combination the user can't see.
  useEffect(() => {
    if (propertyFilter === "All") return;
    if (!availableProperties.some((p) => p.id === propertyFilter)) {
      setPropertyFilter("All");
    }
  }, [availableProperties, propertyFilter]);

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
            <h1 className="text-3xl font-bold tracking-tight">Utilities</h1>
            <p className="text-muted-foreground mt-1">All utility services across your portfolio</p>
            {activeCustomerName && (
              <p
                className="text-xs text-muted-foreground mt-2 flex items-center gap-1"
                data-testid="text-utilities-active-customer"
              >
                <Briefcase className="h-3 w-3" />
                Showing only <span className="font-semibold">{activeCustomerName}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-4">
            <Select value={customerFilter} onValueChange={updateCustomerFilter}>
              <SelectTrigger className="w-full sm:w-56" data-testid="select-utilities-customer-filter">
                <SelectValue placeholder="Customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Customers</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={isLoading || filtered.length === 0}
              data-testid="button-download-utilities-csv"
            >
              <Download className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Monthly</p>
              {isLoading ? (
                <Skeleton className="h-8 w-28 mt-1 ml-auto" />
              ) : (
                <p className="text-2xl font-bold">${totalMonthly.toLocaleString()}</p>
              )}
            </div>
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

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex flex-col sm:flex-row gap-3 items-center">
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

              <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                <SelectTrigger className="w-full sm:w-56" data-testid="select-utilities-property-filter">
                  <SelectValue placeholder="All Properties" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Properties</SelectItem>
                  {availableProperties.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Types</SelectItem>
                  {UTILITY_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  {showCustomerColumn && <TableHead>Customer</TableHead>}
                  <TableHead>Type</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Account #</TableHead>
                  <TableHead className="text-right">Monthly Cost</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <SkeletonRows rows={6} columns={columnCount} />
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columnCount} className="h-24 text-center text-muted-foreground">
                      No utility services found.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {filtered.map((u, i) => {
                      const property = propertyById.get(u.propertyId);
                      const customerName = property?.customerId
                        ? customerById.get(property.customerId)
                        : undefined;
                      return (
                        <motion.tr
                          key={u.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.02 }}
                          className="border-b cursor-pointer hover:bg-muted/50 transition-colors group"
                          onClick={() => navigate(`/properties/${u.propertyId}?tab=utilities`)}
                          data-testid={`row-utility-${u.id}`}
                        >
                          <td className="p-4 font-medium text-sm">{property?.name}</td>
                          {showCustomerColumn && (
                            <td className="p-4 text-sm text-muted-foreground" data-testid={`text-utility-customer-${u.id}`}>
                              {property?.customerId && customerName ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateCustomerFilter(property.customerId);
                                  }}
                                  className="rounded-sm hover:underline hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  data-testid={`button-filter-customer-${u.id}`}
                                  aria-label={`Filter by customer ${customerName}`}
                                >
                                  {customerName}
                                </button>
                              ) : (
                                "—"
                              )}
                            </td>
                          )}
                          <td className="p-4">
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLORS[u.type] ?? "bg-gray-100 text-gray-700"}`}>
                              <Zap className="h-3 w-3" />
                              {u.type}
                            </span>
                          </td>
                          <td className="p-4 text-sm">{u.company}</td>
                          <td className="p-4 text-sm text-muted-foreground font-mono">{u.accountNumber || "—"}</td>
                          <td className="p-4 text-right font-semibold">${u.monthlyCost.toLocaleString()}</td>
                          <td className="p-4 text-sm text-muted-foreground max-w-[200px] truncate">{u.notes || "—"}</td>
                          <td className="p-4">
                            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </td>
                        </motion.tr>
                      );
                    })}
                    <tr className="bg-muted/40 border-t-2 border-border">
                      <td colSpan={showCustomerColumn ? 5 : 4} className="p-4 text-sm font-semibold text-right text-muted-foreground">
                        {filtered.length} service{filtered.length !== 1 ? "s" : ""} total
                      </td>
                      <td className="p-4 text-right font-bold">${totalMonthly.toLocaleString()}/mo</td>
                      <td colSpan={2} />
                    </tr>
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </motion.div>
    </MainLayout>
  );
}
