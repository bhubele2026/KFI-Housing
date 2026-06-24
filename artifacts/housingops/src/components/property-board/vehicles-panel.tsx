import { useMemo } from "react";
import { useListVehicles, useListVehicleRiders } from "@workspace/api-client-react";
import type { Occupant } from "@/data/mockData";
import { DataTable, StatusDot, EmptyState, type DataColumn } from "@/components/kit";

interface VanRow {
  id: string;
  driver: string;
  plate: string;
  make: string;
  model: string;
  year: string;
  color: string;
  inShop: boolean;
  riders: string[];
}

/**
 * Vehicles & transport panel for one property — the van block from the
 * manager's tab: Driver · Plate · Make · Model · Year · Color · In-shop, plus
 * each van's rider list. Reuses the existing vehicles/riders hooks; the
 * transport backend is intact even though /transport is hidden from the nav.
 */
export function VehiclesPanel({
  propertyId,
  occupants,
}: {
  propertyId: string;
  occupants: Occupant[];
}) {
  const { data: vehicles, isLoading } = useListVehicles();
  const { data: riders } = useListVehicleRiders();

  const nameById = useMemo(() => new Map(occupants.map((o) => [o.id, o.name])), [occupants]);

  const rows = useMemo<VanRow[]>(() => {
    const ridersByVan = new Map<string, string[]>();
    for (const r of riders ?? []) {
      const list = ridersByVan.get(r.vehicleId) ?? [];
      list.push(nameById.get(r.occupantId) ?? r.occupantId);
      ridersByVan.set(r.vehicleId, list);
    }
    return (vehicles ?? [])
      .filter((v) => (v as { propertyId?: string | null }).propertyId === propertyId)
      .map((v) => {
        const driverId = (v as { driverOccupantId?: string | null }).driverOccupantId;
        return {
          id: v.id,
          driver: driverId ? (nameById.get(driverId) ?? "—") : "—",
          plate: (v as { plate?: string }).plate ?? "",
          make: (v as { make?: string }).make ?? "",
          model: (v as { model?: string }).model ?? "",
          year: String((v as { year?: number | null }).year ?? ""),
          color: (v as { color?: string }).color ?? "",
          inShop: Boolean((v as { inShop?: boolean }).inShop),
          riders: ridersByVan.get(v.id) ?? [],
        };
      });
  }, [vehicles, riders, nameById, propertyId]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading vehicles…</p>;
  }
  if (rows.length === 0) {
    return <EmptyState title="No vans based at this property" description="Assign a vehicle's location to this property to see it here." />;
  }

  const columns: DataColumn<VanRow>[] = [
    {
      key: "driver",
      header: "Driver",
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <StatusDot status={r.inShop ? "warn" : "ok"} size="sm" />
          {r.driver}
        </span>
      ),
      sortValue: (r) => r.driver,
    },
    { key: "plate", header: "Plate", cell: (r) => r.plate || "—", sortValue: (r) => r.plate },
    { key: "make", header: "Make", cell: (r) => r.make || "—", sortValue: (r) => r.make },
    { key: "model", header: "Model", cell: (r) => r.model || "—", sortValue: (r) => r.model },
    { key: "year", header: "Year", cell: (r) => r.year || "—", sortValue: (r) => r.year, numeric: true, align: "right" },
    { key: "color", header: "Color", cell: (r) => r.color || "—", sortValue: (r) => r.color },
    { key: "inShop", header: "In shop", cell: (r) => (r.inShop ? "In shop" : "—"), align: "center" },
    { key: "riders", header: "Riders", cell: (r) => (r.riders.length ? r.riders.join(", ") : "—"), sortValue: (r) => r.riders.length, numeric: false },
  ];

  return (
    <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} initialSort={{ key: "driver", dir: "asc" }} />
  );
}
