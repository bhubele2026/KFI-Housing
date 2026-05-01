import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, BedDouble, KeyRound, Zap, DollarSign, TrendingUp, ArrowUpRight, ArrowDownRight, Users, Briefcase } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Dashboard() {
  const { properties, beds, leases, utilities, customers } = useData();
  const [customerFilter, setCustomerFilter] = useState("All");

  const totalProperties = properties.length;
  const totalBeds = beds.length;
  const occupiedBeds = beds.filter(b => b.status === "Occupied").length;
  const vacantBeds = beds.filter(b => b.status === "Vacant").length;
  const occupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;

  const totalMonthlyRevenue = properties.reduce((acc, p) => {
    const occupied = beds.filter(b => b.propertyId === p.id && b.status === "Occupied");
    return acc + (occupied.length * p.monthlyRent);
  }, 0);

  const totalMonthlyLeaseCosts = leases.filter(l => l.status === "Active").reduce((acc, l) => acc + l.monthlyRent, 0);
  const currentMonthUtilities = utilities.reduce((acc, u) => acc + u.monthlyCost, 0);
  const totalMonthlyCosts = totalMonthlyLeaseCosts + currentMonthUtilities;
  const netProfit = totalMonthlyRevenue - totalMonthlyCosts;

  const scopedProperties = useMemo(() => {
    if (customerFilter === "All") return properties;
    return properties.filter((p) => p.customerId === customerFilter);
  }, [properties, customerFilter]);

  const chartData = useMemo(
    () =>
      scopedProperties.map((p) => {
        const revenue = beds.filter(b => b.propertyId === p.id && b.status === "Occupied").length * p.monthlyRent;
        const leaseCost = leases.find(l => l.propertyId === p.id && l.status === "Active")?.monthlyRent || 0;
        const utilCost = utilities.filter(u => u.propertyId === p.id).reduce((acc, u) => acc + u.monthlyCost, 0);
        return {
          name: p.name,
          Revenue: revenue,
          Cost: leaseCost + utilCost,
          Profit: revenue - (leaseCost + utilCost),
        };
      }),
    [scopedProperties, beds, leases, utilities],
  );

  const cards = [
    { title: "Properties", value: totalProperties, icon: Building2, trend: "+2 this year" },
    { title: "Total Beds", value: totalBeds, icon: BedDouble, trend: `${occupiedBeds} occupied` },
    { title: "Occupancy", value: `${occupancyRate.toFixed(1)}%`, icon: Users, trend: `${vacantBeds} vacant` },
    { title: "Monthly Revenue", value: `$${totalMonthlyRevenue.toLocaleString()}`, icon: TrendingUp, trend: "Target: $45k" },
    { title: "Monthly Costs", value: `$${totalMonthlyCosts.toLocaleString()}`, icon: DollarSign, trend: "Leases + Utilities" },
    { title: "Net Profit", value: `$${netProfit.toLocaleString()}`, icon: Zap, trend: netProfit >= 0 ? "+12% vs last month" : "Needs attention" },
  ];

  const activeCustomerName =
    customerFilter === "All" ? null : customers.find((c) => c.id === customerFilter)?.name ?? null;

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Dashboard</h1>
            <p className="text-zinc-500 mt-1">Overview of your housing operations and financials.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {cards.map((card, i) => (
            <motion.div key={card.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between space-y-0 pb-2">
                    <p className="text-sm font-medium text-muted-foreground">{card.title}</p>
                    <card.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-2xl font-bold">{card.value}</span>
                    <span className="text-xs text-muted-foreground mt-1">{card.trend}</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Occupancy Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{occupiedBeds} Occupied</span>
                <span>{vacantBeds} Vacant</span>
              </div>
              <Progress value={occupancyRate} className="h-4" />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <CardTitle>Financial Overview</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                  <Tooltip formatter={(value) => `$${value}`} cursor={{fill: 'transparent'}} />
                  <Legend />
                  <Bar dataKey="Revenue" fill="#0f172a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Cost" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle>Property Performance</CardTitle>
                  {activeCustomerName && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Briefcase className="h-3 w-3" />
                      Showing only <span className="font-semibold">{activeCustomerName}</span>
                    </p>
                  )}
                </div>
                <Select value={customerFilter} onValueChange={setCustomerFilter}>
                  <SelectTrigger className="w-full sm:w-56" data-testid="select-dashboard-customer-filter">
                    <SelectValue placeholder="Customer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Customers</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Occupancy</TableHead>
                    <TableHead className="text-right">Profit/Loss</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chartData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                        No properties match this customer.
                      </TableCell>
                    </TableRow>
                  ) : (
                    chartData.map((data) => {
                      const property = properties.find(p => p.name === data.name);
                      const customer = property ? customers.find(c => c.id === property.customerId) : undefined;
                      return (
                        <TableRow key={data.name} data-testid={`row-perf-${property?.id ?? data.name}`}>
                          <TableCell className="font-medium">{data.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {customer?.name ?? <span className="italic">—</span>}
                          </TableCell>
                          <TableCell>
                            {Math.round((beds.filter(b => b.propertyId === property?.id && b.status === "Occupied").length / (property?.totalBeds || 1)) * 100)}%
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={data.Profit >= 0 ? "default" : "destructive"} className={data.Profit >= 0 ? "bg-emerald-500 hover:bg-emerald-600" : ""}>
                              ${Math.abs(data.Profit).toLocaleString()} {data.Profit >= 0 ? 'Profit' : 'Loss'}
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
      </div>
    </MainLayout>
  );
}
