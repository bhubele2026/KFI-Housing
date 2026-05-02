import { useMemo } from "react";
import { Link, useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { toMonthlyCharge } from "@/data/mockData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Briefcase, ChevronLeft, ChevronRight, Building2, BedDouble,
  TrendingUp, Mail, Phone, FileText, User,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

function StatCard({
  label, value, sub, icon: Icon, color = "text-foreground", testId,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ElementType;
  color?: string;
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          {Icon && (
            <div className="p-2 rounded-lg bg-muted">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { customers, properties, beds, occupants, isLoading } = useData();

  // Per-property roll-ups for THIS customer: total beds, occupied beds, and
  // monthly revenue (summed from each active occupant's normalized monthly
  // charge). Memoized so the calculation only re-runs when the underlying
  // collections actually change.
  const propertyStats = useMemo(() => {
    const customerProperties = properties.filter((p) => p.customerId === id);

    const bedsByProperty = new Map<string, { total: number; occupied: number }>();
    for (const b of beds) {
      const entry = bedsByProperty.get(b.propertyId) ?? { total: 0, occupied: 0 };
      entry.total += 1;
      if (b.status === "Occupied") entry.occupied += 1;
      bedsByProperty.set(b.propertyId, entry);
    }

    const revenueByProperty = new Map<string, number>();
    for (const o of occupants) {
      if (o.status !== "Active" || !o.propertyId) continue;
      const monthly = toMonthlyCharge(o.chargePerBed, o.billingFrequency ?? "Monthly");
      revenueByProperty.set(
        o.propertyId,
        (revenueByProperty.get(o.propertyId) ?? 0) + monthly,
      );
    }

    return customerProperties.map((p) => {
      const bed = bedsByProperty.get(p.id) ?? { total: 0, occupied: 0 };
      const revenue = Math.round(revenueByProperty.get(p.id) ?? 0);
      const occupancyPct = bed.total > 0 ? (bed.occupied / bed.total) * 100 : 0;
      return {
        property: p,
        totalBeds: bed.total,
        occupiedBeds: bed.occupied,
        occupancyPct,
        monthlyRevenue: revenue,
      };
    });
  }, [properties, beds, occupants, id]);

  // Last ~12 months of monthly revenue for THIS customer. For each month, we
  // sum up the normalized monthly charge of every occupant who was at one of
  // this customer's properties during that month — based on the occupant's
  // moveInDate / moveOutDate window, not their current Active/Former status,
  // so historical revenue stays correct even after move-outs.
  const revenueTrend = useMemo(() => {
    const now = new Date();
    const months: { key: string; label: string; tooltipLabel: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const key = `${year}-${String(month).padStart(2, "0")}`;
      const short = d.toLocaleString("en-US", { month: "short" });
      months.push({
        key,
        label: short,
        tooltipLabel: `${short} ${year}`,
      });
    }

    const customerPropIds = new Set(
      properties.filter((p) => p.customerId === id).map((p) => p.id),
    );
    const relevantOccupants = occupants.filter(
      (o) => o.propertyId && customerPropIds.has(o.propertyId),
    );

    return months.map(({ key, label, tooltipLabel }) => {
      let revenue = 0;
      for (const o of relevantOccupants) {
        const moveInKey = (o.moveInDate ?? "").slice(0, 7);
        if (!moveInKey || moveInKey > key) continue;
        const moveOutKey = o.moveOutDate ? o.moveOutDate.slice(0, 7) : null;
        if (moveOutKey && moveOutKey < key) continue;
        revenue += toMonthlyCharge(o.chargePerBed, o.billingFrequency ?? "Monthly");
      }
      return { key, label, tooltipLabel, revenue: Math.round(revenue) };
    });
  }, [properties, occupants, id]);

  const totals = useMemo(() => {
    let totalBeds = 0;
    let occupiedBeds = 0;
    let monthlyRevenue = 0;
    for (const s of propertyStats) {
      totalBeds += s.totalBeds;
      occupiedBeds += s.occupiedBeds;
      monthlyRevenue += s.monthlyRevenue;
    }
    const occupancyPct = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;
    return {
      propertyCount: propertyStats.length,
      totalBeds,
      occupiedBeds,
      occupancyPct,
      monthlyRevenue,
    };
  }, [propertyStats]);

  if (isLoading) {
    return (
      <MainLayout>
        <div className="p-8 max-w-7xl mx-auto space-y-6" data-testid="customer-detail-loading">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-28" />
            <span className="text-muted-foreground">/</span>
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-4 w-72" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Skeleton className="h-56 w-full rounded-xl lg:col-span-1" />
            <Skeleton className="h-56 w-full rounded-xl lg:col-span-2" />
          </div>
        </div>
      </MainLayout>
    );
  }

  const customer = customers.find((c) => c.id === id);
  if (!customer) {
    return (
      <MainLayout>
        <div className="p-8 text-center" data-testid="customer-detail-not-found">
          <p className="text-muted-foreground">Customer not found.</p>
          <Link href="/customers">
            <Button variant="link" className="mt-2">Back to Customers</Button>
          </Link>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="p-8 max-w-7xl mx-auto space-y-6"
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-3">
          <Link href="/customers">
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground" data-testid="link-back-to-customers">
              <ChevronLeft className="h-4 w-4" />
              Customers
            </Button>
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium">{customer.name}</span>
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Briefcase className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="customer-detail-name">
                {customer.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                {totals.propertyCount} propert{totals.propertyCount === 1 ? "y" : "ies"} · {totals.totalBeds} bed{totals.totalBeds === 1 ? "" : "s"}
              </p>
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Properties"
            value={totals.propertyCount}
            icon={Building2}
            testId="stat-properties"
          />
          <StatCard
            label="Beds"
            value={totals.totalBeds > 0 ? `${totals.occupiedBeds}/${totals.totalBeds}` : "—"}
            sub={totals.totalBeds > 0 ? "occupied / total" : undefined}
            icon={BedDouble}
            testId="stat-beds"
          />
          <StatCard
            label="Occupancy"
            value={totals.totalBeds > 0 ? `${totals.occupancyPct.toFixed(0)}%` : "—"}
            color={totals.totalBeds > 0 ? "text-emerald-600" : "text-muted-foreground"}
            icon={TrendingUp}
            testId="stat-occupancy"
          />
          <StatCard
            label="Monthly Revenue"
            value={totals.monthlyRevenue > 0 ? `$${totals.monthlyRevenue.toLocaleString()}` : "—"}
            sub="across all properties"
            color={totals.monthlyRevenue > 0 ? "text-emerald-600" : "text-muted-foreground"}
            icon={TrendingUp}
            testId="stat-revenue"
          />
        </div>

        {/* Revenue trend (last 12 months) */}
        <Card data-testid="card-customer-revenue-trend">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Revenue Trend
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                Last 12 months
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-44" data-testid="customer-revenue-trend-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={revenueTrend}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`
                    }
                  />
                  <Tooltip
                    cursor={{ fill: "transparent" }}
                    formatter={(value: number) => [
                      `$${value.toLocaleString()}`,
                      "Revenue",
                    ]}
                    labelFormatter={(_label, payload) =>
                      (payload?.[0]?.payload as { tooltipLabel?: string } | undefined)
                        ?.tooltipLabel ?? ""
                    }
                  />
                  <Bar dataKey="revenue" fill="#0f172a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Contact + Properties */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Contact card */}
          <Card className="lg:col-span-1" data-testid="card-customer-contact">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                Contact
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Primary contact</p>
                <p className="mt-0.5" data-testid="contact-name">
                  {customer.contactName || <span className="text-muted-foreground italic">Not set</span>}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Email</p>
                <p className="mt-0.5" data-testid="contact-email">
                  {customer.email ? (
                    <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1.5 hover:underline">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      {customer.email}
                    </a>
                  ) : (
                    <span className="text-muted-foreground italic">Not set</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Phone</p>
                <p className="mt-0.5" data-testid="contact-phone">
                  {customer.phone ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      {customer.phone}
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">Not set</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
                  <FileText className="h-3 w-3" />
                  Notes
                </p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground" data-testid="contact-notes">
                  {customer.notes ? customer.notes : <span className="italic">No notes yet.</span>}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Properties list */}
          <Card className="lg:col-span-2" data-testid="card-customer-properties">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Properties
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {totals.propertyCount} total
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {propertyStats.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground" data-testid="empty-properties">
                  This customer has no properties yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Property</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-center">Beds</TableHead>
                      <TableHead className="text-center">Occupancy</TableHead>
                      <TableHead className="text-right">Revenue / mo</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {propertyStats.map(({ property, totalBeds, occupiedBeds, occupancyPct, monthlyRevenue }, i) => (
                      <motion.tr
                        key={property.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="cursor-pointer hover:bg-muted/50 border-b transition-colors group"
                        onClick={() => navigate(`/properties/${property.id}`)}
                        data-testid={`row-customer-property-${property.id}`}
                      >
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{property.name}</span>
                            <Badge
                              variant={property.status === "Active" ? "default" : "secondary"}
                              className="text-[10px] px-1.5 py-0"
                            >
                              {property.status}
                            </Badge>
                          </div>
                        </td>
                        <td className="p-4 text-sm text-muted-foreground">
                          {property.city}{property.state ? `, ${property.state}` : ""}
                        </td>
                        <td className="p-4 text-center text-sm tabular-nums">
                          {totalBeds > 0 ? (
                            <span className="font-medium">{occupiedBeds}/{totalBeds}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4 text-center text-sm tabular-nums">
                          {totalBeds > 0 ? (
                            <span className="font-medium">{occupancyPct.toFixed(0)}%</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4 text-right text-sm tabular-nums">
                          {monthlyRevenue > 0 ? (
                            <span className="font-medium">${monthlyRevenue.toLocaleString()}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </td>
                      </motion.tr>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </MainLayout>
  );
}
