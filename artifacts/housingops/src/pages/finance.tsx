import { useMemo } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { PropertyNameCell } from "@/components/property-name-cell";
import { formatPropertyName } from "@/lib/property-name";
import { useData } from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { sumActiveRentEstimated, toMonthlyCharge } from "@/data/mockData";
import { useListRoomNightLogs } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { motion } from "framer-motion";
import { Briefcase, X, DollarSign, Building2, Download } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { toCsv, toCsvRows, downloadCsv, timestampedCsvName } from "@/lib/csv";
import { useToast } from "@/hooks/use-toast";

export default function Finance() {
  const { properties, beds, leases, utilities, occupants, customers } = useData();
  const { customerId: customerFilter, setCustomerId: updateCustomerFilter } =
    useCustomerScope();
  // Room-night logs power the hotel-rate revenue estimate so corporate
  // agreements (Ridge Motor Inn, Comfort Suites Madison, etc.) show up
  // in Lease Cost / Net Profit / Total Costs instead of being silently
  // treated as $0. Mirrors property-detail / dashboard behaviour.
  const { data: roomNightLogsData } = useListRoomNightLogs();
  const roomNightLogs = useMemo(() => roomNightLogsData ?? [], [roomNightLogsData]);

  const customerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name);
    return map;
  }, [customers]);

  const visibleProperties = useMemo(() => {
    if (customerFilter === ALL_CUSTOMERS) return properties;
    return properties.filter((p) => p.customerId === customerFilter);
  }, [properties, customerFilter]);

  const financialData = visibleProperties.map(p => {
    const propOccupants = occupants.filter(o => o.propertyId === p.id && o.status === "Active");
    const revenue = propOccupants.reduce((s, o) => s + toMonthlyCharge(o.chargePerBed, o.billingFrequency ?? "Monthly"), 0);
    // Sum across every Active lease for the property — a property can hold
    // more than one (e.g. overlapping renewals or multi-room agreements).
    // Picking just the first match silently under-reports rent and profit.
    const leaseCost = sumActiveRentEstimated(leases, roomNightLogs, p.id);
    const propUtils = utilities.filter(u => u.propertyId === p.id);
    const utilCost = propUtils.reduce((s, u) => s + u.monthlyCost, 0);
    // Per-bed "electric" specifically excludes water/internet/etc, matching
    // the Dashboard and Property Detail Electric / Bed cards. Total Utility
    // Cost above keeps summing every utility type.
    const electricCost = propUtils.reduce(
      (s, u) => (u.type === "Electric" ? s + (u.monthlyCost || 0) : s),
      0,
    );
    const totalCost = leaseCost + utilCost;
    const occupiedBeds = beds.filter(b => b.propertyId === p.id && b.status === "Occupied").length;
    const totalBeds = beds.filter(b => b.propertyId === p.id).length;
    const customerName = p.customerId ? customerById.get(p.customerId) : undefined;
    // Per-bed unit economics. `null` on zero beds so the cell renders an
    // em-dash instead of a misleading $0 — same contract as the helpers
    // in mockData.ts (computeRentPerBed et al).
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const rentPerBed = totalBeds ? round2(leaseCost / totalBeds) : null;
    const electricPerBed = totalBeds ? round2(electricCost / totalBeds) : null;
    const rentPlusElectricPerBed = totalBeds
      ? round2((leaseCost + electricCost) / totalBeds)
      : null;

    return {
      id: p.id,
      name: p.name,
      shortName: formatPropertyName(p.name).primary,
      customerId: p.customerId,
      customerName,
      revenue,
      leaseCost,
      utilCost,
      electricCost,
      totalCost,
      profit: revenue - totalCost,
      occupiedBeds,
      totalBeds,
      rentPerBed,
      electricPerBed,
      rentPlusElectricPerBed,
    };
  });

  const totals = financialData.reduce(
    (acc, d) => ({
      revenue: acc.revenue + d.revenue,
      leaseCost: acc.leaseCost + d.leaseCost,
      utilCost: acc.utilCost + d.utilCost,
      electricCost: acc.electricCost + d.electricCost,
      totalCost: acc.totalCost + d.totalCost,
      profit: acc.profit + d.profit,
      totalBeds: acc.totalBeds + d.totalBeds,
    }),
    { revenue: 0, leaseCost: 0, utilCost: 0, electricCost: 0, totalCost: 0, profit: 0, totalBeds: 0 }
  );
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const totalsRentPerBed = totals.totalBeds ? round2(totals.leaseCost / totals.totalBeds) : null;
  const totalsElectricPerBed = totals.totalBeds ? round2(totals.electricCost / totals.totalBeds) : null;
  const totalsRentPlusElectricPerBed = totals.totalBeds
    ? round2((totals.leaseCost + totals.electricCost) / totals.totalBeds)
    : null;
  const fmtPerBed = (v: number | null) =>
    v === null ? "—" : `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const activeCustomerName =
    customerFilter === ALL_CUSTOMERS ? null : customerById.get(customerFilter) ?? null;

  // Hide the Customer column when a customer filter is active, since every
  // row already belongs to that customer.
  const showCustomerColumn = customerFilter === ALL_CUSTOMERS;
  const tableColCount = showCustomerColumn ? 11 : 10;

  const { toast } = useToast();

  const handleDownloadCsv = () => {
    const columns = [
      { header: "Property", value: (d: typeof financialData[number]) => d.name },
      ...(showCustomerColumn
        ? [{ header: "Customer", value: (d: typeof financialData[number]) => d.customerName ?? "" }]
        : []),
      { header: "Occupied Beds", value: (d: typeof financialData[number]) => d.occupiedBeds },
      { header: "Total Beds", value: (d: typeof financialData[number]) => d.totalBeds },
      { header: "Revenue", value: (d: typeof financialData[number]) => d.revenue },
      { header: "Lease Cost", value: (d: typeof financialData[number]) => d.leaseCost },
      { header: "Utility Cost", value: (d: typeof financialData[number]) => d.utilCost },
      { header: "Total Cost", value: (d: typeof financialData[number]) => d.totalCost },
      { header: "Net Profit", value: (d: typeof financialData[number]) => d.profit },
      { header: "Rent / Bed", value: (d: typeof financialData[number]) => d.rentPerBed ?? "" },
      { header: "Electric / Bed", value: (d: typeof financialData[number]) => d.electricPerBed ?? "" },
      { header: "Rent + Electric / Bed", value: (d: typeof financialData[number]) => d.rentPlusElectricPerBed ?? "" },
    ];
    const totalsRow: typeof financialData[number] = {
      id: "__totals__",
      name: activeCustomerName ? `${activeCustomerName} Total` : "Portfolio Total",
      shortName: activeCustomerName ? `${activeCustomerName} Total` : "Portfolio Total",
      customerId: "",
      customerName: "",
      revenue: totals.revenue,
      leaseCost: totals.leaseCost,
      utilCost: totals.utilCost,
      electricCost: totals.electricCost,
      totalCost: totals.totalCost,
      profit: totals.profit,
      occupiedBeds: 0,
      totalBeds: 0,
      rentPerBed: totalsRentPerBed,
      electricPerBed: totalsElectricPerBed,
      rentPlusElectricPerBed: totalsRentPlusElectricPerBed,
    };
    // Blank out the non-numeric columns (Customer, Occupied/Total Beds) so the
    // totals row only carries summed values alongside its label.
    const numericHeaders = new Set([
      "Revenue", "Lease Cost", "Utility Cost", "Total Cost", "Net Profit",
      "Rent / Bed", "Electric / Bed", "Rent + Electric / Bed",
    ]);
    const totalsColumns = columns.map((col) =>
      col.header === "Property" || numericHeaders.has(col.header)
        ? col
        : { ...col, value: () => "" },
    );
    const bodyCsv = toCsv(financialData, columns);
    const [totalsCsv = ""] = toCsvRows([totalsRow], totalsColumns);
    const csv = `${bodyCsv}\r\n${totalsCsv}`;
    downloadCsv(timestampedCsvName("housingops-finance"), csv);
    toast({
      title: "Finance summary exported",
      description: `Downloaded ${financialData.length} ${financialData.length === 1 ? "property" : "properties"} as CSV.`,
    });
  };

  return (
    <MainLayout>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="p-8 max-w-7xl mx-auto space-y-8"
      >
        <PageHeader
          title="Financials"
          description="Profit & loss per property (monthly)"
          meta={
            activeCustomerName ? (
              <p
                className="text-xs text-muted-foreground flex items-center gap-1"
                data-testid="text-finance-active-customer"
              >
                <Briefcase className="h-3 w-3" />
                Showing only <span className="font-semibold">{activeCustomerName}</span>
              </p>
            ) : null
          }
          actions={<>
            <Select value={customerFilter} onValueChange={updateCustomerFilter}>
              <SelectTrigger className="w-full sm:w-56" data-testid="select-finance-customer-filter">
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
              disabled={financialData.length === 0}
              data-testid="button-download-finance-csv"
            >
              <Download className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
            <div className="flex gap-6 text-right">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Revenue</p>
                <p className="text-xl font-bold text-green-600">${totals.revenue.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Costs</p>
                <p className="text-xl font-bold text-destructive">${totals.totalCost.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Net Profit</p>
                <p className={`text-xl font-bold ${totals.profit >= 0 ? "text-green-600" : "text-destructive"}`}>
                  {totals.profit >= 0 ? "+" : ""}${totals.profit.toLocaleString()}
                </p>
              </div>
            </div>
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
            <span className="text-xs text-muted-foreground">
              {financialData.length} of {properties.length} propert{properties.length === 1 ? "y" : "ies"}
            </span>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue vs Cost by Property</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={financialData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="id"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => {
                    const row = financialData.find((d) => d.id === value);
                    return row?.shortName ?? String(value);
                  }}
                />
                <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value: number, name: string) => [`$${value.toLocaleString()}`, name]}
                  labelFormatter={(label) => {
                    const row = financialData.find((d) => d.id === label);
                    return row?.name ?? String(label);
                  }}
                  contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px" }}
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="revenue" name="Revenue" fill="hsl(142 76% 36%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="leaseCost" name="Lease Cost" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} stackId="cost" />
                <Bar dataKey="utilCost" name="Utility Cost" fill="hsl(25 95% 53%)" radius={[4, 4, 0, 0]} stackId="cost" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  {showCustomerColumn && <TableHead>Customer</TableHead>}
                  <TableHead className="text-center">Occupancy</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Lease Cost</TableHead>
                  <TableHead className="text-right">Utility Cost</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead className="text-right">Net Profit</TableHead>
                  <TableHead className="text-right">Rent / Bed</TableHead>
                  <TableHead className="text-right">Electric / Bed</TableHead>
                  <TableHead className="text-right">Rent + Electric / Bed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {financialData.length === 0 ? (
                  <tr>
                    <td colSpan={tableColCount} className="p-0">
                      <EmptyState
                        icon={properties.length === 0 ? Building2 : DollarSign}
                        title={
                          properties.length === 0
                            ? "No properties yet"
                            : "No properties match this filter"
                        }
                        description={
                          properties.length === 0
                            ? "Add your first property to start seeing revenue and expenses here."
                            : "Adjust the customer filter above to see revenue and expenses."
                        }
                        action={
                          properties.length === 0 ? (
                            <Button asChild data-testid="button-empty-finance-cta">
                              <Link href="/properties">Add Property</Link>
                            </Button>
                          ) : undefined
                        }
                        testId="empty-finance-table"
                      />
                    </td>
                  </tr>
                ) : (
                  <>
                    {financialData.map((d, i) => (
                      <motion.tr
                        key={d.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className={`border-b transition-colors ${d.profit < 0 ? "bg-destructive/5" : ""}`}
                        data-testid={`row-finance-${d.id}`}
                      >
                        <td className="p-4"><PropertyNameCell name={d.name} /></td>
                        {showCustomerColumn && (
                          <td className="p-4 text-sm text-muted-foreground" data-testid={`text-finance-customer-${d.id}`}>
                            {d.customerId && d.customerName ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateCustomerFilter(d.customerId);
                                }}
                                className="rounded-sm hover:underline hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                data-testid={`button-filter-customer-${d.id}`}
                                aria-label={`Filter by customer ${d.customerName}`}
                              >
                                {d.customerName}
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                        )}
                        <td className="p-4 text-center text-sm text-muted-foreground">
                          {d.occupiedBeds}/{d.totalBeds}
                        </td>
                        <td className="p-4 text-right font-medium text-green-600">${d.revenue.toLocaleString()}</td>
                        <td className="p-4 text-right text-sm text-muted-foreground">${d.leaseCost.toLocaleString()}</td>
                        <td className="p-4 text-right text-sm text-muted-foreground">${d.utilCost.toLocaleString()}</td>
                        <td className="p-4 text-right text-sm font-medium">${d.totalCost.toLocaleString()}</td>
                        <td className="p-4 text-right">
                          <Badge
                            variant={d.profit >= 0 ? "default" : "destructive"}
                            className={d.profit >= 0 ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""}
                          >
                            {d.profit >= 0 ? "+" : "-"}${Math.abs(d.profit).toLocaleString()}
                          </Badge>
                        </td>
                        <td
                          className="p-4 text-right text-sm tabular-nums"
                          data-testid={`text-finance-rent-per-bed-${d.id}`}
                        >
                          {fmtPerBed(d.rentPerBed)}
                        </td>
                        <td
                          className="p-4 text-right text-sm tabular-nums"
                          data-testid={`text-finance-electric-per-bed-${d.id}`}
                        >
                          {fmtPerBed(d.electricPerBed)}
                        </td>
                        <td
                          className="p-4 text-right text-sm font-medium tabular-nums"
                          data-testid={`text-finance-rent-plus-electric-per-bed-${d.id}`}
                        >
                          {fmtPerBed(d.rentPlusElectricPerBed)}
                        </td>
                      </motion.tr>
                    ))}
                    <tr className="bg-muted/50 border-t-2 border-border">
                      <td className="p-4 font-bold">{activeCustomerName ? `${activeCustomerName} Total` : "Portfolio Total"}</td>
                      {showCustomerColumn && <td />}
                      <td />
                      <td className="p-4 text-right font-bold text-green-600">${totals.revenue.toLocaleString()}</td>
                      <td className="p-4 text-right font-bold">${totals.leaseCost.toLocaleString()}</td>
                      <td className="p-4 text-right font-bold">${totals.utilCost.toLocaleString()}</td>
                      <td className="p-4 text-right font-bold">${totals.totalCost.toLocaleString()}</td>
                      <td className="p-4 text-right">
                        <Badge
                          variant={totals.profit >= 0 ? "default" : "destructive"}
                          className={totals.profit >= 0 ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""}
                        >
                          {totals.profit >= 0 ? "+" : "-"}${Math.abs(totals.profit).toLocaleString()}
                        </Badge>
                      </td>
                      <td className="p-4 text-right font-bold tabular-nums">{fmtPerBed(totalsRentPerBed)}</td>
                      <td className="p-4 text-right font-bold tabular-nums">{fmtPerBed(totalsElectricPerBed)}</td>
                      <td className="p-4 text-right font-bold tabular-nums">{fmtPerBed(totalsRentPlusElectricPerBed)}</td>
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
