import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { PropertyNameCell } from "@/components/property-name-cell";
import { shortPropertyName } from "@/lib/property-name";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRows } from "@/components/skeleton-rows";
import { Briefcase, Download, X, BedDouble, Trash2 } from "lucide-react";
import { EmptyStateRow } from "@/components/empty-state";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { useToast } from "@/hooks/use-toast";
import { toCsv, downloadCsv, timestampedCsvName } from "@/lib/csv";

export default function Beds() {
  const { t } = useTranslation();
  const { beds, properties, rooms, occupants, customers, isLoading, deleteBed } = useData();
  const { toast } = useToast();
  const { customerId: customerFilter, setCustomerId: updateCustomerFilter } =
    useCustomerScope();
  const [propertyFilter, setPropertyFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const scopedPropertyIds = useMemo(() => {
    if (customerFilter === ALL_CUSTOMERS) return null;
    return new Set(
      properties.filter((p) => p.customerId === customerFilter).map((p) => p.id),
    );
  }, [properties, customerFilter]);

  const customerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name);
    return map;
  }, [customers]);

  const propertyById = useMemo(() => {
    const map = new Map(properties.map((p) => [p.id, p] as const));
    return map;
  }, [properties]);

  const roomById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rooms) map.set(r.id, r.name);
    return map;
  }, [rooms]);

  // Hide the Customer column when a customer filter is active, since every
  // row already belongs to that customer.
  const showCustomerColumn = customerFilter === ALL_CUSTOMERS;
  // Columns: Property, [Customer], Room, Bed #, Occupant, Status, Actions
  const columnCount = showCustomerColumn ? 7 : 6;

  const propertiesForFilter = useMemo(() => {
    if (!scopedPropertyIds) return properties;
    return properties.filter((p) => scopedPropertyIds.has(p.id));
  }, [properties, scopedPropertyIds]);

  const scopedBeds = useMemo(() => {
    if (!scopedPropertyIds) return beds;
    return beds.filter((b) => scopedPropertyIds.has(b.propertyId));
  }, [beds, scopedPropertyIds]);

  // If the active customer scope changes (locally or because we arrived
  // here with the scope already set on another page), drop a stale
  // property selection back to "All" so the table isn't stuck empty for
  // a property the user can no longer see.
  useEffect(() => {
    if (propertyFilter === "All") return;
    if (customerFilter === ALL_CUSTOMERS) return;
    const stillVisible = properties.some(
      (p) => p.id === propertyFilter && p.customerId === customerFilter,
    );
    if (!stillVisible) setPropertyFilter("All");
  }, [customerFilter, propertyFilter, properties]);

  const filteredBeds = scopedBeds.filter((b) => {
    const matchesProperty = propertyFilter === "All" || b.propertyId === propertyFilter;
    const matchesStatus = statusFilter === "All" || b.status === statusFilter;
    return matchesProperty && matchesStatus;
  });

  const occupiedCount = scopedBeds.filter((b) => b.status === "Occupied").length;
  const occupancyRate = scopedBeds.length > 0 ? (occupiedCount / scopedBeds.length) * 100 : 0;

  const activeCustomerName =
    customerFilter === ALL_CUSTOMERS
      ? null
      : customers.find((c) => c.id === customerFilter)?.name ?? null;

  const handleDownloadCsv = () => {
    const csv = toCsv(filteredBeds, [
      { header: "Property",  value: (b) => properties.find((p) => p.id === b.propertyId)?.name ?? "" },
      { header: "Customer",  value: (b) => {
          const property = properties.find((p) => p.id === b.propertyId);
          return property ? customers.find((c) => c.id === property.customerId)?.name ?? "" : "";
        } },
      { header: "Bed Number", value: (b) => b.bedNumber },
      { header: "Room",       value: (b) => roomById.get(b.roomId) ?? "" },
      { header: "Occupant",   value: (b) => (b.occupantId ? occupants.find((o) => o.id === b.occupantId)?.name ?? "" : "") },
      { header: "Status",     value: (b) => b.status },
    ]);
    downloadCsv(timestampedCsvName("housingops-beds"), csv);
    toast({
      title: t("toasts.bedsExportedTitle"),
      description: t("toasts.bedsExportedDescription", { count: filteredBeds.length }),
    });
  };

  return (
    <MainLayout>
      <div className="p-8 max-w-[1600px] mx-auto space-y-8">
        <PageHeader
          title={t("pages.beds.title")}
          description={t("pages.beds.description")}
          meta={
            activeCustomerName ? (
              <p
                className="text-xs text-muted-foreground flex items-center gap-1"
                data-testid="text-beds-active-customer"
              >
                <Briefcase className="h-3 w-3" />
                {t("pages.beds.showingOnly")} <span className="font-semibold">{activeCustomerName}</span>
              </p>
            ) : null
          }
          actions={<>
            <Select value={customerFilter} onValueChange={updateCustomerFilter}>
              <SelectTrigger className="w-full sm:w-56" data-testid="select-beds-customer-filter">
                <SelectValue placeholder={t("pages.beds.customerPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CUSTOMERS}>{t("pages.beds.allCustomers")}</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={isLoading || filteredBeds.length === 0}
              data-testid="button-download-beds-csv"
            >
              <Download className="mr-2 h-4 w-4" />
              {t("pages.beds.downloadCsv")}
            </Button>
          </>}
        />

        {activeCustomerName && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 px-2 py-1" data-testid="badge-customer-filter">
              <Briefcase className="h-3 w-3" />
              {t("pages.beds.filteredByCustomer")} <span className="font-semibold">{activeCustomerName}</span>
              <button
                type="button"
                onClick={() => updateCustomerFilter(ALL_CUSTOMERS)}
                className="ml-1 rounded-sm p-0.5 hover:bg-background/40"
                aria-label={t("pages.beds.clearCustomerFilter")}
                data-testid="button-clear-customer-filter"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          </div>
        )}

        <Card>
          <CardContent className="p-6">
            {isLoading ? (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-48" />
                </div>
                <Skeleton className="h-3 w-full" />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{t("pages.beds.totalOccupancy")}</span>
                  <span className="text-muted-foreground">{t("pages.beds.occupancySummary", { occupied: occupiedCount, total: scopedBeds.length, rate: occupancyRate.toFixed(1) })}</span>
                </div>
                <Progress value={occupancyRate} className="h-3" />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center">
              <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                <SelectTrigger className="w-full sm:w-64" data-testid="select-beds-property-filter">
                  <SelectValue placeholder={t("pages.beds.propertyPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">{t("pages.beds.allProperties")}</SelectItem>
                  {propertiesForFilter.map(p => (
                    <SelectItem key={p.id} value={p.id}>{shortPropertyName(p.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder={t("pages.beds.statusPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">{t("pages.beds.allStatuses")}</SelectItem>
                  <SelectItem value="Occupied">{t("pages.beds.statusOccupied")}</SelectItem>
                  <SelectItem value="Vacant">{t("pages.beds.statusVacant")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.beds.table.property")}</TableHead>
                  {showCustomerColumn && <TableHead>{t("pages.beds.table.customer")}</TableHead>}
                  <TableHead>{t("pages.beds.table.room")}</TableHead>
                  <TableHead>{t("pages.beds.table.bedNumber")}</TableHead>
                  <TableHead>{t("pages.beds.table.occupant")}</TableHead>
                  <TableHead className="text-center">{t("pages.beds.table.status")}</TableHead>
                  <TableHead className="text-right w-16">
                    <span className="sr-only">{t("pages.beds.table.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <SkeletonRows rows={6} columns={columnCount} />
                ) : filteredBeds.length === 0 ? (
                  <EmptyStateRow
                    colSpan={columnCount}
                    icon={BedDouble}
                    title={t("pages.beds.empty.noBedsFound")}
                    description={
                      beds.length === 0
                        ? t("pages.beds.empty.noBedsDescription")
                        : t("pages.beds.empty.noMatchDescription")
                    }
                    action={
                      beds.length === 0 ? (
                        <Button asChild data-testid="button-empty-beds-cta">
                          <Link href={properties.length === 0 ? "/properties" : `/properties/${properties[0].id}`}>
                            {properties.length === 0 ? t("pages.beds.empty.addProperty") : t("pages.beds.empty.addBeds")}
                          </Link>
                        </Button>
                      ) : undefined
                    }
                    testId="empty-beds-table"
                  />
                ) : (
                  filteredBeds.map((bed) => {
                    const property = propertyById.get(bed.propertyId);
                    const customerName = property?.customerId
                      ? customerById.get(property.customerId)
                      : undefined;
                    const occupant = bed.occupantId ? occupants.find(o => o.id === bed.occupantId) : null;
                    
                    return (
                      <TableRow key={bed.id}>
                        <TableCell><PropertyNameCell name={property?.name} /></TableCell>
                        {showCustomerColumn && (
                          <TableCell className="text-muted-foreground" data-testid={`text-bed-customer-${bed.id}`}>
                            {property?.customerId && customerName ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateCustomerFilter(property.customerId);
                                }}
                                className="rounded-sm hover:underline hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                data-testid={`button-filter-customer-${bed.id}`}
                                aria-label={t("pages.beds.filterByCustomerAria", { customer: customerName })}
                              >
                                {customerName}
                              </button>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        )}
                        <TableCell className="text-muted-foreground" data-testid={`text-bed-room-${bed.id}`}>
                          {roomById.get(bed.roomId) ?? "—"}
                        </TableCell>
                        <TableCell>{t("pages.beds.bedNumberPrefix", { number: bed.bedNumber })}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {occupant ? occupant.name : "-"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={bed.status === "Occupied" ? "default" : "outline"} className={bed.status === "Vacant" ? "text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30" : ""}>
                            {bed.status === "Occupied" ? t("pages.beds.statusOccupied") : t("pages.beds.statusVacant")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <ConfirmDeleteButton
                            title={t("pages.beds.deleteBedTitle", { number: bed.bedNumber })}
                            description={t("pages.beds.deleteBedDescription", {
                              property: property?.name ?? "",
                            })}
                            confirmLabel={t("pages.beds.deleteBedConfirm")}
                            onConfirm={() => deleteBed(bed.id)}
                            testId={`dialog-confirm-delete-bed-${bed.id}`}
                            trigger={
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                disabled={bed.status === "Occupied"}
                                title={
                                  bed.status === "Occupied"
                                    ? t("pages.beds.deleteBedOccupiedTitle")
                                    : t("pages.beds.deleteBedAria", { number: bed.bedNumber })
                                }
                                aria-label={t("pages.beds.deleteBedAria", { number: bed.bedNumber })}
                                data-testid={`button-delete-bed-${bed.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            }
                          />
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
