import { AlertTriangle } from "lucide-react";
import { useGetLastAutoMasterImport } from "@workspace/api-client-react";

/**
 * Shows when the bundled master housing-lease workbook was last
 * auto-imported on api-server boot (Task #318). Lives next to the
 * manual "Import master file" button on the Leases page so operators
 * can confirm the boot import ran and spot the case where it silently
 * failed.
 *
 * Task #340: the plain-timestamp variant is easy for operators to
 * eyeball past, so the indicator now flips to an amber warning style
 * in two cases an operator must not miss:
 *
 *   - The boot import has never succeeded on this api-server process
 *     (fresh deploy that errored on its first attempt).
 *   - The bundled `Housing_Lease_MASTER_*.xlsx` file's mtime is newer
 *     than the recorded `ranAt` — i.e. someone dropped a fresh master
 *     file under `attached_assets/` after the api-server's last boot
 *     import, and a restart is needed to pick it up.
 */
export function LastAutoImportIndicator() {
  const { data, isLoading, isError } = useGetLastAutoMasterImport();

  if (isLoading) return null;

  const baseClass =
    "text-xs text-muted-foreground self-center whitespace-nowrap";
  // Amber/warning palette — distinct from the destructive red used for
  // hard errors elsewhere on the page. Same approach as
  // `runtime-config-stale-warning.tsx` so the visual language for
  // "still working but you should look at this" stays consistent.
  const warningClass =
    "inline-flex items-center gap-1 self-center whitespace-nowrap rounded-md border border-amber-500/50 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-100";

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
        className={warningClass}
        data-testid="text-last-auto-import"
        data-variant="never-succeeded"
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        Auto-import has never succeeded on this server — check logs
      </span>
    );
  }

  const when = new Date(data.ranAt);
  const ranAtMs = when.getTime();
  const formatted = Number.isNaN(ranAtMs) ? data.ranAt : when.toLocaleString();

  const bundled = data.bundledMtime ? new Date(data.bundledMtime) : null;
  const bundledMs = bundled ? bundled.getTime() : NaN;
  const isStale =
    !Number.isNaN(ranAtMs) &&
    !Number.isNaN(bundledMs) &&
    bundledMs > ranAtMs;

  const customers =
    (data.customersCreated ?? 0) + (data.customersUpdated ?? 0);
  const properties =
    (data.propertiesCreated ?? 0) + (data.propertiesUpdated ?? 0);
  const leases = (data.leasesCreated ?? 0) + (data.leasesUpdated ?? 0);

  const countsTitle = `Created/updated counts from the last successful boot-time import: ${data.customersCreated ?? 0}+${data.customersUpdated ?? 0} customers, ${data.propertiesCreated ?? 0}+${data.propertiesUpdated ?? 0} properties, ${data.leasesCreated ?? 0}+${data.leasesUpdated ?? 0} leases.`;

  if (isStale) {
    return (
      <span
        className={warningClass}
        data-testid="text-last-auto-import"
        data-variant="stale"
        title={`Bundled master file was modified on ${bundled!.toLocaleString()} — newer than the last boot-time import (${formatted}). Restart the api-server to pick it up. ${countsTitle}`}
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        Bundled master file is newer than last auto-import ({formatted}) — restart api-server
      </span>
    );
  }

  return (
    <span
      className={baseClass}
      data-testid="text-last-auto-import"
      data-variant="ok"
      title={countsTitle}
    >
      Last auto-imported on {formatted} — {customers} customers, {properties} properties, {leases} leases
    </span>
  );
}
