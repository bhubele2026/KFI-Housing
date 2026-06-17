import { useMemo, useState } from "react";
import { Link } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CalendarX,
  Layers,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import {
  computeHousingAudit,
  type AuditLeaseRef,
  type DuplicateGroup,
} from "@/components/housing-audit-panel";

/**
 * Review — the single place that ingests every data-audit issue across the
 * app (missing rent, missing dates, possible duplicate properties) so they
 * don't have to live as banners on every page. Each item links straight to
 * where it gets fixed.
 */

function LeaseIssueSection({
  title,
  hint,
  icon,
  accent,
  refs,
  hrefFor,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  accent: string;
  refs: AuditLeaseRef[];
  hrefFor: (r: AuditLeaseRef) => string;
}) {
  const [open, setOpen] = useState(true);
  if (refs.length === 0) return null;
  return (
    <Card className={"overflow-hidden border-l-4 " + accent}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30"
      >
        {icon}
        <span className="text-sm font-semibold">{title}</span>
        <Badge variant="secondary">{refs.length}</Badge>
        <span className="text-xs text-muted-foreground hidden sm:inline">{hint}</span>
        {open ? (
          <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="max-h-96 overflow-y-auto border-t divide-y">
          {refs.map((r) => (
            <Link
              key={r.leaseId}
              href={hrefFor(r)}
              className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-muted/30"
            >
              <span className="truncate">
                <span className="font-medium">{r.propertyName}</span>
                {r.unit ? <span className="text-muted-foreground"> · {r.unit}</span> : null}
                {r.note ? <span className="text-muted-foreground"> — {r.note}</span> : null}
              </span>
              <span className="flex items-center gap-1 text-xs font-medium text-primary shrink-0">
                Fix <ChevronRight className="h-3 w-3" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Review() {
  const { properties, leases, isLoading } = useData();
  const audit = useMemo(
    () => computeHousingAudit(properties, leases),
    [properties, leases],
  );
  const total =
    audit.missingRent.length +
    audit.missingDates.length +
    audit.rentAnomalies.length +
    audit.duplicates.length;

  return (
    <MainLayout>
      <div className="p-8 max-w-[1600px] mx-auto space-y-6">
        <PageHeader
          title="Review"
          description="Everything that needs cleaning up so every property forecasts correctly — fix each item right from here."
          actions={
            <Badge variant={total > 0 ? "destructive" : "secondary"} className="text-sm">
              {total} open
            </Badge>
          }
        />

        {isLoading ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">Loading…</CardContent>
          </Card>
        ) : audit.clear ? (
          <Card className="border-l-4 border-l-green-500">
            <CardContent className="flex items-center gap-3 p-5">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <p className="text-sm">
                <span className="font-semibold">All clear</span> — every property and lease
                has a rent, dates, and a unique address.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <LeaseIssueSection
              title="Missing rent"
              hint="Imported from a scanned lease — enter the rent on the lease."
              icon={<span className="text-lg leading-none">🔴</span>}
              accent="border-l-red-500"
              refs={audit.missingRent}
              hrefFor={(r) => `/leases/${r.leaseId}?from=${encodeURIComponent("/review")}`}
            />
            <LeaseIssueSection
              title="Missing dates"
              hint="No start/end date — renewal & expiry alerts can mis-time."
              icon={<CalendarX className="h-5 w-5 text-amber-600" />}
              accent="border-l-amber-500"
              refs={audit.missingDates}
              hrefFor={(r) =>
                `/leases/${r.leaseId}?focus=dates&from=${encodeURIComponent("/review")}`
              }
            />
            <LeaseIssueSection
              title="Rent looks wrong"
              hint="Far higher than the other units in the same property — likely a typo."
              icon={<span className="text-lg leading-none">⚠️</span>}
              accent="border-l-red-500"
              refs={audit.rentAnomalies}
              hrefFor={(r) => `/leases/${r.leaseId}?from=${encodeURIComponent("/review")}`}
            />

            {audit.duplicates.length > 0 && (
              <Card className="overflow-hidden border-l-4 border-l-orange-500">
                <div className="flex items-center gap-3 px-4 py-3">
                  <Layers className="h-5 w-5 text-orange-600" />
                  <span className="text-sm font-semibold">Possible duplicates</span>
                  <Badge variant="secondary">{audit.duplicates.length}</Badge>
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    Two properties share a street address — merge or deactivate one.
                  </span>
                </div>
                <div className="max-h-96 overflow-y-auto border-t divide-y">
                  {audit.duplicates.map((d: DuplicateGroup, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                      {d.properties.map((p, j) => (
                        <span key={p.id} className="flex items-center gap-2">
                          {j > 0 && <span className="text-muted-foreground">↔</span>}
                          <Link
                            href={`/properties/${p.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {p.name}
                          </Link>
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
