import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageToggle } from "@/components/language-toggle";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Home, KeyRound, BedDouble, Users, Zap, DollarSign, LogOut, RotateCcw, Download, Upload, Briefcase, X, ChevronRight, ChevronDown, PanelLeftClose, PanelLeftOpen, ShieldCheck, Settings, Building2, Truck, FileText, Contact, MapPin, Wrench, Fuel, Map as MapIcon, Receipt, Calculator, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { KfiLogo } from "@/components/kfi-logo";
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
  type ImportSummary,
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
import { ImportOccupantsDialog } from "@/components/import-occupants-dialog";
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

type NavLeaf = {
  kind: "leaf";
  href: string;
  labelKey: string;
  icon: LucideIcon;
};
type NavGroup = {
  kind: "group";
  id: string;
  labelKey: string;
  icon: LucideIcon;
  defaultOpen: boolean;
  children: NavLeaf[];
};
type NavEntry = NavLeaf | NavGroup;

const HOUSING_CHILDREN: NavLeaf[] = [
  { kind: "leaf", href: "/customers", labelKey: "nav.customers", icon: Briefcase },
  { kind: "leaf", href: "/properties", labelKey: "nav.properties", icon: Home },
  { kind: "leaf", href: "/leases", labelKey: "nav.leases", icon: KeyRound },
  { kind: "leaf", href: "/beds", labelKey: "nav.beds", icon: BedDouble },
  { kind: "leaf", href: "/occupants", labelKey: "nav.occupants", icon: Users },
  { kind: "leaf", href: "/roster", labelKey: "nav.roster", icon: Contact },
  { kind: "leaf", href: "/utilities", labelKey: "nav.utilities", icon: Zap },
  { kind: "leaf", href: "/finance", labelKey: "nav.finance", icon: DollarSign },
  { kind: "leaf", href: "/economics", labelKey: "nav.economics", icon: Calculator },
  { kind: "leaf", href: "/reconciliation", labelKey: "nav.reconciliation", icon: Receipt },
  { kind: "leaf", href: "/qbo/mapping-rules", labelKey: "nav.qboMappingRules", icon: Receipt },
  { kind: "leaf", href: "/insurance", labelKey: "nav.insurance", icon: ShieldCheck },
  { kind: "leaf", href: "/rental-companies", labelKey: "nav.rentalCompanies", icon: Building2 },
];

const TRANSPORT_CHILDREN: NavLeaf[] = [
  { kind: "leaf", href: "/transport/vehicles", labelKey: "nav.transport.vehicles", icon: Truck },
  { kind: "leaf", href: "/transport/vehicle-leases", labelKey: "nav.transport.vehicleLeases", icon: FileText },
  { kind: "leaf", href: "/transport/drivers", labelKey: "nav.transport.drivers", icon: Contact },
  { kind: "leaf", href: "/transport/trips", labelKey: "nav.transport.trips", icon: MapPin },
  { kind: "leaf", href: "/transport/maintenance", labelKey: "nav.transport.maintenance", icon: Wrench },
  { kind: "leaf", href: "/transport/fuel-logs", labelKey: "nav.transport.fuelLogs", icon: Fuel },
  { kind: "leaf", href: "/transport/routes", labelKey: "nav.transport.routes", icon: MapIcon },
  { kind: "leaf", href: "/transport/charges", labelKey: "nav.transport.charges", icon: Receipt },
];

const NAV_ENTRIES: NavEntry[] = [
  { kind: "leaf", href: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  {
    kind: "group",
    id: "housing",
    labelKey: "nav.housing",
    icon: Building2,
    defaultOpen: true,
    children: HOUSING_CHILDREN,
  },
  {
    kind: "group",
    id: "transportation",
    labelKey: "nav.transportation",
    icon: Truck,
    defaultOpen: false,
    children: TRANSPORT_CHILDREN,
  },
  { kind: "leaf", href: "/settings", labelKey: "nav.settings", icon: Settings },
];

/** localStorage key that holds the {[groupId]: open} map for the
 *  collapsible nav groups. Stored under localStorage (not sessionStorage)
 *  so the choice survives client-side route changes that remount
 *  MainLayout/Sidebar AND full page reloads / next-day visits — matching
 *  the existing collapse-rail toggle's persistence model so operators
 *  don't have to re-open their preferred sections every time. */
const GROUP_OPEN_STORAGE_KEY = "housingops.sidebar.groupOpen";

function readPersistedGroupOpen(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(GROUP_OPEN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export type SidebarProps = {
  /** Render the icon-only ~56px rail (desktop only). When undefined, renders the full 256px rail. */
  collapsed?: boolean;
  /** When provided, shows a toggle button in the header for switching between collapsed and expanded. Omit for the mobile drawer copy. */
  onToggleCollapsed?: () => void;
  /** Fired after the operator activates a nav link or footer action — used by the mobile drawer to close itself. */
  onNavigate?: () => void;
};

export function Sidebar({ collapsed = false, onToggleCollapsed, onNavigate }: SidebarProps = {}) {
  const [location] = useLocation();
  const { t } = useTranslation();
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
    const countLabel = t("nav.addressNeedsFix", { count: addressesNeedingFixCount });
    if (typeof oldestFailureCheckedAt !== "number") return countLabel;
    return `${countLabel} — ${t("nav.oldestFlagChecked", { ago: formatDistanceToNow(oldestFailureCheckedAt, { addSuffix: true }) })}`;
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
  // Gate the Reconciliation nav entry behind a connected QBO account.
  const [qboConnected, setQboConnected] = useState<boolean>(false);
  useEffect(() => {
    const baseUrl = import.meta.env.BASE_URL ?? "/";
    fetch(`${baseUrl}api/qbo/status`)
      .then((r) => (r.ok ? r.json() : { connected: false }))
      .then((j: { connected?: boolean }) => setQboConnected(!!j.connected))
      .catch(() => setQboConnected(false));
  }, []);
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
          title: t("toasts.sampleDataRestoredTitle"),
          description: t("toasts.sampleDataRestoredDescription"),
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
          title: t("toasts.demoResetTitle"),
          description: t("toasts.demoResetDescription"),
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
        title: t("toasts.dataExportedTitle"),
        description: t("toasts.dataExportedDescription", {
          file: a.download,
          customers: payload.data.customers.length,
          properties: payload.data.properties.length,
          leases: payload.data.leases.length,
          beds: payload.data.beds.length,
          occupants: payload.data.occupants.length,
          utilities: payload.data.utilities.length,
        }),
      });
    } catch {
      toast({
        title: t("toasts.exportFailedTitle"),
        description: t("toasts.exportFailedDescription"),
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
        title: t("toasts.couldNotReadFileTitle"),
        description: t("toasts.couldNotReadFileDescription"),
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
          : t("toasts.cantImportFallback");
      toast({
        title: t("toasts.cantImportTitle"),
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
          : t("toasts.importFailedFallback");
      toast({
        title: t("toasts.importFailedTitle"),
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
    const counts = t("toasts.importCounts", {
      customers: summary.customers,
      properties: summary.properties,
      leases: summary.leases,
      beds: summary.beds,
      occupants: summary.occupants,
      utilities: summary.utilities,
      roomNightLogs: summary.roomNightLogs,
    });
    // Same Undo action attached to both the merge and replace success toasts
    // — both modes are destructive (rows are overwritten by-id) so an
    // operator who confirmed by mistake gets the same one-click recovery.
    // The button stays armed for the data-store's UNDO_IMPORT_WINDOW_MS;
    // after that the snapshot is dropped and click reports it expired.
    const undoAction = (
      <ToastAction
        altText={t("toasts.undoAlt")}
        onClick={handleUndoImport}
        data-testid="button-undo-import"
      >
        {t("common.undo")}
      </ToastAction>
    );
    if (result.mode === "merge" && result.added && result.updated) {
      const addedTotal = totalImportSummary(result.added);
      const updatedTotal = totalImportSummary(result.updated);
      const unchanged =
        totalImportSummary(summary) - addedTotal - updatedTotal;
      const unchangedNote =
        unchanged > 0 ? t("toasts.unchangedNote", { count: unchanged }) : "";
      toast({
        title: t("toasts.dataMergedTitle"),
        description: preview.migratedFromV1
          ? t("toasts.dataMergedDescriptionLegacy", { file: fileName, added: addedTotal, updated: updatedTotal, unchangedNote })
          : t("toasts.dataMergedDescription", { file: fileName, added: addedTotal, updated: updatedTotal, unchangedNote }),
        action: undoAction,
        duration: UNDO_IMPORT_WINDOW_MS,
      });
    } else {
      toast({
        title: preview.migratedFromV1 ? t("toasts.olderBackupImportedTitle") : t("toasts.dataImportedTitle"),
        description: preview.migratedFromV1
          ? t("toasts.dataImportedDescriptionLegacy", { file: fileName, count: summary.properties, counts })
          : t("toasts.dataImportedDescription", { counts }),
        action: undoAction,
        duration: UNDO_IMPORT_WINDOW_MS,
      });
    }
  };

  const handleUndoImport = () => {
    const restored = undoLastImport();
    if (restored) {
      toast({
        title: t("toasts.importUndone"),
        description: t("toasts.importUndoneDescription"),
      });
    } else {
      toast({
        title: t("toasts.cantUndoImport"),
        description: t("toasts.cantUndoImportDescription"),
        variant: "destructive",
      });
    }
  };

  const handleCancelImport = () => {
    setImportOpen(false);
    setPendingImport(null);
  };

  // When collapsed we render an icon-only rail. Each footer button and
  // nav row is wrapped in a Tooltip so operators can still see the
  // label on hover. The toggle button always sits in the header so
  // the operator can flip back without leaving the rail.
  const wrapTip = (label: string, node: React.ReactNode) =>
    collapsed ? (
      <Tooltip>
        <TooltipTrigger asChild>{node}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    ) : (
      node
    );

  // Session-scoped expand/collapse state per nav group. Defaults are seeded
  // from each group's `defaultOpen`: Housing opens on first load so existing
  // operators don't lose their links; Transportation stays closed so the
  // placeholder section doesn't visually compete on first paint. Persisted
  // to sessionStorage so the choice survives the sidebar remount that
  // happens on every client-side route change (MainLayout is mounted inside
  // each page component).
  const [groupOpen, setGroupOpenState] = useState<Record<string, boolean>>(() => {
    const persisted = readPersistedGroupOpen();
    const init: Record<string, boolean> = {};
    for (const e of NAV_ENTRIES) {
      if (e.kind === "group") {
        init[e.id] = persisted[e.id] ?? e.defaultOpen;
      }
    }
    return init;
  });
  // Filter out QBO-gated entries (currently /reconciliation) until the
  // workspace has a connected QuickBooks account. Operators without QBO
  // shouldn't see a nav link to a page that would just show an empty grid.
  const navEntries = useMemo<NavEntry[]>(() => {
    if (qboConnected) return NAV_ENTRIES;
    return NAV_ENTRIES.map((e) => {
      if (e.kind === "group") {
        return {
          ...e,
          children: e.children.filter(
            (c) => c.href !== "/reconciliation" && c.href !== "/qbo/mapping-rules",
          ),
        };
      }
      return e;
    });
  }, [qboConnected]);
  const setGroupOpen = (
    updater: (prev: Record<string, boolean>) => Record<string, boolean>,
  ) => {
    setGroupOpenState((prev) => {
      const next = updater(prev);
      try {
        window.localStorage.setItem(
          GROUP_OPEN_STORAGE_KEY,
          JSON.stringify(next),
        );
      } catch {
        // localStorage can throw in private-mode/quota cases — the in-memory
        // state still updates, we just lose the cross-reload persistence.
      }
      return next;
    });
  };

  function renderLeaf(item: NavLeaf, opts: { indented: boolean }) {
    const label = t(item.labelKey);
    const isActive = location === item.href;
    const showAddressBadge =
      item.href === "/properties" && addressesNeedingFixCount > 0;
    const linkNode = (
      <Link key={item.href} href={item.href}>
        <span
          onClick={onNavigate}
          data-testid={`nav-leaf-${item.href}`}
          className={cn(
            "group relative flex items-center rounded-md text-[13.5px] font-medium transition-all duration-150 cursor-pointer",
            collapsed
              ? "h-10 w-10 justify-center mx-auto"
              : opts.indented
                ? "px-2.5 py-1.5"
                : "px-3 py-2",
            isActive
              ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
              : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
          )}
        >
          {isActive && !collapsed && (
            <span
              aria-hidden="true"
              className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-sidebar-primary-foreground/80"
            />
          )}
          <item.icon
            className={cn(
              "h-[18px] w-[18px] flex-shrink-0 transition-colors",
              !collapsed && "mr-3",
              isActive
                ? "text-sidebar-primary-foreground"
                : "text-sidebar-foreground/55 group-hover:text-sidebar-accent-foreground",
            )}
            aria-hidden="true"
          />
          {!collapsed && <span className="flex-1">{label}</span>}
          {showAddressBadge ? (
            collapsed ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-sidebar",
                  isActive ? "bg-sidebar-primary-foreground" : "bg-destructive",
                )}
                data-testid="badge-properties-needing-address-fix"
              />
            ) : (
              <span
                className={cn(
                  "ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                  isActive
                    ? "bg-sidebar-primary-foreground/20 text-sidebar-primary-foreground"
                    : "bg-destructive/15 text-destructive",
                )}
                aria-label={addressesNeedingFixTooltip}
                title={addressesNeedingFixTooltip}
                data-testid="badge-properties-needing-address-fix"
              >
                {addressesNeedingFixCount}
              </span>
            )
          ) : null}
        </span>
      </Link>
    );
    const tipLabel =
      showAddressBadge && addressesNeedingFixTooltip
        ? `${label} — ${addressesNeedingFixTooltip}`
        : label;
    return collapsed ? (
      <Tooltip key={item.href}>
        <TooltipTrigger asChild>{linkNode}</TooltipTrigger>
        <TooltipContent side="right">{tipLabel}</TooltipContent>
      </Tooltip>
    ) : (
      <div key={item.href}>{linkNode}</div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-screen flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shadow-xl transition-[width] duration-200",
        collapsed ? "w-14" : "w-64",
      )}
      data-testid="sidebar-root"
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div
        className={cn(
          "flex flex-col px-3 py-3",
          collapsed ? "h-14 items-center justify-center" : "h-28 justify-center",
        )}
      >
        {collapsed ? (
          // Icon-only header: just the toggle button. We drop the logo
          // entirely at this width — it can't render legibly in 32px
          // and operators still see the brand on the expand toggle's
          // tooltip.
          onToggleCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleCollapsed}
                  aria-label={t("nav.expandSidebar")}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                  data-testid="button-sidebar-toggle"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("nav.expandSidebar")}</TooltipContent>
            </Tooltip>
          ) : null
        ) : (
          <div className="flex items-center px-1">
            {/* KFI Workforce Deployment wordmark — crisp SVG, white, flat on
                the navy sidebar (no backing glow so it blends cleanly).
                The collapse control now lives at the bottom of the rail. */}
            <KfiLogo
              variant="full"
              className="min-w-0 text-white"
              data-testid="img-sidebar-logo"
            />
          </div>
        )}
      </div>

      {activeScopedCustomer && (
        collapsed ? (
          <div
            className="px-2 py-2 border-b border-sidebar-border bg-sidebar-accent/20 flex justify-center"
            data-testid="sidebar-customer-scope"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCustomerId(ALL_CUSTOMERS)}
                  className="relative flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-accent/40 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                  aria-label={t("nav.filteredByCustomerAria", { name: activeScopedCustomer.name })}
                  data-testid="button-sidebar-clear-customer"
                >
                  <Briefcase className="h-4 w-4 text-primary" />
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {t("nav.filteredByCustomerTooltip", { name: activeScopedCustomer.name })}
              </TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <div
            className="px-4 py-3 border-b border-sidebar-border bg-sidebar-accent/20"
            data-testid="sidebar-customer-scope"
          >
            <p className="text-[10px] uppercase tracking-wider font-semibold text-sidebar-foreground/50 mb-1.5">
              {t("nav.filteredByCustomer")}
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
                aria-label={t("nav.clearCustomerFilter")}
                data-testid="button-sidebar-clear-customer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )
      )}

      {!collapsed ? (
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/40">
            {t("nav.workspace")}
          </p>
          <LanguageToggle />
        </div>
      ) : (
        <div className="pt-3 flex justify-center">
          <LanguageToggle iconOnly />
        </div>
      )}
      <nav
        className={cn(
          "flex-1 space-y-0.5 pb-6 overflow-y-auto",
          collapsed ? "px-2" : "px-3",
        )}
      >
        {collapsed
          ? navEntries.map((entry) => {
              if (entry.kind === "leaf") {
                return renderLeaf(entry, { indented: false });
              }
              // Collapsed rail keeps each group as a single icon
              // (Building2 for Housing, Truck for Transportation) with a
              // tooltip showing its label. Clicking the icon expands the
              // rail and opens that group so children are reachable —
              // we reuse the existing rail-expand toggle rather than
              // inventing a flyout primitive.
              const activeChild = entry.children.some((c) => c.href === location);
              const GroupIcon = entry.icon;
              const onClickGroupIcon = () => {
                setGroupOpen((prev) => ({ ...prev, [entry.id]: true }));
                onToggleCollapsed?.();
              };
              return (
                <Tooltip key={entry.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={onClickGroupIcon}
                      aria-label={t(entry.labelKey)}
                      data-testid={`nav-group-${entry.id}`}
                      data-active-child={activeChild ? "true" : "false"}
                      className={cn(
                        "group relative mx-auto flex h-10 w-10 items-center justify-center rounded-md transition-colors",
                        activeChild
                          ? "bg-sidebar-primary/15 text-sidebar-primary-foreground"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <GroupIcon
                        className={cn(
                          "h-[18px] w-[18px] transition-colors",
                          activeChild
                            ? "text-sidebar-primary-foreground"
                            : "text-sidebar-foreground/55 group-hover:text-sidebar-accent-foreground",
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{t(entry.labelKey)}</TooltipContent>
                </Tooltip>
              );
            })
          : navEntries.map((entry) => {
              if (entry.kind === "leaf") {
                return renderLeaf(entry, { indented: false });
              }
              const open = groupOpen[entry.id] ?? entry.defaultOpen;
              const activeChild = entry.children.some((c) => c.href === location);
              const GroupIcon = entry.icon;
              return (
                <Collapsible
                  key={entry.id}
                  open={open}
                  onOpenChange={(o) =>
                    setGroupOpen((prev) => ({ ...prev, [entry.id]: o }))
                  }
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      aria-expanded={open}
                      data-testid={`nav-group-${entry.id}`}
                      data-active-child={activeChild ? "true" : "false"}
                      className={cn(
                        "group relative flex w-full items-center rounded-md px-3 py-2 text-[13.5px] font-medium transition-all duration-150 cursor-pointer",
                        activeChild && !open
                          ? "bg-sidebar-primary/15 text-sidebar-primary-foreground"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      {activeChild && !open && (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-sidebar-primary-foreground/80"
                        />
                      )}
                      <GroupIcon
                        className={cn(
                          "h-[18px] w-[18px] flex-shrink-0 mr-3 transition-colors",
                          activeChild
                            ? "text-sidebar-primary-foreground"
                            : "text-sidebar-foreground/55 group-hover:text-sidebar-accent-foreground",
                        )}
                        aria-hidden="true"
                      />
                      <span className="flex-1 text-left">{t(entry.labelKey)}</span>
                      {open ? (
                        <ChevronDown className="h-4 w-4 text-sidebar-foreground/55" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-sidebar-foreground/55" aria-hidden="true" />
                      )}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent
                    className="ml-3 mt-0.5 space-y-0.5 border-l border-sidebar-border/60 pl-2"
                    data-testid={`nav-group-${entry.id}-children`}
                  >
                    {entry.children.map((child) =>
                      renderLeaf(child, { indented: true }),
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
      </nav>

      <div
        className={cn(
          "border-t border-sidebar-border/70 bg-sidebar-accent/10",
          collapsed ? "p-2 space-y-1 flex flex-col items-center" : "p-4 space-y-1.5",
        )}
      >
        <div
          className={cn(
            "flex items-center mb-3",
            collapsed ? "justify-center" : "px-1",
          )}
        >
          <div
            className={cn(
              "rounded-full bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-semibold shadow-sm ring-2 ring-sidebar-primary-foreground/10",
              collapsed ? "h-8 w-8 text-xs" : "h-9 w-9 text-sm",
            )}
            title={collapsed ? `${t("sidebar.userRoleAdmin")} — admin@housingops.app` : undefined}
          >
            AM
          </div>
          {!collapsed && (
            <div className="ml-3 min-w-0">
              <p className="text-sm font-semibold leading-tight truncate">{t("sidebar.userRoleAdmin")}</p>
              <p className="text-[11px] text-sidebar-foreground/55 truncate">admin@housingops.app</p>
            </div>
          )}
        </div>
        {/* Footer actions (Export data, Import occupants, Reset to sample
            data, Sign out) hidden per user request — kept commented in
            place so they can be flipped back on without re-plumbing.
        {wrapTip(
          t("sidebar.exportData"),
          <Button
            variant="outline"
            size={collapsed ? "icon" : "default"}
            className={cn(
              "text-muted-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed ? "h-9 w-9" : "w-full justify-start",
            )}
            onClick={handleExport}
            aria-label={t("sidebar.exportData")}
            data-testid="button-export-data"
          >
            <Download className={cn("h-4 w-4", !collapsed && "mr-2")} />
            {!collapsed && t("sidebar.exportData")}
          </Button>,
        )}
        {wrapTip(
          t("sidebar.importOccupants", "Import occupants"),
          <ImportOccupantsDialog
            trigger={
              <Button
                variant="outline"
                size={collapsed ? "icon" : "default"}
                className={cn(
                  "text-muted-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  collapsed ? "h-9 w-9" : "w-full justify-start",
                )}
                aria-label={t("sidebar.importOccupants", "Import occupants")}
                data-testid="button-import-occupants"
              >
                <Upload className={cn("h-4 w-4", !collapsed && "mr-2")} />
                {!collapsed && t("sidebar.importOccupants", "Import occupants")}
              </Button>
            }
          />,
        )}
        */}
        {/* Legacy JSON-backup file picker kept mounted but detached
            from the visible button. The handlers (handlePickImportFile,
            handleFileSelected) and import dialog state stay reachable
            for tests and any future restore-flow re-entry, but operators
            now use the Import occupants dialog above for everyday work. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFileSelected}
          data-testid="input-import-file"
        />
        {/* Reset to sample data hidden per user request — see footer
            comment above. Dev-only "Reset demo data" below stays.
        {wrapTip(
          t("sidebar.resetSampleData"),
          <Button
            variant="outline"
            size={collapsed ? "icon" : "default"}
            className={cn(
              "text-muted-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed ? "h-9 w-9" : "w-full justify-start",
            )}
            onClick={() => setResetOpen(true)}
            aria-label={t("sidebar.resetSampleData")}
            data-testid="button-reset-sample-data"
          >
            <RotateCcw className={cn("h-4 w-4", !collapsed && "mr-2")} />
            {!collapsed && t("sidebar.resetSampleData")}
          </Button>,
        )}
        */}
        {isDevBuild ? (
          wrapTip(
            t("sidebar.resetDemoData"),
            <Button
              variant="outline"
              size={collapsed ? "icon" : "default"}
              className={cn(
                "border-amber-300/60 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/40",
                collapsed ? "h-9 w-9" : "w-full justify-start",
              )}
              onClick={() => setDemoResetOpen(true)}
              aria-label={t("sidebar.resetDemoData")}
              data-testid="button-reset-demo-data"
              title={collapsed ? undefined : t("sidebar.resetDemoTooltip")}
            >
              <RotateCcw className={cn("h-4 w-4", !collapsed && "mr-2")} />
              {!collapsed && t("sidebar.resetDemoData")}
            </Button>,
          )
        ) : null}
        {/* Sign out hidden per user request — see footer comment above.
        {wrapTip(
          t("nav.logout"),
          <Button
            variant="outline"
            size={collapsed ? "icon" : "default"}
            className={cn(
              "text-muted-foreground border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed ? "h-9 w-9" : "w-full justify-start",
            )}
            onClick={logout}
            aria-label={t("nav.logout")}
          >
            <LogOut className={cn("h-4 w-4", !collapsed && "mr-2")} />
            {!collapsed && t("nav.logout")}
          </Button>,
        )}
        */}
        {/* Collapse the rail — lives at the bottom, out of the logo area. */}
        {!collapsed && onToggleCollapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={t("nav.collapseSidebar")}
            className="mt-1 flex w-full items-center justify-start gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
            data-testid="button-sidebar-toggle"
          >
            <PanelLeftClose className="h-4 w-4" />
            {t("nav.collapseSidebar")}
          </button>
        ) : null}
      </div>

      <AlertDialog open={demoResetOpen} onOpenChange={setDemoResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sidebar.resetDemoConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sidebar.resetDemoConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-reset-demo-cancel">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDemoReset}
              data-testid="button-reset-demo-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("sidebar.resetDemoData")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sidebar.resetDataConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sidebar.resetDataConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-reset-cancel">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmReset}
              data-testid="button-reset-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("sidebar.resetData")}
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
                ? t("sidebar.importTitleMerge")
                : pendingImport?.preview.migratedFromV1
                  ? t("sidebar.importTitleLegacy")
                  : t("sidebar.importTitleReplace")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {t("sidebar.importingFilePrefix")}
                  <span className="font-medium">{pendingImport?.fileName ?? t("sidebar.importingThisFile")}</span>
                  {t("sidebar.importingFileSuffix")}
                </p>
                {pendingImport ? (
                  <ImportSummaryList summary={pendingImport.preview.summary} />
                ) : null}
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
                        {t("sidebar.importModeReplaceLabel")}
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {t("sidebar.importModeReplaceDescription")}
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
                        {t("sidebar.importModeMergeLabel")}
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {t("sidebar.importModeMergeDescription")}
                      </p>
                    </div>
                  </div>
                </RadioGroup>
                {importMode === "replace" ? (
                  <p className="text-sm text-muted-foreground">
                    {t("sidebar.importReplaceWarning")}
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
                    {t("sidebar.importLegacyNote", { count: pendingImport.preview.summary.properties })}
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-import-cancel" onClick={handleCancelImport}>
              {t("common.cancel")}
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
                ? t("sidebar.importMergeButton")
                : pendingImport?.preview.migratedFromV1
                  ? t("sidebar.importMigrateButton")
                  : t("sidebar.importReplaceButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const IMPORT_SUMMARY_TYPES: Array<{ key: keyof ImportSummary; labelKey: string }> = [
  { key: "customers", labelKey: "sidebar.summaryCustomers" },
  { key: "properties", labelKey: "sidebar.summaryProperties" },
  { key: "leases", labelKey: "sidebar.summaryLeases" },
  { key: "rooms", labelKey: "sidebar.summaryRooms" },
  { key: "beds", labelKey: "sidebar.summaryBeds" },
  { key: "occupants", labelKey: "sidebar.summaryOccupants" },
  { key: "utilities", labelKey: "sidebar.summaryUtilities" },
  { key: "roomNightLogs", labelKey: "sidebar.summaryRoomNightLogs" },
];

/**
 * Renders the per-type record counts in the file the operator picked,
 * so they can sanity-check the bundle before choosing replace vs merge.
 * Shown for both modes — the merge dry-run below it adds the
 * added/updated/unchanged breakdown on top.
 */
function ImportSummaryList({ summary }: { summary: ImportSummary }) {
  const { t } = useTranslation();
  return (
    <div
      className="rounded-md border border-border bg-muted/40 p-3 space-y-1"
      data-testid="import-preview-summary"
    >
      <p className="text-sm font-medium">{t("sidebar.summaryTitle")}</p>
      <ul className="text-sm text-muted-foreground space-y-0.5">
        {IMPORT_SUMMARY_TYPES.map(({ key, labelKey }) => (
          <li
            key={key}
            className="flex justify-between gap-2 tabular-nums"
            data-testid={`import-preview-summary-row-${key}`}
          >
            <span>{t(labelKey)}</span>
            <span>{summary[key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MERGE_PREVIEW_TYPES: Array<{ key: keyof MergeDryRun; labelKey: string }> = [
  { key: "customers", labelKey: "sidebar.summaryCustomers" },
  { key: "properties", labelKey: "sidebar.summaryProperties" },
  { key: "leases", labelKey: "sidebar.summaryLeases" },
  { key: "rooms", labelKey: "sidebar.summaryRooms" },
  { key: "beds", labelKey: "sidebar.summaryBeds" },
  { key: "occupants", labelKey: "sidebar.summaryOccupants" },
  { key: "utilities", labelKey: "sidebar.summaryUtilities" },
  { key: "roomNightLogs", labelKey: "sidebar.summaryRoomNightLogs" },
];

/**
 * Renders the per-type breakdown of a merge dry-run (added / updated /
 * unchanged) plus a collapsible list of the rows that would be overwritten.
 * Lets operators spot accidental overwrites BEFORE confirming the merge.
 */
function MergePreview({ dryRun }: { dryRun: MergeDryRun }) {
  const { t } = useTranslation();
  const totals = totalMergeDryRun(dryRun);
  const hasAnyUpdate = MERGE_PREVIEW_TYPES.some(
    (m) => dryRun[m.key].updatedItems.length > 0,
  );
  return (
    <div
      className="rounded-md border border-border bg-muted/40 p-3 space-y-2"
      data-testid="merge-import-preview"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t("sidebar.mergePreviewTitle")}</p>
        <p className="text-xs text-muted-foreground tabular-nums" data-testid="merge-import-preview-totals">
          {t("sidebar.mergePreviewTotals", { added: totals.added, updated: totals.updated, unchanged: totals.unchanged })}
        </p>
      </div>
      <ul className="text-sm text-muted-foreground space-y-0.5">
        {MERGE_PREVIEW_TYPES.map(({ key, labelKey }) => {
          const cat = dryRun[key];
          if (cat.added === 0 && cat.updated === 0 && cat.unchanged === 0) {
            return null;
          }
          return (
            <li key={key} className="flex justify-between gap-2 tabular-nums" data-testid={`merge-preview-row-${key}`}>
              <span>{t(labelKey)}</span>
              <span>
                <span className="text-emerald-700 dark:text-emerald-400">{t("sidebar.mergeAdded", { count: cat.added })}</span>
                {", "}
                <span className={cn(cat.updated > 0 && "text-amber-700 dark:text-amber-400 font-medium")}>
                  {t("sidebar.mergeUpdated", { count: cat.updated })}
                </span>
                {", "}
                <span>{t("sidebar.mergeUnchanged", { count: cat.unchanged })}</span>
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
            {t("sidebar.mergeOverwritesToggle", { count: totals.updated })}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="mb-1">
                {t("sidebar.mergeOverwritesWarning")}
              </p>
              <ul className="space-y-1">
                {MERGE_PREVIEW_TYPES.map(({ key, labelKey }) => (
                  <MergeOverwriteList key={key} label={t(labelKey)} category={dryRun[key]} typeKey={key} />
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
