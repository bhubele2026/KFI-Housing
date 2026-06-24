import { useMemo } from "react";
import type { Property } from "@/data/mockData";
import { useData } from "@/context/data-store";
import { shortPropertyName } from "@/lib/property-name";
import { PropertyBedTable } from "@/components/bed-grid";
import { ProjectedMoveInsSection } from "@/components/projected-move-ins-section";
import { StatusDot, MoneyTile, PrintView, type MoneyStat } from "@/components/kit";
import { BoardSection } from "./board-section";
import { ShiftCoverage } from "./shift-coverage";
import { ContactRoster } from "./contact-roster";
import { VehiclesPanel } from "./vehicles-panel";

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
  const { beds, occupants, customers, rooms } = useData();

  const propBeds = useMemo(() => beds.filter((b) => b.propertyId === property.id), [beds, property.id]);
  const propRooms = useMemo(() => rooms.filter((r) => r.propertyId === property.id), [rooms, property.id]);
  const propOccupants = useMemo(
    () => occupants.filter((o) => o.propertyId === property.id),
    [occupants, property.id],
  );

  const monthlyRent = Number((property as { monthlyRent?: number }).monthlyRent) || 0;

  const { capacity, occupied, available, collectedMonthly, atRiskMonthly, atRiskBeds } =
    useMemo(() => {
      const propBeds = beds.filter((b) => b.propertyId === property.id);
      const cap = propBeds.length;
      const occ = propBeds.filter((b) => b.status === "Occupied").length;
      const avail = propBeds.filter(
        (b) => b.status === "Vacant" && (b as { cleaningStatus?: string }).cleaningStatus === "ready",
      ).length;
      const rentPerBed = cap > 0 ? monthlyRent / cap : 0;

      // Stage 4: split the people placed here into collected-from-linked vs
      // at-risk (unlinked or $0 deduction). Reads the new deduction object
      // cast-safe, falling back to the manual charge, so it works before and
      // after Replit codegen. Never fabricated.
      let collectedWeekly = 0;
      let riskBeds = 0;
      for (const o of occupants) {
        if (o.propertyId !== property.id || o.status !== "Active" || !o.bedId) continue;
        const ded = (o as { deduction?: { weeklyAmount?: number } }).deduction;
        const weekly =
          Number(ded?.weeklyAmount ?? (o as { chargePerBed?: number }).chargePerBed) || 0;
        const zStatus = (o as { zenopleStatus?: string }).zenopleStatus;
        const recovered = weekly > 0 && (zStatus === "linked" || zStatus == null);
        if (recovered) collectedWeekly += weekly;
        else riskBeds += 1;
      }
      return {
        capacity: cap,
        occupied: occ,
        available: avail,
        collectedMonthly: collectedWeekly * WEEKS_PER_MONTH,
        atRiskMonthly: riskBeds * rentPerBed,
        atRiskBeds: riskBeds,
      };
    }, [beds, occupants, property.id, monthlyRent]);

  const client = customers.find((c) => c.id === property.customerId);
  const isActive = property.status === "Active";
  const address = (property as { address?: string }).address ?? "";

  const netSpread = collectedMonthly - monthlyRent; // utilities land in the Money view
  const moneyStats: MoneyStat[] = [
    { label: "Rent we pay", amount: monthlyRent, tone: "neutral" },
    { label: "Collected", amount: collectedMonthly, tone: "ok" },
    {
      label: "At-risk",
      amount: atRiskMonthly,
      tone: "risk",
      hint: atRiskBeds > 0 ? `${atRiskBeds} bed${atRiskBeds === 1 ? "" : "s"} unrecovered` : undefined,
    },
    { label: "Net spread", amount: netSpread, tone: "auto", emphasize: true },
  ];

  return (
    <PrintView
      title={shortPropertyName(property.name)}
      subtitle={address || undefined}
      meta={client ? <span className="font-medium text-brand">{client.name}</span> : undefined}
      testId="property-board"
    >
      <div className="space-y-4">
        {/* Status + the live counts the manager scans first. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusDot
            status={isActive ? "ok" : "neutral"}
            label={isActive ? "Active" : "Inactive"}
            size="md"
          />
          <div className="flex items-center gap-6 rounded-md border border-line bg-panel px-4 py-2">
            <Stat label="Capacity" value={capacity} />
            <Stat label="Occupied" value={occupied} />
            <Stat label="Available" value={available} />
          </div>
        </div>

        {/* Money truth */}
        <MoneyTile title="This property" stats={moneyStats} />
        <p className="-mt-2 px-1 text-[11px] text-muted-foreground">
          Collected = monthlized weekly rent deducted from payroll-linked associates.
          At-risk = the rent we pay for beds whose occupant isn&apos;t linked or has a
          $0 deduction. Utilities land in the Money view.
        </p>

        {/* The rest of the manager's tab, brought onto one page (Stage 5). */}
        <BoardSection title="Move-in / move-out ledger">
          <ProjectedMoveInsSection
            propertyId={property.id}
            propRooms={propRooms}
            propBeds={propBeds}
            propOccupants={propOccupants}
          />
        </BoardSection>

        <BoardSection title="Shifts">
          <ShiftCoverage occupants={propOccupants} />
        </BoardSection>

        <BoardSection title="Contact roster" count={propOccupants.filter((o) => o.status === "Active").length}>
          <ContactRoster
            occupants={propOccupants}
            beds={propBeds}
            rooms={propRooms}
            propertyName={shortPropertyName(property.name)}
          />
        </BoardSection>

        <BoardSection title="Vehicles & transport">
          <VehiclesPanel propertyId={property.id} occupants={propOccupants} />
        </BoardSection>

        {/* Bed grid — the heart of the tab. PropertyBedTable is self-contained
            (assign / move / clear, live counts, building-aware). */}
        <BoardSection title="Beds">
          <PropertyBedTable property={property} showHeaderLink={false} />
        </BoardSection>
      </div>
    </PrintView>
  );
}
