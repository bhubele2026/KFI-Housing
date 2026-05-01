import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { toMonthlyCharge } from "@/data/mockData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { motion } from "framer-motion";
import { Briefcase, X } from "lucide-react";

export default function Finance() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const { properties, beds, leases, utilities, occupants, customers } = useData();
  const [customerFilter, setCustomerFilter] = useState("All");

  const customerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name);
    return map;
  }, [customers]);

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

  const visibleProperties = useMemo(() => {
    if (customerFilter === "All") return properties;
    return properties.filter((p) => p.customerId === customerFilter);
  }, [properties, customerFilter]);

  const financialData = visibleProperties.map(p => {
    const propOccupants = occupants.filter(o => o.propertyId === p.id && o.status === "Active");
    const revenue = propOccupants.reduce((s, o) => s + toMonthlyCharge(o.chargePerBed, o.billingFrequency ?? "Monthly"), 0);
    const leaseCost = leases.find(l => l.propertyId === p.id && l.status === "Active")?.monthlyRent ?? 0;
    const utilCost = utilities.filter(u => u.propertyId === p.id).reduce((s, u) => s + u.monthlyCost, 0);
    const totalCost = leaseCost + utilCost;
    const occupiedBeds = beds.filter(b => b.propertyId === p.id && b.status === "Occupied").length;
    const totalBeds = beds.filter(b => b.propertyId === p.id).length;

    return {
      id: p.id,
      name: p.name,
      shortName: p.name.split(" ")[0],
      revenue,
      leaseCost,
      utilCost,
      totalCost,
      profit: revenue - totalCost,
      occupiedBeds,
      totalBeds,
    };
  });

  const totals = financialData.reduce(
    (acc, d) => ({
      revenue: acc.revenue + d.revenue,
      leaseCost: acc.leaseCost + d.leaseCost,
      utilCost: acc.utilCost + d.utilCost,
      totalCost: acc.totalCost + d.totalCost,
      profit: acc.profit + d.profit,
    }),
    { revenue: 0, leaseCost: 0, utilCost: 0, totalCost: 0, profit: 0 }
  );

  const activeCustomerName =
    customerFilter === "All" ? null : customerById.get(customerFilter) ?? null;

  return (
    <MainLayout>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="p-8 max-w-7xl mx-auto space-y-8"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Financials</h1>
            <p className="text-muted-foreground mt-1">Profit & loss per property (monthly)</p>
            {activeCustomerName && (
              <p
                className="text-xs text-muted-foreground mt-2 flex items-center gap-1"
                data-testid="text-finance-active-customer"
              >
                <Briefcase className="h-3 w-3" />
                Showing only <span className="font-semibold">{activeCustomerName}</span>
              </p>
            )}
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <Select value={customerFilter} onValueChange={updateCustomerFilter}>
              <SelectTrigger className="w-full sm:w-56" data-testid="select-finance-customer-filter">
                <SelectValue placeholder="Customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Customers</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                <XAxis dataKey="shortName" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value: number, name: string) => [`$${value.toLocaleString()}`, name]}
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
                  <TableHead className="text-center">Occupancy</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Lease Cost</TableHead>
                  <TableHead className="text-right">Utility Cost</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead className="text-right">Net Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {financialData.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                      No properties match this filter.
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
                      >
                        <td className="p-4 font-medium">{d.name}</td>
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
                      </motion.tr>
                    ))}
                    <tr className="bg-muted/50 border-t-2 border-border">
                      <td className="p-4 font-bold">{activeCustomerName ? `${activeCustomerName} Total` : "Portfolio Total"}</td>
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
