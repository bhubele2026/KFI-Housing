import { useMemo } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CalendarX,
  Layers,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import type { Property, Lease } from "@/data/mockData";

/**
 * Audits the imported housing portfolio for the data-quality failure
 * modes that the June 2026 Outlook + SharePoint import can leave behind,
 * and surfaces them at the top of the Properties page so an operator can
 * fix them directly (mirrors the Budget app's Bills audit panel):
 *
 *  🔴 Missing rent     — a lease flagged needsReview, or with no rent
 *                        (monthly lease at $0, or a hotel/motel room-night
 *                        lease with $0 nightly rate). These came from
 *                        scanned/unreadable lease PDFs and need a number.
 *  📅 Missing dates    — a lease with no start or end date, so renewal /
 *                        expiry alerts and forecasts can mis-time.
 *  🟠 Possible duplicate— two properties at the same street address (e.g.
 *                        a unit pulled out under its own address, or the
 *                        same complex imported twice).
 *
 *  ✅ all clear        — every property and lease is complete and unique.
 */

export interface AuditLeaseRef {
  leaseId: string;
  propertyId: string;
  propertyName: string;
  unit: string;
  /** Optional inline detail (e.g. the suspicious rent amount). */
  note?: string;
}

export interface DuplicateGroup {
  address: string;
  properties: { id: string; name: string }[];
}

export interface HousingAudit {
  missingRent: AuditLeaseRef[];
  missingDates: AuditLeaseRef[];
  rentAnomalies: AuditLeaseRef[];
  duplicates: DuplicateGroup[];
  clear: boolean;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function normalizeAddress(addr: string | undefined | null): string {
  return (addr ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isBlank(s: string | undefined | null): boolean {
  return !s || s.trim() === "";
}

export function computeHousingAudit(
  properties: readonly Property[],
  leases: readonly Lease[],
): HousingAudit {
  const nameById = new Map<string, string>();
  for (const p of properties) nameById.set(p.id, p.name || p.id);

  const ref = (l: Lease): AuditLeaseRef => ({
    leaseId: l.id,
    propertyId: l.propertyId,
    propertyName: nameById.get(l.propertyId) ?? l.propertyId,
    unit: l.unit ?? "",
  });

  const missingRent: AuditLeaseRef[] = [];
  const missingDates: AuditLeaseRef[] = [];
  for (const l of leases) {
    const isRoomNight = (l.rateType ?? "monthly") === "room-night";
    const noRent = isRoomNight
      ? !l.nightlyRate || l.nightlyRate === 0
      : !l.monthlyRent || l.monthlyRent === 0;
    if (l.needsReview || noRent) missingRent.push(ref(l));
    if (isBlank(l.startDate) || isBlank(l.endDate)) missingDates.push(ref(l));
  }

  // Rent anomalies: a per-unit monthly rent that's wildly out of line with
  // the OTHER units in the same property (e.g. one unit at $10,000/mo when
  // its siblings are all $995 — a clear data-entry slip, like a deposit or
  // annual figure pasted into the monthly field). We compare within a
  // property so legitimately-pricier whole-property leases (Siren at $7k for
  // a 13-bed house) aren't false-flagged — those have no siblings to skew.
  const rentAnomalies: AuditLeaseRef[] = [];
  const monthlyByProp = new Map<string, Lease[]>();
  for (const l of leases) {
    if ((l.rateType ?? "monthly") !== "monthly") continue;
    if (!l.monthlyRent || l.monthlyRent <= 0) continue;
    const arr = monthlyByProp.get(l.propertyId) ?? [];
    arr.push(l);
    monthlyByProp.set(l.propertyId, arr);
  }
  for (const [, group] of monthlyByProp) {
    if (group.length < 2) continue; // need siblings to compare against
    for (const l of group) {
      const others = group.filter((x) => x.id !== l.id).map((x) => x.monthlyRent!);
      const med = median(others);
      if (med > 0 && l.monthlyRent! >= 2000 && l.monthlyRent! >= med * 3) {
        rentAnomalies.push({
          ...ref(l),
          note: `${usd(l.monthlyRent!)}/mo vs ${usd(med)} typical here`,
        });
      }
    }
  }

  // Possible duplicates: 2+ properties sharing the same non-blank street
  // address (normalized).
  const byAddress = new Map<string, { id: string; name: string }[]>();
  for (const p of properties) {
    const key = normalizeAddress(p.address);
    if (!key) continue;
    const list = byAddress.get(key) ?? [];
    list.push({ id: p.id, name: p.name || p.id });
    byAddress.set(key, list);
  }
  const duplicates: DuplicateGroup[] = [];
  for (const [, group] of byAddress) {
    if (group.length > 1) {
      duplicates.push({ address: group[0]!.name, properties: group });
    }
  }

  return {
    missingRent,
    missingDates,
    rentAnomalies,
    duplicates,
    clear:
      missingRent.length === 0 &&
      missingDates.length === 0 &&
      rentAnomalies.length === 0 &&
      duplicates.length === 0,
  };
}

function previewNames(refs: AuditLeaseRef[], max = 4): string {
  const labels = refs
    .slice(0, max)
    .map((r) => `${r.propertyName}${r.unit ? ` · ${r.unit}` : ""}`);
  const extra = refs.length - labels.length;
  return labels.join(", ") + (extra > 0 ? `, +${extra} more` : "");
}

export function HousingAuditPanel({
  properties,
  leases,
}: {
  properties: readonly Property[];
  leases: readonly Lease[];
}) {
  const audit = useMemo(
    () => computeHousingAudit(properties, leases),
    [properties, leases],
  );

  if (audit.clear) {
    return (
      <Card className="mb-4 border-l-4 border-l-green-500" data-testid="housing-audit">
        <CardContent className="flex items-center gap-3 p-4">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
          <p className="text-sm">
            <span className="font-semibold">All clear</span> · every property and
            lease has a rent, dates, and a unique address.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-4 border-l-4 border-l-amber-500" data-testid="housing-audit">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <h3 className="text-sm font-semibold">Housing import audit</h3>
          <span className="text-xs text-muted-foreground">
            things to finish so every property forecasts correctly
          </span>
        </div>

        {audit.missingRent.length > 0 && (
          <div className="flex items-start gap-3 rounded-md bg-red-50 p-3 dark:bg-red-950/30">
            <span className="text-lg leading-none">🔴</span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Missing rent</span>
                <Badge variant="secondary">{audit.missingRent.length}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Imported from a scanned lease — enter the rent on the lease.{" "}
                {previewNames(audit.missingRent)}
              </p>
            </div>
            <Link
              href="/leases?review=1"
              className="flex items-center gap-1 self-center text-xs font-medium text-primary hover:underline"
            >
              Fix <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        )}

        {audit.missingDates.length > 0 && (
          <div className="flex items-start gap-3 rounded-md bg-amber-50 p-3 dark:bg-amber-950/30">
            <CalendarX className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Missing dates</span>
                <Badge variant="secondary">{audit.missingDates.length}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                No start/end date — renewal & expiry alerts can mis-time.{" "}
                {previewNames(audit.missingDates)}
              </p>
            </div>
            <Link
              href="/leases"
              className="flex items-center gap-1 self-center text-xs font-medium text-primary hover:underline"
            >
              Fix <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        )}

        {audit.duplicates.length > 0 && (
          <div className="flex items-start gap-3 rounded-md bg-orange-50 p-3 dark:bg-orange-950/30">
            <Layers className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Possible duplicate</span>
                <Badge variant="secondary">{audit.duplicates.length}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Two properties share a street address — merge or delete one:{" "}
                {audit.duplicates
                  .slice(0, 3)
                  .map((d) => d.properties.map((p) => p.name).join(" ↔ "))
                  .join("; ")}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
