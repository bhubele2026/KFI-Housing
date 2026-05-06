import { useGetLastAutoMasterImport } from "@workspace/api-client-react";

/**
 * Shows when the bundled master housing-lease workbook was last
 * auto-imported on api-server boot (Task #318). Lives next to the
 * manual "Import master file" button on the Leases page so operators
 * can confirm the boot import ran and spot the case where it silently
 * failed.
 */
export function LastAutoImportIndicator() {
  const { data, isLoading, isError } = useGetLastAutoMasterImport();

  if (isLoading) return null;

  const baseClass =
    "text-xs text-muted-foreground self-center whitespace-nowrap";

  if (isError || !data) {
    return (
      <span
        className={baseClass}
        data-testid="text-last-auto-import"
      >
        Last auto-import: unknown
      </span>
    );
  }

  if (!data.ranAt) {
    return (
      <span
        className={baseClass}
        data-testid="text-last-auto-import"
      >
        Auto-import has never succeeded on this server — check logs
      </span>
    );
  }

  const when = new Date(data.ranAt);
  const formatted = Number.isNaN(when.getTime())
    ? data.ranAt
    : when.toLocaleString();

  const customers =
    (data.customersCreated ?? 0) + (data.customersUpdated ?? 0);
  const properties =
    (data.propertiesCreated ?? 0) + (data.propertiesUpdated ?? 0);
  const leases = (data.leasesCreated ?? 0) + (data.leasesUpdated ?? 0);

  return (
    <span
      className={baseClass}
      data-testid="text-last-auto-import"
      title={`Created/updated counts from the last successful boot-time import: ${data.customersCreated ?? 0}+${data.customersUpdated ?? 0} customers, ${data.propertiesCreated ?? 0}+${data.propertiesUpdated ?? 0} properties, ${data.leasesCreated ?? 0}+${data.leasesUpdated ?? 0} leases.`}
    >
      Last auto-imported on {formatted} — {customers} customers, {properties} properties, {leases} leases
    </span>
  );
}
