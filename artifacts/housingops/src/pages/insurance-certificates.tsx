import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck, Briefcase, X, Download, AlertTriangle, Home, FileText, Upload, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toCsv, downloadCsv, timestampedCsvName } from "@/lib/csv";
import { daysUntil } from "@/data/mockData";
import { isBlankYMD } from "@/lib/lease-dates";
import { AddCertificateDialog } from "@/components/add-certificate-dialog";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { EmptyStateRow } from "@/components/empty-state";
import { InlineEdit } from "@/pages/property-detail";
import { Trash2 } from "lucide-react";
import { useUpload } from "@workspace/object-storage-web";

type StatusFilter = "All" | "Active" | "Expiring" | "Expired" | "NoDates";
type SortKey = "carrier" | "coverageEnd" | "property";
type SortDir = "asc" | "desc";

const ALL_PROPERTIES = "__all__";

export default function InsuranceCertificates() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [propertyFilter, setPropertyFilter] = useState(ALL_PROPERTIES);
  const [sortKey, setSortKey] = useState<SortKey>("coverageEnd");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const { customerId: customerFilter, setCustomerId: updateCustomerFilter } =
    useCustomerScope();
  const {
    insuranceCertificates,
    properties,
    customers,
    addInsuranceCertificate,
    updateInsuranceCertificate,
    deleteInsuranceCertificate,
  } = useData();

  const customerById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name);
    return map;
  }, [customers]);

  const propertyById = useMemo(() => {
    const map = new Map(properties.map((p) => [p.id, p] as const));
    return map;
  }, [properties]);

  const propertiesWithCerts = useMemo(() => {
    const ids = new Set(insuranceCertificates.map((c) => c.propertyId));
    return properties
      .filter((p) => ids.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [properties, insuranceCertificates]);

  const enriched = useMemo(() => {
    return insuranceCertificates.map((cert) => {
      const property = propertyById.get(cert.propertyId);
      const days = cert.coverageEnd && !isBlankYMD(cert.coverageEnd)
        ? daysUntil(cert.coverageEnd)
        : null;
      const expired = days !== null && days < 0;
      const expiringSoon = days !== null && days >= 0 && days <= 30;
      const noDates = !cert.coverageStart && !cert.coverageEnd;
      return { cert, property, days, expired, expiringSoon, noDates };
    });
  }, [insuranceCertificates, propertyById]);

  const filtered = useMemo(() => {
    return enriched.filter((row) => {
      if (customerFilter !== ALL_CUSTOMERS) {
        const propCustomerId = row.property?.customerId ?? "";
        if (propCustomerId !== customerFilter) return false;
      }

      if (propertyFilter !== ALL_PROPERTIES) {
        if (row.cert.propertyId !== propertyFilter) return false;
      }

      if (statusFilter === "Active") {
        return !row.expired && !row.expiringSoon && !row.noDates;
      }
      if (statusFilter === "Expiring") return row.expiringSoon;
      if (statusFilter === "Expired") return row.expired;
      if (statusFilter === "NoDates") return row.noDates;
      return true;
    });
  }, [enriched, customerFilter, propertyFilter, statusFilter]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "carrier") {
        cmp = (a.cert.carrier || "").localeCompare(b.cert.carrier || "");
      } else if (sortKey === "coverageEnd") {
        const ae = a.cert.coverageEnd || "";
        const be = b.cert.coverageEnd || "";
        if (!ae && !be) cmp = 0;
        else if (!ae) cmp = 1;
        else if (!be) cmp = -1;
        else cmp = ae.localeCompare(be);
      } else if (sortKey === "property") {
        cmp = (a.property?.name || "").localeCompare(b.property?.name || "");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  const activeCustomerName =
    customerFilter === ALL_CUSTOMERS
      ? null
      : customerById.get(customerFilter) ?? null;

  const activePropertyName =
    propertyFilter === ALL_PROPERTIES
      ? null
      : propertyById.get(propertyFilter)?.name ?? null;

  const expiringCount = enriched.filter((r) => r.expiringSoon).length;
  const expiredCount = enriched.filter((r) => r.expired).length;

  const handleDownloadCsv = () => {
    const csv = toCsv(sorted.map((r) => r.cert), [
      { header: "Property", value: (c) => propertyById.get(c.propertyId)?.name ?? "Unknown" },
      { header: "Customer", value: (c) => {
          const prop = propertyById.get(c.propertyId);
          return prop ? customerById.get(prop.customerId) ?? "" : "";
        }},
      { header: "Carrier", value: (c) => c.carrier },
      { header: "Policy #", value: (c) => c.policyNumber },
      { header: "Insured", value: (c) => c.insuredName },
      { header: "Coverage Start", value: (c) => c.coverageStart },
      { header: "Coverage End", value: (c) => c.coverageEnd },
      { header: "Document URL", value: (c) => c.documentUrl },
      { header: "Notes", value: (c) => c.notes },
    ]);
    downloadCsv(timestampedCsvName("housingops-certificates"), csv);
    toast({
      title: t("toasts.certificatesExportedTitle"),
      description: t("toasts.certificatesExportedDescription", { count: sorted.length }),
    });
  };

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <PageHeader
          title={t("pages.insurance.title")}
          description={t("pages.insurance.description")}
          actions={
            <>
              <Button
                variant="outline"
                onClick={handleDownloadCsv}
                disabled={sorted.length === 0}
                data-testid="button-download-certificates-csv"
              >
                <Download className="mr-2 h-4 w-4" />
                {t("pages.insurance.downloadCsv")}
              </Button>
              <AddCertificateDialog
                properties={properties}
                customers={customers}
                onAdd={(cert) => {
                  addInsuranceCertificate(cert);
                  const property = propertyById.get(cert.propertyId);
                  toast({
                    title: t("toasts.certificateAddedTitle"),
                    description: property
                      ? t("toasts.certificateAddedDescriptionWithProperty", { property: property.name })
                      : t("toasts.certificateAddedDescription"),
                  });
                }}
              />
            </>
          }
        />

        {(activeCustomerName || activePropertyName) && (
          <div className="flex flex-wrap items-center gap-2">
            {activeCustomerName && (
              <Badge variant="secondary" className="gap-1.5 px-2 py-1" data-testid="badge-customer-filter">
                <Briefcase className="h-3 w-3" />
                {t("pages.insurance.filteredByCustomer")} <span className="font-semibold">{activeCustomerName}</span>
                <button
                  type="button"
                  onClick={() => updateCustomerFilter(ALL_CUSTOMERS)}
                  className="ml-1 rounded-sm p-0.5 hover:bg-background/40"
                  aria-label={t("pages.insurance.clearCustomerFilter")}
                  data-testid="button-clear-customer-filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {activePropertyName && (
              <Badge variant="secondary" className="gap-1.5 px-2 py-1" data-testid="badge-property-filter">
                <Home className="h-3 w-3" />
                {t("pages.insurance.filteredByProperty")} <span className="font-semibold">{activePropertyName}</span>
                <button
                  type="button"
                  onClick={() => setPropertyFilter(ALL_PROPERTIES)}
                  className="ml-1 rounded-sm p-0.5 hover:bg-background/40"
                  aria-label={t("pages.insurance.clearPropertyFilter")}
                  data-testid="button-clear-property-filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </div>
        )}

        {(expiringCount > 0 || expiredCount > 0) && (
          <Card
            className="border-amber-200 bg-amber-50/40"
            data-testid="card-expiry-alerts"
          >
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-md bg-amber-100">
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                </div>
                <h2 className="text-base font-semibold">{t("pages.insurance.coverageAlerts")}</h2>
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                {expiredCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter("Expired")}
                    className="text-red-700 hover:underline font-medium"
                    data-testid="link-expired-count"
                  >
                    {t("pages.insurance.expiredCount", { count: expiredCount })}
                  </button>
                )}
                {expiringCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter("Expiring")}
                    className="text-amber-700 hover:underline font-medium"
                    data-testid="link-expiring-count"
                  >
                    {t("pages.insurance.expiringWithin30", { count: expiringCount })}
                  </button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          >
            <SelectTrigger className="w-44" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">{t("pages.insurance.allStatusesCount", { count: enriched.length })}</SelectItem>
              <SelectItem value="Active">{t("pages.insurance.statusActive")}</SelectItem>
              <SelectItem value="Expiring">{t("pages.insurance.statusExpiring")}</SelectItem>
              <SelectItem value="Expired">{t("pages.insurance.statusExpired")}</SelectItem>
              <SelectItem value="NoDates">{t("pages.insurance.statusNoDates")}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={propertyFilter}
            onValueChange={(v) => setPropertyFilter(v)}
          >
            <SelectTrigger className="w-52" data-testid="select-property-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PROPERTIES}>{t("pages.insurance.allProperties")}</SelectItem>
              {propertiesWithCerts.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {t("pages.insurance.certificatesCount", { count: sorted.length })}
          </span>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="cursor-pointer select-none hover:text-foreground"
                    onClick={() => toggleSort("property")}
                    data-testid="th-property"
                  >
                    {t("pages.insurance.table.property")}{sortIndicator("property")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none hover:text-foreground"
                    onClick={() => toggleSort("carrier")}
                    data-testid="th-carrier"
                  >
                    {t("pages.insurance.table.carrier")}{sortIndicator("carrier")}
                  </TableHead>
                  <TableHead>{t("pages.insurance.table.policy")}</TableHead>
                  <TableHead>{t("pages.insurance.table.insured")}</TableHead>
                  <TableHead
                    className="cursor-pointer select-none hover:text-foreground"
                    onClick={() => toggleSort("coverageEnd")}
                    data-testid="th-coverage-end"
                  >
                    {t("pages.insurance.table.coverage")}{sortIndicator("coverageEnd")}
                  </TableHead>
                  <TableHead>{t("pages.insurance.table.status")}</TableHead>
                  <TableHead>{t("pages.insurance.table.document")}</TableHead>
                  <TableHead>{t("pages.insurance.table.notes")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.length === 0 ? (
                  <EmptyStateRow
                    colSpan={9}
                    icon={ShieldCheck}
                    title={t("pages.insurance.empty.noCertificatesTitle")}
                    description={t("pages.insurance.empty.noCertificatesDescription")}
                    testId="empty-certificates"
                    action={
                      <AddCertificateDialog
                        properties={properties}
                        customers={customers}
                        onAdd={(cert) => {
                          addInsuranceCertificate(cert);
                          toast({
                            title: t("toasts.certificateAddedTitle"),
                            description: t("toasts.certificateAddedDescription"),
                          });
                        }}
                        trigger={
                          <Button size="sm" data-testid="button-add-certificate-empty">
                            <ShieldCheck className="h-4 w-4 mr-1.5" />{t("pages.insurance.addCertificate")}
                          </Button>
                        }
                      />
                    }
                  />
                ) : (
                  sorted.map(({ cert: c, property, days, expired, expiringSoon }) => (
                    <TableRow
                      key={c.id}
                      data-testid={`row-certificate-${c.id}`}
                      className={
                        expired
                          ? "border-l-4 border-l-red-500"
                          : expiringSoon
                            ? "border-l-4 border-l-amber-500"
                            : ""
                      }
                    >
                      <TableCell>
                        {property ? (
                          <button
                            type="button"
                            className="text-primary hover:underline text-sm font-medium text-left"
                            onClick={() => navigate(`/properties/${property.id}`)}
                            data-testid={`link-property-${c.id}`}
                          >
                            {property.name}
                          </button>
                        ) : (
                          <span className="text-muted-foreground text-sm">{t("pages.insurance.unknownProperty")}</span>
                        )}
                        {property && customerById.get(property.customerId) && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {customerById.get(property.customerId)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <InlineEdit
                          value={c.carrier}
                          onSave={(v) => updateInsuranceCertificate(c.id, { carrier: v })}
                          placeholder={t("pages.insurance.addCarrier")}
                          testId={`edit-carrier-${c.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <InlineEdit
                          value={c.policyNumber}
                          onSave={(v) => updateInsuranceCertificate(c.id, { policyNumber: v })}
                          placeholder={t("pages.insurance.addPolicy")}
                          displayClassName="font-mono"
                          testId={`edit-policy-${c.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <InlineEdit
                          value={c.insuredName}
                          onSave={(v) => updateInsuranceCertificate(c.id, { insuredName: v })}
                          placeholder={t("pages.insurance.addInsured")}
                          testId={`edit-insured-${c.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <InlineEdit
                            value={c.coverageStart}
                            type="date"
                            onSave={(v) => updateInsuranceCertificate(c.id, { coverageStart: v })}
                            placeholder={t("pages.insurance.coverageStartPlaceholder")}
                            testId={`edit-start-${c.id}`}
                          />
                          <span className="text-muted-foreground">→</span>
                          <InlineEdit
                            value={c.coverageEnd}
                            type="date"
                            onSave={(v) => updateInsuranceCertificate(c.id, { coverageEnd: v })}
                            placeholder={t("pages.insurance.coverageEndPlaceholder")}
                            testId={`edit-end-${c.id}`}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        {expired ? (
                          <Badge
                            variant="outline"
                            className="bg-red-100 text-red-800 border-red-200"
                            data-testid={`badge-certificate-${c.id}-expired`}
                          >
                            {t("pages.insurance.expiredAgo", { days: Math.abs(days!) })}
                          </Badge>
                        ) : expiringSoon ? (
                          <Badge
                            variant="outline"
                            className="bg-amber-100 text-amber-800 border-amber-200"
                            data-testid={`badge-certificate-${c.id}-expiring`}
                          >
                            {t("pages.insurance.expiringDays", { days })}
                          </Badge>
                        ) : days !== null ? (
                          <Badge
                            variant="outline"
                            className="bg-emerald-50 text-emerald-700 border-emerald-200"
                            data-testid={`badge-certificate-${c.id}-active`}
                          >
                            {t("pages.insurance.activeDaysLeft", { days })}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[14rem]">
                        {c.documentUrl ? (
                          <div className="flex items-center gap-2">
                            <a
                              href={certPdfHref(c.documentUrl)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline text-sm inline-flex items-center gap-1"
                              data-testid={`link-certificate-${c.id}-doc`}
                            >
                              <FileText className="h-3.5 w-3.5" />{t("pages.insurance.viewPdf")}
                            </a>
                            <CertUploadButton certId={c.id} onUploaded={(url) => updateInsuranceCertificate(c.id, { documentUrl: url })} label={t("pages.insurance.replaceLabel")} />
                          </div>
                        ) : (
                          <CertUploadButton certId={c.id} onUploaded={(url) => updateInsuranceCertificate(c.id, { documentUrl: url })} label={t("pages.insurance.uploadLabel")} />
                        )}
                      </TableCell>
                      <TableCell>
                        <InlineEdit
                          value={c.notes || ""}
                          onSave={(v) => updateInsuranceCertificate(c.id, { notes: v })}
                          placeholder={t("pages.insurance.addNotes")}
                          testId={`edit-notes-${c.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <ConfirmDeleteButton
                          title={t("pages.insurance.deleteTitle")}
                          description={
                            <>
                              {t("pages.insurance.deleteDescriptionPrefix")}
                              <span className="font-medium text-foreground">
                                {c.carrier || t("pages.insurance.deleteDescriptionFallback")}
                              </span>
                              {t("pages.insurance.deleteDescriptionSuffix")}
                            </>
                          }
                          onConfirm={() => deleteInsuranceCertificate(c.id)}
                          testId={`dialog-confirm-delete-certificate-${c.id}`}
                          trigger={
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              data-testid={`button-delete-certificate-${c.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}

function certPdfHref(documentUrl: string): string {
  if (documentUrl.startsWith("/api/")) return documentUrl;
  if (documentUrl.startsWith("http://") || documentUrl.startsWith("https://")) return documentUrl;
  return `/api/attached-assets/${encodeURIComponent(documentUrl)}`;
}

function CertUploadButton({ certId, onUploaded, label }: { certId: string; onUploaded: (url: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading } = useUpload({
    basePath: "/api/storage",
    onSuccess: (response) => {
      onUploaded(`/api/storage${response.objectPath}`);
    },
  });
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) await uploadFile(file);
          if (ref.current) ref.current.value = "";
        }}
        data-testid={`input-certificate-${certId}-upload`}
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={isUploading}
        onClick={() => ref.current?.click()}
        data-testid={`button-certificate-${certId}-upload`}
      >
        {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Upload className="h-3 w-3 mr-1" />{label}</>}
      </Button>
    </>
  );
}
