import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { PropertyNameCell } from "@/components/property-name-cell";
import { formatPropertyName } from "@/lib/property-name";
import { useData } from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { sumActiveRentBreakdown, toMonthlyCharge, formatUsd } from "@/data/mockData";
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
  const { t } = useTranslation();
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
    const { contractCost, hotelRateCost, hasHotelRateLease } = sumActiveRentBreakdown(leases, roomNightLogs, p.id);
    const leaseCost = contractCost + hotelRateCost;
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
      contractCost,
      hotelRateCost,
      hasHotelRateLease,
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
      contractCost: acc.contractCost + d.contractCost,
      hotelRateCost: acc.hotelRateCost + d.hotelRateCost,
      hasAnyHotelRateLease: acc.hasAnyHotelRateLease || d.hasHotelRateLease,
      utilCost: acc.utilCost + d.utilCost,
      electricCost: acc.electricCost + d.electricCost,
      totalCost: acc.totalCost + d.totalCost,
      profit: acc.profit + d.profit,
      totalBeds: acc.totalBeds + d.totalBeds,
    }),
    { revenue: 0, leaseCost: 0, contractCost: 0, hotelRateCost: 0, hasAnyHotelRateLease: false, utilCost: 0, electricCost: 0, totalCost: 0, profit: 0, totalBeds: 0 }
  );
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const totalsRentPerBed = totals.totalBeds ? round2(totals.leaseCost / totals.totalBeds) : null;
  const totalsElectricPerBed = totals.totalBeds ? round2(totals.electricCost / totals.totalBeds) : null;
  const totalsRentPlusElectricPerBed = totals.totalBeds
    ? round2((totals.leaseCost + totals.electricCost) / totals.totalBeds)
    : null;
  const fmtPerBed = (v: number | null) =>
    v === null ? "—" : `${formatUsd(v)}`;

  const activeCustomerName =
    customerFilter === ALL_CUSTOMERS ? null : customerById.get(customerFilter) ?? null;

  // Hide the Customer column when a customer filter is active, since every
  // row already belongs to that customer.
  const showCustomerColumn = customerFilter === ALL_CUSTOMERS;
  const tableColCount = showCustomerColumn ? 11 : 10;

  const { toast } = useToast();

  const handleDownloadCsv = () => {
    const tt = (k: string) => t(`pages.finance.table.${k}`);
    const columns = [
      { header: tt("property"), value: (d: typeof financialData[number]) => d.name },
      ...(showCustomerColumn
        ? [{ header: tt("customer"), value: (d: typeof financialData[number]) => d.customerName ?? "" }]
        : []),
      { header: tt("occupiedBeds"), value: (d: typeof financialData[number]) => d.occupiedBeds },
      { header: tt("totalBeds"), value: (d: typeof financialData[number]) => d.totalBeds },
      { header: tt("revenue"), value: (d: typeof financialData[number]) => d.revenue },
      { header: tt("leaseCost"), value: (d: typeof financialData[number]) => d.leaseCost },
      { header: tt("contractRent"), value: (d: typeof financialData[number]) => d.contractCost },
      { header: tt("hotelRateEst"), value: (d: typeof financialData[number]) => d.hotelRateCost },
      { header: tt("utilityCost"), value: (d: typeof financialData[number]) => d.utilCost },
      { header: tt("totalCost"), value: (d: typeof financialData[number]) => d.totalCost },
      { header: tt("netProfit"), value: (d: typeof financialData[number]) => d.profit },
      { header: tt("rentPerBed"), value: (d: typeof financialData[number]) => d.rentPerBed ?? "" },
      { header: tt("electricPerBed"), value: (d: typeof financialData[number]) => d.electricPerBed ?? "" },
      { header: tt("rentPlusElectricPerBed"), value: (d: typeof financialData[number]) => d.rentPlusElectricPerBed ?? "" },
    ];
    const totalLabel = activeCustomerName
      ? t("pages.finance.table.customerTotal", { customer: activeCustomerName })
      : t("pages.finance.table.portfolioTotal");
    const totalsRow: typeof financialData[number] = {
      id: "__totals__",
      name: totalLabel,
      shortName: totalLabel,
      customerId: "",
      customerName: "",
      revenue: totals.revenue,
      leaseCost: totals.leaseCost,
      contractCost: totals.contractCost,
      hotelRateCost: totals.hotelRateCost,
      hasHotelRateLease: totals.hasAnyHotelRateLease,
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
      tt("revenue"), tt("leaseCost"), tt("contractRent"), tt("hotelRateEst"), tt("utilityCost"), tt("totalCost"), tt("netProfit"),
      tt("rentPerBed"), tt("electricPerBed"), tt("rentPlusElectricPerBed"),
    ]);
    const propertyHeader = tt("property");
    const totalsColumns = columns.map((col) =>
      col.header === propertyHeader || numericHeaders.has(col.header)
        ? col
        : { ...col, value: () => "" },
    );
    const bodyCsv = toCsv(financialData, columns);
    const [totalsCsv = ""] = toCsvRows([totalsRow], totalsColumns);
    const csv = `${bodyCsv}\r\n${totalsCsv}`;
    downloadCsv(timestampedCsvName("housingops-finance"), csv);
    toast({
      title: t("pages.finance.exportedTitle"),
      description: t("pages.finance.exportedDescription", { count: financialData.length }),
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
          title={t("pages.finance.title")}
          description={t("pages.finance.description")}
          meta={
            activeCustomerName ? (
              <p
                className="text-xs text-muted-foreground flex items-center gap-1"
                data-testid="text-finance-active-customer"
              >
                <Briefcase className="h-3 w-3" />
                {t("pages.finance.showingOnly")} <span className="font-semibold">{activeCustomerName}</span>
              </p>
            ) : null
          }
          actions={<>
            <Select value={customerFilter} onValueChange={updateCustomerFilter}>
              <SelectTrigger className="w-full sm:w-56" data-testid="select-finance-customer-filter">
                <SelectValue placeholder={t("pages.finance.customerPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CUSTOMERS}>{t("pages.finance.allCustomers")}</SelectItem>
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
              {t("pages.finance.downloadCsv")}
            </Button>
            <div className="flex gap-6 text-right">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("pages.finance.totalRevenue")}</p>
                <p className="text-xl font-bold text-green-600">{formatUsd(totals.revenue)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("pages.finance.totalCosts")}</p>
                <p className="text-xl font-bold text-destructive">{formatUsd(totals.totalCost)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("pages.finance.netProfit")}</p>
                <p className={`text-xl font-bold ${totals.profit >= 0 ? "text-green-600" : "text-destructive"}`}>
                  {totals.profit >= 0 ? "+" : ""}{formatUsd(totals.profit)}
                </p>
              </div>
            </div>
          </>}
        />

        {activeCustomerName && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 px-2 py-1" data-testid="badge-customer-filter">
              <Briefcase className="h-3 w-3" />
              {t("pages.finance.filteredByCustomer")} <span className="font-semibold">{activeCustomerName}</span>
              <button
                type="button"
                onClick={() => updateCustomerFilter(ALL_CUSTOMERS)}
                className="ml-1 rounded-sm p-0.5 hover:bg-background/40"
                aria-label={t("pages.finance.clearCustomerFilter")}
                data-testid="button-clear-customer-filter"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
            <span className="text-xs text-muted-foreground">
              {t("pages.finance.propertiesCount", { shown: financialData.length, total: properties.length, count: properties.length })}
            </span>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("pages.finance.chartTitle")}</CardTitle>
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
                  formatter={(value: number, name: string) => [`${formatUsd(value)}`, name]}
                  labelFormatter={(label) => {
                    const row = financialData.find((d) => d.id === label);
                    return row?.name ?? String(label);
                  }}
                  contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", fontSize: "12px" }}
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="revenue" name={t("pages.finance.table.revenue")} fill="hsl(142 76% 36%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="leaseCost" name={t("pages.finance.table.leaseCost")} fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} stackId="cost" />
                <Bar dataKey="utilCost" name={t("pages.finance.table.utilityCost")} fill="hsl(25 95% 53%)" radius={[4, 4, 0, 0]} stackId="cost" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.finance.table.property")}</TableHead>
                  {showCustomerColumn && <TableHead>{t("pages.finance.table.customer")}</TableHead>}
                  <TableHead className="text-center">{t("pages.finance.table.occupancy")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.revenue")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.leaseCost")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.utilityCost")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.totalCost")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.netProfit")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.rentPerBed")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.electricPerBed")}</TableHead>
                  <TableHead className="text-right">{t("pages.finance.table.rentPlusElectricPerBed")}</TableHead>
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
                            ? t("pages.finance.empty.noPropertiesTitle")
                            : t("pages.finance.empty.noMatchTitle")
                        }
                        description={
                          properties.length === 0
                            ? t("pages.finance.empty.noPropertiesDescription")
                            : t("pages.finance.empty.noMatchDescription")
                        }
                        action={
                          properties.length === 0 ? (
                            <Button asChild data-testid="button-empty-finance-cta">
                              <Link href="/properties">{t("pages.finance.empty.addProperty")}</Link>
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
                                aria-label={t("pages.finance.filterByCustomerAria", { customer: d.customerName })}
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
                        <td className="p-4 text-right font-medium text-green-600">{formatUsd(d.revenue)}</td>
                        <td className="p-4 text-right text-sm text-muted-foreground">
                          <span>{formatUsd(d.leaseCost)}</span>
                          {d.hasHotelRateLease && (
                            <>
                              <span className="block text-xs text-muted-foreground/70" data-testid={`text-finance-contract-rent-${d.id}`}>
                                {t("pages.finance.table.contractLabel")} {formatUsd(d.contractCost)}
                              </span>
                              <span className="block text-xs text-muted-foreground/70" data-testid={`text-finance-hotel-rate-${d.id}`}>
                                {t("pages.finance.table.hotelRateLabel")} {formatUsd(d.hotelRateCost)} {t("pages.finance.table.hotelRateSuffix")}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="p-4 text-right text-sm text-muted-foreground">{formatUsd(d.utilCost)}</td>
                        <td className="p-4 text-right text-sm font-medium">{formatUsd(d.totalCost)}</td>
                        <td className="p-4 text-right">
                          <Badge
                            variant={d.profit >= 0 ? "default" : "destructive"}
                            className={d.profit >= 0 ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""}
                          >
                            {d.profit >= 0 ? "+" : "-"}{formatUsd(Math.abs(d.profit))}
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
                      <td className="p-4 font-bold">{activeCustomerName ? t("pages.finance.table.customerTotal", { customer: activeCustomerName }) : t("pages.finance.table.portfolioTotal")}</td>
                      {showCustomerColumn && <td />}
                      <td />
                      <td className="p-4 text-right font-bold text-green-600">{formatUsd(totals.revenue)}</td>
                      <td className="p-4 text-right font-bold">
                        <span>{formatUsd(totals.leaseCost)}</span>
                        {totals.hasAnyHotelRateLease && (
                          <>
                            <span className="block text-xs font-normal text-muted-foreground" data-testid="text-finance-contract-rent-total">
                              {t("pages.finance.table.contractLabel")} {formatUsd(totals.contractCost)}
                            </span>
                            <span className="block text-xs font-normal text-muted-foreground" data-testid="text-finance-hotel-rate-total">
                              {t("pages.finance.table.hotelRateLabel")} {formatUsd(totals.hotelRateCost)} {t("pages.finance.table.hotelRateSuffix")}
                            </span>
                          </>
                        )}
                      </td>
                      <td className="p-4 text-right font-bold">{formatUsd(totals.utilCost)}</td>
                      <td className="p-4 text-right font-bold">{formatUsd(totals.totalCost)}</td>
                      <td className="p-4 text-right">
                        <Badge
                          variant={totals.profit >= 0 ? "default" : "destructive"}
                          className={totals.profit >= 0 ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""}
                        >
                          {totals.profit >= 0 ? "+" : "-"}{formatUsd(Math.abs(totals.profit))}
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
