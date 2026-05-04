import { useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Home, KeyRound, BedDouble, Users, Zap, DollarSign, LogOut, RotateCcw, Download, Upload, Briefcase, X } from "lucide-react";
import kfiLogoUrl from "@assets/kfi-staffing-logo.png";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  useData,
  inspectImportPayload,
  UnsupportedImportError,
  totalImportSummary,
  type ImportMode,
  type ImportResult,
  type ImportPreview,
} from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { useToast } from "@/hooks/use-toast";
import { useGeocodeFailures } from "@/hooks/use-geocode-failures";
import { formatGeocodeAddress } from "@/lib/google-maps-sdk";
import { Button } from "@/components/ui/button";
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
  const { resetToSampleData, exportData, importData, customers, properties } = useData();
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
  const addressesNeedingFixCount = useMemo(() => {
    if (geocodeFailures.size === 0) return 0;
    if (!properties) return 0;
    let count = 0;
    for (const p of properties) {
      const addr = formatGeocodeAddress(p);
      if (addr.length > 0 && geocodeFailures.has(addr)) count += 1;
    }
    return count;
  }, [properties, geocodeFailures]);
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
      a.download = `kfi-staffing-export-${stamp}.json`;
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
        description: "That file is not valid JSON. Please choose a KFI Staffing export file.",
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
          : "That file doesn't look like a KFI Staffing export. No changes were made.";
      toast({
        title: "Can't import this file",
        description,
        variant: "destructive",
      });
    }
  };

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
      });
    } else {
      toast({
        title: preview.migratedFromV1 ? "Older backup imported" : "Data imported",
        description: preview.migratedFromV1
          ? `${fileName} was made before Customers existed. We created a "Legacy Properties" customer and assigned all ${summary.properties} imported properties to it. Loaded ${counts}.`
          : `Loaded ${counts}.`,
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
          src={kfiLogoUrl}
          alt="KFI Staffing"
          className="h-10 w-auto max-w-full object-contain"
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
                    aria-label={`${addressesNeedingFixCount} ${addressesNeedingFixCount === 1 ? "address needs" : "addresses need"} fixing`}
                    title={`${addressesNeedingFixCount} ${addressesNeedingFixCount === 1 ? "address needs" : "addresses need"} fixing`}
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
              <p className="text-xs text-sidebar-foreground/60">admin@kfistaffing.com</p>
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
