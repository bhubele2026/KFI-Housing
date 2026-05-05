import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, BedDouble, Zap, DollarSign, TrendingUp, Users, Briefcase, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, EmptyStateRow } from "@/components/empty-state";
import { computeOverallRating, RATING_CATEGORIES, sumActiveRent, type RatingCategoryKey } from "@/data/mockData";
import { StarRating } from "@/components/star-rating";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PropertyNameCell } from "@/components/property-name-cell";
import { formatPropertyName } from "@/lib/property-name";

type TopPropertiesSortKey = "overall" | RatingCategoryKey;

export default function Dashboard() {
  const { properties, beds, leases, utilities, customers } = useData();
  const { customerId: customerFilter, setCustomerId: updateCustomerFilter } =
    useCustomerScope();
  const [topRatingSort, setTopRatingSort] = useState<TopPropertiesSortKey>("overall");

  const scopedProperties = useMemo(() => {
    if (customerFilter === ALL_CUSTOMERS) return properties;
    return properties.filter((p) => p.customerId === customerFilter);
  }, [properties, customerFilter]);

  const scopedPropertyIds = useMemo(
    () => new Set(scopedProperties.map((p) => p.id)),
    [scopedProperties],
  );

  const scopedBeds = useMemo(
    () => beds.filter((b) => scopedPropertyIds.has(b.propertyId)),
    [beds, scopedPropertyIds],
  );

  const scopedLeases = useMemo(
    () => leases.filter((l) => scopedPropertyIds.has(l.propertyId)),
    [leases, scopedPropertyIds],
  );

  const scopedUtilities = useMemo(
    () => utilities.filter((u) => scopedPropertyIds.has(u.propertyId)),
    [utilities, scopedPropertyIds],
  );

  const totalProperties = scopedProperties.length;
  const totalBeds = scopedBeds.length;
  const occupiedBeds = scopedBeds.filter((b) => b.status === "Occupied").length;
  const vacantBeds = scopedBeds.filter((b) => b.status === "Vacant").length;
  const occupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;

  const totalMonthlyRevenue = scopedProperties.reduce((acc, p) => {
    const occupied = scopedBeds.filter((b) => b.propertyId === p.id && b.status === "Occupied");
    return acc + occupied.length * p.monthlyRent;
  }, 0);

  const totalMonthlyLeaseCosts = scopedLeases
    .filter((l) => l.status === "Active")
    .reduce((acc, l) => acc + l.monthlyRent, 0);
  const currentMonthUtilities = scopedUtilities.reduce((acc, u) => acc + u.monthlyCost, 0);
  const totalMonthlyCosts = totalMonthlyLeaseCosts + currentMonthUtilities;
  const netProfit = totalMonthlyRevenue - totalMonthlyCosts;

  const topRatedProperties = useMemo(() => {
    const scored = scopedProperties.map((p) => {
      const overall = computeOverallRating(p.ratings);
      const score =
        topRatingSort === "overall" ? overall : (p.ratings?.[topRatingSort] ?? 0) || null;
      return { property: p, overall, score };
    });
    return scored
      .filter((row) => row.score !== null && row.score > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 5);
  }, [scopedProperties, topRatingSort]);

  const sortLabel =
    topRatingSort === "overall"
      ? "Overall"
      : RATING_CATEGORIES.find((c) => c.key === topRatingSort)?.label ?? "Overall";

  // Carry the property id through chartData so downstream lookups (customer
  // name, occupancy %, row keys) don't depend on `name` — two properties can
  // share a name in the demo data, which would otherwise mis-map rows. The
  // `name` field is kept purely for display via the chart tickFormatter.
  // Lease cost sums every Active lease for the property — picking just the
  // first match silently under-reports rent (matches finance.tsx behavior).
  const chartData = useMemo(
    () =>
      scopedProperties.map((p) => {
        const revenue = scopedBeds.filter((b) => b.propertyId === p.id && b.status === "Occupied").length * p.monthlyRent;
        const leaseCost = sumActiveRent(scopedLeases, p.id);
        const utilCost = scopedUtilities.filter((u) => u.propertyId === p.id).reduce((acc, u) => acc + u.monthlyCost, 0);
        return {
          id: p.id,
          name: p.name,
          Revenue: revenue,
          Cost: leaseCost + utilCost,
          Profit: revenue - (leaseCost + utilCost),
        };
      }),
    [scopedProperties, scopedBeds, scopedLeases, scopedUtilities],
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
    customerFilter === ALL_CUSTOMERS
      ? null
      : customers.find((c) => c.id === customerFilter)?.name ?? null;

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <PageHeader
          title="Dashboard"
          description="Overview of your housing operations and financials."
          meta={
            activeCustomerName ? (
              <p
                className="text-xs text-muted-foreground flex items-center gap-1"
                data-testid="text-dashboard-active-customer"
              >
                <Briefcase className="h-3 w-3" />
                Showing only <span className="font-semibold">{activeCustomerName}</span>
              </p>
            ) : null
          }
          actions={
            <Select value={customerFilter} onValueChange={updateCustomerFilter}>
              <SelectTrigger className="w-full sm:w-56" data-testid="select-dashboard-customer-filter">
                <SelectValue placeholder="Customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CUSTOMERS}>All Customers</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

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

        <Card data-testid="card-top-properties">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              <CardTitle>Top Properties by Rating</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Sort by</span>
              <Select
                value={topRatingSort}
                onValueChange={(v) => setTopRatingSort(v as TopPropertiesSortKey)}
              >
                <SelectTrigger className="w-44 h-8" data-testid="select-top-rating-sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overall">Overall</SelectItem>
                  {RATING_CATEGORIES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {topRatedProperties.length === 0 ? (
              <EmptyState
                icon={properties.length === 0 ? Building2 : Trophy}
                title={
                  properties.length === 0
                    ? "No properties yet"
                    : `No ${sortLabel.toLowerCase()} ratings yet`
                }
                description={
                  properties.length === 0
                    ? "Add your first property to start ranking your top performers here."
                    : "Rate your properties to see your top performers ranked here."
                }
                action={
                  <Button asChild data-testid="button-empty-top-rated-cta">
                    <Link href="/properties">
                      {properties.length === 0 ? "Add Property" : "Rate Properties"}
                    </Link>
                  </Button>
                }
                testId="empty-top-rated-properties"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>{sortLabel}</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topRatedProperties.map((row, i) => {
                    const customer = customers.find((c) => c.id === row.property.customerId);
                    const score = row.score ?? 0;
                    return (
                      <TableRow key={row.property.id} data-testid={`row-top-rated-${row.property.id}`}>
                        <TableCell className="text-sm font-semibold tabular-nums text-muted-foreground">
                          {i + 1}
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link
                            href={`/properties/${row.property.id}`}
                            className="hover:underline text-primary"
                          >
                            <PropertyNameCell
                              name={row.property.name}
                              primaryClassName="text-primary"
                            />
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {customer?.name ?? <span className="italic">—</span>}
                        </TableCell>
                        <TableCell>
                          <StarRating value={score} readOnly size="sm" ariaLabel={`${sortLabel} rating`} />
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums">
                          {score.toFixed(1)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
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
                  <XAxis
                    dataKey="id"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => {
                      const row = chartData.find((d) => d.id === value);
                      return row ? formatPropertyName(row.name).primary : value;
                    }}
                  />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                  <Tooltip
                    formatter={(value) => `$${value}`}
                    labelFormatter={(label) => {
                      const row = chartData.find((d) => d.id === label);
                      return row?.name ?? String(label);
                    }}
                    cursor={{fill: 'transparent'}}
                  />
                  <Legend />
                  <Bar dataKey="Revenue" fill="hsl(217 71% 21%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Cost" fill="hsl(217 25% 65%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Property Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <Table containerClassName="max-h-[300px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10 bg-card">Property</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card">Customer</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card">Occupancy</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card text-right">Profit/Loss</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chartData.length === 0 ? (
                    <EmptyStateRow
                      colSpan={4}
                      icon={Building2}
                      title={
                        properties.length === 0
                          ? "No properties yet"
                          : "No properties match this customer"
                      }
                      description={
                        properties.length === 0
                          ? "Add your first property to start tracking performance here."
                          : "Pick a different customer above, or add properties to this one to see performance."
                      }
                      action={
                        <Button asChild data-testid="button-empty-perf-cta">
                          <Link href="/properties">Add Property</Link>
                        </Button>
                      }
                      testId="empty-property-performance"
                    />
                  ) : (
                    chartData.map((data) => {
                      const property = scopedProperties.find(p => p.id === data.id);
                      const customer = property ? customers.find(c => c.id === property.customerId) : undefined;
                      // Derive occupancy from the actual bed rows for this
                      // property — the static `totalBeds` field on the
                      // property record can drift from reality (or be 0),
                      // which previously inflated occupancy past 100%.
                      const propBeds = scopedBeds.filter(b => b.propertyId === data.id);
                      const propOccupied = propBeds.filter(b => b.status === "Occupied").length;
                      const occupancyPct = propBeds.length > 0
                        ? Math.round((propOccupied / propBeds.length) * 100)
                        : 0;
                      return (
                        <TableRow key={data.id} data-testid={`row-perf-${data.id}`}>
                          <TableCell><PropertyNameCell name={data.name} /></TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {customer?.name ?? <span className="italic">—</span>}
                          </TableCell>
                          <TableCell>{occupancyPct}%</TableCell>
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
