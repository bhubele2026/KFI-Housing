import { useMemo } from "react";
import type { Property } from "@/data/mockData";
import { useData } from "@/context/data-store";
import { shortPropertyName } from "@/lib/property-name";
import { PropertyBedTable } from "@/components/bed-grid";
import { StatusDot, MoneyTile, buildPropertyMoneyStats } from "@/components/kit";

const WEEKS_PER_MONTH = 52 / 12;

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-2xl font-bold tabular-nums text-ink">{value}</span>
    </div>
  );
}

/**
 * The Property Board (Stage 1) — one property's whole world on a single calm
 * page that visually rhymes with the manager's old spreadsheet tab: a header
 * band, the live Capacity/Occupied/Available counts, the money truth, then the
 * bed grid itself. Counts are computed exactly like property-detail's stat
 * cards so the numbers agree everywhere.
 */
export function PropertyBoard({ property }: { property: Property }) {
  const { beds, occupants, customers } = useData();

  const { capacity, occupied, available, collectedMonthly } = useMemo(() => {
    const propBeds = beds.filter((b) => b.propertyId === property.id);
    const occ = propBeds.filter((b) => b.status === "Occupied").length;
    const avail = propBeds.filter(
      (b) => b.status === "Vacant" && (b as { cleaningStatus?: string }).cleaningStatus === "ready",
    ).length;
    // Collected = weekly rent deducted from the people actually placed here,
    // monthlized. Real where the charge is in hand; Stage 4 replaces this with
    // payroll-verified collection vs at-risk. Never fabricated.
    const weekly = occupants
      .filter((o) => o.propertyId === property.id && o.status === "Active" && o.bedId)
      .reduce((sum, o) => sum + (Number((o as { chargePerBed?: number }).chargePerBed) || 0), 0);
    return {
      capacity: propBeds.length,
      occupied: occ,
      available: avail,
      collectedMonthly: weekly * WEEKS_PER_MONTH,
    };
  }, [beds, occupants, property.id]);

  const client = customers.find((c) => c.id === property.customerId);
  const isActive = property.status === "Active";
  const address = (property as { address?: string }).address ?? "";
  const monthlyRent = Number((property as { monthlyRent?: number }).monthlyRent) || 0;

  const moneyStats = buildPropertyMoneyStats({
    rentWePay: monthlyRent,
    collected: collectedMonthly,
    utilities: 0,
  });

  return (
    <div className="space-y-4">
      {/* Header band — reads like the top of the manager's tab. */}
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-bold text-ink">
                {shortPropertyName(property.name)}
              </h2>
              <StatusDot
                status={isActive ? "ok" : "neutral"}
                label={isActive ? "Active" : "Inactive"}
                size="md"
              />
            </div>
            {address && <p className="text-sm text-muted-foreground">{address}</p>}
            {client && (
              <p className="text-sm font-medium text-brand">{client.name}</p>
            )}
          </div>
          {/* Summary strip */}
          <div className="flex items-center gap-6 rounded-md border border-line bg-panel px-4 py-2">
            <Stat label="Capacity" value={capacity} />
            <Stat label="Occupied" value={occupied} />
            <Stat label="Available" value={available} />
          </div>
        </div>
      </div>

      {/* Money truth */}
      <MoneyTile title="This property" stats={moneyStats} />
      <p className="-mt-2 px-1 text-[11px] text-muted-foreground">
        Collected is monthlized from weekly charges on placed associates;
        utilities and payroll-verified collection land in the Money view.
      </p>

      {/* Bed grid — the heart of the tab. PropertyBedTable is self-contained
          (assign / move / clear, live counts, building-aware). */}
      <div className="rounded-lg border border-line bg-panel p-2">
        <PropertyBedTable property={property} showHeaderLink={false} />
      </div>
    </div>
  );
}
