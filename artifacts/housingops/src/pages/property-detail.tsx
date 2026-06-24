import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link, useLocation, useSearch } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WhyPopover } from "@/components/kit-v2";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { BedBoardV2 } from "@/components/bed-board/bed-board-v2";
import { BOARD_VIEW_ENABLED } from "@/lib/flags";
import { LayoutDashboard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft, ChevronDown, ChevronUp, Building2, Edit2, Check, X, Plus, Trash2,
  BedDouble, Users, Zap, DollarSign, KeyRound, CreditCard, Hotel,
  Home, Phone, Mail, Globe, Calendar, TrendingUp, TrendingDown, AlertTriangle, CalendarPlus,
  Sofa, Refrigerator, Utensils, Bath, WashingMachine, Thermometer, Tv,
  ShieldCheck, Trees, Sparkles, CheckCircle2, Star, Briefcase,
  Cigarette, Car, Volume2, Siren, Wrench, Sparkle, MoreHorizontal,
  ShieldAlert, ArrowRightLeft, Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Lease, Property, Room, Bed, Occupant, Utility, InsuranceCertificate, OtherCost, PropertyViolation, PropertyViolationCategory, PROPERTY_VIOLATION_CATEGORIES, PROPERTY_VIOLATION_CATEGORY_LABELS, UTILITY_TYPES, BILLING_FREQUENCIES, PROPERTY_TYPE_OPTIONS, type PropertyType, toMonthlyCharge, toWeeklyCharge, formatUsd, formatUsdWhole, getRenewalInfo, FURNISHING_CATEGORIES, ALL_FURNISHINGS_COUNT, type FurnishingCategory, RATING_CATEGORIES, EMPTY_RATINGS, computeOverallRating, computeRoomTotals, computePricePerSqft, computeRentPerBed, computeElectricPerBed, computeRentPlusElectricPerBed, getActiveLeasesForProperty, sortLeases, estimateLeaseMonthlyRent, getLatestRoomNightLog, sumActiveRentEstimated, sumOtherCostsForProperty, daysUntil, type Ratings, type RentFrequency, type BillingFrequency } from "@/data/mockData";
import { formatYMDPretty, isBlankYMD } from "@/lib/lease-dates";
import {
  useListRoomNightLogs,
  useListPropertyViolations,
  useCreatePropertyViolation,
  useDeletePropertyViolation,
  getListPropertyViolationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { RoomInUseError } from "@/context/data-store";
import { motion } from "framer-motion";
import { RenewLeasePopover } from "@/components/renew-lease-popover";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { StarRating } from "@/components/star-rating";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { LeasesTable } from "@/components/leases-table";
import { BuildingPicker } from "@/components/building-picker";
import { AddBuildingDialog } from "@/components/add-building-dialog";
import { UploadLeasePdfDialog, LeasePdfDropzone } from "@/components/upload-lease-pdf-dialog";
import { EmptyState, EmptyStateRow } from "@/components/empty-state";
import { PropertyLocationMap } from "@/components/property-location-map";
import { PropertyFinanceMiniChart } from "@/components/property-finance-mini-chart";
import { NotFoundScreen } from "@/components/not-found-screen";
import { AssignOccupantDialog } from "@/components/assign-occupant-dialog";
import { MoveOccupantDialog } from "@/components/move-occupant-dialog";
import { computeShiftPairs, roomHasAnyShift, pairStatusLabel } from "@/lib/shift-pairs";
import { ShiftPicker } from "@/components/shift-picker";
import { PendingPlacementBoard } from "@/components/pending-placement-board";
import { ProjectedMoveInsSection } from "@/components/projected-move-ins-section";
import { PropertyBedTable } from "@/components/bed-grid";
import { isPendingPlacementProperty } from "@/lib/pending-placement";
import { useUpload } from "@workspace/object-storage-web";
import { Upload, FileText, Loader2 } from "lucide-react";
import { extractSourcePdfFilename, sourcePdfHref } from "@/lib/lease-source-pdf";

const RENT_FREQUENCIES: readonly RentFrequency[] = ["Weekly", "Bi-Weekly", "Monthly"] as const;
const RENT_FREQUENCY_FACTOR: Record<RentFrequency, number> = {
  Weekly: 12 / 52,
  "Bi-Weekly": 12 / 26,
  Monthly: 1,
};

const FURNISHING_ICONS: Record<string, LucideIcon> = {
  BedDouble, Sofa, Refrigerator, Utensils, Bath, WashingMachine,
  Thermometer, Tv, ShieldCheck, Trees, Building2, Sparkles,
};

// Sort options for the per-room cards on the Beds tab. "default" preserves
// the natural (creation/seed) order so users can opt out of sorting.
type BedsSortKey =
  | "default"
  | "ppsf-desc"
  | "ppsf-asc"
  | "rent-desc"
  | "rent-asc"
  | "sqft-desc"
  | "sqft-asc";

const BEDS_SORT_OPTIONS: { value: BedsSortKey; labelKey: string }[] = [
  { value: "default",   labelKey: "pages.propertyDetail.bedsSort.default" },
  { value: "ppsf-desc", labelKey: "pages.propertyDetail.bedsSort.ppsfDesc" },
  { value: "ppsf-asc",  labelKey: "pages.propertyDetail.bedsSort.ppsfAsc" },
  { value: "rent-desc", labelKey: "pages.propertyDetail.bedsSort.rentDesc" },
  { value: "rent-asc",  labelKey: "pages.propertyDetail.bedsSort.rentAsc" },
  { value: "sqft-desc", labelKey: "pages.propertyDetail.bedsSort.sqftDesc" },
  { value: "sqft-asc",  labelKey: "pages.propertyDetail.bedsSort.sqftAsc" },
];

const VALID_BEDS_SORT_KEYS = new Set<BedsSortKey>(
  BEDS_SORT_OPTIONS.map((o) => o.value),
);

// Persist the user's last Beds-tab sort choice across refreshes and across
// navigation between properties — same approach the Properties list uses
// for its own toolbar prefs (see PROPERTIES_PREFS_STORAGE_KEY there).
const BEDS_SORT_STORAGE_KEY = "housingops:property-beds:sort";

function readPersistedBedsSort(): BedsSortKey {
  if (typeof window === "undefined") return "default";
  try {
    const raw = window.localStorage.getItem(BEDS_SORT_STORAGE_KEY);
    if (raw && VALID_BEDS_SORT_KEYS.has(raw as BedsSortKey)) {
      return raw as BedsSortKey;
    }
    return "default";
  } catch {
    return "default";
  }
}

function writePersistedBedsSort(sort: BedsSortKey): void {
  if (typeof window === "undefined") return;
  try {
    if (sort === "default") {
      // Drop the key entirely once the user is back to the default so
      // storage doesn't accumulate stale state.
      window.localStorage.removeItem(BEDS_SORT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(BEDS_SORT_STORAGE_KEY, sort);
    }
  } catch {
    // Quota / disabled storage / private mode — silently ignore;
    // this is a UX nicety, not a correctness requirement.
  }
}

// Persist whether the property header's stat-card row is expanded (10 cards)
// or collapsed to a single condensed summary line. Power users who already
// know a property tend to scroll past the row to get to beds/leases, so this
// lets them keep the chrome small while preserving the at-a-glance view for
// everyone else (task #484).
const STATS_EXPANDED_STORAGE_KEY = "housingops:property-stats:expanded";

function readPersistedStatsExpanded(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(STATS_EXPANDED_STORAGE_KEY);
    if (raw === "0") return false;
    return true;
  } catch {
    return true;
  }
}

function writePersistedStatsExpanded(expanded: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (expanded) {
      // Expanded is the default — drop the key so storage doesn't accumulate
      // stale state.
      window.localStorage.removeItem(STATS_EXPANDED_STORAGE_KEY);
    } else {
      window.localStorage.setItem(STATS_EXPANDED_STORAGE_KEY, "0");
    }
  } catch {
    // Quota / disabled storage / private mode — silently ignore.
  }
}

// Per-property persistence for the Leases / Units tab building filters
// (Task #592). Operators on multi-building properties used to lose their
// pick every time they navigated away — refresh, drill into a lease, or
// flip tabs and the dropdown reset to "All buildings". We store the
// selection per property (keyed by propertyId in a JSON map) so each
// property remembers its own focus, mirroring the localStorage pattern
// used for BEDS_SORT_STORAGE_KEY / STATS_EXPANDED_STORAGE_KEY above.
//
// Map shape: `{ [propertyId: string]: buildingId }`. "all" is the
// default and is stored as the absence of an entry — selecting
// "All buildings" deletes the key so storage doesn't accumulate stale
// entries (and so single-building properties never write at all).
const LEASES_BUILDING_STORAGE_KEY = "housingops:property-leases:building";
const UNITS_BUILDING_STORAGE_KEY = "housingops:property-units:building";

function readBuildingFilterMap(storageKey: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && v.length > 0) out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function readPersistedBuildingFilter(storageKey: string, propertyId: string | undefined): string {
  if (!propertyId) return "all";
  const map = readBuildingFilterMap(storageKey);
  return map[propertyId] ?? "all";
}

function writePersistedBuildingFilter(storageKey: string, propertyId: string | undefined, value: string): void {
  if (typeof window === "undefined" || !propertyId) return;
  try {
    const map = readBuildingFilterMap(storageKey);
    if (value === "all") {
      if (!(propertyId in map)) return;
      delete map[propertyId];
    } else {
      if (map[propertyId] === value) return;
      map[propertyId] = value;
    }
    if (Object.keys(map).length === 0) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, JSON.stringify(map));
    }
  } catch {
    // Quota / disabled storage / private mode — silently ignore;
    // this is a UX nicety, not a correctness requirement.
  }
}

// Shift coverage for hot-bedded rooms (task #337). For Patriot/Baraboo-style
// units, slots 1+2 share Bedroom A and slots 3+4 share Bedroom B (see
// seed-patriot-baraboo.ts). We pair beds by consecutive bedNumber so the same
// logic generalises to any room with an even number of beds — pair (1,2) is
// "Bedroom A", (3,4) is "Bedroom B", (5,6) is "Bedroom C", and so on. This is
// purely a UI grouping; it does not change the underlying schema.
//
// Coverage mode is opt-in: if no occupant in the room has a shift set, we skip
// the badges entirely so non-hot-bedded properties look unchanged.
//
// `computeShiftPairs` and `roomHasAnyShift` live in `@/lib/shift-pairs` so
// they can be reused by the dashboard shift-gap card (task #388).
// Re-export the type locally for convenience inside this file.
export type { PairCoverage } from "@/lib/shift-pairs";

const TYPE_COLORS: Record<string, string> = {
  Electric: "bg-yellow-100 text-yellow-800",
  Gas:      "bg-orange-100 text-orange-800",
  Propane:  "bg-amber-100 text-amber-800",
  Water:    "bg-blue-100 text-blue-800",
  Garbage:  "bg-slate-100 text-slate-700",
  Internet: "bg-purple-100 text-purple-800",
  Other:    "bg-gray-100 text-gray-700",
};

/** Consolidated Fix §0: the "why" payload for a self-explaining KPI. */
type StatWhy = {
  title?: string;
  formula?: string;
  rows?: { k: string; v: string | number }[];
  href?: string;
};

function StatCard({ label, value, sub, icon: Icon, color = "text-ink", testId, onClick, why }: { label: string; value: string | number; sub?: React.ReactNode; icon?: React.ElementType; color?: string; testId?: string; onClick?: () => void; why?: StatWhy }) {
  const clickable = !!onClick;
  // When a KPI has a "why", clicking the dotted value opens the popover — keep
  // that from also firing the card's scroll-to-section onClick.
  const valueEl = why ? (
    <span onClick={(e) => e.stopPropagation()}>
      <WhyPopover title={why.title ?? label} formula={why.formula} rows={why.rows} href={why.href}>
        {value}
      </WhyPopover>
    </span>
  ) : (
    value
  );
  return (
    <div
      data-testid={testId}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick!(); } } : undefined}
      className={`rounded-2xl border border-line bg-panel p-3.5 shadow-sm transition-all ${clickable ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50" : ""}`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold text-faint uppercase tracking-wide leading-tight">{label}</p>
          <p className={`text-[22px] font-extrabold mt-1 leading-tight tabular-nums whitespace-nowrap ${color}`}>{valueEl}</p>
        </div>
        {Icon && <div className="p-1.5 rounded-xl bg-[hsl(var(--chip))] shrink-0"><Icon className="h-3.5 w-3.5 text-brand" /></div>}
      </div>
      {sub && <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">{sub}</p>}
    </div>
  );
}

// Smooth-scroll to an on-page section by id (used by the clickable stat
// cards to jump to the relevant detail).
function scrollToSection(sectionId: string) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(sectionId);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function BedMap({ beds, occupants, rooms, propertyId, onAddBed, onDeleteBed, onBedClick, onAssignOccupant, onVacateBed }: {
  beds: Bed[];
  occupants: Occupant[];
  rooms: Room[];
  propertyId: string;
  onAddBed: (bed: Bed) => void;
  onDeleteBed: (id: string) => void;
  onBedClick?: (bedId: string) => void;
  onAssignOccupant?: (occupant: Occupant, bed: { id: string; propertyId: string }) => void;
  /** Move the occupant out of this bed (frees the bed + marks them Former). */
  onVacateBed?: (bed: Bed) => void;
}) {
  const { t } = useTranslation();
  const occupied = beds.filter(b => b.status === "Occupied").length;
  const pct = beds.length > 0 ? Math.round((occupied / beds.length) * 100) : 0;
  const roomNameById = new Map(rooms.map(r => [r.id, r.name] as const));

  // Default new beds into the first room of the property. The "+" control is
  // disabled below if the property has no rooms yet so we always have a valid
  // FK when the user clicks it.
  const defaultRoomId = rooms[0]?.id ?? "";

  const addBed = () => {
    if (!defaultRoomId) return;
    const nextNum = beds.length > 0 ? Math.max(...beds.map(b => b.bedNumber)) + 1 : 1;
    onAddBed({ id: `bed-${Date.now()}`, propertyId, bedNumber: nextNum, roomId: defaultRoomId, status: "Vacant", occupantId: null });
  };

  const removeBed = () => {
    const vacants = beds.filter(b => b.status === "Vacant").sort((a, b) => b.bedNumber - a.bedNumber);
    if (vacants.length > 0) onDeleteBed(vacants[0].id);
  };

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BedDouble className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">{t("pages.propertyDetail.bedOccupancy")}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500 inline-block" />{t("pages.propertyDetail.bedOccupiedCount", { count: occupied })}</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-400 inline-block" />{t("pages.propertyDetail.bedVacantCount", { count: beds.length - occupied })}</span>
              {beds.length > 0 && <span className="font-medium text-foreground">{t("pages.propertyDetail.pctFull", { pct })}</span>}
            </div>
            <div className="flex items-center gap-1 border rounded-lg p-0.5">
              <Button
                size="icon" variant="ghost"
                className="h-6 w-6 rounded-md text-muted-foreground hover:text-destructive"
                onClick={removeBed}
                disabled={beds.filter(b => b.status === "Vacant").length === 0}
              >
                <span className="text-base leading-none font-bold">−</span>
              </Button>
              <span className="text-xs font-semibold w-8 text-center tabular-nums">{t("pages.propertyDetail.bedsCount", { count: beds.length })}</span>
              <Button
                size="icon" variant="ghost"
                className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
                onClick={addBed}
                disabled={!defaultRoomId}
                title={defaultRoomId ? t("pages.propertyDetail.addBed") : t("pages.propertyDetail.addRoomFirst")}
              >
                <span className="text-base leading-none font-bold">+</span>
              </Button>
            </div>
          </div>
        </div>
        {(() => {
          // Group beds by room so the tile numbers have visible context
          // (a flat strip of 1/2/3… reads as noise — the user just sees
          // numbers with no anchor). Rooms with no beds are skipped, and
          // any orphaned beds (room missing from the rooms list) fall
          // into a final "Other" group so nothing silently disappears.
          const roomOrder = rooms.map(r => r.id);
          const bedsByRoom = new Map<string, typeof beds>();
          for (const bed of beds) {
            const key = roomNameById.has(bed.roomId) ? bed.roomId : "__orphan";
            const arr = bedsByRoom.get(key) ?? [];
            arr.push(bed);
            bedsByRoom.set(key, arr);
          }
          const orderedKeys = [
            ...roomOrder.filter(id => bedsByRoom.has(id)),
            ...(bedsByRoom.has("__orphan") ? ["__orphan"] : []),
          ];
          return (
            <div className="flex flex-wrap gap-x-6 gap-y-4">
              {orderedKeys.map(roomKey => {
                const roomBeds = (bedsByRoom.get(roomKey) ?? []).sort(
                  (a, b) => a.bedNumber - b.bedNumber,
                );
                const label = roomKey === "__orphan"
                  ? t("pages.propertyDetail.bedsWithoutRoom", { defaultValue: "No room" })
                  : roomNameById.get(roomKey) ?? "";
                return (
                  <div key={roomKey} className="flex flex-col gap-1 min-w-0">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium truncate" title={label}>
                      {label}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {roomBeds.map(bed => {
                        const occ = bed.occupantId ? occupants.find(o => o.id === bed.occupantId) : null;
                        // Occupied bed: a readable name chip. The name is plain
                        // selectable text (NOT an edit trigger); moving someone
                        // out is an explicit ✕ that frees the bed.
                        if (bed.status === "Occupied" && occ) {
                          return (
                            <div
                              key={bed.id}
                              data-testid={`bedmap-tile-${bed.id}`}
                              className="group flex items-center gap-2 rounded-md border border-border bg-background pl-2 pr-1 py-1 min-w-[150px] max-w-[210px]"
                            >
                              <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
                              <span className="flex flex-col min-w-0 leading-tight">
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  {`Bed ${bed.bedNumber}`}
                                </span>
                                <span className="text-xs font-medium truncate" title={occ.name}>{occ.name}</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => onVacateBed?.(bed)}
                                title={`Move ${occ.name} out`}
                                aria-label={t("pages.propertyDetail.bedAriaLabelOccupied", { number: bed.bedNumber, name: occ.name })}
                                className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-destructive transition-opacity focus:outline-none"
                                data-testid={`bedmap-vacate-${bed.id}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        }
                        // Vacant bed: click to assign. A bed mid-turnover
                        // (needs_cleaning / in_progress) isn't assignable yet.
                        const ready = bed.cleaningStatus === "ready";
                        const vacantChip = (
                          <button
                            type="button"
                            data-testid={`bedmap-tile-${bed.id}`}
                            aria-label={t("pages.propertyDetail.bedAriaLabelVacant", { number: bed.bedNumber })}
                            className="flex items-center gap-1.5 rounded-md border border-dashed border-border/70 bg-muted/30 px-2 py-1 min-w-[150px] text-xs text-muted-foreground hover:bg-muted/60 hover:text-primary focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
                          >
                            <span className="text-[10px] tabular-nums">
                              {`Bed ${bed.bedNumber}`}
                            </span>
                            {ready ? (
                              <span className="ml-auto inline-flex items-center gap-0.5"><Plus className="h-3 w-3" />{t("dialogs.assignOccupant.triggerDefault", { defaultValue: "Assign" })}</span>
                            ) : (
                              <span className="ml-auto text-amber-600">🧹</span>
                            )}
                          </button>
                        );
                        return ready && onAssignOccupant ? (
                          <AssignOccupantDialog
                            key={bed.id}
                            bed={{ id: bed.id, propertyId }}
                            onAssign={onAssignOccupant}
                            onDeleteBed={onDeleteBed}
                            trigger={vacantChip}
                          />
                        ) : (
                          <span key={bed.id} onClick={() => onBedClick?.(bed.id)}>{vacantChip}</span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}

function RatingsCard({ ratings, onChange }: { ratings: Ratings | undefined; onChange: (next: Ratings) => void }) {
  const { t } = useTranslation();
  const current: Ratings = ratings ?? EMPTY_RATINGS;
  const overall = computeOverallRating(current);
  const ratedCount = RATING_CATEGORIES.filter(c => current[c.key] > 0).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Star className="h-4 w-4" />{t("pages.propertyDetail.ratingsTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Overall summary */}
        <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3" data-testid="ratings-overall">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("pages.propertyDetail.ratingsOverall")}</p>
            {overall === null ? (
              <p className="text-sm text-muted-foreground mt-1">{t("pages.propertyDetail.ratingsNoneYet")}</p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("pages.propertyDetail.ratingsAverageOf", { count: ratedCount })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <StarRating value={overall ?? 0} readOnly size="md" ariaLabel={t("pages.propertyDetail.ratingsOverallAria")} />
            <span className="text-base font-semibold tabular-nums w-16 text-right" data-testid="ratings-overall-value">
              {overall === null ? "— / 5" : `${overall.toFixed(1)} / 5`}
            </span>
          </div>
        </div>

        {/* Categories */}
        <div className="space-y-2">
          {RATING_CATEGORIES.map(({ key }) => (
            <div key={key} className="flex items-center justify-between py-1 border-b border-dashed border-border/50 last:border-0">
              <span className="text-sm text-muted-foreground">{t(`pages.propertyDetail.ratingsCategoryLabels.${key}`)}</span>
              <StarRating
                value={current[key]}
                size="md"
                ariaLabel={t("pages.propertyDetail.ratingsCategoryAria", { label: t(`pages.propertyDetail.ratingsCategoryLabels.${key}`) })}
                testId={`rating-${key}`}
                onChange={(v) => onChange({ ...current, [key]: v })}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function NotesEditor({ value, onSave, className }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  const lastIncomingRef = useRef(value);
  // Latest draft + value + onSave kept on refs so the unmount cleanup can
  // flush an in-progress edit without re-binding the effect (and re-firing
  // the cleanup) on every keystroke.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const valueRef = useRef(value);
  valueRef.current = value;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Whenever the persisted value changes from outside (e.g. an optimistic
  // patch settles, or a save fails and the data store reverts), pull the new
  // value into the local draft. This makes the textarea visibly snap back to
  // the server-confirmed value after a failed save. On a successful save the
  // incoming value matches the draft, so this is a no-op (no flicker).
  useEffect(() => {
    if (value === lastIncomingRef.current) return;
    lastIncomingRef.current = value;
    setDraft(value);
  }, [value]);

  // Notes draft protection (task #76): operators frequently start typing in
  // a Notes textarea and then click a sidebar link or back button before
  // blurring the field, which dropped the in-progress text on the floor.
  // Two safety nets:
  //
  //   1. On unmount, if the local draft hasn't been saved yet, flush it
  //      through onSave so the optimistic update + API call still fire.
  //      Covers in-app navigation away from the page mid-edit.
  //   2. On `beforeunload`, set returnValue while the draft is dirty so the
  //      browser shows its native "Leave site?" prompt. Covers tab close,
  //      hard refresh, and cross-origin nav, where the unmount flush above
  //      can't help because the page is being torn down before React runs
  //      cleanup synchronously enough for an in-flight POST to complete.
  // Track the most recent draft we've already pushed through onSave (via
  // blur or a previous unmount flush), so the unmount safety net doesn't
  // re-fire an identical save when an in-flight blur PATCH hasn't yet
  // round-tripped to update `value`.
  const lastSavedDraftRef = useRef<string | null>(null);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (draftRef.current === valueRef.current) return;
      if (draftRef.current === lastSavedDraftRef.current) return;
      e.preventDefault();
      e.returnValue = "You have unsaved notes — discard?";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (
        draftRef.current !== valueRef.current &&
        draftRef.current !== lastSavedDraftRef.current
      ) {
        lastSavedDraftRef.current = draftRef.current;
        onSaveRef.current(draftRef.current);
      }
    };
  }, []);

  return (
    <Textarea
      value={draft}
      className={className}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value && draft !== lastSavedDraftRef.current) {
          lastSavedDraftRef.current = draft;
          onSave(draft);
        }
      }}
    />
  );
}

/**
 * Compact inline editor for an occupant's `responsibilities` list
 * (task #500). Renders the current entries as small removable chips
 * and exposes a tiny "+ add" affordance that flips into a one-line
 * input. Stays out of a separate drawer so operators can edit per
 * item without leaving the beds-tab table — the chips wrap inside
 * the occupant's name cell beneath the lead/keys badges.
 */
function ResponsibilitiesEditor({
  occupantId,
  values,
  onChange,
}: {
  occupantId: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setAdding(false);
      setDraft("");
      return;
    }
    onChange([...(values ?? []), trimmed]);
    setDraft("");
    setAdding(false);
  };
  const remove = (idx: number) => {
    const next = (values ?? []).filter((_, i) => i !== idx);
    onChange(next);
  };
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      data-testid={`responsibilities-${occupantId}`}
    >
      {(values ?? []).map((item, idx) => (
        <Badge
          key={`${item}-${idx}`}
          variant="secondary"
          className="h-5 px-1.5 text-[10px] font-normal gap-1 bg-slate-100 text-slate-700 border-slate-200"
          data-testid={`responsibility-${occupantId}-${idx}`}
        >
          <span>{item}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => remove(idx)}
            data-testid={`responsibility-remove-${occupantId}-${idx}`}
            title={t("pages.propertyDetail.responsibilities.removeTitle")}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </Badge>
      ))}
      {adding ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft("");
              setAdding(false);
            }
          }}
          placeholder={t("pages.propertyDetail.responsibilities.placeholder")}
          className="h-6 text-[11px] py-0 w-56"
          data-testid={`responsibility-input-${occupantId}`}
        />
      ) : (
        <button
          type="button"
          className={`text-[10px] text-muted-foreground hover:text-foreground italic flex items-center gap-0.5 ${(values ?? []).length === 0 ? "opacity-0 group-hover/occ:opacity-100 transition-opacity" : ""}`}
          onClick={() => setAdding(true)}
          data-testid={`responsibility-add-${occupantId}`}
        >
          <Plus className="h-2.5 w-2.5" />
          {(values ?? []).length === 0 ? "Add responsibility" : "Add"}
        </button>
      )}
    </div>
  );
}

export function InlineEdit({
  value, onSave, type = "text", prefix,
  placeholder, displayClassName, inputClassName, testId, displayValue,
  startEditing = false,
}: {
  value: string | number;
  onSave: (v: string) => void;
  type?: string;
  prefix?: string;
  placeholder?: string;
  displayClassName?: string;
  inputClassName?: string;
  testId?: string;
  /**
   * Optional override for the collapsed (non-editing) display only — the
   * editor still operates on `value`. Used when the column wants to show a
   * derived label (e.g. customer prefix stripped) while preserving the
   * underlying stored value for editing and persistence.
   */
  displayValue?: string;
  /**
   * When true on first mount, open the editor immediately so the input is
   * focused. Used by the lease detail "Fix" deep-link (`?focus=rent`) to
   * land the operator straight on the rent field. Has no effect after the
   * first render — operators can still cancel or commit normally.
   */
  startEditing?: boolean;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(String(value));
  const lastIncomingRef = useRef(String(value));
  // Track the previous saved value so we can offer an "undo" affordance
  // for ~8s after every commit. The undo button calls onSave again with
  // the previous value, which flows through the same persistence path
  // (optimistic update + rollback on failure) so there's nothing special
  // to wire up in callers.
  const [undoableFrom, setUndoableFrom] = useState<string | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  // Resync the local draft whenever the persisted value changes from the
  // outside — e.g. an optimistic patch settles, or a save fails and the data
  // store reverts. Without this, after a failed save the field would still
  // display the typed value the next time the user opened the editor (the
  // collapsed view already reads from `value`, so it reverts on its own).
  // On a successful save the incoming value matches the draft, so this is a
  // no-op and there is no flicker mid-save.
  useEffect(() => {
    const incoming = String(value);
    if (incoming === lastIncomingRef.current) return;
    lastIncomingRef.current = incoming;
    setDraft(incoming);
  }, [value]);

  const startUndoWindow = (previous: string) => {
    setUndoableFrom(previous);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoableFrom(null), 8000);
  };

  const commit = () => {
    const previous = String(value);
    if (draft !== previous) {
      onSave(draft);
      startUndoWindow(previous);
    }
    setEditing(false);
  };
  const cancel = () => { setDraft(String(value)); setEditing(false); };
  const undo = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (undoableFrom === null) return;
    const previous = undoableFrom;
    onSave(previous);
    setDraft(previous);
    setUndoableFrom(null);
    if (undoTimerRef.current) { clearTimeout(undoTimerRef.current); undoTimerRef.current = null; }
  };

  if (!editing) {
    const isEmpty = String(value).length === 0;
    return (
      // role="button" so callers wrapping the InlineEdit in a clickable
      // row (see leases-table) can treat it as an interactive element and
      // bail out of row-level navigation when the operator clicks here to
      // edit. Without this the parent row's onClick would steal the click
      // and navigate away instead of opening the editor.
      <span
        role="button"
        tabIndex={0}
        className="group flex items-center gap-1 cursor-pointer"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        data-testid={testId}
      >
        {isEmpty && placeholder ? (
          <span className={`text-sm text-muted-foreground italic ${displayClassName ?? ""}`}>
            {placeholder}
          </span>
        ) : (
          <span className={`text-sm ${displayClassName ?? ""}`}>{prefix}{displayValue ?? value}</span>
        )}
        <Edit2 className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        {undoableFrom !== null && (
          <button
            type="button"
            onClick={undo}
            title={`Undo (revert to ${undoableFrom || "previous value"})`}
            aria-label="Undo last change"
            data-testid={testId ? `${testId}-undo` : undefined}
            className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <Undo2 className="h-3 w-3" />
          </button>
        )}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Input
        type={type}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder={placeholder}
        className={`h-7 text-sm py-0 ${inputClassName ?? "w-36"}`}
        autoFocus
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
        data-testid={testId ? `${testId}-input` : undefined}
      />
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); commit(); }} data-testid={testId ? `${testId}-save` : undefined}><Check className="h-3 w-3 text-green-600" /></Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); cancel(); }} data-testid={testId ? `${testId}-cancel` : undefined}><X className="h-3 w-3 text-destructive" /></Button>
    </div>
  );
}

export default function PropertyDetail() {
  const { t } = useTranslation();
  // Task #570: the route also matches /properties/:id/buildings/:buildingId
  // for drill-downs into a single building. When `buildingId` is present
  // we filter rooms / beds / leases to that building so operators can
  // focus on one unit of a multi-building property.
  const { id, buildingId: focusedBuildingId } = useParams<{ id: string; buildingId?: string }>();
  const [, navigate] = useLocation();
  const { properties, leases, rooms, beds, occupants, utilities, otherCosts, insuranceCertificates, customers, buildings, isLoading, dataIssues, updateProperty, updateLease, addLease, deleteLease, addRoom, updateRoom, deleteRoom, addBed, deleteBed, updateBed, updateOccupant, addOccupant, deleteOccupant, updateUtility, addUtility, deleteUtility, addOtherCost, updateOtherCost, deleteOtherCost, addInsuranceCertificate, updateInsuranceCertificate, deleteInsuranceCertificate, addBuilding, updateBuilding, deleteBuilding } = useData();
  // Room-night logs back the hotel-rate revenue estimate ("≈ $X this
  // month (Y nights × $Z/night)") shown for hotel-rate leases. Pulled
  // here so the Stat strip and the Finance tab share the same numbers.
  const roomNightLogsQuery = useListRoomNightLogs();
  const roomNightLogs = roomNightLogsQuery.data ?? [];
  const { toast } = useToast();

  // Property violations are scoped per-property (Task #499). The
  // /properties/:id/violations endpoint returns just this property's
  // rows, so unlike the global lists in the data-store we fetch
  // straight from the orval hook here. Optimistic add/delete write
  // through the same query key so the Violations tab renders the new
  // row immediately without waiting for a refetch.
  const violationsKey = useMemo(
    () => getListPropertyViolationsQueryKey(id ?? ""),
    [id],
  );
  const violationsQuery = useListPropertyViolations(id ?? "", {
    query: { queryKey: violationsKey, enabled: Boolean(id) },
  });
  const propertyViolations: PropertyViolation[] = violationsQuery.data ?? [];
  const queryClient = useQueryClient();
  const createViolationMut = useCreatePropertyViolation();
  const deleteViolationMut = useDeletePropertyViolation();
  const addPropertyViolation = (v: PropertyViolation) => {
    const snapshot = queryClient.getQueryData<PropertyViolation[]>(violationsKey);
    queryClient.setQueryData<PropertyViolation[]>(violationsKey, (prev) =>
      [v, ...(prev ?? [])],
    );
    createViolationMut.mutate(
      {
        id: id!,
        data: {
          id: v.id,
          occupantId: v.occupantId,
          occupantName: v.occupantName,
          category: v.category,
          details: v.details,
          notes: v.notes,
          occurredOn: v.occurredOn,
          createdBy: v.createdBy,
        },
      },
      {
        onError: () => {
          if (snapshot !== undefined) {
            queryClient.setQueryData<PropertyViolation[]>(violationsKey, snapshot);
          }
          toast({
            title: "Save failed",
            description: "Couldn't log the violation. Your change was reverted.",
            variant: "destructive",
          });
        },
        onSettled: () => {
          queryClient.invalidateQueries({ queryKey: violationsKey });
        },
      },
    );
  };
  const deletePropertyViolation = (violationId: string) => {
    const snapshot = queryClient.getQueryData<PropertyViolation[]>(violationsKey);
    queryClient.setQueryData<PropertyViolation[]>(violationsKey, (prev) =>
      (prev ?? []).filter((v) => v.id !== violationId),
    );
    deleteViolationMut.mutate(
      { id: id!, violationId },
      {
        onError: () => {
          if (snapshot !== undefined) {
            queryClient.setQueryData<PropertyViolation[]>(violationsKey, snapshot);
          }
          toast({
            title: "Save failed",
            description: "Couldn't delete the violation. Your change was reverted.",
            variant: "destructive",
          });
        },
        onSettled: () => {
          queryClient.invalidateQueries({ queryKey: violationsKey });
        },
      },
    );
  };

  // Beds-tab sort selection. Hydrated once from localStorage so the
  // user's last choice survives refresh AND navigation between
  // properties — same persistence approach as the Properties list's
  // toolbar prefs. Persisted on change in the effect below. Declared
  // ahead of the loading/not-found early returns so the hook order
  // is stable across renders.
  const [bedsSort, setBedsSort] = useState<BedsSortKey>(
    () => readPersistedBedsSort(),
  );
  useEffect(() => {
    writePersistedBedsSort(bedsSort);
  }, [bedsSort]);

  // Whether the property header's stat-card row is expanded (10 cards) or
  // collapsed to a single condensed summary line. Same persistence pattern
  // as bedsSort above (task #484).
  const [statsExpanded, setStatsExpanded] = useState<boolean>(
    () => readPersistedStatsExpanded(),
  );
  useEffect(() => {
    writePersistedStatsExpanded(statsExpanded);
  }, [statsExpanded]);

  // Controlled tab state so clicking a tile in the Bed Map can jump
  // straight to the Beds tab and scroll the matching row into view.
  // Initial value is read from the URL (`?tab=...`) so a "Back to
  // <Property>" navigation from the lease detail page lands the user
  // on the same tab they came from (typically Leases) instead of
  // bouncing them to Overview. Wouter's location string drops the
  // search portion, so we read window.location directly. This is safe
  // at first render because the browser's location is the source of
  // truth.
  const PROPERTY_TABS = useMemo(
    () => new Set(["board", "overview", "leases", "units", "beds", "furnishings", "utilities", "insurance", "violations", "finance"]),
    [],
  );
  // The Property Board is the default landing tab when the flag is on (Stage 1).
  const DEFAULT_TAB = BOARD_VIEW_ENABLED ? "board" : "overview";
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_TAB;
    const tab = new URLSearchParams(window.location.search).get("tab");
    return tab && PROPERTY_TABS.has(tab) ? tab : DEFAULT_TAB;
  });
  // Keep `activeTab` in sync with `?tab=` whenever the URL changes
  // (Task #596). Without this, in-app navigation that only changes
  // the query string — e.g. the Buildings roster's "Beds" jump
  // (`/properties/:id/buildings/:bldgId?tab=beds`) — would update
  // the URL but leave the user on whichever tab they were already
  // on, since `useState`'s initializer runs once. wouter's
  // `useSearch` is reactive so this effect fires on every location
  // change.
  const locationSearch = useSearch();
  useEffect(() => {
    const tab = new URLSearchParams(locationSearch).get("tab");
    if (tab && PROPERTY_TABS.has(tab)) setActiveTab(tab);
  }, [locationSearch, PROPERTY_TABS]);
  // Per-tab building filters (Task #590). On multi-building properties
  // operators want to focus the Leases table or Units list to a single
  // structure without dropping into the URL-based drill-down. State is
  // kept separate per tab so flipping one doesn't surprise the other,
  // and "all" is the default so single-building properties (the common
  // case) and the initial render stay unchanged.
  //
  // Hydrated from localStorage per-property (Task #592) so the pick
  // survives refreshes and round-trips back from a lease detail page.
  // The persisted buildingId is validated against `propBuildings` in an
  // effect below — if the saved building was deleted (or the user
  // landed on a different property), we silently fall back to "all".
  const [leasesBuildingFilter, setLeasesBuildingFilterState] = useState<string>(
    () => readPersistedBuildingFilter(LEASES_BUILDING_STORAGE_KEY, id),
  );
  const [unitsBuildingFilter, setUnitsBuildingFilterState] = useState<string>(
    () => readPersistedBuildingFilter(UNITS_BUILDING_STORAGE_KEY, id),
  );
  const setLeasesBuildingFilter = useCallback(
    (value: string) => {
      setLeasesBuildingFilterState(value);
      writePersistedBuildingFilter(LEASES_BUILDING_STORAGE_KEY, id, value);
    },
    [id],
  );
  const setUnitsBuildingFilter = useCallback(
    (value: string) => {
      setUnitsBuildingFilterState(value);
      writePersistedBuildingFilter(UNITS_BUILDING_STORAGE_KEY, id, value);
    },
    [id],
  );
  // Beds-tab building filter (Task #596). Same pattern as the Units /
  // Leases pickers above so every property — including single-building
  // ones — gets a consistent Beds → Building navigation story. When the
  // URL drill-down is active (`focusedBuildingId`) it always wins so the
  // dropdown stays in sync with the Buildings roster. Not persisted —
  // task #592's persistence was scoped to Units / Leases.
  const [bedsBuildingFilter, setBedsBuildingFilter] = useState<string>("all");
  // Add-Building dialog open state (Task #609). Hoisted to component
  // scope so the Buildings-card button can pop the same combined
  // building + first-lease dialog regardless of which tab the operator
  // is on.
  const [addBuildingOpen, setAddBuildingOpen] = useState(false);
  // Visible drop zone on the Leases tab (Task #622). Files dropped /
  // picked on the page are pushed into the existing UploadLeasePdfDialog
  // via `pendingFiles`, opening it straight into the queue stage so the
  // operator skips the in-dialog drop step.
  const [leaseUploadDialogOpen, setLeaseUploadDialogOpen] = useState(false);
  const [leaseUploadPendingFiles, setLeaseUploadPendingFiles] = useState<File[] | null>(null);
  const handleLeasePdfDropped = useCallback((files: File[]) => {
    setLeaseUploadPendingFiles(files);
    setLeaseUploadDialogOpen(true);
  }, []);
  const [highlightedBedIds, setHighlightedBedIds] = useState<Set<string>>(new Set());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  }, []);
  const highlightConsumedRef = useRef(false);
  const focusBed = (bedId: string) => {
    setActiveTab("beds");
    setHighlightedBedIds(new Set([bedId]));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(`bed-row-${bedId}`);
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    });
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedBedIds(new Set()), 2000);
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (highlightConsumedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get("highlightRoom");
    const bedroomLetter = params.get("highlightBedroom");
    if (!roomId || !bedroomLetter) return;
    const roomBeds = beds
      .filter((b) => b.roomId === roomId)
      .sort((a, b) => a.bedNumber - b.bedNumber);
    if (roomBeds.length < 2) return;
    const pairIndex = bedroomLetter.charCodeAt(0) - 65;
    const startIdx = pairIndex * 2;
    const pairBeds = roomBeds.slice(startIdx, startIdx + 2);
    if (pairBeds.length === 0) return;
    highlightConsumedRef.current = true;
    const ids = new Set(pairBeds.map((b) => b.id));
    setHighlightedBedIds(ids);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const firstBed = pairBeds[0];
        if (firstBed) {
          const el = document.getElementById(`bed-row-${firstBed.id}`);
          if (el && typeof el.scrollIntoView === "function") {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      });
    });
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedBedIds(new Set()), 3000);
  }, [beds]);

  const droppedRoomsForProperty = useMemo(() => {
    if (!dataIssues) return { droppedRooms: [], droppedBeds: [] };
    const roomIssue = dataIssues.find(i => i.kind === "rooms");
    const bedIssue = dataIssues.find(i => i.kind === "beds");
    const droppedRooms = roomIssue?.rows.filter(r => r.propertyId === id) ?? [];
    const droppedBeds = bedIssue?.rows.filter(r => r.propertyId === id) ?? [];
    return { droppedRooms, droppedBeds };
  }, [dataIssues, id]);

  const propLeases = useMemo(() => leases.filter(l => l.propertyId === id), [leases, id]);
  const propRooms = useMemo(
    () =>
      rooms
        .filter((r) => r.propertyId === id)
        // When the URL targets a single building, only show its rooms.
        .filter((r) => !focusedBuildingId || r.buildingId === focusedBuildingId),
    [rooms, id, focusedBuildingId],
  );
  const propBeds = useMemo(() => {
    const allowedRoomIds = new Set(propRooms.map((r) => r.id));
    return beds
      .filter((b) => b.propertyId === id)
      .filter((b) => !focusedBuildingId || allowedRoomIds.has(b.roomId));
  }, [beds, id, focusedBuildingId, propRooms]);
  // Buildings under this property (Task #570). Most properties have a
  // single back-filled "Main building"; multi-building properties (e.g. the
  // Schuette duplex 1331/1341 S 8th Ave) get a row per building.
  const propBuildings = useMemo(
    () => buildings.filter(b => b.propertyId === id),
    [buildings, id],
  );
  // Legacy "Building N" placeholders (Task #614). Task #609 stopped the
  // Add Building button from creating empty rows going forward, but
  // properties edited before that change may still carry one or more
  // unused placeholders. We surface a one-click cleanup affordance for
  // any building that (a) has the autogenerated `Building <n>` name,
  // (b) has no address, (c) has no rooms, and (d) has no leases
  // referencing it — i.e. the same "safe to delete" criteria the
  // server enforces, plus the lease check called out in the task.
  // The server additionally rejects deleting the last building on a
  // property, so we never include the final remaining row in the
  // cleanup set.
  const placeholderBuildings = useMemo(() => {
    if (propBuildings.length <= 1) return [];
    const placeholderNameRe = /^Building \d+$/;
    const candidates = propBuildings.filter((b) => {
      if (!placeholderNameRe.test(b.name)) return false;
      if ((b.address ?? "").trim() !== "") return false;
      const hasRoom = rooms.some(
        (r) => r.propertyId === id && r.buildingId === b.id,
      );
      if (hasRoom) return false;
      const hasLease = leases.some(
        (l) => l.propertyId === id && l.buildingId === b.id,
      );
      if (hasLease) return false;
      return true;
    });
    // Leave at least one building on the property — if every row is a
    // placeholder, keep the last one so the server's "last building"
    // guard never trips and the property card still has something to
    // mirror its address from.
    if (candidates.length >= propBuildings.length) {
      return candidates.slice(0, propBuildings.length - 1);
    }
    return candidates;
  }, [propBuildings, rooms, leases, id]);
  const [cleaningPlaceholders, setCleaningPlaceholders] = useState(false);
  // Validate the persisted Leases / Units building filters against the
  // current property's buildings (Task #592). If the saved buildingId
  // no longer exists — building deleted, single-building property, etc.
  // — silently fall back to "all" and clean the storage entry. We wait
  // until buildings have actually loaded (length > 0) so we don't
  // clobber a valid pick during the initial empty-data render.
  useEffect(() => {
    if (propBuildings.length === 0) return;
    if (
      leasesBuildingFilter !== "all" &&
      !propBuildings.some((b) => b.id === leasesBuildingFilter)
    ) {
      setLeasesBuildingFilter("all");
    }
    if (
      unitsBuildingFilter !== "all" &&
      !propBuildings.some((b) => b.id === unitsBuildingFilter)
    ) {
      setUnitsBuildingFilter("all");
    }
  }, [propBuildings, leasesBuildingFilter, unitsBuildingFilter, setLeasesBuildingFilter, setUnitsBuildingFilter]);
  const propOccupants = useMemo(() => occupants.filter(o => o.propertyId === id && o.status === "Active"), [occupants, id]);
  // Recurring non-rent line items for this property. Hoisted above the
  // `isLoading` / not-found early returns so the hook count stays stable
  // across the cold-cache → loaded transition (Task #596). Previously
  // these `useMemo`s sat ~150 lines below the early return, which caused
  // React's "Rendered more hooks than during the previous render" crash
  // on a hard refresh of `/properties/:id`.
  const propOtherCostsTotal = useMemo(
    () => sumOtherCostsForProperty(otherCosts, id),
    [otherCosts, id],
  );
  const propOtherCosts = useMemo(
    () => otherCosts.filter((c) => c.propertyId === id),
    [otherCosts, id],
  );

  const propertyUnits = useMemo(() => {
    const byUnit = new Map<string, Lease[]>();
    for (const l of propLeases) {
      const u = (l.unit ?? "").trim();
      if (!u) continue;
      const list = byUnit.get(u) ?? [];
      list.push(l);
      byUnit.set(u, list);
    }
    const naturalCompare = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    return Array.from(byUnit.entries())
      .sort(([a], [b]) => naturalCompare(a, b))
      .map(([unit, unitLeases]) => {
        const sortedLeases = sortLeases(unitLeases);
        const room = propRooms.find(
          (r) => r.name === `Unit ${unit}` || r.name === unit,
        );
        const unitBeds = room ? propBeds.filter((b) => b.roomId === room.id) : [];
        const unitOccupants = unitBeds
          .map((b) => propOccupants.find((o) => o.bedId === b.id))
          .filter((o): o is Occupant => Boolean(o));
        return { unit, leases: sortedLeases, room, beds: unitBeds, occupants: unitOccupants };
      });
  }, [propLeases, propRooms, propBeds, propOccupants]);

  const sortedPropLeases = useMemo(() => sortLeases(propLeases), [propLeases]);

  // Apply the Leases-tab building filter (Task #590). When the user
  // picks a building, only show leases tied to it; "all" passes through.
  // Single-building properties never render the picker, so this is a
  // no-op for them.
  const filteredLeasesForLeasesTab = useMemo(() => {
    if (leasesBuildingFilter === "all") return sortedPropLeases;
    return sortedPropLeases.filter((l) => l.buildingId === leasesBuildingFilter);
  }, [sortedPropLeases, leasesBuildingFilter]);

  // Apply the Units-tab building filter (Task #590). A unit is included
  // if any of its leases is tied to the selected building. Most units
  // have a single lease, so in practice this matches "show units in
  // building X".
  const filteredPropertyUnits = useMemo(() => {
    if (unitsBuildingFilter === "all") return propertyUnits;
    return propertyUnits.filter((u) =>
      u.leases.some((l) => l.buildingId === unitsBuildingFilter),
    );
  }, [propertyUnits, unitsBuildingFilter]);

  // Hoisted above the early returns (same reason as `propOtherCosts*` above)
  // so the hook count stays stable across the loading → loaded transition.
  // These were previously recomputed on every render down in the main JSX
  // body — wrapping them as memos avoids redoing the filter/sort/reduce
  // chains every time an unrelated piece of context state updates.
  const propUtils = useMemo(
    () =>
      utilities
        .filter((u) => u.propertyId === id)
        .sort(
          (a, b) =>
            a.type.localeCompare(b.type) || a.company.localeCompare(b.company),
        ),
    [utilities, id],
  );
  const propCerts = useMemo(
    () =>
      insuranceCertificates
        .filter((c) => c.propertyId === id)
        .sort((a, b) => (a.coverageEnd || "").localeCompare(b.coverageEnd || "")),
    [insuranceCertificates, id],
  );
  const activeLeases = useMemo(
    () => getActiveLeasesForProperty(propLeases, id),
    [propLeases, id],
  );
  const primaryActiveLease = useMemo(
    () =>
      [...activeLeases].sort((a, b) => a.endDate.localeCompare(b.endDate))[0],
    [activeLeases],
  );
  const bedCounts = useMemo(() => {
    let occupied = 0;
    let available = 0;
    let needsCleaning = 0;
    for (const b of propBeds) {
      if (b.status === "Occupied") {
        occupied++;
      } else if (b.status === "Vacant") {
        if ((b.cleaningStatus ?? "ready") === "ready") available++;
        else needsCleaning++;
      }
    }
    return {
      occupied,
      available,
      needsCleaning,
      vacant: propBeds.length - occupied,
    };
  }, [propBeds]);
  const weeklyRecovery = useMemo(
    () =>
      propOccupants.reduce(
        (s, o) =>
          s + toWeeklyCharge(o.chargePerBed, o.billingFrequency ?? "Monthly"),
        0,
      ),
    [propOccupants],
  );
  const monthlyRevenueFromOccupants = useMemo(
    () =>
      propOccupants.reduce(
        (s, o) =>
          s + toMonthlyCharge(o.chargePerBed, o.billingFrequency ?? "Monthly"),
        0,
      ),
    [propOccupants],
  );
  const monthlyUtilCost = useMemo(
    () => propUtils.reduce((s, u) => s + u.monthlyCost, 0),
    [propUtils],
  );
  const monthlyElectricCost = useMemo(
    () =>
      propUtils.reduce(
        (s, u) => (u.type === "Electric" ? s + (u.monthlyCost || 0) : s),
        0,
      ),
    [propUtils],
  );
  const hotelRateLeaseEstimates = useMemo(
    () =>
      activeLeases
        .filter((l) => (l.rateType ?? "monthly") === "room-night")
        .map((l) => {
          const latest = getLatestRoomNightLog(roomNightLogs, l.id);
          return {
            lease: l,
            nights: latest?.roomNights ?? 0,
            month: latest?.month ?? null,
            nightlyRate: l.nightlyRate ?? 0,
            estimate: estimateLeaseMonthlyRent(l, roomNightLogs),
          };
        }),
    [activeLeases, roomNightLogs],
  );
  // Beds-tab grouping: bucket beds into rooms, surface unknown-room beds
  // as orphans, apply the building filter, then sort. All driven by
  // memoized inputs so the heavy work only re-runs when the underlying
  // bed/room set or the toolbar selections actually change.
  const bedRoomGrouping = useMemo(() => {
    const bedsByRoomId = new Map<string, Bed[]>();
    for (const r of propRooms) bedsByRoomId.set(r.id, []);
    const orphans: Bed[] = [];
    for (const b of propBeds) {
      const list = bedsByRoomId.get(b.roomId);
      if (list) list.push(b);
      else orphans.push(b);
    }
    const allGroups = propRooms.map((r) => ({
      room: r,
      beds: bedsByRoomId.get(r.id) ?? [],
    }));
    return { allGroups, orphans };
  }, [propRooms, propBeds]);
  // Apply the Beds-tab building filter + user sort to the room cards.
  // Memoized so the filter + sort + array copy only re-run when one of
  // their actual inputs changes (not every parent render).
  const sortedBedGroups = useMemo(() => {
    const { allGroups } = bedRoomGrouping;
    const groups =
      bedsBuildingFilter === "all" || focusedBuildingId
        ? allGroups
        : allGroups.filter((g) => g.room.buildingId === bedsBuildingFilter);
    if (bedsSort === "default") return groups;
    const valueFor = (g: { room: Room; beds: Bed[] }): number | null => {
      switch (bedsSort) {
        case "ppsf-desc":
        case "ppsf-asc":
          return computePricePerSqft(g.room.monthlyRent, g.room.sqft);
        case "rent-desc":
        case "rent-asc":
          return g.room.monthlyRent > 0 ? g.room.monthlyRent : null;
        case "sqft-desc":
        case "sqft-asc":
          return g.room.sqft > 0 ? g.room.sqft : null;
        default:
          return null;
      }
    };
    const isAsc = bedsSort.endsWith("-asc");
    return [...groups].sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = av - bv;
      return isAsc ? cmp : -cmp;
    });
  }, [bedRoomGrouping, bedsBuildingFilter, focusedBuildingId, bedsSort]);

  if (isLoading) {
    return (
      <MainLayout>
        <div className="p-8 max-w-[1600px] mx-auto space-y-6" data-testid="property-detail-loading">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-28" />
            <span className="text-muted-foreground">/</span>
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-4 w-72" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-10 w-full max-w-3xl rounded-md" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-72 w-full rounded-xl" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
        </div>
      </MainLayout>
    );
  }

  const property = properties.find(p => p.id === id);
  if (!property) {
    return (
      <MainLayout>
        <NotFoundScreen
          title={t("pages.propertyDetail.notFoundTitle")}
          description={t("pages.propertyDetail.notFoundDescription")}
          secondary={{
            label: t("pages.propertyDetail.backToProperties"),
            href: "/properties",
            testId: "button-back-to-properties",
          }}
          testId="property-detail-not-found"
        />
      </MainLayout>
    );
  }

  if (isPendingPlacementProperty(property.name)) {
    return (
      <MainLayout>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="p-8 max-w-5xl mx-auto space-y-6"
          data-testid="property-detail-pending-placement"
        >
          <div className="flex items-center gap-3">
            <Link href="/properties">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground">
                <ChevronLeft className="h-4 w-4" />
                Properties
              </Button>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm font-medium">{property.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10">
              <Users className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{property.name}</h1>
              <p className="text-sm text-muted-foreground">
                Synthetic bucket — payroll roster people waiting to be placed in a real bed.
              </p>
            </div>
          </div>
          <PendingPlacementBoard property={property} />
        </motion.div>
      </MainLayout>
    );
  }
  // `propUtils`, `propCerts`, `activeLeases`, `primaryActiveLease`,
  // `bedCounts`, `weeklyRecovery`, `monthlyUtilCost`,
  // `monthlyElectricCost`, and `hotelRateLeaseEstimates` are all
  // memoized above the early returns so the heavy filter/sort/reduce
  // chains only re-run when their inputs actually change.
  const { occupied: occupiedBeds, available: availableBeds, needsCleaning: bedsNeedsCleaning, vacant: vacantBeds } = bedCounts;
  // Housing Recovery (monthly snapshot) = sum of per-occupant weekly
  // deduction × 4. Same source as the "Weekly Deduction" column on the
  // bed table, so the stat card and the per-bed rows always agree.
  // Editing the deduction on the occupant or bed row immediately moves
  // this number. Empty / unset deductions contribute $0.
  const monthlyRevenue = weeklyRecovery * 4;
  // Per-bed unit economics use property.monthlyRent (not the sum of
  // active-lease rent) so the number matches the Properties list and
  // Dashboard cards — those views key off the property's canonical
  // monthly rent and don't see leases yet for greenfield properties.
  const rentPerBed = computeRentPerBed(property.monthlyRent, propBeds.length);
  const electricPerBed = computeElectricPerBed(monthlyElectricCost, propBeds.length);
  const rentPlusElectricPerBed = computeRentPlusElectricPerBed(
    property.monthlyRent,
    monthlyElectricCost,
    propBeds.length,
  );
  // Lease cost combines stored monthly rent with the hotel-rate estimate
  // (`nightlyRate × latest month's room-nights`) so the Lease Rent stat
  // and the Finance tab don't silently report $0 for hotel-rate leases
  // like Ridge Motor Inn / Comfort Suites Madison. Monthly leases are
  // unaffected because `estimateLeaseMonthlyRent` returns their stored
  // `monthlyRent` unchanged when `rateType !== "room-night"`.
  const monthlyLeaseCost = sumActiveRentEstimated(propLeases, roomNightLogs, id);
  // Total of recurring non-rent line items for this property (task #497).
  // When `property.rentFree` is true, this replaces `monthlyLeaseCost` in
  // every "rent" surface (header stat card, leases table, etc.) so the
  // operator sees the cleaning fee total instead of a perpetual $0.
  // `propOtherCostsTotal` and `propOtherCosts` are computed above the
  // early returns (Task #596) so refer to those bindings here.
  // `hotelRateLeaseEstimates` is memoized above the early returns.
  const totalCost = monthlyLeaseCost + monthlyUtilCost;
  const profit = monthlyRevenue - totalCost;
  const roomTotals = computeRoomTotals(propRooms);
  const pricePerSqft = computePricePerSqft(roomTotals.totalMonthlyRent, roomTotals.totalSqft);
  // Difference between the sum of per-room expected rent and the actual lease
  // rent. Positive = rooms add up to more than the lease costs (good for the
  // operator); negative = rooms underprice the lease. We only show the delta
  // when both sides are non-zero to avoid noisy "vs $0" comparisons.
  const expectedVsLeaseDelta =
    roomTotals.totalMonthlyRent > 0 && monthlyLeaseCost > 0
      ? roomTotals.totalMonthlyRent - monthlyLeaseCost
      : null;

  return (
    <MainLayout>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="p-8 max-w-[1600px] mx-auto space-y-6">
        {/* Breadcrumb — lead with the CUSTOMER (the hub) so you can always
            jump back up the customer → property → beds trail. */}
        {(() => {
          const propCustomer = customers.find((c) => c.id === property.customerId);
          return (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Link href="/customers"><span className="text-muted-foreground hover:text-foreground">Customers</span></Link>
              {propCustomer && (
                <>
                  <span className="text-muted-foreground">/</span>
                  <Link href={`/customers/${propCustomer.id}`}>
                    <span className="text-muted-foreground hover:text-foreground hover:underline">{propCustomer.name}</span>
                  </Link>
                </>
              )}
              <span className="text-muted-foreground">/</span>
              <span className="font-medium">{property.name}</span>
              <Link href="/properties"><span className="ml-1 text-xs text-muted-foreground hover:text-foreground">· all properties</span></Link>
            </div>
          );
        })()}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{property.name}</h1>
              <p className="text-sm text-muted-foreground">{property.address}, {property.city}, {property.state} {property.zip}</p>
            </div>
            <Badge variant={property.status === "Active" ? "default" : "secondary"} className="ml-2">
              {property.status}
            </Badge>
            {property.propertyType ? (
              <Badge
                variant="outline"
                className="ml-1 text-xs font-medium"
                data-testid="badge-property-type"
              >
                {property.propertyType}
              </Badge>
            ) : null}
            {(() => {
              const overall = computeOverallRating(property.ratings);
              if (overall === null) return null;
              return (
                <div
                  className="flex items-center gap-1.5 ml-1 rounded-md border bg-muted/40 px-2 py-1"
                  data-testid="property-header-rating"
                  title={`Overall rating ${overall.toFixed(1)} out of 5`}
                >
                  <StarRating value={overall} readOnly size="sm" ariaLabel="Overall rating" />
                  <span
                    className="text-xs font-semibold tabular-nums"
                    data-testid="property-header-rating-value"
                  >
                    {overall.toFixed(1)}
                  </span>
                </div>
              );
            })()}
            {primaryActiveLease && (() => {
              const renewal = getRenewalInfo(primaryActiveLease.endDate);
              const noEndDate =
                !renewal && isBlankYMD(primaryActiveLease.endDate);
              if (!renewal && !noEndDate) return null;
              if (renewal && renewal.level === "ok") return null;
              return (
                <div className="flex items-center gap-1.5 ml-1">
                  {renewal ? (
                    <Badge variant="outline" className={`text-xs font-medium ${renewal.badgeClass}`}>
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Renewal: {renewal.label}
                    </Badge>
                  ) : (
                    // Inline end-date editor (task #430). Clicking the
                    // "No end date" pill opens the same RenewLeasePopover
                    // the explicit Renew button uses, so operators can
                    // type in a date right from the header without
                    // hunting for the renew action first.
                    <RenewLeasePopover
                      currentEndDate={primaryActiveLease.endDate}
                      currentStatus={primaryActiveLease.status}
                      propertyName={property.name}
                      onRenew={(newEndDate, newStatus) =>
                        updateLease(primaryActiveLease.id, {
                          endDate: newEndDate,
                          status: newStatus,
                        })
                      }
                      trigger={
                        <button
                          type="button"
                          data-testid="badge-property-no-end-date"
                          title="Click to set the lease end date"
                          className="inline-flex items-center rounded-md border border-dashed border-input bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          No end date
                        </button>
                      }
                    />
                  )}
                  <RenewLeasePopover
                    currentEndDate={primaryActiveLease.endDate}
                    currentStatus={primaryActiveLease.status}
                    propertyName={property.name}
                    onRenew={(newEndDate, newStatus) =>
                      updateLease(primaryActiveLease.id, {
                        endDate: newEndDate,
                        status: newStatus,
                      })
                    }
                    trigger={
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1">
                        <CalendarPlus className="h-3 w-3" />
                        Renew
                      </Button>
                    }
                  />
                </div>
              );
            })()}
            {(() => {
              // Laundry location pill (task #504). Surfaces the Onsite /
              // Offsite value picked on the Furnishings tab so operators
              // don't have to switch tabs to see it. Hidden when the
              // operator hasn't picked a value (radio is N/A by default).
              const furnishings = property.furnishings ?? [];
              const laundryCat = FURNISHING_CATEGORIES.find((c) => c.id === "laundry");
              const radio = laundryCat?.radioGroup;
              const picked = radio?.options.find((o) => furnishings.includes(o)) ?? null;
              if (!picked) return null;
              const short = radio?.shortLabels?.[picked] ?? picked;
              return (
                <Badge
                  variant="outline"
                  className="text-xs font-medium ml-1 bg-emerald-50 text-emerald-700 border-emerald-200"
                  data-testid="badge-property-laundry"
                  title={`Laundry facility is ${short.toLowerCase()}`}
                >
                  <WashingMachine className="h-3 w-3 mr-1" />
                  Laundry: {short}
                </Badge>
              );
            })()}
            {(() => {
              const certs = propCerts.filter((c) => c.coverageEnd);
              if (certs.length === 0) return null;
              let worst: { days: number; coverageEnd: string } | null = null;
              for (const c of certs) {
                const d = daysUntil(c.coverageEnd);
                if (d > 30) continue;
                if (!worst || d < worst.days) worst = { days: d, coverageEnd: c.coverageEnd };
              }
              if (!worst) return null;
              return (
                <Badge
                  variant="outline"
                  className={`text-xs font-medium ml-1 ${
                    worst.days < 0
                      ? "bg-red-100 text-red-800 border-red-200"
                      : "bg-amber-100 text-amber-800 border-amber-200"
                  }`}
                  data-testid="badge-property-insurance-expiry"
                >
                  <ShieldCheck className="h-3 w-3 mr-1" />
                  {worst.days < 0
                    ? "Insurance expired"
                    : `Insurance expiring ${formatYMDPretty(worst.coverageEnd)}`}
                </Badge>
              );
            })()}
          </div>
        </div>

        {(droppedRoomsForProperty.droppedRooms.length > 0 || droppedRoomsForProperty.droppedBeds.length > 0) && (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
            data-testid="property-dropped-notice"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{t("pages.propertyDetail.droppedNotice")}</p>
              <ul className="mt-1 list-disc list-inside space-y-0.5 text-xs">
                {droppedRoomsForProperty.droppedRooms.map((row, i) => (
                  <li key={`room-${row.id ?? i}`}>
                    Room{row.id ? <> <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">{row.id}</code></> : ""}{row.label ? ` — ${row.label}` : ""}
                  </li>
                ))}
                {droppedRoomsForProperty.droppedBeds.map((row, i) => (
                  <li key={`bed-${row.id ?? i}`}>
                    {typeof row.bedNumber === "number" ? `Bed #${row.bedNumber}` : "Bed"}{row.id ? <> <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">{row.id}</code></> : ""}{row.label ? ` — ${row.label}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Summary Stats. Collapsible into a condensed summary line so power
            users who already know the property can keep the chrome small.
            State is persisted per-user via localStorage (task #484). */}
        <div className="space-y-2" data-testid="property-stats-section">
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={() => setStatsExpanded((v) => !v)}
              data-testid="button-toggle-stats"
              aria-expanded={statsExpanded}
            >
              {statsExpanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  {t("pages.propertyDetail.hideStats")}
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  {t("pages.propertyDetail.showAllStats")}
                </>
              )}
            </Button>
          </div>

          {!statsExpanded && (
            <Card data-testid="property-stats-summary">
              <CardContent className="p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    <BedDouble className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">{t("pages.propertyDetail.summaryTotalBeds")}</span>
                    <span className="font-semibold">{propBeds.length}</span>
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">{t("pages.propertyDetail.summaryOccupied")}</span>
                    <span className="font-semibold text-green-600">{occupiedBeds}</span>
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">{t("pages.propertyDetail.summaryMonthlyRevenue")}</span>
                    <span className="font-semibold text-green-600">{formatUsdWhole(monthlyRevenue)}</span>
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">{t("pages.propertyDetail.summaryNetProfit")}</span>
                    <span className={`font-semibold ${profit >= 0 ? "text-green-600" : "text-destructive"}`}>
                      {profit >= 0 ? "+" : ""}{formatUsdWhole(profit)}
                    </span>
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {statsExpanded && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-10 gap-4">
          <StatCard label={t("pages.propertyDetail.statTotalBeds")} value={propBeds.length} icon={BedDouble} onClick={() => scrollToSection("section-bed-occupancy")} why={{ title: "Total beds", formula: "Occupied + available + needs-cleaning", rows: [{ k: "Occupied", v: occupiedBeds }, { k: "Available", v: availableBeds }, { k: "Needs cleaning", v: bedsNeedsCleaning }, { k: "Vacant (all)", v: vacantBeds }] }} />
          <StatCard label={t("pages.propertyDetail.statOccupied")} value={occupiedBeds} icon={Users} color="text-green-600" onClick={() => scrollToSection("section-bed-occupancy")} why={{ title: "Occupied beds", formula: "Beds with an active occupant", rows: [{ k: "Occupied", v: occupiedBeds }, { k: "of total", v: propBeds.length }, { k: "Occupancy", v: propBeds.length > 0 ? `${Math.round((occupiedBeds / propBeds.length) * 100)}%` : "—" }] }} />
          <StatCard
            testId="stat-available-beds"
            onClick={() => scrollToSection("section-bed-occupancy")}
            label={t("pages.propertyDetail.statAvailable")}
            value={availableBeds}
            icon={BedDouble}
            color={availableBeds > 0 ? "text-amber-500" : "text-muted-foreground"}
            why={{ title: "Available beds", formula: "Vacant & ready (excludes needs-cleaning)", rows: [{ k: "Available now", v: availableBeds }, { k: "Needs cleaning", v: bedsNeedsCleaning }, { k: "Vacant (all)", v: vacantBeds }] }}
            sub={
              bedsNeedsCleaning > 0 ? (
                <span
                  className="inline-flex items-center gap-1 text-amber-700"
                  data-testid="stat-needs-cleaning-sub"
                >
                  <Sparkles className="h-3 w-3" />
                  {t("pages.propertyDetail.statNeedsCleaning", { count: bedsNeedsCleaning })}
                </span>
              ) : (
                t("pages.propertyDetail.statVacantTotal", { count: vacantBeds })
              )
            }
          />
          <StatCard label={t("pages.propertyDetail.statMonthlyRevenue")} value={formatUsdWhole(monthlyRevenue)} icon={TrendingUp} color="text-green-600" why={{ title: "Housing recovery / mo", formula: "Sum of per-occupant weekly deduction × 4 weeks", rows: [{ k: "Weekly recovery", v: formatUsdWhole(weeklyRecovery) }, { k: "× 4 weeks", v: formatUsdWhole(monthlyRevenue) }, { k: "Occupied beds", v: occupiedBeds }] }} />
          <StatCard
            testId="stat-lease-rent"
            onClick={() => { setActiveTab("leases"); scrollToSection("section-tabs"); }}
            label={property.rentFree ? t("pages.propertyDetail.statOtherCosts") : t("pages.propertyDetail.statLeaseRent")}
            value={
              property.rentFree
                ? (propOtherCostsTotal > 0 ? formatUsdWhole(propOtherCostsTotal) : "—")
                : (monthlyLeaseCost > 0 ? formatUsdWhole(monthlyLeaseCost) : "—")
            }
            icon={KeyRound}
            color="text-destructive"
            why={
              property.rentFree
                ? { title: "Other costs / mo", formula: "Recurring non-rent line items (rent-free property)", rows: [{ k: "Other costs", v: formatUsdWhole(propOtherCostsTotal) }] }
                : { title: "Lease rent / mo", formula: "Active lease rent + hotel-rate estimates", rows: [{ k: "Active leases", v: activeLeases.length }, { k: "Monthly lease cost", v: formatUsdWhole(monthlyLeaseCost) }] }
            }
            sub={
              <span className="flex flex-col gap-0.5">
                <span>
                  {activeLeases.length >= 2 ? (
                    <span
                      className="inline-flex items-center gap-1 text-amber-700"
                      data-testid="badge-multi-active-leases"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {t("pages.propertyDetail.statActiveLeasesCombined", { count: activeLeases.length })}
                    </span>
                  ) : activeLeases.length === 1 ? (
                    t("pages.propertyDetail.statActiveLeaseSingular")
                  ) : (
                    t("pages.propertyDetail.statNoActiveLease")
                  )}
                </span>
                {hotelRateLeaseEstimates.map((h) => (
                  <span
                    key={h.lease.id}
                    className="inline-flex items-center gap-1 text-foreground/80"
                    data-testid={`hotel-rate-estimate-${h.lease.id}`}
                  >
                    <Hotel className="h-3 w-3" />
                    {h.month && h.nights > 0 ? (
                      <>
                        {t("pages.propertyDetail.statHotelRateThisMonth", {
                          count: h.nights,
                          est: formatUsdWhole(h.estimate),
                          nights: h.nights,
                          rate: formatUsdWhole(h.nightlyRate),
                        })}
                      </>
                    ) : (
                      <>{t("pages.propertyDetail.statHotelRateLogPrompt")}</>
                    )}
                  </span>
                ))}
              </span>
            }
          />
          <StatCard label={t("pages.propertyDetail.statUtilityCost")} value={formatUsdWhole(monthlyUtilCost)} icon={Zap} color="text-destructive" sub={t("pages.propertyDetail.statServicesCount", { count: propUtils.length })} onClick={() => { setActiveTab("utilities"); scrollToSection("section-tabs"); }} why={{ title: "Utility cost / mo", formula: "Sum of monthly utility services on this property", rows: [{ k: "Services", v: propUtils.length }, { k: "Monthly total", v: formatUsdWhole(monthlyUtilCost) }, { k: "of which electric", v: formatUsdWhole(monthlyElectricCost) }] }} />
          <StatCard
            testId="stat-rent-per-bed"
            label={t("pages.propertyDetail.statRentPerBed")}
            value={rentPerBed === null ? "—" : formatUsdWhole(rentPerBed)}
            icon={DollarSign}
            why={{ title: "Rent / bed", formula: "Property monthly rent ÷ total beds", rows: [{ k: "Monthly rent", v: formatUsdWhole(property.monthlyRent ?? 0) }, { k: "Total beds", v: propBeds.length }, { k: "Rent / bed", v: rentPerBed === null ? "—" : formatUsdWhole(rentPerBed) }] }}
            sub={t("pages.propertyDetail.statRentPerBedSub", { count: propBeds.length })}
          />
          <StatCard
            testId="stat-electric-per-bed"
            label={t("pages.propertyDetail.statElectricPerBed")}
            value={electricPerBed === null ? "—" : formatUsdWhole(electricPerBed)}
            icon={Zap}
            why={{ title: "Electric / bed", formula: "Monthly electric cost ÷ total beds", rows: [{ k: "Monthly electric", v: formatUsdWhole(monthlyElectricCost) }, { k: "Total beds", v: propBeds.length }, { k: "Electric / bed", v: electricPerBed === null ? "—" : formatUsdWhole(electricPerBed) }] }}
            sub={t("pages.propertyDetail.statElectricPerBedSub", { count: propBeds.length, cost: formatUsdWhole(monthlyElectricCost) })}
          />
          <StatCard
            testId="stat-rent-plus-electric-per-bed"
            label={t("pages.propertyDetail.statRentPlusElectricPerBed")}
            value={rentPlusElectricPerBed === null ? "—" : formatUsdWhole(rentPlusElectricPerBed)}
            icon={DollarSign}
            why={{ title: "Rent + electric / bed", formula: "(Monthly rent + monthly electric) ÷ total beds", rows: [{ k: "Monthly rent", v: formatUsdWhole(property.monthlyRent ?? 0) }, { k: "Monthly electric", v: formatUsdWhole(monthlyElectricCost) }, { k: "Total beds", v: propBeds.length }, { k: "Per bed", v: rentPlusElectricPerBed === null ? "—" : formatUsdWhole(rentPlusElectricPerBed) }] }}
            sub={t("pages.propertyDetail.statRentPlusElectricPerBedSub", { count: propBeds.length, cost: formatUsdWhole(monthlyElectricCost) })}
          />
          <StatCard label={t("pages.propertyDetail.statNetProfit")} value={`${profit >= 0 ? "+" : ""}${formatUsdWhole(profit)}`} icon={DollarSign} color={profit >= 0 ? "text-green-600" : "text-destructive"} why={{ title: "Net profit / mo", formula: "Housing recovery − lease rent − utilities", rows: [{ k: "Recovery / mo", v: formatUsdWhole(monthlyRevenue) }, { k: "− Lease rent", v: formatUsdWhole(monthlyLeaseCost) }, { k: "− Utilities", v: formatUsdWhole(monthlyUtilCost) }, { k: "= Net", v: `${profit >= 0 ? "+" : ""}${formatUsdWhole(profit)}` }] }} />
        </div>
          )}
        </div>

        {/* The chip-grid "Bed Occupancy" card was scrapped (operator
            request) — bed management lives in the Beds tab below. The
            anchor stays so the Total Beds / Occupied / Available stat-card
            deep-links still land here, just above the tabs. */}
        <div id="section-bed-occupancy" className="scroll-mt-20" />

        {/* Tabs */}
        <Tabs id="section-tabs" value={activeTab} onValueChange={setActiveTab} className="space-y-4 scroll-mt-20">
          {/* Consolidated Fix §2: the bed board is the default view; the other
              eight detail panels collapse behind ONE compact "Details ▾" menu so
              the page leads with beds, not a 10-tab strip. The menu button shows
              the active panel's name + a count badge for violations; every item
              keeps its original data-testid so deep-links + tests still resolve. */}
          <div className="flex flex-wrap items-center gap-2">
            {BOARD_VIEW_ENABLED && (
              <TabsList className="bg-transparent p-0">
                <TabsTrigger value="board" data-testid="tab-trigger-board" className="rounded-xl"><LayoutDashboard className="h-3.5 w-3.5 mr-1.5" />Board</TabsTrigger>
              </TabsList>
            )}
            {(() => {
              const detailTabs: { value: string; icon: LucideIcon; label: string }[] = [
                { value: "overview", icon: Home, label: t("pages.propertyDetail.tabs.info") },
                { value: "leases", icon: KeyRound, label: t("pages.propertyDetail.tabs.leases") },
                ...(propertyUnits.length > 0 ? [{ value: "units", icon: Building2, label: t("pages.propertyDetail.tabs.units") }] : []),
                { value: "beds", icon: BedDouble, label: t("pages.propertyDetail.tabs.beds") },
                { value: "furnishings", icon: Sofa, label: t("pages.propertyDetail.tabs.furnishings") },
                { value: "utilities", icon: Zap, label: t("pages.propertyDetail.tabs.utilities") },
                { value: "insurance", icon: ShieldCheck, label: t("pages.propertyDetail.tabs.insurance") },
                { value: "violations", icon: ShieldAlert, label: t("pages.propertyDetail.tabs.violations") },
                { value: "finance", icon: DollarSign, label: t("pages.propertyDetail.tabs.finance") },
              ];
              const active = detailTabs.find((d) => d.value === activeTab);
              const ActiveIcon = active?.icon ?? LayoutDashboard;
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid="property-details-menu"
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[13px] font-semibold transition-colors ${active ? "border-brand bg-brand text-brand-foreground" : "border-line bg-panel text-ink hover:border-brand/40"}`}
                    >
                      <ActiveIcon className="h-3.5 w-3.5" />
                      {active ? active.label : "Details"}
                      {!active && propertyViolations.length > 0 && (
                        <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white tabular-nums">{propertyViolations.length}</span>
                      )}
                      <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52">
                    {detailTabs.map((item) => (
                      <DropdownMenuItem
                        key={item.value}
                        data-testid={`tab-trigger-${item.value}`}
                        onSelect={() => setActiveTab(item.value)}
                        className={`gap-2 ${activeTab === item.value ? "bg-accent" : ""}`}
                      >
                        <item.icon className="h-4 w-4" />
                        <span className="flex-1">{item.label}</span>
                        {item.value === "violations" && propertyViolations.length > 0 && (
                          <Badge
                            variant="secondary"
                            className="h-4 px-1 text-[10px] tabular-nums"
                            data-testid="badge-violations-count"
                          >
                            {propertyViolations.length}
                          </Badge>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })()}
          </div>

          {/* ── OVERVIEW TAB ── */}
          {BOARD_VIEW_ENABLED && (
            <TabsContent value="board" className="space-y-4">
              <BedBoardV2 property={property} />
            </TabsContent>
          )}

          <TabsContent value="overview" className="space-y-4">
            {/*
              Location map — sits at the top of Overview so operators see
              where a property is the moment they open it. Falls back to a
              plain "Open in Google Maps" link when the embed API key is
              not configured, and shows an empty state when the address
              fields are blank. See PropertyLocationMap for the three
              render branches.
            */}
            <PropertyLocationMap
              address={property.address}
              city={property.city}
              state={property.state}
              zip={property.zip}
              lat={property.lat ?? null}
              lng={property.lng ?? null}
              coordsVerified={property.coordsVerified ?? false}
              onGeocoded={(point) =>
                updateProperty(id, { lat: point.lat, lng: point.lng })
              }
              onMarkVerified={() =>
                updateProperty(id, { coordsVerified: true })
              }
              onCoordsAdjusted={(point) =>
                // Operator dragged the pin to a new spot. Persist the
                // hand-placed coords AND flip `coordsVerified` to true
                // — a manually-positioned pin is by definition operator
                // confirmed, so the badge should reflect that without a
                // separate "Mark as verified" click.
                updateProperty(id, {
                  lat: point.lat,
                  lng: point.lng,
                  coordsVerified: true,
                })
              }
              onResetCoords={(point) =>
                // Restore the address-resolved coords captured before
                // the drag. Clearing `coordsVerified` returns the badge
                // to "Approximate" so the row matches a freshly auto-
                // geocoded pin.
                updateProperty(id, {
                  lat: point.lat,
                  lng: point.lng,
                  coordsVerified: false,
                })
              }
              onRegeocode={() => {
                // Resending the address with no body diff is enough to
                // make the server re-geocode (it re-geocodes whenever
                // any address field is in the body), and the route also
                // resets `coordsVerified` to false on the freshly-
                // resolved coords so the badge reflects the new state.
                // Optimistically clear the local cached coords so the
                // map shows the loading state while the round-trip is
                // in flight, instead of leaving the old pin sitting in
                // the wrong spot.
                updateProperty(id, {
                  address: property.address,
                  lat: null,
                  lng: null,
                  coordsVerified: false,
                });
              }}
            />

            {/*
              Per-lease rent breakdown. Renders here on Overview (not the
              Leases tab) because it answers a header-level question — "what
              is the combined Lease Rent in the stat card made up of?" — and
              the operator shouldn't have to leave Overview to audit it.

              Gated on `propLeases.length >= 2` (every lease, regardless of
              status) so historical/upcoming context is visible whenever
              there's more than one lease attached. The "Combined" footer
              still sums *active* rent only — that's the figure the header
              card displays, and we want the two numbers to agree.
            */}
            {propLeases.length >= 2 && (
              <Card data-testid="card-active-leases-breakdown">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    {t("pages.propertyDetail.perLeaseRentBreakdown")}
                    <span className="text-xs font-normal text-muted-foreground">
                      {t("pages.propertyDetail.leasesOnThisProperty", { count: propLeases.length })}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 pt-0">
                  {(() => {
                    const STATUS_RANK: Record<string, number> = { Active: 0, Upcoming: 1, Expired: 2 };
                    const sorted = [...propLeases].sort(
                      (a, b) =>
                        (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) ||
                        (a.unit || "").localeCompare(b.unit || "", undefined, { numeric: true }) ||
                        a.endDate.localeCompare(b.endDate),
                    );
                    // Flag a rent wildly above its peers (e.g. a $10,000 typo
                    // for $1,000) against the median of the other active,
                    // positive rents on this property so data errors jump out.
                    const activeRents = propLeases
                      .filter((x) => x.status === "Active" && (x.monthlyRent || 0) > 0)
                      .map((x) => x.monthlyRent);
                    const median =
                      activeRents.length > 0
                        ? [...activeRents].sort((a, b) => a - b)[Math.floor(activeRents.length / 2)]
                        : 0;
                    return sorted.map((l) => {
                      const pdf = extractSourcePdfFilename(l.notes, l.clauses);
                      const anomalous = median > 0 && (l.monthlyRent || 0) > median * 2.5;
                      return (
                        <div
                          key={l.id}
                          className="flex items-center justify-between gap-2 text-sm py-1.5 border-b border-dashed last:border-b-0"
                          data-testid={`row-active-lease-rent-${l.id}`}
                        >
                          <Link href={`/leases/${l.id}?from=${encodeURIComponent(`/properties/${id}`)}`}>
                            <button
                              type="button"
                              className="text-left hover:underline flex items-center gap-2 min-w-0"
                              data-testid={`link-active-lease-${l.id}`}
                            >
                              <span className="font-semibold tabular-nums shrink-0">
                                {l.unit?.trim() ? l.unit : "—"}
                              </span>
                              <Badge
                                variant={
                                  l.status === "Active"
                                    ? "default"
                                    : l.status === "Expired"
                                    ? "destructive"
                                    : "secondary"
                                }
                                className="text-[10px] px-1.5 py-0 shrink-0"
                                data-testid={`badge-breakdown-status-${l.id}`}
                              >
                                {l.status}
                              </Badge>
                              <span className="text-xs text-muted-foreground truncate">
                                {l.startDate || "—"} → {l.endDate || "—"}
                              </span>
                            </button>
                          </Link>
                          <div className="flex items-center gap-2 shrink-0">
                            {anomalous && (
                              <span
                                className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-600"
                                title="Rent is far above the other units here — check for a typo"
                              >
                                <AlertTriangle className="h-3 w-3" /> check
                              </span>
                            )}
                            {pdf && (
                              <a
                                href={sourcePdfHref(pdf)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
                                title="Open the source lease PDF"
                                data-testid={`link-breakdown-pdf-${l.id}`}
                              >
                                <FileText className="h-3 w-3" /> PDF
                              </a>
                            )}
                            <span
                              className={
                                "font-medium tabular-nums " +
                                (l.status === "Active"
                                  ? anomalous
                                    ? "text-amber-600"
                                    : ""
                                  : "text-muted-foreground line-through decoration-muted")
                              }
                            >
                              {formatUsd(l.monthlyRent || 0)}{t("pages.propertyDetail.perMonthSuffix")}
                            </span>
                          </div>
                        </div>
                      );
                    });
                  })()}
                  <div
                    className="flex items-center justify-between text-sm pt-2 border-t font-semibold"
                    data-testid="row-active-lease-rent-total"
                  >
                    <span>{t("pages.propertyDetail.combinedActiveRent")}</span>
                    <span className="tabular-nums">
                      {formatUsd(monthlyLeaseCost)}{t("pages.propertyDetail.perMonthSuffix")}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Room totals — rolls up the per-room sqft / bath / rent that
                are edited on the Beds tab so customers can see them at a
                glance without leaving Overview. */}
            <Card data-testid="room-totals-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Home className="h-4 w-4" />
                  {t("pages.propertyDetail.roomTotals")}
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("pages.propertyDetail.roomTotalsRolledUp", { count: roomTotals.roomCount })}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {roomTotals.roomCount === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("pages.propertyDetail.roomTotalsEmpty")} <span className="font-medium text-foreground">{t("pages.propertyDetail.roomTotalsEmptyTab")}</span> {t("pages.propertyDetail.roomTotalsEmptySuffix")}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    <div data-testid="room-totals-rooms">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("pages.propertyDetail.rooms")}</p>
                      <p className="text-2xl font-bold mt-1 tabular-nums">{roomTotals.roomCount}</p>
                    </div>
                    <div data-testid="room-totals-sqft">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("pages.propertyDetail.totalSqft")}</p>
                      <p className="text-2xl font-bold mt-1 tabular-nums">
                        {roomTotals.totalSqft.toLocaleString()}
                        <span className="text-sm font-normal text-muted-foreground"> sqft</span>
                      </p>
                    </div>
                    <div data-testid="room-totals-bathrooms">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("pages.propertyDetail.totalBathrooms")}</p>
                      <p className="text-2xl font-bold mt-1 tabular-nums">
                        {Number.isInteger(roomTotals.totalBathrooms)
                          ? roomTotals.totalBathrooms
                          : roomTotals.totalBathrooms.toFixed(1)}
                      </p>
                    </div>
                    <div data-testid="room-totals-expected-rent">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("pages.propertyDetail.expectedRent")}</p>
                      <p className="text-2xl font-bold mt-1 tabular-nums">
                        {formatUsd(roomTotals.totalMonthlyRent)}
                        <span className="text-sm font-normal text-muted-foreground">{t("pages.propertyDetail.perMonthSuffix")}</span>
                      </p>
                      {expectedVsLeaseDelta !== null && (
                        <p
                          className={`text-xs mt-0.5 ${expectedVsLeaseDelta >= 0 ? "text-green-600" : "text-destructive"}`}
                          data-testid="room-totals-vs-lease"
                        >
                          {t("pages.propertyDetail.deltaVsLease", { sign: expectedVsLeaseDelta >= 0 ? "+" : "−", amount: formatUsd(Math.abs(expectedVsLeaseDelta)) })}
                        </p>
                      )}
                      {expectedVsLeaseDelta === null && monthlyLeaseCost > 0 && (
                        <p className="text-xs mt-0.5 text-muted-foreground">
                          {t("pages.propertyDetail.leaseRentInfo", { rent: formatUsd(monthlyLeaseCost) })}
                        </p>
                      )}
                    </div>
                    {pricePerSqft !== null && (
                      <div data-testid="room-totals-price-per-sqft">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("pages.propertyDetail.pricePerSqftLabel")}</p>
                        <p className="text-2xl font-bold mt-1 tabular-nums">
                          ${pricePerSqft.toFixed(2)}
                          <span className="text-sm font-normal text-muted-foreground">/sqft</span>
                        </p>
                        <p className="text-xs mt-0.5 text-muted-foreground">
                          {t("pages.propertyDetail.rentDivSqft")}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Property Details */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><Home className="h-4 w-4" />{t("pages.propertyDetail.propertyDetailsCard")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {([
                    { label: t("pages.propertyDetail.propertyName"), field: "name" },
                    { label: t("pages.propertyDetail.address"), field: "address" },
                    { label: t("pages.propertyDetail.city"), field: "city" },
                    { label: t("pages.propertyDetail.state"), field: "state" },
                    { label: t("pages.propertyDetail.zip"), field: "zip" },
                  ] as { label: string; field: keyof typeof property }[]).map(({ label, field }) => (
                    <div key={field} className="flex items-center justify-between py-1 border-b border-dashed border-border/50 last:border-0">
                      <span className="text-sm text-muted-foreground w-36 shrink-0">{label}</span>
                      <InlineEdit value={property[field] as string} onSave={v => updateProperty(id, { [field]: v } as Partial<Property>)} />
                    </div>
                  ))}
                  <div className="flex items-start justify-between py-1 border-b border-dashed border-border/50 gap-2">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground w-36 shrink-0 pt-1">
                      <Briefcase className="h-3.5 w-3.5" />{t("pages.propertyDetail.customer")}
                    </div>
                    <div className="flex-1 flex flex-col items-end gap-1.5" data-testid="property-customer-row">
                      {(() => {
                        const currentCustomer = customers.find((c) => c.id === property.customerId);
                        return currentCustomer ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/customers#customer-${currentCustomer.id}`)}
                            className="text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1"
                            data-testid="link-property-customer"
                            title="Open this customer on the Customers page"
                          >
                            {currentCustomer.name}
                            <ChevronLeft className="h-3 w-3 rotate-180" />
                          </button>
                        ) : (
                          <span className="text-sm italic text-muted-foreground">{t("pages.propertyDetail.unassigned")}</span>
                        );
                      })()}
                      <Select value={property.customerId} onValueChange={v => updateProperty(id, { customerId: v })}>
                        <SelectTrigger className="h-7 text-xs w-56" data-testid="select-property-customer">
                          <SelectValue placeholder={t("pages.propertyDetail.chooseCustomer")} />
                        </SelectTrigger>
                        <SelectContent>
                          {customers.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                    <span className="text-sm text-muted-foreground w-36 shrink-0">{t("pages.propertyDetail.type")}</span>
                    <Select
                      value={property.propertyType ?? "__none__"}
                      onValueChange={(v) =>
                        updateProperty(id, {
                          propertyType:
                            v === "__none__" ? null : (v as PropertyType),
                        })
                      }
                    >
                      <SelectTrigger
                        className="h-7 text-sm w-36"
                        data-testid="select-property-type"
                      >
                        <SelectValue placeholder={t("pages.propertyDetail.noType")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("pages.propertyDetail.noType")}</SelectItem>
                        {PROPERTY_TYPE_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {t(`common.propertyTypes.${opt}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                    <span className="text-sm text-muted-foreground w-36 shrink-0">{t("pages.propertyDetail.status")}</span>
                    <Select value={property.status} onValueChange={v => updateProperty(id, { status: v as "Active" | "Inactive" })}>
                      <SelectTrigger className="h-7 text-sm w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Active">{t("pages.propertyDetail.statusActive")}</SelectItem>
                        <SelectItem value="Inactive">{t("pages.propertyDetail.statusInactive")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                    <span className="text-sm text-muted-foreground w-36 shrink-0">{t("pages.propertyDetail.chargePerBedLabel")}</span>
                    <InlineEdit value={property.chargePerBed} prefix="$" type="number" onSave={v => updateProperty(id, { chargePerBed: parseFloat(v) })} />
                  </div>
                  <div className="py-1">
                    <span className="text-sm text-muted-foreground block mb-1">{t("pages.propertyDetail.notes")}</span>
                    <NotesEditor
                      value={property.notes}
                      className="text-sm min-h-[72px]"
                      onSave={v => updateProperty(id, { notes: v })}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Right column: Landlord stacked above Ratings */}
              <div className="space-y-4">
                {/* Landlord Info */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />{t("pages.propertyDetail.landlordContactCard")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {([
                      { label: t("pages.propertyDetail.landlordName"), field: "landlordName", icon: Users },
                      { label: t("pages.propertyDetail.landlordEmail"), field: "landlordEmail", icon: Mail },
                      { label: t("pages.propertyDetail.landlordPhone"), field: "landlordPhone", icon: Phone },
                    ] as { label: string; field: keyof typeof property; icon: React.ElementType }[]).map(({ label, field, icon: Icon }) => (
                      <div key={field} className="flex items-center justify-between py-1 border-b border-dashed border-border/50 last:border-0">
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground w-36 shrink-0">
                          <Icon className="h-3.5 w-3.5" />{label}
                        </div>
                        <InlineEdit value={property[field] as string} onSave={v => updateProperty(id, { [field]: v } as Partial<Property>)} />
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Ratings */}
                <RatingsCard
                  ratings={property.ratings}
                  onChange={(next) => updateProperty(id, { ratings: next })}
                />
              </div>

              {/* Payment Info */}
              <Card className="lg:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4" />{t("pages.propertyDetail.paymentDetailsCard")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Rent-free toggle (task #497). When enabled, the canonical
                      monthly rent is treated as $0 and the property's recurring
                      cost is the sum of the Other Costs editor below. */}
                  <div
                    className="flex items-center justify-between py-2 mb-3 border-b border-border/60"
                    data-testid="rent-free-toggle-row"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">Rent-free property</span>
                      <span className="text-xs text-muted-foreground">
                        Use this for cleaning-fee-only sites with no monthly rent.
                      </span>
                    </div>
                    <Switch
                      checked={property.rentFree ?? false}
                      onCheckedChange={(v) => updateProperty(id, { rentFree: v })}
                      data-testid="switch-rent-free"
                    />
                  </div>
                  {property.rentFree && (
                    <div className="mb-4" data-testid="other-costs-editor">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">{t("pages.propertyDetail.statOtherCosts")}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            addOtherCost({
                              id: `oc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                              propertyId: id,
                              label: "",
                              monthlyCost: 0,
                            })
                          }
                          data-testid="button-add-other-cost"
                        >
                          {t("pages.propertyDetail.addLine")}
                        </Button>
                      </div>
                      {propOtherCosts.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">
                          {t("pages.propertyDetail.noRecurringCosts")}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {propOtherCosts.map((c) => (
                            <div
                              key={c.id}
                              className="flex items-center gap-2"
                              data-testid={`other-cost-row-${c.id}`}
                            >
                              <InlineEdit
                                value={c.label}
                                onSave={(v) => updateOtherCost(c.id, { label: v })}
                                placeholder={t("pages.propertyDetail.labelPlaceholder")}
                              />
                              <InlineEdit
                                value={c.monthlyCost}
                                type="number"
                                prefix="$"
                                onSave={(v) =>
                                  updateOtherCost(c.id, { monthlyCost: parseFloat(v) || 0 })
                                }
                              />
                              <span className="text-xs text-muted-foreground">{t("pages.propertyDetail.perMonthSuffix")}</span>
                              <ConfirmDeleteButton
                                title="Delete this line item?"
                                description="This permanently removes the recurring cost line. You can't undo this."
                                onConfirm={() => deleteOtherCost(c.id)}
                                trigger={
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    aria-label={t("pages.propertyDetail.deleteOtherCostAria")}
                                    data-testid={`button-delete-other-cost-${c.id}`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                }
                              />
                            </div>
                          ))}
                          <div className="flex items-center justify-end gap-2 pt-1 border-t border-dashed border-border/50">
                            <span className="text-xs text-muted-foreground">{t("pages.propertyDetail.total")}</span>
                            <span
                              className="text-sm font-medium tabular-nums"
                              data-testid="other-costs-total"
                            >
                              {formatUsd(propOtherCostsTotal)}{t("pages.propertyDetail.perMonthSuffix")}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                    <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                      <span className="text-sm text-muted-foreground w-40 shrink-0">{t("pages.propertyDetail.paymentMethod")}</span>
                      <Select value={property.paymentMethod} onValueChange={v => updateProperty(id, { paymentMethod: v as Property["paymentMethod"] })}>
                        <SelectTrigger className="h-7 text-sm w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["ACH", "Check", "Wire", "Online Portal", "Money Order"].map(m => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                      <span className="text-sm text-muted-foreground w-40 shrink-0">{t("pages.propertyDetail.payTo")}</span>
                      <InlineEdit value={property.paymentRecipient} onSave={v => updateProperty(id, { paymentRecipient: v })} />
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                      <span className="text-sm text-muted-foreground w-40 shrink-0">{t("pages.propertyDetail.dueDayOfMonth")}</span>
                      <InlineEdit value={property.paymentDueDay} type="number" onSave={v => updateProperty(id, { paymentDueDay: parseInt(v) })} />
                    </div>
                    {/* Task #492: property-level default notice period; each
                        lease can still override per-lease. Empty/null means
                        "no notice configured" — alerts simply won't fire for
                        that property until either field is set. */}
                    <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                      <span className="text-sm text-muted-foreground w-40 shrink-0">{t("pages.propertyDetail.defaultNoticeDays")}</span>
                      <InlineEdit
                        value={property.defaultNoticePeriodDays ?? ""}
                        type="number"
                        placeholder="—"
                        testId="inline-property-default-notice-period-days"
                        onSave={v => {
                          const trimmed = v.trim();
                          if (trimmed === "") {
                            updateProperty(id, { defaultNoticePeriodDays: null });
                            return;
                          }
                          const n = parseInt(trimmed, 10);
                          updateProperty(id, {
                            defaultNoticePeriodDays:
                              Number.isFinite(n) && n >= 0 ? n : null,
                          });
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                      <div className="flex items-center gap-2 w-40 shrink-0">
                        <Select
                          value={property.rentFrequency ?? "Monthly"}
                          onValueChange={v => updateProperty(id, { rentFrequency: v as RentFrequency })}
                        >
                          <SelectTrigger
                            className="h-7 text-sm w-[110px]"
                            data-testid="rent-frequency-select"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {RENT_FREQUENCIES.map(f => (
                              <SelectItem key={f} value={f}>{f}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-sm text-muted-foreground">{t("pages.propertyDetail.rentLabel")}</span>
                      </div>
                      {(() => {
                        // The inline editor edits a single lease; with multiple active
                        // leases the operator should go to the Leases tab to disambiguate.
                        // We surface the SUM as a read-only value so the number on screen
                        // still matches the header and the Finance tab.
                        const freq: RentFrequency = property.rentFrequency ?? "Monthly";
                        const factor = RENT_FREQUENCY_FACTOR[freq];
                        const monthly = monthlyLeaseCost;
                        const displayAmount = Math.round(monthly * factor * 100) / 100;
                        const editableLease =
                          activeLeases.length === 1 ? activeLeases[0] : null;
                        if (!editableLease) {
                          return (
                            <span
                              className="text-sm tabular-nums text-muted-foreground"
                              data-testid="rent-amount-readonly"
                              title={
                                activeLeases.length === 0
                                  ? "No active lease — add one on the Leases tab"
                                  : `${activeLeases.length} active leases — open the Leases tab to edit each one`
                              }
                            >
                              {formatUsd(displayAmount)}
                            </span>
                          );
                        }
                        return (
                          <InlineEdit
                            value={displayAmount}
                            prefix="$"
                            type="number"
                            testId="rent-amount-inline-edit"
                            onSave={v => {
                              const entered = parseFloat(v);
                              if (Number.isNaN(entered)) return;
                              const newMonthly = entered / factor;
                              updateLease(editableLease.id, { monthlyRent: newMonthly });
                            }}
                          />
                        );
                      })()}
                    </div>
                    {property.paymentMethod !== "Online Portal" && (
                      <>
                        <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                          <span className="text-sm text-muted-foreground w-40 shrink-0">{t("pages.propertyDetail.bankName")}</span>
                          <InlineEdit value={property.bankName} onSave={v => updateProperty(id, { bankName: v })} />
                        </div>
                        <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                          <span className="text-sm text-muted-foreground w-40 shrink-0">{t("pages.propertyDetail.bankRouting")}</span>
                          <InlineEdit value={property.bankRouting} onSave={v => updateProperty(id, { bankRouting: v })} />
                        </div>
                        <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                          <span className="text-sm text-muted-foreground w-40 shrink-0">{t("pages.propertyDetail.bankAccount")}</span>
                          <InlineEdit value={property.bankAccount} onSave={v => updateProperty(id, { bankAccount: v })} />
                        </div>
                      </>
                    )}
                    {property.paymentMethod === "Online Portal" && (
                      <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground w-40 shrink-0"><Globe className="h-3.5 w-3.5" />{t("pages.propertyDetail.portalUrl")}</div>
                        <InlineEdit value={property.portalUrl} onSave={v => updateProperty(id, { portalUrl: v })} />
                      </div>
                    )}
                    <div className="sm:col-span-2 pt-1">
                      <span className="text-sm text-muted-foreground block mb-1">{t("pages.propertyDetail.paymentNotes")}</span>
                      <NotesEditor
                        value={property.paymentNotes}
                        className="text-sm min-h-[60px]"
                        onSave={v => updateProperty(id, { paymentNotes: v })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── LEASES TAB ── */}
          <TabsContent value="leases" className="space-y-4">
            <div className="flex justify-between items-center gap-3 flex-wrap">
              <p className="text-sm text-muted-foreground">
                {t("pages.propertyDetail.leasesForProperty", { count: propLeases.length })}
                {activeLeases.length >= 2 && (
                  <span
                    className="ml-2 inline-flex items-center gap-1 text-amber-700"
                    data-testid="text-leases-tab-multi-active"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {t("pages.propertyDetail.multiActiveCombined", { count: activeLeases.length })}
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {propBuildings.length > 1 && (
                  <div className="flex items-center gap-2">
                    <Label htmlFor="leases-building-filter" className="text-xs text-muted-foreground">
                      Building
                    </Label>
                    <Select
                      value={leasesBuildingFilter}
                      onValueChange={setLeasesBuildingFilter}
                    >
                      <SelectTrigger
                        id="leases-building-filter"
                        className="h-8 text-xs w-48"
                        data-testid="select-leases-building-filter"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All buildings</SelectItem>
                        {propBuildings.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <UploadLeasePdfDialog
                  propertyId={id}
                  buildings={propBuildings}
                  open={leaseUploadDialogOpen}
                  onOpenChange={(next) => {
                    setLeaseUploadDialogOpen(next);
                    if (!next) setLeaseUploadPendingFiles(null);
                  }}
                  pendingFiles={leaseUploadPendingFiles}
                  onPendingFilesConsumed={() => setLeaseUploadPendingFiles(null)}
                  trigger={
                    <Button size="sm" data-testid="button-add-lease">
                      <Plus className="h-4 w-4 mr-1.5" />
                      {t("dialogs.addLease.triggerLabel")}
                    </Button>
                  }
                />
              </div>
            </div>
            {/* Visible drop zone (Task #622). Pre-binds to the current
                propertyId via the controlled dialog above so dropping a
                PDF here lands the operator in the same review step as
                the in-dialog drop zone. */}
            <LeasePdfDropzone
              onFilesAccepted={handleLeasePdfDropped}
              headline={t("pages.propertyDetail.leasesDropzone.headline")}
              helperText={t("pages.propertyDetail.leasesDropzone.helper")}
              testId="dropzone-property-leases"
            />
            <Card>
              <CardContent className="p-0">
                <LeasesTable
                  leases={filteredLeasesForLeasesTab}
                  properties={properties}
                  otherCosts={otherCosts}
                  buildings={propBuildings}
                  showProperty={false}
                  showCustomer={false}
                  onDelete={deleteLease}
                  onMarkReviewed={(leaseId) => {
                    updateLease(leaseId, { needsReview: false });
                    toast({
                      title: "Marked as reviewed",
                      description: "The 'Needs review' flag has been cleared.",
                    });
                  }}
                  onUpdateLease={updateLease}
                  onBulkMarkReviewed={(ids) => {
                    for (const id of ids) {
                      updateLease(id, { needsReview: false });
                    }
                    toast({
                      title: `Marked ${ids.length} as reviewed`,
                      description: `Cleared the 'Needs review' flag on ${ids.length} ${
                        ids.length === 1 ? "lease" : "leases"
                      }.`,
                    });
                  }}
                  emptyMessage={t("pages.propertyDetail.noLeasesYet")}
                  // Render the branded EmptyState block (icon + headline +
                  // CTA) when this property has no leases — same treatment
                  // task #128 added to the global list pages. The CTA
                  // re-uses the AddLeaseDialog with the property pre-bound,
                  // mirroring the dialog wired up in the tab header.
                  emptyAction={
                    // Two routes from the empty state:
                    //  1. The quick AddLeaseDialog (primary) — fast path with
                    //     just the essential fields.
                    //  2. A secondary "Open full form" deep-link to the
                    //     lease-detail create page, which exposes
                    //     buyout/clauses/terms in one screen. Restored after
                    //     task #132 removed the placeholder-row shortcut.
                    //     `from=` round-trips back to this Leases tab.
                    <div className="flex flex-col items-center gap-2">
                      <UploadLeasePdfDialog
                        propertyId={id}
                        buildings={propBuildings}
                        trigger={
                          <Button size="sm" data-testid="button-add-lease-empty">
                            <Plus className="h-4 w-4 mr-1.5" />{t("pages.propertyDetail.addLease")}
                          </Button>
                        }
                      />
                      <Link
                        href={`/leases/new?propertyId=${encodeURIComponent(id)}&from=${encodeURIComponent(`/properties/${id}?tab=leases`)}`}
                        className="text-xs text-muted-foreground hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                        data-testid="link-add-lease-full-form-empty"
                      >
                        {t("pages.propertyDetail.openFullForm")}
                      </Link>
                    </div>
                  }
                  // Threaded so opening a lease here and clicking "Back"
                  // returns the user to *this* property's Leases tab,
                  // not the global Leases page. The `?tab=leases` is
                  // read by PropertyDetail's activeTab initializer so
                  // the round trip lands on the same tab. Same value is
                  // used by the placeholder row to forward `&from=` to
                  // the create page.
                  originPath={`/properties/${id}?tab=leases`}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── UNITS TAB (task #310) ──────────────────────────────
              For multi-unit properties (Park Place, Patriot Baraboo)
              we group leases by their `unit` field so operators can see
              "what's going on in 509" without scanning the full lease
              list. Each unit card shows the lease (active first), its
              term + rent, and any occupants we can resolve via the
              "Unit <n>" room → bed → occupant chain. */}
          {propertyUnits.length > 0 && (
            <TabsContent value="units" className="space-y-4" data-testid="tab-content-units">
              {/* Buildings roster (Task #570). Always rendered so operators
                  can rename or delete the back-filled "Main building" row,
                  and so multi-building properties get drill-down links. */}
              <Card data-testid="card-buildings-section">
                <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 space-y-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Buildings
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0" data-testid="badge-buildings-count">
                      {propBuildings.length}
                    </Badge>
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="button-add-building"
                    onClick={() => setAddBuildingOpen(true)}
                  >
                    <Plus className="h-4 w-4 mr-1.5" />
                    Add building
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {placeholderBuildings.length > 0 && (
                    <div
                      className="border border-amber-300 bg-amber-50 text-amber-900 rounded-md p-2.5 flex items-center justify-between gap-3 text-xs"
                      data-testid="placeholder-buildings-banner"
                    >
                      <div className="flex items-start gap-2 min-w-0">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>
                          {placeholderBuildings.length === 1
                            ? "Found 1 unused \"Building N\" placeholder row with no address, rooms, or leases."
                            : `Found ${placeholderBuildings.length} unused "Building N" placeholder rows with no address, rooms, or leases.`}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 bg-white"
                        disabled={cleaningPlaceholders}
                        data-testid="button-cleanup-placeholder-buildings"
                        onClick={async () => {
                          setCleaningPlaceholders(true);
                          try {
                            for (const b of placeholderBuildings) {
                              try {
                                await deleteBuilding(b.id);
                              } catch {
                                // Individual failure already toasted by
                                // the store; keep going so partial
                                // success still cleans what it can.
                              }
                            }
                          } finally {
                            setCleaningPlaceholders(false);
                          }
                        }}
                      >
                        {cleaningPlaceholders
                          ? "Cleaning up…"
                          : placeholderBuildings.length === 1
                            ? "Clean up 1 placeholder"
                            : `Clean up ${placeholderBuildings.length} placeholders`}
                      </Button>
                    </div>
                  )}
                  {propBuildings.length === 0 ? (
                    <p className="text-xs text-muted-foreground" data-testid="buildings-empty">
                      No buildings yet — add one to organize rooms by structure.
                    </p>
                  ) : (
                    propBuildings.map((b) => {
                      const buildingRoomCount = rooms.filter(
                        (r) => r.propertyId === id && r.buildingId === b.id,
                      ).length;
                      const isFocused = focusedBuildingId === b.id;
                      return (
                        <div
                          key={b.id}
                          className={`border rounded-md p-2.5 flex items-center justify-between gap-2 ${
                            isFocused ? "bg-accent/40" : ""
                          }`}
                          data-testid={`building-row-${b.id}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <InlineEdit
                              value={b.name}
                              onSave={(v) => updateBuilding(b.id, { name: v })}
                              displayClassName="font-medium text-sm"
                              inputClassName="w-48"
                              testId={`inline-edit-building-name-${b.id}`}
                            />
                            {b.address && (
                              <span className="text-xs text-muted-foreground truncate" title={b.address}>
                                · {b.address}
                              </span>
                            )}
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {buildingRoomCount} room{buildingRoomCount === 1 ? "" : "s"}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Link
                              href={`/properties/${id}/buildings/${b.id}?tab=beds`}
                            >
                              <Button
                                size="sm"
                                variant="ghost"
                                data-testid={`button-building-beds-${b.id}`}
                                title={`Show beds in ${b.name}`}
                              >
                                <BedDouble className="h-3.5 w-3.5 mr-1" />
                                Beds
                              </Button>
                            </Link>
                            <Link
                              href={
                                isFocused
                                  ? `/properties/${id}`
                                  : `/properties/${id}/buildings/${b.id}`
                              }
                            >
                              <Button
                                size="sm"
                                variant="ghost"
                                data-testid={`button-drilldown-building-${b.id}`}
                              >
                                {isFocused ? "Show all buildings" : "Drill down"}
                              </Button>
                            </Link>
                            {propBuildings.length > 1 && buildingRoomCount === 0 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                data-testid={`button-delete-building-${b.id}`}
                                onClick={async () => {
                                  try {
                                    await deleteBuilding(b.id);
                                  } catch {
                                    /* toast already shown */
                                  }
                                }}
                              >
                                Remove
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 space-y-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    {unitsBuildingFilter === "all"
                      ? `${propertyUnits.length} unit${propertyUnits.length === 1 ? "" : "s"} on this property`
                      : `${filteredPropertyUnits.length} of ${propertyUnits.length} unit${propertyUnits.length === 1 ? "" : "s"}`}
                  </CardTitle>
                  {propBuildings.length > 1 && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="units-building-filter" className="text-xs text-muted-foreground">
                        Building
                      </Label>
                      <Select
                        value={unitsBuildingFilter}
                        onValueChange={setUnitsBuildingFilter}
                      >
                        <SelectTrigger
                          id="units-building-filter"
                          className="h-8 text-xs w-48"
                          data-testid="select-units-building-filter"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All buildings</SelectItem>
                          {propBuildings.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {filteredPropertyUnits.length === 0 ? (
                    <p className="text-xs text-muted-foreground" data-testid="units-filter-empty">
                      No units in the selected building.
                    </p>
                  ) : null}
                  {filteredPropertyUnits.map(({ unit, leases: unitLeases, occupants: unitOccupants, beds: unitBeds }) => {
                    const activeLease = unitLeases.find((l) => l.status === "Active") ?? unitLeases[0];
                    return (
                      <div
                        key={unit}
                        className="border rounded-md p-3 space-y-2"
                        data-testid={`unit-card-${unit}`}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold" data-testid={`unit-label-${unit}`}>
                              Unit {unit}
                            </span>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              {unitLeases.length} lease{unitLeases.length === 1 ? "" : "s"}
                            </Badge>
                          </div>
                          {activeLease && (
                            <Link href={`/leases/${activeLease.id}?from=${encodeURIComponent(`/properties/${id}?tab=units`)}`}>
                              <button
                                type="button"
                                className="text-sm hover:underline flex items-center gap-2"
                                data-testid={`unit-active-lease-${unit}`}
                              >
                                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>{activeLease.startDate || "—"} → {activeLease.endDate || "—"}</span>
                                <Badge
                                  variant={activeLease.status === "Active" ? "default" : activeLease.status === "Expired" ? "destructive" : "secondary"}
                                  className="text-[10px] px-1.5 py-0"
                                >
                                  {activeLease.status}
                                </Badge>
                                <span className="font-medium tabular-nums">{formatUsd((activeLease.monthlyRent || 0))}/mo</span>
                              </button>
                            </Link>
                          )}
                        </div>
                        {unitOccupants.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5" data-testid={`unit-occupants-${unit}`}>
                            {unitOccupants.map((o) => (
                              <Link key={o.id} href={`/occupants/${o.id}`}>
                                <Badge
                                  variant="outline"
                                  className="text-xs gap-1 hover:bg-accent cursor-pointer"
                                  data-testid={`unit-occupant-${unit}-${o.id}`}
                                >
                                  <Users className="h-3 w-3" />
                                  {o.name}
                                </Badge>
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground" data-testid={`unit-occupants-empty-${unit}`}>
                            {unitBeds.length === 0
                              ? "No rooms seeded for this unit yet — add a room named \"Unit " + unit + "\" on the Beds tab to link occupants."
                              : "No active occupants assigned."}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── BEDS TAB (grouped by room, merged with occupants) ── */}
          <TabsContent value="beds" className="space-y-4">
            <ProjectedMoveInsSection
              propertyId={id ?? ""}
              propRooms={propRooms}
              propBeds={propBeds}
              propOccupants={propOccupants}
            />

            {/* One unified bed + occupant table (same as the customer Beds
                area): per-room rows, occupant ID/match, shift, move-in,
                projected move-out, and charge — assign / move / match / clean
                all inline. */}
            {property && <PropertyBedTable property={property} showHeaderLink={false} />}
          </TabsContent>

          {/* ── FURNISHINGS TAB ── */}
          <TabsContent value="furnishings" className="space-y-4">
            <FurnishingsPanel
              selected={property.furnishings ?? []}
              onChange={(next) => updateProperty(id, { furnishings: next })}
            />
          </TabsContent>

          {/* ── UTILITIES TAB ── */}
          <TabsContent value="utilities" className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                {t("pages.propertyDetail.utilityServicesLine", { count: propUtils.length, cost: formatUsd(propUtils.reduce((s, u) => s + u.monthlyCost, 0)) })}
              </p>
              <AddUtilityDialog propertyId={id} onAdd={addUtility} />
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("pages.propertyDetail.utilityType")}</TableHead>
                      <TableHead>{t("pages.propertyDetail.utilityCompany")}</TableHead>
                      <TableHead>{t("pages.propertyDetail.utilityAccount")}</TableHead>
                      <TableHead className="text-right">{t("pages.propertyDetail.utilityMonthlyCost")}</TableHead>
                      <TableHead>{t("pages.propertyDetail.utilityNotes")}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {propUtils.length === 0 ? (
                      <EmptyStateRow
                        colSpan={6}
                        icon={Zap}
                        title={t("pages.propertyDetail.noUtilitiesYet")}
                        description={t("pages.propertyDetail.noUtilitiesDescription")}
                        testId="empty-property-utilities"
                        action={
                          <AddUtilityDialog
                            propertyId={id}
                            onAdd={addUtility}
                            trigger={
                              <Button size="sm" data-testid="button-add-utility-empty">
                                <Plus className="h-4 w-4 mr-1.5" />{t("pages.propertyDetail.addService")}
                              </Button>
                            }
                          />
                        }
                      />
                    ) : propUtils.map(u => (
                      <TableRow key={u.id}>
                        <TableCell>
                          {/* Type is now inline-editable (was a read-only badge) so the
                              whole utility row can be updated in place. */}
                          <Select value={u.type} onValueChange={(v) => updateUtility(u.id, { type: v as typeof u.type })}>
                            <SelectTrigger
                              className={`h-7 w-32 gap-1.5 rounded-full border-0 px-2.5 text-xs font-medium ${TYPE_COLORS[u.type] ?? "bg-gray-100 text-gray-700"}`}
                              data-testid={`select-utility-type-${u.id}`}
                            >
                              <Zap className="h-3 w-3" />
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {UTILITY_TYPES.map((tp) => (
                                <SelectItem key={tp} value={tp}>{t(`common.utilityTypes.${tp}`)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><InlineEdit value={u.company} onSave={v => updateUtility(u.id, { company: v })} /></TableCell>
                        <TableCell className="font-mono text-sm"><InlineEdit value={u.accountNumber} onSave={v => updateUtility(u.id, { accountNumber: v })} /></TableCell>
                        <TableCell className="text-right"><InlineEdit value={u.monthlyCost} prefix="$" type="number" onSave={v => updateUtility(u.id, { monthlyCost: parseFloat(v) })} /></TableCell>
                        <TableCell><InlineEdit value={u.notes || ""} onSave={v => updateUtility(u.id, { notes: v })} /></TableCell>
                        <TableCell>
                          <ConfirmDeleteButton
                            title={t("pages.propertyDetail.deleteUtility.title")}
                            description={
                              <>
                                {t("pages.propertyDetail.deleteUtility.descriptionPrefix")}
                                <span className="font-medium text-foreground">{t(`common.utilityTypes.${u.type}`)}</span>
                                {t("pages.propertyDetail.deleteUtility.descriptionSuffix")}
                              </>
                            }
                            onConfirm={() => deleteUtility(u.id)}
                            testId={`dialog-confirm-delete-utility-${u.id}`}
                            trigger={
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" data-testid={`button-delete-utility-${u.id}`}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── INSURANCE TAB (Task #333) ── */}
          {/* Lists every certificate of insurance on file for this property
              (renter's, liability, etc.) along with a coverage window and
              the source PDF, plus an "Expiring soon" badge when the
              coverage end date is within 30 days. Operators can add new
              certificates inline so a paper-trail is always one click
              away from the property page. */}
          <TabsContent value="insurance" className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground" data-testid="text-insurance-count">
                {t("pages.propertyDetail.certificatesOnFile", { count: propCerts.length })}
              </p>
              <AddInsuranceCertificateDialog
                propertyId={id}
                leases={propLeases}
                onAdd={addInsuranceCertificate}
              />
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("pages.propertyDetail.insuranceCarrier")}</TableHead>
                      <TableHead>{t("pages.propertyDetail.insurancePolicy")}</TableHead>
                      <TableHead>{t("pages.propertyDetail.insuranceInsured")}</TableHead>
                      <TableHead>{t("pages.propertyDetail.insuranceCoverage")}</TableHead>
                      <TableHead>{t("pages.propertyDetail.insuranceStatus")}</TableHead>
                      <TableHead>{t("pages.propertyDetail.insuranceDocument")}</TableHead>
                      <TableHead>{t("pages.propertyDetail.insuranceNotes")}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {propCerts.length === 0 ? (
                      <EmptyStateRow
                        colSpan={8}
                        icon={ShieldCheck}
                        title={t("pages.propertyDetail.noCertificatesTitle")}
                        description={t("pages.propertyDetail.noCertificatesDescription")}
                        testId="empty-property-insurance"
                        action={
                          <AddInsuranceCertificateDialog
                            propertyId={id}
                            leases={propLeases}
                            onAdd={addInsuranceCertificate}
                            trigger={
                              <Button size="sm" data-testid="button-add-insurance-empty">
                                <Plus className="h-4 w-4 mr-1.5" />{t("pages.propertyDetail.addCertificate")}
                              </Button>
                            }
                          />
                        }
                      />
                    ) : propCerts.map(c => {
                      // Skip the daysUntil() throw on a blank coverage end —
                      // some PDFs only confirm the cert exists. A blank
                      // window simply gets no expiry badge.
                      const days = c.coverageEnd ? daysUntil(c.coverageEnd) : null;
                      const expiringSoon = days !== null && days >= 0 && days <= 30;
                      const expired = days !== null && days < 0;
                      return (
                        <TableRow
                          key={c.id}
                          data-testid={`row-insurance-${c.id}`}
                          className={
                            expired
                              ? "border-l-4 border-l-red-500"
                              : expiringSoon
                                ? "border-l-4 border-l-amber-500"
                                : ""
                          }
                        >
                          <TableCell>
                            <InlineEdit value={c.carrier} onSave={v => updateInsuranceCertificate(c.id, { carrier: v })} />
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            <InlineEdit value={c.policyNumber} onSave={v => updateInsuranceCertificate(c.id, { policyNumber: v })} />
                          </TableCell>
                          <TableCell>
                            <InlineEdit value={c.insuredName} onSave={v => updateInsuranceCertificate(c.id, { insuredName: v })} />
                          </TableCell>
                          <TableCell className="text-sm tabular-nums text-muted-foreground">
                            {c.coverageStart || c.coverageEnd ? (
                              <span data-testid={`text-insurance-${c.id}-coverage`}>
                                {c.coverageStart ? formatYMDPretty(c.coverageStart) : "—"}
                                {" → "}
                                {c.coverageEnd ? formatYMDPretty(c.coverageEnd) : "—"}
                              </span>
                            ) : (
                              <span className="italic">{t("pages.propertyDetail.noDates")}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {expired ? (
                              <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200" data-testid={`badge-insurance-${c.id}-expired`}>
                                {t("pages.propertyDetail.insuranceExpiredAgo", { days: Math.abs(days!) })}
                              </Badge>
                            ) : expiringSoon ? (
                              <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200" data-testid={`badge-insurance-${c.id}-expiring`}>
                                {t("pages.propertyDetail.insuranceExpiringSoon", { days })}
                              </Badge>
                            ) : days !== null ? (
                              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200" data-testid={`badge-insurance-${c.id}-active`}>
                                {t("pages.propertyDetail.insuranceActiveLeft", { days })}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[14rem]">
                            {c.documentUrl ? (
                              <div className="flex items-center gap-2">
                                <a
                                  href={certPdfHref(c.documentUrl)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-primary hover:underline text-sm inline-flex items-center gap-1"
                                  data-testid={`link-insurance-${c.id}-doc`}
                                >
                                  <FileText className="h-3.5 w-3.5" />{t("pages.propertyDetail.viewPdf")}
                                </a>
                                <InlineCertUpload certId={c.id} onUploaded={(url) => updateInsuranceCertificate(c.id, { documentUrl: url })} label={t("pages.propertyDetail.replace")} />
                              </div>
                            ) : (
                              <InlineCertUpload certId={c.id} onUploaded={(url) => updateInsuranceCertificate(c.id, { documentUrl: url })} label={t("pages.propertyDetail.upload")} />
                            )}
                          </TableCell>
                          <TableCell>
                            <InlineEdit value={c.notes || ""} onSave={v => updateInsuranceCertificate(c.id, { notes: v })} />
                          </TableCell>
                          <TableCell>
                            <ConfirmDeleteButton
                              title={t("pages.propertyDetail.deleteCertificate.title")}
                              description={
                                <>
                                  {t("pages.propertyDetail.deleteCertificate.descriptionPrefix")}
                                  <span className="font-medium text-foreground">{c.carrier || t("pages.propertyDetail.deleteCertificate.fallbackName")}</span>
                                  {t("pages.propertyDetail.deleteCertificate.descriptionSuffix")}
                                </>
                              }
                              onConfirm={() => deleteInsuranceCertificate(c.id)}
                              testId={`dialog-confirm-delete-insurance-${c.id}`}
                              trigger={
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" data-testid={`button-delete-insurance-${c.id}`}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              }
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── VIOLATIONS TAB (Task #499) ── */}
          {/* Per-property rule violations the operator has been notified
              about (typically by email). Summary card shows the running
              total plus a per-category breakdown so the worst offending
              category jumps out at a glance. Below that, rows are
              grouped by occupant so a single tenant generating multiple
              notices is easy to spot. */}
          <TabsContent value="violations" className="space-y-4">
            <ViolationsTab
              propertyId={id}
              violations={propertyViolations}
              occupants={propOccupants}
              onAdd={addPropertyViolation}
              onDelete={deletePropertyViolation}
              isLoading={violationsQuery.isLoading}
            />
          </TabsContent>

          {/* ── FINANCE TAB ── */}
          <TabsContent value="finance" className="space-y-4">
            <PropertyFinanceMiniChart propertyId={id} />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><DollarSign className="h-4 w-4" />{t("pages.propertyDetail.monthlyFinancialSummary")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Separator />
                <div className="space-y-2">
                  <div className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                    <span className="text-muted-foreground">{t("pages.propertyDetail.activeOccupants")}</span>
                    <span className="font-medium">{propOccupants.length}</span>
                  </div>
                  <div className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                    <span className="text-muted-foreground">{t("pages.propertyDetail.occupiedBeds")}</span>
                    <span className="font-medium">{occupiedBeds} / {propBeds.length}</span>
                  </div>
                  <div className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                    <span className="text-muted-foreground">{t("pages.propertyDetail.occupancyRate")}</span>
                    <span className="font-medium">{propBeds.length > 0 ? Math.round((occupiedBeds / propBeds.length) * 100) : 0}%</span>
                  </div>
                </div>

                <Separator />
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("pages.propertyDetail.revenue")}</p>
                {propOccupants.map(occ => (
                  <div key={occ.id} className="flex justify-between text-sm py-1 border-b border-dashed border-border/40">
                    <span className="text-muted-foreground">{t("pages.propertyDetail.bedChargeRow", { name: occ.name, frequency: occ.billingFrequency ?? "Monthly" })}</span>
                    <span className="font-medium text-green-600">+{formatUsd(toMonthlyCharge(occ.chargePerBed, occ.billingFrequency ?? "Monthly"))}{t("pages.propertyDetail.perMonthSuffix")}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-semibold py-2 border-b-2 border-border">
                  <span>{t("pages.propertyDetail.totalRevenue")}</span>
                  <span className="text-green-600">+{formatUsd(monthlyRevenue)}</span>
                </div>

                <Separator />
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("pages.propertyDetail.costs")}</p>
                <div className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                  <span className="text-muted-foreground">{t("pages.propertyDetail.leaseActive")}</span>
                  <span className="text-destructive">-{formatUsd(monthlyLeaseCost)}</span>
                </div>
                {hotelRateLeaseEstimates.map((h) => (
                  <div
                    key={h.lease.id}
                    className="flex justify-between text-xs py-1 pl-3 border-b border-dashed border-border/40 text-muted-foreground"
                    data-testid={`finance-hotel-rate-row-${h.lease.id}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Hotel className="h-3 w-3" />
                      {h.month && h.nights > 0
                        ? t("pages.propertyDetail.hotelRateRow", { count: h.nights, month: h.month, rate: formatUsd(h.nightlyRate) })
                        : t("pages.propertyDetail.hotelRateNoNights")}
                    </span>
                    <span className="tabular-nums">
                      {h.month && h.nights > 0
                        ? `≈ -${formatUsd(h.estimate)}`
                        : "—"}
                    </span>
                  </div>
                ))}
                {propUtils.map(u => (
                  <div key={u.id} className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                    <span className="text-muted-foreground">{t(`common.utilityTypes.${u.type}`)} ({u.company})</span>
                    <span className="text-destructive">-{formatUsd(u.monthlyCost)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-semibold py-2 border-b-2 border-border">
                  <span>{t("pages.propertyDetail.totalCosts")}</span>
                  <span className="text-destructive">-{formatUsd(totalCost)}</span>
                </div>

                <Separator />
                <div className={`flex justify-between text-base font-bold py-2 ${profit >= 0 ? "text-green-600" : "text-destructive"}`}>
                  <span>{t("pages.propertyDetail.netProfitLoss")}</span>
                  <span>{profit >= 0 ? "+" : ""}{formatUsd(profit)}</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        <AddBuildingDialog
          open={addBuildingOpen}
          onOpenChange={setAddBuildingOpen}
          property={property}
          defaultBuildingName={`Building ${propBuildings.length + 1}`}
          addBuilding={addBuilding}
          addLease={addLease}
        />
      </motion.div>
    </MainLayout>
  );
}

// AddLeaseDialog moved to @/components/add-lease-dialog so the same dialog
// can be used on both the per-property tab (with propertyId pre-bound) and
// the global Leases page (with a property picker).

// AssignOccupantDialog moved to @/components/assign-occupant-dialog so the
// same dialog can be reused on the dashboard's "Unplaced payroll" tile
// pre-filled with name + company + weekly deduction.

function AddUtilityDialog({ propertyId, onAdd, trigger }: { propertyId: string; onAdd: (u: Utility) => void; trigger?: React.ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    type: "Electric" as Utility["type"],
    company: "",
    monthlyCost: "",
    accountNumber: "",
    notes: "",
  });

  const submit = () => {
    if (!form.company || !form.monthlyCost) return;
    onAdd({
      id: `u-${Date.now()}`,
      propertyId,
      type: form.type,
      company: form.company,
      monthlyCost: parseFloat(form.monthlyCost),
      accountNumber: form.accountNumber,
      notes: form.notes,
    });
    setOpen(false);
    setForm({ type: "Electric", company: "", monthlyCost: "", accountNumber: "", notes: "" });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm"><Plus className="h-4 w-4 mr-1.5" />{t("pages.propertyDetail.addUtilityDialog.submit")}</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t("pages.propertyDetail.addUtilityDialog.title")}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <Label>{t("pages.propertyDetail.addUtilityDialog.type")}</Label>
            <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as Utility["type"] }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{UTILITY_TYPES.map(ut => <SelectItem key={ut} value={ut}>{t(`common.utilityTypes.${ut}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("pages.propertyDetail.addUtilityDialog.company")}</Label><Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder={t("pages.propertyDetail.addUtilityDialog.companyPlaceholder")} /></div>
            <div><Label>{t("pages.propertyDetail.addUtilityDialog.monthlyCost")}</Label><Input type="number" value={form.monthlyCost} onChange={e => setForm(f => ({ ...f, monthlyCost: e.target.value }))} placeholder="0.00" /></div>
            <div><Label>{t("pages.propertyDetail.addUtilityDialog.accountNumber")}</Label><Input value={form.accountNumber} onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} placeholder={t("pages.propertyDetail.addUtilityDialog.accountPlaceholder")} /></div>
          </div>
          <div><Label>{t("pages.propertyDetail.addUtilityDialog.notes")}</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder={t("pages.propertyDetail.addUtilityDialog.notesPlaceholder")} /></div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>{t("pages.propertyDetail.addUtilityDialog.cancel")}</Button>
            <Button onClick={submit}>{t("pages.propertyDetail.addUtilityDialog.submit")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function certPdfHref(documentUrl: string): string {
  if (documentUrl.startsWith("/api/")) return documentUrl;
  if (documentUrl.startsWith("http://") || documentUrl.startsWith("https://")) return documentUrl;
  return `/api/attached-assets/${encodeURIComponent(documentUrl)}`;
}

function InlineCertUpload({ certId, onUploaded, label = "Upload" }: { certId: string; onUploaded: (url: string) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading } = useUpload({
    basePath: "/api/storage",
    onSuccess: (response) => {
      onUploaded(`/api/storage${response.objectPath}`);
    },
  });
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) await uploadFile(file);
          if (ref.current) ref.current.value = "";
        }}
        data-testid={`input-insurance-${certId}-upload`}
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={isUploading}
        onClick={() => ref.current?.click()}
        data-testid={`button-insurance-${certId}-upload`}
      >
        {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Upload className="h-3 w-3 mr-1" />{label}</>}
      </Button>
    </>
  );
}

function AddInsuranceCertificateDialog({
  propertyId,
  leases,
  onAdd,
  trigger,
}: {
  propertyId: string;
  leases: Lease[];
  onAdd: (c: InsuranceCertificate) => void;
  trigger?: React.ReactNode;
}) {
  const { t } = useTranslation();
  // Sentinel because <SelectItem value=""> is disallowed by Radix — we
  // translate it back to an empty string when building the payload.
  const NO_LEASE = "__none__";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    carrier: "",
    policyNumber: "",
    insuredName: "",
    coverageStart: "",
    coverageEnd: "",
    documentUrl: "",
    notes: "",
    leaseId: NO_LEASE,
  });
  const [uploadedFileName, setUploadedFileName] = useState("");
  const { uploadFile, isUploading, progress } = useUpload({
    basePath: "/api/storage",
    onSuccess: (response) => {
      const servingUrl = `/api/storage${response.objectPath}`;
      setForm(f => ({ ...f, documentUrl: servingUrl }));
      setUploadedFileName(response.metadata?.name ?? "Uploaded");
    },
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = () => {
    if (!form.carrier) return;
    onAdd({
      id: `ins-${Date.now()}`,
      propertyId,
      leaseId: form.leaseId === NO_LEASE ? "" : form.leaseId,
      carrier: form.carrier,
      policyNumber: form.policyNumber,
      insuredName: form.insuredName,
      coverageStart: form.coverageStart,
      coverageEnd: form.coverageEnd,
      documentUrl: form.documentUrl,
      notes: form.notes,
    });
    setOpen(false);
    setForm({
      carrier: "", policyNumber: "", insuredName: "",
      coverageStart: "", coverageEnd: "", documentUrl: "", notes: "",
      leaseId: NO_LEASE,
    });
    setUploadedFileName("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" data-testid="button-add-insurance">
            <Plus className="h-4 w-4 mr-1.5" />{t("pages.propertyDetail.addInsuranceDialog.trigger")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t("pages.propertyDetail.addInsuranceDialog.title")}</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("pages.propertyDetail.addInsuranceDialog.carrier")}</Label>
              <Input
                value={form.carrier}
                onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))}
                placeholder={t("pages.propertyDetail.addInsuranceDialog.carrierPlaceholder")}
                data-testid="input-insurance-carrier"
              />
            </div>
            <div>
              <Label>{t("pages.propertyDetail.addInsuranceDialog.policy")}</Label>
              <Input
                value={form.policyNumber}
                onChange={e => setForm(f => ({ ...f, policyNumber: e.target.value }))}
                placeholder={t("pages.propertyDetail.addInsuranceDialog.policyPlaceholder")}
                data-testid="input-insurance-policy"
              />
            </div>
            <div className="col-span-2">
              <Label>{t("pages.propertyDetail.addInsuranceDialog.insured")}</Label>
              <Input
                value={form.insuredName}
                onChange={e => setForm(f => ({ ...f, insuredName: e.target.value }))}
                placeholder={t("pages.propertyDetail.addInsuranceDialog.insuredPlaceholder")}
                data-testid="input-insurance-insured"
              />
            </div>
            <div>
              <Label>{t("pages.propertyDetail.addInsuranceDialog.coverageStart")}</Label>
              <Input
                type="date"
                value={form.coverageStart}
                onChange={e => setForm(f => ({ ...f, coverageStart: e.target.value }))}
                data-testid="input-insurance-start"
              />
            </div>
            <div>
              <Label>{t("pages.propertyDetail.addInsuranceDialog.coverageEnd")}</Label>
              <Input
                type="date"
                value={form.coverageEnd}
                onChange={e => setForm(f => ({ ...f, coverageEnd: e.target.value }))}
                data-testid="input-insurance-end"
              />
            </div>
            <div className="col-span-2">
              <Label>{t("pages.propertyDetail.addInsuranceDialog.certificatePdf")}</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFileSelect}
                data-testid="input-insurance-file"
              />
              {form.documentUrl ? (
                <div className="flex items-center gap-2 mt-1">
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm truncate flex-1">{uploadedFileName || t("pages.propertyDetail.addInsuranceDialog.pdfAttached")}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => { setForm(f => ({ ...f, documentUrl: "" })); setUploadedFileName(""); }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full mt-1"
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-insurance-upload"
                >
                  {isUploading ? (
                    <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />{t("pages.propertyDetail.addInsuranceDialog.uploading", { progress })}</>
                  ) : (
                    <><Upload className="h-4 w-4 mr-1.5" />{t("pages.propertyDetail.addInsuranceDialog.uploadPdf")}</>
                  )}
                </Button>
              )}
            </div>
            {leases.length > 0 && (
              <div className="col-span-2">
                <Label>{t("pages.propertyDetail.addInsuranceDialog.linkedLease")}</Label>
                <Select
                  value={form.leaseId}
                  onValueChange={v => setForm(f => ({ ...f, leaseId: v }))}
                >
                  <SelectTrigger data-testid="select-insurance-lease"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LEASE}>{t("pages.propertyDetail.addInsuranceDialog.notLeaseSpecific")}</SelectItem>
                    {leases.map(l => (
                      <SelectItem key={l.id} value={l.id}>
                        {t("pages.propertyDetail.addInsuranceDialog.leaseLabel", { label: l.startDate || l.id })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div>
            <Label>{t("pages.propertyDetail.addInsuranceDialog.notes")}</Label>
            <Textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder={t("pages.propertyDetail.addInsuranceDialog.notesPlaceholder")}
              data-testid="input-insurance-notes"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>{t("pages.propertyDetail.addInsuranceDialog.cancel")}</Button>
            <Button onClick={submit} data-testid="button-insurance-submit">{t("pages.propertyDetail.addInsuranceDialog.submit")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Furnishings Panel ──────────────────────────────────────────────────
function FurnishingsPanel({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const [search, setSearch] = useState("");
  const selectedSet = new Set(selected);
  const totalSelected = selected.length;
  const totalAvailable = ALL_FURNISHINGS_COUNT;
  const pct = totalAvailable === 0 ? 0 : Math.round((totalSelected / totalAvailable) * 100);

  // When toggling an item that belongs to a category's radioGroup
  // (mutually-exclusive set), make sure the sibling option is removed
  // so only one value from the group is ever selected at a time. Plain
  // checkbox items behave as before.
  const findRadioGroup = (item: string) =>
    FURNISHING_CATEGORIES.find(c => c.radioGroup?.options.includes(item))
      ?.radioGroup;

  const toggleItem = (item: string) => {
    if (selectedSet.has(item)) {
      onChange(selected.filter(f => f !== item));
      return;
    }
    const group = findRadioGroup(item);
    if (group) {
      const siblings = new Set(group.options);
      onChange([...selected.filter(f => !siblings.has(f)), item]);
    } else {
      onChange([...selected, item]);
    }
  };

  const selectRadio = (group: NonNullable<FurnishingCategory["radioGroup"]>, value: string | null) => {
    const siblings = new Set(group.options);
    const others = selected.filter(f => !siblings.has(f));
    onChange(value ? [...others, value] : others);
  };

  const setCategory = (items: string[], select: boolean) => {
    const others = selected.filter(f => !items.includes(f));
    onChange(select ? [...others, ...items] : others);
  };

  const clearAll = () => onChange([]);

  const q = search.trim().toLowerCase();
  const visibleCategories = FURNISHING_CATEGORIES.map(cat => ({
    ...cat,
    visibleItems: q ? cat.items.filter(i => i.toLowerCase().includes(q)) : cat.items,
  })).filter(cat => cat.visibleItems.length > 0);

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Sofa className="h-4 w-4" /> Furnishings &amp; Amenities
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Track what's included at this property — from beds and appliances to building amenities like a gym or pool.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-2xl font-bold tabular-nums">{totalSelected}<span className="text-sm font-normal text-muted-foreground"> / {totalAvailable}</span></div>
                <div className="text-xs text-muted-foreground">{pct}% included</div>
              </div>
              {totalSelected > 0 && (
                <Button variant="outline" size="sm" onClick={clearAll} data-testid="furnishings-clear-all">
                  <X className="h-3.5 w-3.5 mr-1" /> Clear all
                </Button>
              )}
            </div>
          </div>
          {/* progress bar */}
          <div className="mt-4 h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="h-full bg-emerald-500 rounded-full"
            />
          </div>
          <div className="mt-4">
            <Input
              placeholder="Search furnishings (e.g. 'pool', 'wifi', 'fridge')..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 text-sm"
              data-testid="furnishings-search"
            />
          </div>
        </CardContent>
      </Card>

      {/* Branded EmptyState when no furnishings have been picked yet —
          visual parity with the Leases / Beds / Utilities tabs (task
          #132). Renders alongside the category checklists below so
          operators still see where to start tagging amenities. */}
      {totalSelected === 0 && q === "" && (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Sofa}
              title="No furnishings selected yet"
              description="Pick from the category checklists below to mark what's included at this property — beds, appliances, building amenities, and more."
              testId="empty-property-furnishings"
            />
          </CardContent>
        </Card>
      )}

      {/* Category cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {visibleCategories.length === 0 && (
          <Card className="lg:col-span-2">
            <CardContent className="p-0">
              <EmptyState
                icon={Sofa}
                title={`No furnishings match "${search}"`}
                description="Try a different keyword, or clear the search to browse every category checklist."
                testId="empty-property-furnishings-search"
              />
            </CardContent>
          </Card>
        )}
        {visibleCategories.map(cat => {
          const Icon = FURNISHING_ICONS[cat.iconName] ?? Sparkles;
          const catItemsSelected = cat.items.filter(i => selectedSet.has(i)).length;
          const catSelectedInVisible = cat.visibleItems.filter(i => selectedSet.has(i)).length;
          const radioGroup = cat.radioGroup;
          const radioValue = radioGroup?.options.find(o => selectedSet.has(o)) ?? null;
          const radioSelectedCount = radioValue ? 1 : 0;
          const catSelectedTotal = catItemsSelected + radioSelectedCount;
          const catTotal = cat.items.length + (radioGroup ? 1 : 0);
          // "Select all"/"Clear" only operates on the regular checkbox
          // items — the radio group is left to the segmented control so
          // the toolbar doesn't accidentally pick Onsite vs Offsite for
          // the operator.
          const allInCatSelected = catItemsSelected === cat.items.length;
          const radioBadgeLabel = radioValue
            ? radioGroup?.shortLabels?.[radioValue] ?? radioValue
            : null;

          return (
            <Card key={cat.id} data-testid={`furnishings-category-${cat.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {cat.name}
                    {radioBadgeLabel && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border border-emerald-200"
                        data-testid={`furnishings-${cat.id}-radio-badge`}
                      >
                        {radioBadgeLabel}
                      </Badge>
                    )}
                    <span className="text-xs font-normal text-muted-foreground">
                      {catSelectedTotal}/{catTotal}
                    </span>
                  </CardTitle>
                  <button
                    type="button"
                    onClick={() => setCategory(cat.items, !allInCatSelected)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {allInCatSelected ? "Clear" : "Select all"}
                  </button>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                {radioGroup && (
                  <div data-testid={`furnishings-${cat.id}-radio-group`}>
                    <div className="text-xs font-medium text-muted-foreground mb-1.5">
                      {radioGroup.label}
                    </div>
                    <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
                      {radioGroup.options.map(option => {
                        const isOn = radioValue === option;
                        const short = radioGroup.shortLabels?.[option] ?? option;
                        return (
                          <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={isOn}
                            onClick={() => selectRadio(radioGroup, isOn ? null : option)}
                            data-testid={`furnishings-${cat.id}-radio-${short.toLowerCase()}`}
                            className={
                              "px-3 py-1 rounded text-xs font-medium transition-colors " +
                              (isOn
                                ? "bg-emerald-600 text-white shadow-sm"
                                : "text-muted-foreground hover:text-foreground")
                            }
                          >
                            {short}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        role="radio"
                        aria-checked={radioValue === null}
                        onClick={() => selectRadio(radioGroup, null)}
                        data-testid={`furnishings-${cat.id}-radio-na`}
                        className={
                          "px-3 py-1 rounded text-xs font-medium transition-colors " +
                          (radioValue === null
                            ? "bg-white text-foreground shadow-sm border border-border"
                            : "text-muted-foreground hover:text-foreground")
                        }
                      >
                        N/A
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {cat.visibleItems.map(item => {
                    const isOn = selectedSet.has(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => toggleItem(item)}
                        data-testid={`furnishing-${item}`}
                        className={
                          "px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1 " +
                          (isOn
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                            : "bg-white text-muted-foreground border-border hover:bg-muted hover:text-foreground")
                        }
                      >
                        {isOn ? <CheckCircle2 className="h-3 w-3" /> : <Plus className="h-3 w-3 opacity-60" />}
                        {item}
                      </button>
                    );
                  })}
                  {cat.visibleItems.length !== cat.items.length && (
                    <span className="text-xs text-muted-foreground self-center px-1">
                      ({cat.items.length - cat.visibleItems.length} more match other searches)
                    </span>
                  )}
                </div>
                {catSelectedInVisible === 0 && cat.visibleItems.length === cat.items.length && (
                  <p className="text-xs text-muted-foreground mt-3 italic">No items selected in this category.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── Violations Tab (Task #499) ──────────────────────────────────────────

const VIOLATION_CATEGORY_ICONS: Record<PropertyViolationCategory, LucideIcon> = {
  smoking: Cigarette,
  parking: Car,
  noise: Volume2,
  police: Siren,
  maintenance: Wrench,
  cleanliness: Sparkle,
  other: MoreHorizontal,
};

const VIOLATION_CATEGORY_BADGE_CLASSES: Record<PropertyViolationCategory, string> = {
  smoking: "bg-orange-50 text-orange-700 border-orange-200",
  parking: "bg-blue-50 text-blue-700 border-blue-200",
  noise: "bg-purple-50 text-purple-700 border-purple-200",
  police: "bg-red-50 text-red-700 border-red-200",
  maintenance: "bg-amber-50 text-amber-700 border-amber-200",
  cleanliness: "bg-emerald-50 text-emerald-700 border-emerald-200",
  other: "bg-slate-50 text-slate-700 border-slate-200",
};

function ViolationsTab({
  propertyId,
  violations,
  occupants,
  onAdd,
  onDelete,
  isLoading,
}: {
  propertyId: string;
  violations: PropertyViolation[];
  occupants: Occupant[];
  onAdd: (v: PropertyViolation) => void;
  onDelete: (id: string) => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  // Per-category counts power the summary card. Built from the
  // canonical category list so every bucket renders even when empty —
  // operators can see at a glance which categories are quiet vs hot.
  const counts = useMemo(() => {
    const c: Record<PropertyViolationCategory, number> = {
      smoking: 0, parking: 0, noise: 0, police: 0,
      maintenance: 0, cleanliness: 0, other: 0,
    };
    for (const v of violations) c[v.category] += 1;
    return c;
  }, [violations]);

  // Group rows by occupant. Rows whose `occupantId` no longer matches
  // an active occupant land in a "Former / unknown occupant" bucket so
  // the historical record stays visible. Within each group, rows are
  // sorted by `occurredOn` desc so the most recent notice surfaces
  // first.
  const grouped = useMemo(() => {
    type Group = { key: string; name: string; rows: PropertyViolation[] };
    const byKey = new Map<string, Group>();
    for (const v of violations) {
      const key = v.occupantId || `__unknown__:${v.occupantName || "Unknown"}`;
      const existing = byKey.get(key);
      const name = v.occupantId
        ? occupants.find((o) => o.id === v.occupantId)?.name ||
          v.occupantName ||
          "Former occupant"
        : v.occupantName || "Unknown occupant";
      if (existing) {
        existing.rows.push(v);
      } else {
        byKey.set(key, { key, name, rows: [v] });
      }
    }
    for (const g of byKey.values()) {
      g.rows.sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
    }
    return [...byKey.values()].sort(
      (a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name),
    );
  }, [violations, occupants]);

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-rose-600" />
                Rule Violations
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Smoking, parking, noise, police and other notices logged
                against this property.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div
                  className="text-2xl font-bold tabular-nums"
                  data-testid="text-violations-total"
                >
                  {violations.length}
                </div>
                <div className="text-xs text-muted-foreground">
                  total {violations.length === 1 ? "notice" : "notices"}
                </div>
              </div>
              <AddPropertyViolationDialog
                propertyId={propertyId}
                occupants={occupants}
                onAdd={onAdd}
              />
            </div>
          </div>
          <Separator className="my-4" />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {PROPERTY_VIOLATION_CATEGORIES.map((cat) => {
              const Icon = VIOLATION_CATEGORY_ICONS[cat];
              const n = counts[cat];
              return (
                <div
                  key={cat}
                  className={
                    "rounded-md border px-2 py-2 flex items-center gap-2 " +
                    (n > 0 ? VIOLATION_CATEGORY_BADGE_CLASSES[cat] : "bg-muted/30 text-muted-foreground border-border")
                  }
                  data-testid={`stat-violations-${cat}`}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">
                      {t(`common.violationCategories.${cat}`)}
                    </div>
                    <div className="text-sm font-semibold tabular-nums">
                      {n}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Per-occupant grouped list */}
      {isLoading ? (
        <Card>
          <CardContent className="p-6 space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </CardContent>
        </Card>
      ) : violations.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={ShieldAlert}
              title="No violations on file"
              description="Log a notice from the property manager here so a paper trail builds up against the offending occupant."
              testId="empty-property-violations"
              action={
                <AddPropertyViolationDialog
                  propertyId={propertyId}
                  occupants={occupants}
                  onAdd={onAdd}
                  trigger={
                    <Button size="sm" data-testid="button-add-violation-empty">
                      <Plus className="h-4 w-4 mr-1.5" />Log Violation
                    </Button>
                  }
                />
              }
            />
          </CardContent>
        </Card>
      ) : (
        grouped.map((g) => (
          <Card key={g.key} data-testid={`violation-group-${g.key}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  {g.name}
                </CardTitle>
                <Badge variant="secondary" className="tabular-nums" data-testid={`badge-violation-group-${g.key}-count`}>
                  {t("pages.propertyDetail.violations.noticesCount", { count: g.rows.length })}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">{t("pages.propertyDetail.violations.date")}</TableHead>
                    <TableHead className="w-40">{t("pages.propertyDetail.violations.category")}</TableHead>
                    <TableHead>{t("pages.propertyDetail.violations.notes")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.rows.map((v) => {
                    const Icon = VIOLATION_CATEGORY_ICONS[v.category];
                    return (
                      <TableRow key={v.id} data-testid={`row-violation-${v.id}`}>
                        <TableCell className="text-sm tabular-nums text-muted-foreground align-top">
                          {v.occurredOn ? formatYMDPretty(v.occurredOn) : "—"}
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge
                            variant="outline"
                            className={VIOLATION_CATEGORY_BADGE_CLASSES[v.category]}
                            data-testid={`badge-violation-${v.id}-category`}
                          >
                            <Icon className="h-3 w-3 mr-1" />
                            {t(`common.violationCategories.${v.category}`)}
                            {v.category === "other" && v.details
                              ? ` · ${v.details}`
                              : ""}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top">
                          {v.notes ? (
                            <pre
                              className="whitespace-pre-wrap font-sans text-sm text-foreground/90 max-w-xl"
                              data-testid={`text-violation-${v.id}-notes`}
                            >
                              {v.notes}
                            </pre>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">{t("pages.propertyDetail.violations.noNotes")}</span>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <ConfirmDeleteButton
                            title={t("pages.propertyDetail.violations.deleteTitle")}
                            description={
                              <>
                                {t("pages.propertyDetail.violations.deleteDescriptionPrefix")}
                                <span className="font-medium text-foreground">
                                  {t(`common.violationCategories.${v.category}`)}
                                </span>
                                {t("pages.propertyDetail.violations.deleteDescriptionSuffix", { group: g.name })}
                              </>
                            }
                            onConfirm={() => onDelete(v.id)}
                            testId={`dialog-confirm-delete-violation-${v.id}`}
                            trigger={
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                data-testid={`button-delete-violation-${v.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function AddPropertyViolationDialog({
  propertyId,
  occupants,
  onAdd,
  trigger,
}: {
  propertyId: string;
  occupants: Occupant[];
  onAdd: (v: PropertyViolation) => void;
  trigger?: React.ReactNode;
}) {
  const { t } = useTranslation();
  // Sentinel — Radix's <SelectItem> can't take an empty string, so we
  // translate this back to "" + "Unknown" when building the payload.
  const NO_OCCUPANT = "__none__";
  const todayYMD = () => {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  };
  const initialForm = () => ({
    occupantId: occupants[0]?.id ?? NO_OCCUPANT,
    category: "smoking" as PropertyViolationCategory,
    details: "",
    occurredOn: todayYMD(),
    notes: "",
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialForm);

  const reset = () => setForm(initialForm());
  const submit = () => {
    if (!form.occurredOn) return;
    const occupant = occupants.find((o) => o.id === form.occupantId);
    onAdd({
      id: `viol-${Date.now()}`,
      propertyId,
      occupantId: occupant?.id ?? "",
      occupantName: occupant?.name ?? "",
      category: form.category,
      details: form.category === "other" ? form.details : "",
      notes: form.notes,
      occurredOn: form.occurredOn,
      createdBy: "",
    });
    setOpen(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" data-testid="button-add-violation">
            <Plus className="h-4 w-4 mr-1.5" />{t("pages.propertyDetail.violations.logTrigger")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("pages.propertyDetail.violations.addTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("pages.propertyDetail.violations.occupant")}</Label>
              <Select
                value={form.occupantId}
                onValueChange={(v) => setForm((f) => ({ ...f, occupantId: v }))}
              >
                <SelectTrigger data-testid="select-violation-occupant">
                  <SelectValue placeholder={t("pages.propertyDetail.violations.occupantPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OCCUPANT}>{t("pages.propertyDetail.violations.occupantUnknown")}</SelectItem>
                  {occupants.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name || t("pages.propertyDetail.violations.occupantUnnamed")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("pages.propertyDetail.violations.categoryLabel")}</Label>
              <Select
                value={form.category}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, category: v as PropertyViolationCategory }))
                }
              >
                <SelectTrigger data-testid="select-violation-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROPERTY_VIOLATION_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {t(`common.violationCategories.${cat}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.category === "other" && (
              <div className="col-span-2">
                <Label>{t("pages.propertyDetail.violations.whatKind")}</Label>
                <Input
                  value={form.details}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, details: e.target.value }))
                  }
                  placeholder={t("pages.propertyDetail.violations.whatKindPlaceholder")}
                  data-testid="input-violation-details"
                />
              </div>
            )}
            <div className="col-span-2">
              <Label>{t("pages.propertyDetail.violations.dateLabel")}</Label>
              <Input
                type="date"
                value={form.occurredOn}
                onChange={(e) =>
                  setForm((f) => ({ ...f, occurredOn: e.target.value }))
                }
                data-testid="input-violation-date"
              />
            </div>
          </div>
          <div>
            <Label>{t("pages.propertyDetail.violations.notesEmail")}</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={t("pages.propertyDetail.violations.notesEmailPlaceholder")}
              className="min-h-[8rem]"
              data-testid="input-violation-notes"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("pages.propertyDetail.violations.cancel")}
            </Button>
            <Button onClick={submit} data-testid="button-violation-submit">
              {t("pages.propertyDetail.violations.submit")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
