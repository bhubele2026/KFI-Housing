import { useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Home, KeyRound, BedDouble, Users, Zap, DollarSign, LogOut, RotateCcw, Download, Upload, Briefcase, X, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import logoUrl from "@/assets/housingops-logo.svg";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  useData,
  inspectImportPayload,
  UnsupportedImportError,
  totalImportSummary,
  totalMergeDryRun,
  type ImportMode,
  type ImportResult,
  type ImportPreview,
  type MergeDryRun,
  type MergeImpactCategory,
  UNDO_IMPORT_WINDOW_MS,
} from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { useToast } from "@/hooks/use-toast";
import { useGeocodeFailures, useGeocodeFailureTimestamps } from "@/hooks/use-geocode-failures";
import { useNow } from "@/hooks/use-now";
import { formatDistanceToNow } from "date-fns";
import { useGeocodeFailureToasts } from "@/hooks/use-geocode-failure-toasts";
import {
  clearGeocodeFailures,
  formatGeocodeAddress,
} from "@/lib/google-maps-sdk";
import { Button } from "@/components/ui/button";
import { ToastAction } from "@/components/ui/toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/customers", label: "Customers", icon: Briefcase },
  { href: "/properties", label: "Properties", icon: Home },
  { href: "/leases", label: "Leases", icon: KeyRound },
  { href: "/beds", label: "Beds", icon: BedDouble },
  { href: "/occupants", label: "Occupants", icon: Users },
  { href: "/utilities", label: "Utilities", icon: Zap },
  { href: "/finance", label: "Finance", icon: DollarSign },
];

export function Sidebar() {
  const [location] = useLocation();
  const { logout } = useAuth();
  const { resetToSampleData, exportData, importData, previewMergeImport, undoLastImport, customers, properties } = useData();
  const { customerId, setCustomerId } = useCustomerScope();
  const activeScopedCustomer =
    customerId !== ALL_CUSTOMERS
      ? customers.find((c) => c.id === customerId)
      : undefined;

  // Subscribe to the shared in-session geocode cache so the Properties
  // nav badge alerts operators the moment Google rejects a property's
  // address — even when the failure was recorded by a sibling surface
  // like a per-property Location card. We mirror the rollup panel's
  // logic exactly (count properties whose CURRENT formatted address
  // matches a cached failure) so the badge and the panel always agree.
  const geocodeFailures = useGeocodeFailures();
  // Pulled alongside the failure set so the badge tooltip can mirror the
  // Properties rollup's "Checked N ago" label — operators on narrow
  // displays who never open /properties get the same staleness signal
  // by hovering the badge. Updating live falls out of the hook's
  // subscription path: every failure recording or re-recording rebuilds
  // the Map, which re-renders us and re-runs the memo below.
  const geocodeFailureTimestamps = useGeocodeFailureTimestamps();
  // Subscribe to the shared minute-tick clock so the tooltip below
  // ("Oldest flag checked N ago") advances over real time even when
  // no fresh failure lands in the cache to force a re-render. Without
  // this, an operator who left the tab open for an hour would still
  // see "checked 1 minute ago" until something else nudged the
  // sidebar to render. The hook piggy-backs on a single shared
  // setInterval, so we don't add per-component timer load.
  const now = useNow(60_000);
  const { addressesNeedingFixCount, oldestFailureCheckedAt } = useMemo(() => {
    if (geocodeFailures.size === 0 || !properties) {
      return { addressesNeedingFixCount: 0, oldestFailureCheckedAt: null as number | null };
    }
    let count = 0;
    let oldest: number | null = null;
    for (const p of properties) {
      const addr = formatGeocodeAddress(p);
      if (addr.length === 0 || !geocodeFailures.has(addr)) continue;
      count += 1;
      // Track the EARLIEST timestamp across matching properties so the
      // tooltip can call out the most stale flag — that's the one
      // operators most need a nudge to triage. Falls back silently if
      // a timestamp is missing (shouldn't happen in steady state since
      // the cache and timestamp Map are written together).
      const ts = geocodeFailureTimestamps.get(addr);
      if (typeof ts === "number" && (oldest === null || ts < oldest)) {
        oldest = ts;
      }
    }
    return { addressesNeedingFixCount: count, oldestFailureCheckedAt: oldest };
  }, [properties, geocodeFailures, geocodeFailureTimestamps]);
  const addressesNeedingFixTooltip = useMemo(() => {
    if (addressesNeedingFixCount === 0) return "";
    const countLabel = `${addressesNeedingFixCount} ${addressesNeedingFixCount === 1 ? "address needs" : "addresses need"} fixing`;
    if (typeof oldestFailureCheckedAt !== "number") return countLabel;
    // Match the Properties rollup phrasing exactly ("Checked N ago")
    // so the two surfaces read the same. Prefixed with "Oldest flag"
    // so the meaning is clear when we're rolling up multiple rows
    // into a single line of tooltip text.
    return `${countLabel} — Oldest flag checked ${formatDistanceToNow(oldestFailureCheckedAt, { addSuffix: true })}`;
    // `now` is in the dep list so each minute-tick recomputes the
    // relative-time suffix off a fresh clock — `formatDistanceToNow`
    // reads `Date.now()` internally, but the memo would otherwise
    // hold the previous string and never invalidate.
  }, [addressesNeedingFixCount, oldestFailureCheckedAt, now]);
  // Pop a one-shot toast each time a brand-new failure lands in the
  // shared cache. The badge above only catches the operator's eye if
  // the sidebar is actually visible — on narrow displays where the
  // sidebar is tucked off-screen, or when the operator is heads-down
  // editing a Lease/Bed elsewhere, the toast is what surfaces the
  // problem in real time. Mounting the listener here (the global
  // shell) means it's installed regardless of the active route.
  useGeocodeFailureToasts(properties);
  const { toast } = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [demoResetOpen, setDemoResetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const isDevBuild = import.meta.env.DEV;
  const [pendingImport, setPendingImport] = useState<{ preview: ImportPreview; fileName: string } | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("replace");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isResetting, setIsResetting] = useState(false);
  const [isDemoResetting, setIsDemoResetting] = useState(false);
  // Refs back the in-flight guards so two synchronous double-clicks both
  // see the locked state — `useState` updates would batch and let the
  // second click sneak through with the stale `false` value.
  const isResettingRef = useRef(false);
  const isDemoResettingRef = useRef(false);

  const handleConfirmReset = () => {
    if (isResettingRef.current) return;
    isResettingRef.current = true;
    setIsResetting(true);
    // Keep the click guard armed (and the dialog open) until the reset
    // mutation actually settles. Releasing the guard synchronously after
    // dispatch defeated duplicate-click protection because the mutation
    // is async — operators could fire two resets back to back.
    resetToSampleData({
      onSuccess: () => {
        // Wipe persisted geocode failures + dismissals so the sidebar
        // badge and the Properties rollup drop to empty alongside the
        // freshly-reseeded demo dataset. Without this, a stale
        // "addresses Google can't pinpoint" badge from a previous
        // session would survive the reset since failures live in
        // localStorage now (see `lib/google-maps-sdk.ts`).
        clearGeocodeFailures();
        toast({
          title: "Sample data restored",
          description: "All saved changes were cleared and the demo data was reloaded.",
        });
      },
      onSettled: () => {
        setResetOpen(false);
        setIsResetting(false);
        isResettingRef.current = false;
      },
    });
  };

  const handleConfirmDemoReset = () => {
    if (isDemoResettingRef.current) return;
    isDemoResettingRef.current = true;
    setIsDemoResetting(true);
    resetToSampleData({
      onSuccess: () => {
        // Same rationale as the production reset above — a clean
        // demo take shouldn't carry a phantom failures badge into
        // the next investor walkthrough.
        clearGeocodeFailures();
        toast({
          title: "Demo data reset",
          description: "Edits cleared and the demo dataset was reseeded. Ready for the next take.",
        });
      },
      onSettled: () => {
        setDemoResetOpen(false);
        setIsDemoResetting(false);
        isDemoResettingRef.current = false;
      },
    });
  };

  const handleExport = () => {
    try {
      const payload = exportData();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const a = document.createElement("a");
      a.href = url;
      a.download = `housingops-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: "Data exported",
        description: `Saved ${a.download} with ${payload.data.customers.length} customers, ${payload.data.properties.length} properties, ${payload.data.leases.length} leases, ${payload.data.beds.length} beds, ${payload.data.occupants.length} occupants, ${payload.data.utilities.length} utilities.`,
      });
    } catch {
      toast({
        title: "Export failed",
        description: "Could not generate the export file. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handlePickImportFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let parsed: unknown;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch {
      toast({
        title: "Could not read file",
        description: "That file is not valid JSON. Please choose a HousingOps export file.",
        variant: "destructive",
      });
      return;
    }
    try {
      const preview = inspectImportPayload(parsed);
      setPendingImport({ preview, fileName: file.name });
      setImportMode("replace");
      setImportOpen(true);
    } catch (err) {
      const description =
        err instanceof UnsupportedImportError
          ? err.message
          : "That file doesn't look like a HousingOps export. No changes were made.";
      toast({
        title: "Can't import this file",
        description,
        variant: "destructive",
      });
    }
  };

  // Recompute the per-type "what will change" preview whenever the operator
  // toggles to merge mode (or the underlying data changes mid-dialog).
  // Skipped in replace mode since replace is total — there's nothing to diff.
  const mergeDryRun = useMemo<MergeDryRun | null>(() => {
    if (!pendingImport || importMode !== "merge") return null;
    return previewMergeImport(pendingImport.preview);
  }, [pendingImport, importMode, previewMergeImport]);

  const handleConfirmImport = () => {
    if (!pendingImport) return;
    const { preview, fileName } = pendingImport;
    let result: ImportResult;
    try {
      result = importData(preview, importMode);
    } catch (err) {
      const description =
        err instanceof UnsupportedImportError
          ? err.message
          : "Something went wrong while importing. No changes were made.";
      toast({
        title: "Import failed",
        description,
        variant: "destructive",
      });
      setImportOpen(false);
      setPendingImport(null);
      return;
    }
    setImportOpen(false);
    setPendingImport(null);
    const summary = result.summary;
    const counts = `${summary.customers} customers, ${summary.properties} properties, ${summary.leases} leases, ${summary.beds} beds, ${summary.occupants} occupants, ${summary.utilities} utilities`;
    // Same Undo action attached to both the merge and replace success toasts
    // — both modes are destructive (rows are overwritten by-id) so an
    // operator who confirmed by mistake gets the same one-click recovery.
    // The button stays armed for the data-store's UNDO_IMPORT_WINDOW_MS;
    // after that the snapshot is dropped and click reports it expired.
    const undoAction = (
      <ToastAction
        altText="Undo this import"
        onClick={handleUndoImport}
        data-testid="button-undo-import"
      >
        Undo
      </ToastAction>
    );
    if (result.mode === "merge" && result.added && result.updated) {
      const addedTotal = totalImportSummary(result.added);
      const updatedTotal = totalImportSummary(result.updated);
      const unchanged =
        totalImportSummary(summary) - addedTotal - updatedTotal;
      const unchangedNote =
        unchanged > 0 ? ` ${unchanged} were already up to date.` : "";
      toast({
        title: "Data merged",
        description: preview.migratedFromV1
          ? `${fileName} was made before Customers existed. We created a "Legacy Properties" customer for the migrated properties. ${addedTotal} added, ${updatedTotal} updated.${unchangedNote}`
          : `From ${fileName}: ${addedTotal} added, ${updatedTotal} updated.${unchangedNote} Existing records not in the file were kept.`,
        action: undoAction,
        // Hold the toast open for the full undo window so the Undo
        // button is reachable for as long as the snapshot is alive.
        // Without this, Radix's ~5s default would auto-dismiss the
        // toast (and its action) long before the 30s window expires.
        duration: UNDO_IMPORT_WINDOW_MS,
      });
    } else {
      toast({
        title: preview.migratedFromV1 ? "Older backup imported" : "Data imported",
        description: preview.migratedFromV1
          ? `${fileName} was made before Customers existed. We created a "Legacy Properties" customer and assigned all ${summary.properties} imported properties to it. Loaded ${counts}.`
          : `Loaded ${counts}.`,
        action: undoAction,
        duration: UNDO_IMPORT_WINDOW_MS,
      });
    }
  };

  const handleUndoImport = () => {
    const restored = undoLastImport();
    if (restored) {
      toast({
        title: "Import undone",
        description: "Your previous data was restored.",
      });
    } else {
      // Either the operator waited past the undo window or already
      // clicked Undo once — in both cases the snapshot is gone, so
      // explain that rather than silently no-op.
      toast({
        title: "Can't undo this import",
        description: "The undo window has expired. Re-import your previous backup file to restore that data.",
        variant: "destructive",
      });
    }
  };

  const handleCancelImport = () => {
    setImportOpen(false);
    setPendingImport(null);
  };

  return (
    <div className="flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shadow-lg">
      <div className="flex h-16 items-center px-4 border-b border-sidebar-border bg-sidebar">
        <img
          src={logoUrl}
          alt="HousingOps"
          className="h-9 w-auto max-w-full object-contain"
        />
      </div>

      {activeScopedCustomer && (
        <div
          className="px-4 py-3 border-b border-sidebar-border bg-sidebar-accent/20"
          data-testid="sidebar-customer-scope"
        >
          <p className="text-[10px] uppercase tracking-wider font-semibold text-sidebar-foreground/50 mb-1.5">
            Filtered by customer
          </p>
          <div className="flex items-center gap-2">
            <Briefcase className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            <span
              className="text-sm font-medium truncate flex-1"
              title={activeScopedCustomer.name}
              data-testid="text-sidebar-customer-name"
            >
              {activeScopedCustomer.name}
            </span>
            <button
              type="button"
              onClick={() => setCustomerId(ALL_CUSTOMERS)}
              className="rounded-sm p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              aria-label="Clear customer filter"
              data-testid="button-sidebar-clear-customer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <nav className="flex-1 space-y-1 px-3 py-6 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = location === item.href;
          const showAddressBadge =
            item.href === "/properties" && addressesNeedingFixCount > 0;
          return (
            <Link key={item.href} href={item.href}>
              <span
                className={cn(
                  "group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 cursor-pointer",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon
                  className={cn(
                    "mr-3 h-5 w-5 flex-shrink-0 transition-colors",
                    isActive ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/50 group-hover:text-sidebar-accent-foreground"
                  )}
                  aria-hidden="true"
                />
                <span className="flex-1">{item.label}</span>
                {showAddressBadge ? (
                  <span
                    className={cn(
                      "ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                      isActive
                        ? "bg-sidebar-primary-foreground/20 text-sidebar-primary-foreground"
                        : "bg-destructive/15 text-destructive"
                    )}
                    aria-label={addressesNeedingFixTooltip}
                    title={addressesNeedingFixTooltip}
                    data-testid="badge-properties-needing-address-fix"
                  >
                    {addressesNeedingFixCount}
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-4 bg-sidebar-accent/10 space-y-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center">
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold text-sm shadow-sm">
              AM
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium">Admin Manager</p>
              <p className="text-xs text-sidebar-foreground/60">admin@housingops.app</p>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          className="w-full justify-start text-muted-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={handleExport}
          data-testid="button-export-data"
        >
          <Download className="mr-2 h-4 w-4" />
          Export data
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start text-muted-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={handlePickImportFile}
          data-testid="button-import-data"
        >
          <Upload className="mr-2 h-4 w-4" />
          Import data
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFileSelected}
          data-testid="input-import-file"
        />
        <Button
          variant="outline"
          className="w-full justify-start text-muted-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => setResetOpen(true)}
          data-testid="button-reset-sample-data"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset to sample data
        </Button>
        {isDevBuild ? (
          <Button
            variant="outline"
            className="w-full justify-start border-amber-300/60 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/40"
            onClick={() => setDemoResetOpen(true)}
            data-testid="button-reset-demo-data"
            title="Visible in development builds only"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset demo data (dev)
          </Button>
        ) : null}
        <Button variant="outline" className="w-full justify-start text-muted-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </Button>
      </div>

      <AlertDialog open={demoResetOpen} onOpenChange={setDemoResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              Wipes every edit in this browser and reseeds the demo dataset so you can re-run the
              demo cleanly between investor takes. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-reset-demo-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDemoReset}
              data-testid="button-reset-demo-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reset demo data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to sample data?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears every saved change in this browser — customers, properties, leases, beds,
              occupants, and utilities — and reloads the original demo data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-reset-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmReset}
              data-testid="button-reset-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reset data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!open) handleCancelImport();
          else setImportOpen(true);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {importMode === "merge"
                ? "Merge import into current data?"
                : pendingImport?.preview.migratedFromV1
                  ? "Import older backup?"
                  : "Replace current data with import?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Importing <span className="font-medium">{pendingImport?.fileName ?? "this file"}</span>.
                  Choose how it should be applied to your current data.
                </p>
                <RadioGroup
                  value={importMode}
                  onValueChange={(v) => setImportMode(v as ImportMode)}
                  className="gap-3"
                  data-testid="radio-import-mode"
                >
                  <div className="flex items-start gap-3 rounded-md border border-border p-3">
                    <RadioGroupItem
                      value="replace"
                      id="import-mode-replace"
                      className="mt-0.5"
                      data-testid="radio-import-mode-replace"
                    />
                    <div className="space-y-1">
                      <Label
                        htmlFor="import-mode-replace"
                        className="font-medium cursor-pointer"
                      >
                        Replace all data
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Wipe every customer, property, lease, bed, occupant, and utility in this
                        browser and load only what&apos;s in the file. Use this to restore a backup
                        or move to a new browser.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-md border border-border p-3">
                    <RadioGroupItem
                      value="merge"
                      id="import-mode-merge"
                      className="mt-0.5"
                      data-testid="radio-import-mode-merge"
                    />
                    <div className="space-y-1">
                      <Label
                        htmlFor="import-mode-merge"
                        className="font-medium cursor-pointer"
                      >
                        Merge into current data
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Add records from the file as new entries, update any existing records that
                        share the same id, and keep everything else you already have. Use this to
                        combine data from another teammate&apos;s export.
                      </p>
                    </div>
                  </div>
                </RadioGroup>
                {importMode === "replace" ? (
                  <p className="text-sm text-muted-foreground">
                    Your current data will be lost. Consider exporting first if you want a backup.
                  </p>
                ) : null}
                {importMode === "merge" && mergeDryRun ? (
                  <MergePreview dryRun={mergeDryRun} />
                ) : null}
                {pendingImport?.preview.migratedFromV1 ? (
                  <p
                    className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                    data-testid="text-import-legacy-warning"
                  >
                    This backup was made before Customers existed. We&apos;ll create a single
                    &quot;Legacy Properties&quot; customer and assign all{" "}
                    {pendingImport.preview.summary.properties} imported{" "}
                    {pendingImport.preview.summary.properties === 1 ? "property" : "properties"} to it.
                    You can re-assign them on the Properties page afterwards.
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-import-cancel" onClick={handleCancelImport}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmImport}
              data-testid="button-import-confirm"
              className={
                importMode === "replace"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
            >
              {importMode === "merge"
                ? "Merge data"
                : pendingImport?.preview.migratedFromV1
                  ? "Import and migrate"
                  : "Replace data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const MERGE_PREVIEW_TYPES: Array<{ key: keyof MergeDryRun; label: string }> = [
  { key: "customers", label: "Customers" },
  { key: "properties", label: "Properties" },
  { key: "leases", label: "Leases" },
  { key: "rooms", label: "Rooms" },
  { key: "beds", label: "Beds" },
  { key: "occupants", label: "Occupants" },
  { key: "utilities", label: "Utilities" },
];

/**
 * Renders the per-type breakdown of a merge dry-run (added / updated /
 * unchanged) plus a collapsible list of the rows that would be overwritten.
 * Lets operators spot accidental overwrites BEFORE confirming the merge.
 */
function MergePreview({ dryRun }: { dryRun: MergeDryRun }) {
  const totals = totalMergeDryRun(dryRun);
  const hasAnyUpdate = MERGE_PREVIEW_TYPES.some(
    (t) => dryRun[t.key].updatedItems.length > 0,
  );
  return (
    <div
      className="rounded-md border border-border bg-muted/40 p-3 space-y-2"
      data-testid="merge-import-preview"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">What this merge will do</p>
        <p className="text-xs text-muted-foreground tabular-nums" data-testid="merge-import-preview-totals">
          {totals.added} added · {totals.updated} updated · {totals.unchanged} unchanged
        </p>
      </div>
      <ul className="text-sm text-muted-foreground space-y-0.5">
        {MERGE_PREVIEW_TYPES.map(({ key, label }) => {
          const cat = dryRun[key];
          if (cat.added === 0 && cat.updated === 0 && cat.unchanged === 0) {
            return null;
          }
          return (
            <li key={key} className="flex justify-between gap-2 tabular-nums" data-testid={`merge-preview-row-${key}`}>
              <span>{label}</span>
              <span>
                <span className="text-emerald-700 dark:text-emerald-400">{cat.added} added</span>
                {", "}
                <span className={cn(cat.updated > 0 && "text-amber-700 dark:text-amber-400 font-medium")}>
                  {cat.updated} updated
                </span>
                {", "}
                <span>{cat.unchanged} unchanged</span>
              </span>
            </li>
          );
        })}
      </ul>
      {hasAnyUpdate ? (
        <Collapsible>
          <CollapsibleTrigger
            className="group flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
            data-testid="merge-preview-overwrites-toggle"
          >
            <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
            Show records that would be overwritten ({totals.updated})
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="mb-1">
                These existing records share an id with the file and will be replaced. Any local
                edits to them will be lost.
              </p>
              <ul className="space-y-1">
                {MERGE_PREVIEW_TYPES.map(({ key, label }) => (
                  <MergeOverwriteList key={key} label={label} category={dryRun[key]} typeKey={key} />
                ))}
              </ul>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

function MergeOverwriteList({
  label,
  category,
  typeKey,
}: {
  label: string;
  category: MergeImpactCategory;
  typeKey: keyof MergeDryRun;
}) {
  if (category.updatedItems.length === 0) return null;
  return (
    <li data-testid={`merge-preview-overwrites-${typeKey}`}>
      <span className="font-semibold">{label}:</span>{" "}
      <span>
        {category.updatedItems.map((item, idx) => (
          <span key={item.id}>
            {idx > 0 ? ", " : ""}
            <span title={item.id}>{item.label}</span>
          </span>
        ))}
      </span>
    </li>
  );
}
