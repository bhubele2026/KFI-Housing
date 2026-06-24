import { useMemo } from "react";
import { Download } from "lucide-react";
import type { Bed, Occupant, Room } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import { DataTable, DeductionBadge, type DataColumn } from "@/components/kit";
import { toCsv, downloadCsv, timestampedCsvName } from "@/lib/csv";

interface RosterRow {
  id: string;
  name: string;
  unit: string;
  email: string;
  phone: string;
  shift: string;
  startDate: string;
  driver: boolean;
  weekly: number | null;
  zenopleStatus?: string;
}

/**
 * Per-property contact roster — the directory block from the manager's tab:
 * Name · Unit · Email · Phone · Shift · Start date · Driver?, plus the weekly
 * deduction (so the money fact rides here too). Dense, sortable, CSV-exportable
 * in the sheet's column order. Reads occupant fields cast-safe.
 */
export function ContactRoster({
  occupants,
  beds,
  rooms,
  propertyName,
}: {
  occupants: Occupant[];
  beds: Bed[];
  rooms: Room[];
  propertyName: string;
}) {
  const rows = useMemo<RosterRow[]>(() => {
    const roomById = new Map(rooms.map((r) => [r.id, r]));
    const bedById = new Map(beds.map((b) => [b.id, b]));
    const unitFor = (o: Occupant): string => {
      const bed = o.bedId ? bedById.get(o.bedId) : undefined;
      const room = bed ? roomById.get((bed as { roomId?: string }).roomId ?? "") : undefined;
      return (
        (room as { name?: string } | undefined)?.name ??
        (bed as { name?: string } | undefined)?.name ??
        ""
      );
    };
    return occupants
      .filter((o) => o.status === "Active")
      .map((o) => {
        const ded = (o as { deduction?: { weeklyAmount?: number } }).deduction;
        const weekly = ded?.weeklyAmount ?? (o as { chargePerBed?: number }).chargePerBed ?? null;
        return {
          id: o.id,
          name: o.name,
          unit: unitFor(o),
          email: (o as { email?: string }).email ?? "",
          phone: (o as { phone?: string }).phone ?? "",
          shift: (o.shift ?? "") + (((o as { shiftTime?: string }).shiftTime ?? "") ? ` · ${(o as { shiftTime?: string }).shiftTime}` : ""),
          startDate: (o as { moveInDate?: string }).moveInDate ?? "",
          driver: Boolean((o as { kfisAuthorizedToDrive?: boolean }).kfisAuthorizedToDrive),
          weekly: typeof weekly === "number" ? weekly : null,
          zenopleStatus: (o as { zenopleStatus?: string }).zenopleStatus,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [occupants, beds, rooms]);

  const columns: DataColumn<RosterRow>[] = [
    { key: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
    { key: "unit", header: "Unit", cell: (r) => r.unit || "—", sortValue: (r) => r.unit },
    { key: "email", header: "Email", cell: (r) => r.email || "—", sortValue: (r) => r.email },
    { key: "phone", header: "Phone", cell: (r) => r.phone || "—", sortValue: (r) => r.phone, numeric: true },
    { key: "shift", header: "Shift", cell: (r) => r.shift || "—", sortValue: (r) => r.shift },
    { key: "startDate", header: "Start date", cell: (r) => r.startDate || "—", sortValue: (r) => r.startDate, numeric: true },
    { key: "driver", header: "Driver?", cell: (r) => (r.driver ? "Yes" : "—"), sortValue: (r) => (r.driver ? 1 : 0), align: "center" },
    {
      key: "weekly",
      header: "Weekly rent deducted",
      cell: (r) => <DeductionBadge weeklyAmount={r.weekly} zenopleStatus={r.zenopleStatus} size="sm" />,
      align: "right",
    },
  ];

  const exportCsv = () => {
    const csv = toCsv(rows, [
      { header: "Name", value: (r) => r.name },
      { header: "Unit", value: (r) => r.unit },
      { header: "Email", value: (r) => r.email },
      { header: "Phone", value: (r) => r.phone },
      { header: "Shift", value: (r) => r.shift },
      { header: "Start date", value: (r) => r.startDate },
      { header: "Driver?", value: (r) => (r.driver ? "Yes" : "No") },
      { header: "Weekly rent deducted", value: (r) => (r.weekly ?? "") },
    ]);
    downloadCsv(timestampedCsvName(`roster-${propertyName}`.replace(/\s+/g, "-").toLowerCase()), csv);
  };

  return (
    <>
      <div className="mb-2 flex justify-end">
        <Button variant="outline" size="sm" className="print-hide gap-1.5" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        initialSort={{ key: "name", dir: "asc" }}
        empty={{ title: "No associates housed here yet" }}
      />
    </>
  );
}
