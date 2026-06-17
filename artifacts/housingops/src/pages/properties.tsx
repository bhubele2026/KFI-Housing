import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import { PropertyNameCell } from "@/components/property-name-cell";
import { formatPropertyName } from "@/lib/property-name";
import { InlineEdit } from "@/pages/property-detail";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { HousingAuditPanel } from "@/components/housing-audit-panel";
import { useData } from "@/context/data-store";
import { RenewLeasePopover } from "@/components/renew-lease-popover";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { getRenewalInfo, computeOverallRating, computeRentPerBed, computeElectricPerBed, computeRentPlusElectricPerBed, daysUntil, RATING_CATEGORIES, PROPERTY_TYPE_OPTIONS, type Property, type Customer, type RatingCategoryKey, type PropertyType, type Bed, type Lease, type InsuranceCertificate } from "@/data/mockData";
import { isBlankYMD, formatYMDPretty } from "@/lib/lease-dates";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Search, Plus, ChevronRight, ChevronDown, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Briefcase, X, Download, Home, Map as MapIcon, Table as TableIcon, MapPinOff, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { PortfolioMap, type MappableProperty } from "@/components/portfolio-map";
import { EmptyStateRow } from "@/components/empty-state";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { motion } from "framer-motion";
import { StarRating } from "@/components/star-rating";
import { SkeletonRows } from "@/components/skeleton-rows";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { toCsv, downloadCsv, timestampedCsvName } from "@/lib/csv";
import {
  dismissGeocodeFailure,
  formatGeocodeAddress,
  loadMapsApi,
  retryGeocode,
  undismissGeocodeFailure,
} from "@/lib/google-maps-sdk";
import {
  useDismissedGeocodeFailures,
  useGeocodeFailureTimestamps,
} from "@/hooks/use-geocode-failures";
import { CheckedAgoLabel } from "@/components/checked-ago-label";
import { useRuntimeConfigQuery, useRuntimeConfigStream } from "@/hooks/use-runtime-config";

type SortDir = "asc" | "desc" | null;
type SortKey = "customer" | "rating" | "totalBeds" | "occupied" | "vacant";
type MinRating = "any" | "3" | "4" | "5";
type RatingSortKey = "overall" | RatingCategoryKey;
// The category the Min-rating filter applies to. Mirrors the rating
// sort dimensions so the filter can target Overall or any one of the
// six rating categories independently of how the list is sorted.
type RatingFilterCategory = RatingSortKey;
type ViewMode = "table" | "map";

const RATING_SORT_OPTIONS: { key: RatingSortKey; label: string }[] = [
  { key: "overall", label: "Overall" },
  ...RATING_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
];

/**
 * Returns the property's value for the given rating dimension, or null when
 * unrated so the caller can sort unrated properties to the end. Per-category
 * values of 0 mean "not yet rated" and are treated as null.
 */
function getRatingValueFor(p: Property, key: RatingSortKey): number | null {
  if (key === "overall") return computeOverallRating(p.ratings);
  const v = p.ratings?.[key] ?? 0;
  return v > 0 ? v : null;
}

// Persisted toolbar preferences for the Properties list. Stored in
// localStorage so the user's last sort/filter choices survive a refresh
// AND a return navigation (URL params alone wouldn't survive navigating
// away to another page and back).
//
// The customer filter is intentionally NOT persisted here — it already
// has its own ?customer= URL contract that other pages rely on for
// deep-linking.
const PROPERTIES_PREFS_STORAGE_KEY = "housingops:properties:prefs";
const VALID_STATUS_FILTERS = new Set<string>(["All", "Active", "Inactive"]);
const VALID_MIN_RATINGS = new Set<MinRating>(["any", "3", "4", "5"]);
const VALID_SORT_KEYS = new Set<SortKey>(["customer", "rating", "totalBeds", "occupied", "vacant"]);
const VALID_SORT_DIRS = new Set<Exclude<SortDir, null>>(["asc", "desc"]);
const VALID_RATING_SORT_KEYS = new Set<RatingSortKey>(
  RATING_SORT_OPTIONS.map((o) => o.key),
);
const VALID_VIEW_MODES = new Set<ViewMode>(["table", "map"]);

interface PersistedPrefs {
  statusFilter?: string;
  minRating?: MinRating;
  ratingFilterCategory?: RatingFilterCategory;
  sortKey?: SortKey;
  sortDir?: Exclude<SortDir, null>;
  ratingSortCategory?: RatingSortKey;
  viewMode?: ViewMode;
  // Customer ids whose collapsible group the operator has explicitly
  // expanded. The Properties table now groups properties by customer
  // (one collapsible row per customer); this set captures the per-row
  // expansion state so it survives refresh / back-navigation under the
  // same prefs key as the rest of the toolbar.
  expandedCustomerIds?: string[];
}

function readPersistedPrefs(): PersistedPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PROPERTIES_PREFS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: PersistedPrefs = {};
    if (typeof parsed.statusFilter === "string" && VALID_STATUS_FILTERS.has(parsed.statusFilter)) {
      out.statusFilter = parsed.statusFilter;
    }
    if (typeof parsed.minRating === "string" && VALID_MIN_RATINGS.has(parsed.minRating as MinRating)) {
      out.minRating = parsed.minRating as MinRating;
    }
    if (
      typeof parsed.ratingFilterCategory === "string" &&
      VALID_RATING_SORT_KEYS.has(parsed.ratingFilterCategory as RatingFilterCategory)
    ) {
      out.ratingFilterCategory = parsed.ratingFilterCategory as RatingFilterCategory;
    }
    // Sort key + direction must agree: persisting one without the other
    // would render meaningless state.
    if (
      typeof parsed.sortKey === "string" &&
      VALID_SORT_KEYS.has(parsed.sortKey as SortKey) &&
      typeof parsed.sortDir === "string" &&
      VALID_SORT_DIRS.has(parsed.sortDir as Exclude<SortDir, null>)
    ) {
      out.sortKey = parsed.sortKey as SortKey;
      out.sortDir = parsed.sortDir as Exclude<SortDir, null>;
    }
    if (
      typeof parsed.ratingSortCategory === "string" &&
      VALID_RATING_SORT_KEYS.has(parsed.ratingSortCategory as RatingSortKey)
    ) {
      out.ratingSortCategory = parsed.ratingSortCategory as RatingSortKey;
    }
    if (
      typeof parsed.viewMode === "string" &&
      VALID_VIEW_MODES.has(parsed.viewMode as ViewMode)
    ) {
      out.viewMode = parsed.viewMode as ViewMode;
    }
    if (Array.isArray(parsed.expandedCustomerIds)) {
      const ids = parsed.expandedCustomerIds.filter(
        (x): x is string => typeof x === "string" && x.length > 0,
      );
      if (ids.length > 0) out.expandedCustomerIds = ids;
    }
    return out;
  } catch {
    return {};
  }
}

function writePersistedPrefs(prefs: {
  statusFilter: string;
  minRating: MinRating;
  ratingFilterCategory: RatingFilterCategory;
  sortKey: SortKey | null;
  sortDir: SortDir;
  ratingSortCategory: RatingSortKey;
  viewMode: ViewMode;
  expandedCustomerIds: string[];
}): void {
  if (typeof window === "undefined") return;
  try {
    // Only persist non-default values so storage doesn't accumulate
    // stale state — when the user clears everything we drop the key.
    const cleaned: PersistedPrefs = {};
    if (prefs.statusFilter !== "All") cleaned.statusFilter = prefs.statusFilter;
    if (prefs.minRating !== "any") cleaned.minRating = prefs.minRating;
    // The rating filter category is only meaningful when an actual minimum
    // is set — otherwise the dimension doesn't affect the list. Skipping it
    // when minRating is "any" keeps storage clean of inert state.
    if (prefs.minRating !== "any" && prefs.ratingFilterCategory !== "overall") {
      cleaned.ratingFilterCategory = prefs.ratingFilterCategory;
    }
    if (prefs.sortKey && prefs.sortDir) {
      cleaned.sortKey = prefs.sortKey;
      cleaned.sortDir = prefs.sortDir;
    }
    // Only persist the rating sort category when it's actually being used
    // (i.e. the user is sorting by rating) and is non-default.
    if (
      prefs.sortKey === "rating" &&
      prefs.sortDir &&
      prefs.ratingSortCategory !== "overall"
    ) {
      cleaned.ratingSortCategory = prefs.ratingSortCategory;
    }
    if (prefs.viewMode !== "table") cleaned.viewMode = prefs.viewMode;
    if (prefs.expandedCustomerIds.length > 0) {
      cleaned.expandedCustomerIds = [...prefs.expandedCustomerIds];
    }
    if (Object.keys(cleaned).length === 0) {
      window.localStorage.removeItem(PROPERTIES_PREFS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PROPERTIES_PREFS_STORAGE_KEY, JSON.stringify(cleaned));
    }
  } catch {
    // Quota errors / disabled storage / private mode — silently ignore;
    // this is a UX nicety, not a correctness requirement.
  }
}

interface PropertyDraft {
  name: string;
  customerId: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  // Optional classification (task #501). `null` = "no type chosen yet";
  // we don't force a default at create time so the badge stays hidden
  // until the operator picks one.
  propertyType: PropertyType | null;
}

const EMPTY_PROPERTY_DRAFT: PropertyDraft = {
  name: "",
  customerId: "",
  address: "",
  city: "",
  state: "",
  zip: "",
  propertyType: null,
};

// Sentinel used by the "Type" Select to represent the optional/empty
// state. shadcn's <Select> can't carry an actual empty string as an
// item value, so we map "" ↔ null at the boundary.
const NO_PROPERTY_TYPE_VALUE = "__none__";

// Synthetic group id for the "Inactive" bucket that collects every
// Inactive property at the bottom of the list, regardless of customer.
const INACTIVE_GROUP_ID = "__inactive__";

interface NewCustomerDraft {
  name: string;
  contactName: string;
  email: string;
  phone: string;
}

const EMPTY_NEW_CUSTOMER: NewCustomerDraft = {
  name: "",
  contactName: "",
  email: "",
  phone: "",
};

const NEW_CUSTOMER_VALUE = "__new__";

export default function Properties() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  // Defensive fallback to `[]` for `utilities` keeps existing tests
  // with partial `useData` mocks from crashing on the per-bed-electric
  // pre-compute below — production always returns an array.
  const { properties, beds, leases, customers, buildings, utilities = [], insuranceCertificates, addProperty, addCustomer, updateProperty, updateLease, isLoading } = useData();
  const { customerId: customerFilter, setCustomerId: updateCustomerFilter } =
    useCustomerScope();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  // Hydrate persisted toolbar prefs once on mount so the user's last
  // sort/filter choices survive refresh and return navigation. Search
  // and customer filter are intentionally excluded — see notes above
  // PROPERTIES_PREFS_STORAGE_KEY. The customer filter is owned by the
  // shared CustomerScopeProvider, not local state.
  const [initialPrefs] = useState<PersistedPrefs>(() => readPersistedPrefs());
  const [statusFilter, setStatusFilter] = useState<string>(
    () => initialPrefs.statusFilter ?? "All",
  );
  const [minRating, setMinRating] = useState<MinRating>(
    () => initialPrefs.minRating ?? "any",
  );
  const [ratingFilterCategory, setRatingFilterCategory] =
    useState<RatingFilterCategory>(
      () => initialPrefs.ratingFilterCategory ?? "overall",
    );
  const [sortKey, setSortKey] = useState<SortKey | null>(
    () => initialPrefs.sortKey ?? null,
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    () => initialPrefs.sortDir ?? null,
  );
  const [ratingSortCategory, setRatingSortCategory] = useState<RatingSortKey>(
    () => initialPrefs.ratingSortCategory ?? "overall",
  );
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => initialPrefs.viewMode ?? "table",
  );
  // Per-customer expand/collapse for the customer-grouped table. Hydrated
  // from the same prefs key as the rest of the toolbar so a refresh /
  // back-navigation lands on the operator's last expanded set. The
  // "auto-expand" rules below (single-customer scope, search match,
  // single visible group) are layered on top at render time — this set
  // only captures the operator's manual clicks.
  const [expandedCustomerIds, setExpandedCustomerIds] = useState<Set<string>>(
    () => new Set(initialPrefs.expandedCustomerIds ?? []),
  );

  // URL-driven so the dashboard "Needs review" tile can deep-link straight
  // to properties missing rent (`?needsReview=1`), mirroring occupants.tsx.
  // Deliberately NOT persisted to localStorage — this is a transient
  // triage view, not a saved preference.
  const searchString = useSearch();
  const [needsReviewFilter, setNeedsReviewFilter] = useState<"All" | "NeedsReview">(
    () =>
      new URLSearchParams(searchString).get("needsReview") === "1"
        ? "NeedsReview"
        : "All",
  );
  useEffect(() => {
    const next: "All" | "NeedsReview" =
      new URLSearchParams(searchString).get("needsReview") === "1"
        ? "NeedsReview"
        : "All";
    setNeedsReviewFilter((prev) => (prev === next ? prev : next));
  }, [searchString]);
  const clearNeedsReviewFilter = () => {
    setNeedsReviewFilter("All");
    const params = new URLSearchParams(window.location.search);
    params.delete("needsReview");
    const qs = params.toString();
    navigate(qs ? `/properties?${qs}` : "/properties", { replace: true });
  };

  // Persist toolbar prefs whenever they change. writePersistedPrefs
  // strips defaults and removes the storage key entirely when the user
  // is back to a fully-default toolbar, so storage doesn't accumulate
  // stale state.
  useEffect(() => {
    writePersistedPrefs({
      statusFilter,
      minRating,
      ratingFilterCategory,
      sortKey,
      sortDir,
      ratingSortCategory,
      viewMode,
      expandedCustomerIds: Array.from(expandedCustomerIds),
    });
  }, [statusFilter, minRating, ratingFilterCategory, sortKey, sortDir, ratingSortCategory, viewMode, expandedCustomerIds]);

  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState<PropertyDraft>(EMPTY_PROPERTY_DRAFT);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState<NewCustomerDraft>(EMPTY_NEW_CUSTOMER);

  const customerById = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) map.set(c.id, c);
    return map;
  }, [customers]);

  // Pre-compute total/occupied/vacant bed counts per property so both
  // the table cells AND the map's info bubble pull from the same source
  // — the bubble would otherwise have to re-filter `beds` for every
  // pin, and the two views could drift out of sync if the table's
  // counting logic ever changed. Declared above `filtered` so the bed-
  // count column sorts can read from it without a TDZ.
  // Pre-compute monthly Electric utility totals per property so the
  // map bubble's rent+electric/bed metric shares one pass over `utilities`
  // instead of filtering it per pin.
  const monthlyElectricByPropertyId = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of utilities) {
      if (u.type !== "Electric") continue;
      map.set(u.propertyId, (map.get(u.propertyId) ?? 0) + (u.monthlyCost || 0));
    }
    return map;
  }, [utilities]);

  const bedStatsByPropertyId = useMemo(() => {
    const map = new Map<
      string,
      { total: number; occupied: number; vacant: number }
    >();
    for (const b of beds) {
      const cur =
        map.get(b.propertyId) ?? { total: 0, occupied: 0, vacant: 0 };
      cur.total += 1;
      if (b.status === "Occupied") cur.occupied += 1;
      else cur.vacant += 1;
      map.set(b.propertyId, cur);
    }
    return map;
  }, [beds]);

  const filtered = useMemo(() => {
    const minRatingValue = minRating === "any" ? null : Number(minRating);

    const list = properties.filter((p) => {
      const customerName = customerById.get(p.customerId)?.name ?? "";
      const q = search.toLowerCase();
      const matchesSearch =
        p.name.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        customerName.toLowerCase().includes(q);
      const matchesStatus = statusFilter === "All" || p.status === statusFilter;
      // Shared-housing properties (task #295) also surface under each
      // customer in `sharedWithCustomerIds` in addition to the primary
      // `customerId`, so the customer filter must check both.
      const sharedIds = p.sharedWithCustomerIds ?? [];
      const matchesCustomer =
        customerFilter === ALL_CUSTOMERS ||
        p.customerId === customerFilter ||
        sharedIds.includes(customerFilter);
      // Needs review = property missing a monthly rent (0 / unset).
      // Mirrors the "incomplete record" pattern used by the occupants
      // missing-move-in subset and lets the dashboard tile deep-link in.
      // Rent-free properties (task #497) are never "missing rent" — the
      // canonical rent is intentionally $0, so they shouldn't surface
      // in the missing-rent triage queue alongside genuinely incomplete
      // records.
      if (needsReviewFilter === "NeedsReview" && (p.rentFree || (p.monthlyRent || 0) > 0)) {
        return false;
      }
      let matchesRating = true;
      if (minRatingValue !== null) {
        // Compare against whichever rating dimension the user picked —
        // Overall by default, or any one of the six per-category ratings.
        // Unrated properties (null) for that dimension are excluded so the
        // behavior matches the previous overall-only filter.
        const value = getRatingValueFor(p, ratingFilterCategory);
        matchesRating = value !== null && value >= minRatingValue;
      }
      return matchesSearch && matchesStatus && matchesCustomer && matchesRating;
    });

    if (sortKey && sortDir) {
      if (sortKey === "customer") {
        list.sort((a, b) => {
          const an = customerById.get(a.customerId)?.name ?? "";
          const bn = customerById.get(b.customerId)?.name ?? "";
          const cmp = an.localeCompare(bn);
          return sortDir === "asc" ? cmp : -cmp;
        });
      } else if (sortKey === "rating") {
        list.sort((a, b) => {
          const ar = getRatingValueFor(a, ratingSortCategory);
          const br = getRatingValueFor(b, ratingSortCategory);
          // Unrated properties always sort to the end, regardless of direction.
          if (ar === null && br === null) return 0;
          if (ar === null) return 1;
          if (br === null) return -1;
          const cmp = ar - br;
          return sortDir === "asc" ? cmp : -cmp;
        });
      } else if (sortKey === "totalBeds" || sortKey === "occupied" || sortKey === "vacant") {
        // Numeric column sort. Zero / missing values always sort to the
        // end so an unbedded property doesn't push real rows out of
        // view when sorting ascending.
        const valueOf = (p: Property): number | null => {
          const stats = bedStatsByPropertyId.get(p.id);
          if (!stats || stats.total === 0) return null;
          if (sortKey === "totalBeds") return stats.total;
          if (sortKey === "occupied") return stats.occupied;
          return stats.vacant;
        };
        list.sort((a, b) => {
          const av = valueOf(a);
          const bv = valueOf(b);
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          const cmp = av - bv;
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }
    return list;
  }, [properties, search, statusFilter, customerFilter, minRating, ratingFilterCategory, needsReviewFilter, sortKey, sortDir, ratingSortCategory, customerById, bedStatsByPropertyId]);

  // Group the already-filtered/sorted property list by customer so the
  // table can render one collapsible row per customer with the property
  // rows nested inside. The grouping is purely presentational — we
  // preserve the original `filtered` order within each group so all the
  // existing sort controls (rating, beds, etc.) still apply within the
  // expanded section.
  const customerGroups = useMemo(() => {
    const map = new Map<string, Property[]>();
    // Inactive properties don't belong under their customer — they drop
    // into a single "Inactive" bucket rendered last.
    const inactive: Property[] = [];
    for (const p of filtered) {
      if (p.status === "Inactive") {
        inactive.push(p);
        continue;
      }
      // Surface shared-housing properties (task #295) under every
      // customer that uses them — the primary `customerId` AND every
      // entry in `sharedWithCustomerIds`. Single-tenant properties
      // (the common case) only land in one group because the shared
      // list is empty by default.
      const groupIds = new Set<string>([p.customerId]);
      for (const cid of p.sharedWithCustomerIds ?? []) groupIds.add(cid);
      // When the operator has scoped to a single customer, only emit
      // that customer's group — otherwise a shared-housing property
      // whose primary customerId differs from the scope (e.g. Ridge
      // Motor Inn primary=Penda, scoped to Trienda) would still
      // surface a Penda group containing only the shared row, which
      // contradicts the scope chip.
      if (customerFilter !== ALL_CUSTOMERS) {
        for (const cid of [...groupIds]) {
          if (cid !== customerFilter) groupIds.delete(cid);
        }
      }
      for (const cid of groupIds) {
        const arr = map.get(cid) ?? [];
        arr.push(p);
        map.set(cid, arr);
      }
    }
    const list: { customer: Customer; properties: Property[] }[] = [];
    for (const [cid, props] of map) {
      const customer = customerById.get(cid);
      if (customer) {
        list.push({ customer, properties: props });
      } else {
        // Defensive fallback: if a property points to a customerId we
        // can't resolve (stale data, pre-load race), still surface it
        // under a synthetic header so it isn't silently dropped.
        list.push({
          customer: {
            id: cid,
            name: t("toasts.unknownCustomer"),
            contactName: "",
            email: "",
            phone: "",
            notes: "",
          } as Customer,
          properties: props,
        });
      }
    }
    // Customer groups always render alphabetically by customer name —
    // matches the sidebar ordering and keeps the list stable as
    // properties are added.
    list.sort((a, b) => a.customer.name.localeCompare(b.customer.name));
    // Append the Inactive bucket at the very bottom, after the
    // alphabetical customer groups.
    if (inactive.length > 0) {
      list.push({
        customer: {
          id: INACTIVE_GROUP_ID,
          name: t("pages.properties.inactiveBucket", { defaultValue: "Inactive" }),
          contactName: "",
          email: "",
          phone: "",
          notes: "",
        } as Customer,
        properties: inactive,
      });
    }
    return list;
  }, [filtered, customerById, customerFilter, t]);

  // Per-property derived data used by the grouped table rows. Previously
  // these filter/find/IIFE chains were computed inline inside
  // `customerGroups.map(...)`, so every parent render walked `beds`,
  // `leases`, `insuranceCertificates`, and `buildings` once per visible
  // property. Memoizing a Map keyed by property id collapses all of that
  // into a single pass that only re-runs when the underlying lists
  // change.
  const propertyRowDataById = useMemo(() => {
    // Group source lists by propertyId in a single pass so the per-row
    // lookup is O(1) instead of an O(N) `.filter` per property.
    const bedsByProp = new Map<string, Bed[]>();
    for (const b of beds) {
      const arr = bedsByProp.get(b.propertyId);
      if (arr) arr.push(b);
      else bedsByProp.set(b.propertyId, [b]);
    }
    const activeLeaseByProp = new Map<string, Lease>();
    for (const l of leases) {
      if (l.status !== "Active") continue;
      if (!activeLeaseByProp.has(l.propertyId)) {
        activeLeaseByProp.set(l.propertyId, l);
      }
    }
    const certsByProp = new Map<string, InsuranceCertificate[]>();
    for (const c of insuranceCertificates) {
      if (!c.coverageEnd) continue;
      const arr = certsByProp.get(c.propertyId);
      if (arr) arr.push(c);
      else certsByProp.set(c.propertyId, [c]);
    }
    const buildingCountByProp = new Map<string, number>();
    for (const b of buildings) {
      buildingCountByProp.set(
        b.propertyId,
        (buildingCountByProp.get(b.propertyId) ?? 0) + 1,
      );
    }
    const out = new Map<
      string,
      {
        propBeds: Bed[];
        occupied: number;
        vacant: number;
        activeLease: Lease | undefined;
        renewal: ReturnType<typeof getRenewalInfo>;
        showNoEndDate: boolean;
        overallRating: number | null;
        customer: Customer | undefined;
        worstInsuranceCert: { days: number; coverageEnd: string } | null;
        buildingCount: number;
      }
    >();
    for (const property of filtered) {
      const propBeds = bedsByProp.get(property.id) ?? [];
      let occupied = 0;
      for (const b of propBeds) if (b.status === "Occupied") occupied++;
      const activeLease = activeLeaseByProp.get(property.id);
      const renewal = activeLease ? getRenewalInfo(activeLease.endDate) : null;
      const showNoEndDate =
        !!activeLease && !renewal && isBlankYMD(activeLease.endDate);
      const overallRating = computeOverallRating(property.ratings);
      const customer = customerById.get(property.customerId);
      const propCerts = certsByProp.get(property.id) ?? [];
      let worstInsuranceCert: { days: number; coverageEnd: string } | null = null;
      for (const c of propCerts) {
        const d = daysUntil(c.coverageEnd);
        if (d > 30) continue;
        if (!worstInsuranceCert || d < worstInsuranceCert.days) {
          worstInsuranceCert = { days: d, coverageEnd: c.coverageEnd };
        }
      }
      out.set(property.id, {
        propBeds,
        occupied,
        vacant: propBeds.length - occupied,
        activeLease,
        renewal,
        showNoEndDate,
        overallRating,
        customer,
        worstInsuranceCert,
        buildingCount: buildingCountByProp.get(property.id) ?? 0,
      });
    }
    return out;
  }, [filtered, beds, leases, insuranceCertificates, buildings, customerById]);

  // Search auto-expands every group containing a match. Since `filtered`
  // already excludes non-matching properties, the presence of any
  // properties in a group while a search is active means it has a
  // match — we don't need to re-test text here.
  const isSearchActive = search.trim().length > 0;
  const isCustomerScoped = customerFilter !== ALL_CUSTOMERS;

  const isGroupEffectivelyExpanded = useCallback(
    (customerId: string): boolean => {
      // When the operator has scoped to one customer, that group is
      // auto-expanded — picking a customer should "drop down" their
      // properties without needing an extra click.
      if (isCustomerScoped && customerId === customerFilter) return true;
      // Search results auto-expand so matches are visible without the
      // operator having to click each customer to find them.
      if (isSearchActive) return true;
      // When only a single group is in view (e.g. only one customer's
      // properties match the active filters), there's nothing to hide
      // behind a collapse — auto-expand it so the page isn't a single
      // mystery row.
      if (customerGroups.length === 1) return true;
      return expandedCustomerIds.has(customerId);
    },
    [
      isCustomerScoped,
      customerFilter,
      isSearchActive,
      customerGroups.length,
      expandedCustomerIds,
    ],
  );

  const toggleCustomerGroup = useCallback((customerId: string) => {
    setExpandedCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  }, []);

  const cycleSort = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    // Same column: asc -> desc -> off
    if (sortDir === "asc") {
      setSortDir("desc");
    } else if (sortDir === "desc") {
      setSortKey(null);
      setSortDir(null);
    } else {
      setSortDir("asc");
    }
  };

  const toggleCustomerSort = () => cycleSort("customer");
  const toggleTotalBedsSort = () => cycleSort("totalBeds");
  const toggleOccupiedSort = () => cycleSort("occupied");
  const toggleVacantSort = () => cycleSort("vacant");

  /**
   * Cycle through the rating sort for the chosen category. Picking a different
   * category from the active one resets to ascending. Same category cycles
   * asc → desc → off, matching the column-header sort behavior elsewhere.
   */
  const cycleRatingSort = (category: RatingSortKey) => {
    if (sortKey !== "rating" || ratingSortCategory !== category) {
      setSortKey("rating");
      setRatingSortCategory(category);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") {
      setSortDir("desc");
    } else if (sortDir === "desc") {
      setSortKey(null);
      setSortDir(null);
    } else {
      setSortDir("asc");
    }
  };

  const customerSortDir: SortDir = sortKey === "customer" ? sortDir : null;
  const ratingSortDir: SortDir = sortKey === "rating" ? sortDir : null;
  const totalBedsSortDir: SortDir = sortKey === "totalBeds" ? sortDir : null;
  const occupiedSortDir: SortDir = sortKey === "occupied" ? sortDir : null;
  const vacantSortDir: SortDir = sortKey === "vacant" ? sortDir : null;

  // Shared icon for the new numeric column sort headers — keeps every
  // header rendering identical chevrons without each one repeating the
  // same ternary.
  const numericSortIcon = (dir: SortDir) =>
    dir === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5" />
    ) : dir === "desc" ? (
      <ArrowDown className="h-3.5 w-3.5" />
    ) : (
      <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
    );
  const sortAriaSuffix = (dir: SortDir) =>
    dir === "asc"
      ? " (currently ascending)"
      : dir === "desc"
        ? " (currently descending)"
        : "";
  const openAdd = () => {
    setDraft(EMPTY_PROPERTY_DRAFT);
    setShowNewCustomerForm(false);
    setNewCustomer(EMPTY_NEW_CUSTOMER);
    setAddOpen(true);
  };

  const [saving, setSaving] = useState(false);

  const handleSaveProperty = async () => {
    if (saving) return;
    const name = draft.name.trim();
    if (!name) {
      toast({
        title: t("toasts.nameRequiredTitle"),
        description: t("toasts.propertyNameRequiredDescription"),
        variant: "destructive",
      });
      return;
    }

    let customerId = draft.customerId;
    if (showNewCustomerForm) {
      const cName = newCustomer.name.trim();
      if (!cName) {
        toast({
          title: t("toasts.newCustomerNameRequiredTitle"),
          description: t("toasts.newCustomerNameRequiredDescription"),
          variant: "destructive",
        });
        return;
      }
      customerId = `cust-${Date.now()}`;
    }
    if (!customerId) {
      toast({
        title: t("toasts.customerSelectionRequiredTitle"),
        description: t("toasts.customerSelectionRequiredDescription"),
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      // If we're inline-creating a customer, persist it FIRST and await the
      // server response. The property's POST will then pass the backend's
      // foreign-key check on customerId. Without this await they race.
      if (showNewCustomerForm) {
        try {
          await addCustomer({
            id: customerId,
            name: newCustomer.name.trim(),
            contactName: newCustomer.contactName.trim(),
            email: newCustomer.email.trim(),
            phone: newCustomer.phone.trim(),
            notes: "",
            state: "",
            customShifts: [],
            isInactive: false,
          });
        } catch {
          toast({
            title: t("toasts.couldntCreateCustomerTitle"),
            description: t("toasts.couldntCreateCustomerDescription"),
            variant: "destructive",
          });
          return;
        }
      }

      const newProperty: Property = {
        id: `prop-${Date.now()}`,
        customerId,
        name,
        address: draft.address.trim(),
        city: draft.city.trim(),
        state: draft.state.trim(),
        zip: draft.zip.trim(),
        totalBeds: 0,
        monthlyRent: 0,
        chargePerBed: 0,
        status: "Active",
        landlordName: "",
        landlordEmail: "",
        landlordPhone: "",
        paymentMethod: "ACH",
        paymentRecipient: "",
        paymentDueDay: 1,
        paymentNotes: "",
        bankName: "",
        bankRouting: "",
        bankAccount: "",
        portalUrl: "",
        notes: "",
        furnishings: [],
        propertyType: draft.propertyType,
      };

      try {
        const saved = await addProperty(newProperty);
        toast({ title: t("toasts.propertyAddedTitle"), description: t("toasts.propertyAddedDescription", { name }) });
        setAddOpen(false);
        // Save-time geocode warning (Task #228). The property already
        // saved (POST returned 201) — this toast only flags that
        // Google couldn't pinpoint the address so the operator can fix
        // the typo immediately instead of finding it days later in the
        // missing-address side panel. `skipped` (blank address) and
        // `ok` paths stay silent. We tolerate `geocodeStatus` being
        // absent because older deployments may not yet ship the field.
        const geocodeStatus = (saved as Property & {
          geocodeStatus?: "ok" | "no_result" | "skipped";
        }).geocodeStatus;
        if (geocodeStatus === "no_result") {
          toast({
            title: t("toasts.geocode.couldntLocateTitle"),
            description: t("toasts.geocode.couldntLocateDescription", { name }),
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: t("toasts.couldntCreatePropertyTitle"),
          description: t("toasts.couldntCreatePropertyDescription"),
          variant: "destructive",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const activeCustomerName =
    customerFilter === ALL_CUSTOMERS
      ? null
      : customerById.get(customerFilter)?.name ?? null;

  // Subscribe to the shared in-session geocode cache. Any address
  // Google has rejected anywhere in the app — the portfolio map below,
  // a per-property Location card the operator visited earlier, etc. —
  // surfaces here so the rollup panel can list every property whose
  // address Google can't pinpoint without each surface having to push
  // into a parallel store.
  //
  // We subscribe via the timestamps hook (Map of address →
  // lastCheckedAt) and use it for BOTH the failure-set lookup
  // (`.has(addr)`, `.size`) AND the per-row "Checked N ago" label.
  // Calling only one hook keeps us from running two parallel
  // subscriptions over the same shared cache. The Map updates live
  // as new failures land or get re-recorded.
  const geocodeFailureTimestamps = useGeocodeFailureTimestamps();

  // Subscribe to the dismissed-failures set so the rollup's footer
  // can list every address the operator has hidden this session AND
  // offer an Undo affordance per row. Without this channel, the only
  // recovery from a misclick on Dismiss was a hard refresh — which
  // also wiped the rest of the failure cache.
  const dismissedAddressSet = useDismissedGeocodeFailures();

  // Whether the dismissed footer is expanded into its row list.
  // Starts collapsed so the panel doesn't grow every time an
  // operator dismisses something — the small "n dismissed — show"
  // affordance keeps the visual weight aligned with the active list,
  // and a click reveals the rows when the operator wants to triage.
  const [isDismissedExpanded, setIsDismissedExpanded] = useState(false);

  // Tracks addresses with an in-flight Retry. Lives in page state
  // (rather than module-level alongside the cache) because the loading
  // UI is per-row + page-scoped — another tab opening this page should
  // start with no spinners. Keyed by canonical address string so a
  // retry kicked off for a typo'd address that two properties happen
  // to share would mark both rows simultaneously, matching the way the
  // rollup itself groups by address.
  const [retryingAddresses, setRetryingAddresses] = useState<Set<string>>(
    () => new Set(),
  );

  // Bulk-retry progress for the "Retry all" button. Non-null only while
  // a bulk run is in flight; the per-row state (`retryingAddresses`)
  // stays the source of truth for which individual rows are disabled,
  // so the bulk run can hand off to `handleRetryAddress` without
  // duplicating its bookkeeping. We capture `total` from the snapshot
  // taken when the click landed so the indicator reads "Retrying X of
  // Y…" against a stable denominator even as successful rows drop out
  // of `propertiesNeedingAddressFix` mid-iteration.
  const [bulkRetryProgress, setBulkRetryProgress] = useState<
    { done: number; total: number } | null
  >(null);
  const isBulkRetrying = bulkRetryProgress !== null;

  // Fetch the runtime config (Google Maps API key) only when the rollup
  // could be visible — i.e. there's at least one geocode failure in
  // the shared cache. Without one the operator can't reach the Retry
  // button, so there's nothing to spend a /api/config request on.
  // We key off `geocodeFailureTimestamps.size` rather than the
  // `propertiesNeedingAddressFix` memo (which lives further down the
  // file) to keep this hook above all the other useMemos and avoid a
  // TDZ — the cache-side count is the upper bound anyway: if the cache
  // is empty, the property-filtered list is too. Sharing the queryKey
  // with PortfolioMap / Location card means a sibling fetch already in
  // flight is reused for free, and the SSE stream picks up rotated
  // keys without us having to wire it again.
  const hasGeocodeFailures = geocodeFailureTimestamps.size > 0;
  const runtimeConfig = useRuntimeConfigQuery(hasGeocodeFailures);
  useRuntimeConfigStream(hasGeocodeFailures);
  const mapsApiKey =
    runtimeConfig.data?.googleMapsApiKey == null
      ? ""
      : runtimeConfig.data.googleMapsApiKey;

  /**
   * Re-runs a single geocode for a flagged address. The success path
   * is delegated to `retryGeocode` → the shared `runGeocode` helper,
   * which writes the new coords (or fresh `null`) into the module-level
   * cache: that write triggers `notifyGeocodeFailureListeners`, which
   * causes `useGeocodeFailures` to re-render the page with the row
   * gone. So this handler only owns the loading state + the user-
   * facing toast for the "still no luck" / "key/SDK couldn't load"
   * branches.
   */
  const handleRetryAddress = useCallback(
    async (
      addr: string,
      options?: { silent?: boolean },
    ): Promise<"fixed" | "still-failing" | "error" | "skipped"> => {
      if (!addr) return "skipped";
      // Disable double-submits for the same address. The button is
      // already `disabled` while in-flight, but a second click can
      // still race in via keyboard focus + Enter on a stale render.
      if (retryingAddresses.has(addr)) return "skipped";
      const silent = options?.silent === true;
      if (!mapsApiKey) {
        if (!silent) {
          toast({
            title: t("toasts.geocode.couldntRetryTitle"),
            description: t("toasts.geocode.couldntRetryDescription"),
            variant: "destructive",
          });
        }
        return "error";
      }
      setRetryingAddresses((prev) => {
        const next = new Set(prev);
        next.add(addr);
        return next;
      });
      try {
        await loadMapsApi(mapsApiKey);
        const maps = window.google?.maps;
        if (!maps?.Geocoder) {
          throw new Error("Geocoder unavailable");
        }
        const geocoder = new maps.Geocoder();
        const point = await retryGeocode(geocoder, addr);
        if (point === null) {
          // Google still has nothing — leave the row in place so the
          // operator can see the retry was honored but didn't help.
          // The explicit toast is the only signal that the click did
          // anything at all (without it the disabled button just snaps
          // back and looks like a no-op). Suppressed for bulk runs so
          // the caller can roll N outcomes into one summary toast.
          if (!silent) {
            toast({
              title: t("toasts.geocode.stillCouldntPinpointTitle"),
              description: t("toasts.geocode.stillCouldntPinpointDescription"),
            });
          }
          return "still-failing";
        }
        // Success: the cache write inside `retryGeocode` already
        // notified subscribers, so the row will disappear on the
        // next render through `useGeocodeFailures`. We ALSO fire a
        // brief confirmation toast so an operator who clicked Retry
        // and then scrolled or tab-switched still sees that the
        // click landed — without this, the only success signal is
        // the row vanishing, which is easy to miss when you're not
        // staring directly at the rollup panel. Mirrors the
        // ZERO_RESULTS branch's toast for symmetry. Bulk caller
        // suppresses to avoid N "Found it" toasts in a row.
        if (!silent) {
          toast({
            title: t("toasts.geocode.foundItTitle"),
            description: t("toasts.geocode.foundItDescription"),
          });
        }
        return "fixed";
      } catch {
        if (!silent) {
          toast({
            title: t("toasts.geocode.retryFailedTitle"),
            description: t("toasts.geocode.retryFailedDescription"),
            variant: "destructive",
          });
        }
        return "error";
      } finally {
        setRetryingAddresses((prev) => {
          if (!prev.has(addr)) return prev;
          const next = new Set(prev);
          next.delete(addr);
          return next;
        });
      }
    },
    [mapsApiKey, retryingAddresses, toast],
  );

  // Roll up properties whose CURRENT address string matches a cached
  // failure. Keyed by the same canonical address string the maps use
  // when calling the geocoder, so editing the address (which changes
  // the cache key) automatically drops the property out of the list
  // on the next render. Filtered properties without an address skip
  // the lookup entirely — they don't have anything for Google to
  // reject in the first place.
  const propertiesNeedingAddressFix = useMemo(() => {
    if (geocodeFailureTimestamps.size === 0) return [] as Property[];
    return properties.filter((p) => {
      const addr = formatGeocodeAddress(p);
      return addr.length > 0 && geocodeFailureTimestamps.has(addr);
    });
  }, [properties, geocodeFailureTimestamps]);

  // Properties whose canonical address sits in the dismissed-set —
  // these are the rows the dismissed footer surfaces with an Undo
  // affordance. Keyed by the same address string the active list
  // uses so editing the address (which changes the cache key) drops
  // the row out of both sides at once. A property whose address is
  // both dismissed AND missing from the property list (e.g. the
  // property got deleted while its dismissal lingered) is silently
  // skipped — there's nothing meaningful to render for it.
  const dismissedPropertiesForReview = useMemo(() => {
    if (dismissedAddressSet.size === 0) return [] as Property[];
    // Dedupe by canonical address — Undo is keyed by address (one
    // click restores every property sharing it), so showing one row
    // per address keeps the count and the affordances honest. First
    // property wins as the row's display, mirroring how the active
    // list would look once the dismissal is undone.
    const seen = new Set<string>();
    const out: Property[] = [];
    for (const p of properties) {
      const addr = formatGeocodeAddress(p);
      if (addr.length === 0) continue;
      if (!dismissedAddressSet.has(addr)) continue;
      if (seen.has(addr)) continue;
      seen.add(addr);
      out.push(p);
    }
    return out;
  }, [properties, dismissedAddressSet]);

  // Once every dismissal is undone (or the underlying failures get
  // cleared via reset / address fix), collapse the footer back to
  // its compact form so the next dismissal opens with a clean slate
  // rather than starting expanded with no rows to show.
  useEffect(() => {
    if (dismissedPropertiesForReview.length === 0 && isDismissedExpanded) {
      setIsDismissedExpanded(false);
    }
  }, [dismissedPropertiesForReview.length, isDismissedExpanded]);

  /**
   * Re-run every flagged address in the rollup in one click. Iterates
   * sequentially through `handleRetryAddress` so we never have two
   * Google requests in flight at the same time — the SDK's
   * `inFlightGeocodes` map already dedupes per-address, but going
   * sequentially also avoids blasting Google with N parallel requests
   * after a partial outage and keeps the per-row spinner pattern
   * predictable (only the address currently being retried is marked
   * busy at any moment).
   *
   * The address snapshot is taken at click time so the loop has a
   * stable list to iterate even as successful rows drop out of
   * `propertiesNeedingAddressFix` mid-run. `handleRetryAddress` is
   * idempotent — early-returning on addresses already in
   * `retryingAddresses`, and routing toasts for the still-failing /
   * SDK-unavailable / no-key branches — so the loop just hands each
   * address off and advances the progress counter when the per-row
   * call settles.
   */
  const handleRetryAll = useCallback(async () => {
    if (isBulkRetrying) return;
    if (!mapsApiKey) {
      // Mirror the per-row "no key" branch so a click on Retry all
      // before /api/config resolves doesn't silently no-op. We bail
      // BEFORE flipping into the bulk-progress state so the button
      // doesn't briefly disable itself for a run we never started.
      toast({
        title: t("toasts.geocode.couldntRetryTitle"),
        description: t("toasts.geocode.couldntRetryDescription"),
        variant: "destructive",
      });
      return;
    }
    // Snapshot the address list NOW. Successful retries shrink the
    // upstream array via the cache → subscribers path while the loop
    // runs; we want the denominator and the iteration order to stay
    // pinned to what the operator clicked on. Dedupe so two properties
    // sharing the exact same flagged address (e.g. a duplicate-import
    // edge case) don't burn two Google calls on the same string —
    // `inFlightGeocodes` would already collapse parallel requests, but
    // sequential iteration here would otherwise re-hit Google twice.
    const seen = new Set<string>();
    const addresses: string[] = [];
    for (const p of propertiesNeedingAddressFix) {
      const a = formatGeocodeAddress(p);
      if (a.length === 0 || seen.has(a)) continue;
      seen.add(a);
      addresses.push(a);
    }
    if (addresses.length < 2) return;
    setBulkRetryProgress({ done: 0, total: addresses.length });
    let fixed = 0;
    let stillFailing = 0;
    let errored = 0;
    try {
      for (const addr of addresses) {
        // `silent: true` suppresses the per-row toasts in
        // `handleRetryAddress` so the bulk run produces a single
        // summary toast at the end instead of N noisy ones.
        const outcome = await handleRetryAddress(addr, { silent: true });
        if (outcome === "fixed") fixed += 1;
        else if (outcome === "still-failing") stillFailing += 1;
        else errored += 1; // "error" or "skipped" — both = "couldn't be attempted"
        setBulkRetryProgress((prev) =>
          prev ? { done: prev.done + 1, total: prev.total } : prev,
        );
      }
    } finally {
      setBulkRetryProgress(null);
    }
    // One summary toast per bulk run. Wording covers the three shapes
    // the operator cares about: all-success, all-still-failing, and
    // the mixed common case. The "couldn't be attempted" tail is only
    // mentioned when non-zero so the happy path stays terse.
    const total = addresses.length;
    const attemptedFailures = stillFailing + errored;
    let title: string;
    let description: string;
    if (fixed === total) {
      title = t("toasts.geocode.allPinpointedTitle");
      description = t("toasts.geocode.allPinpointedDescription", { count: total });
    } else if (fixed === 0) {
      title = t("toasts.geocode.nonePinpointedTitle");
      description =
        errored > 0 && stillFailing === 0
          ? t("toasts.geocode.nonePinpointedConnectionDescription", { errored, total })
          : errored > 0
            ? t("toasts.geocode.nonePinpointedMixedDescription", { stillFailing, total, errored })
            : t("toasts.geocode.nonePinpointedNeedAttentionDescription", { total });
    } else {
      title = t("toasts.geocode.fixedSomeTitle", { fixed, total });
      description =
        errored > 0
          ? t("toasts.geocode.fixedSomeWithErroredDescription", { stillFailing, errored })
          : t("toasts.geocode.fixedSomeDescription", { count: attemptedFailures });
    }
    toast({
      title,
      description,
      variant: fixed === 0 ? "destructive" : undefined,
    });
  }, [
    isBulkRetrying,
    mapsApiKey,
    propertiesNeedingAddressFix,
    handleRetryAddress,
    toast,
  ]);

  // Ids reported back from the map for properties whose address looked
  // valid but Google couldn't actually geocode (typo'd street, removed
  // ZIP, etc). We surface those alongside truly-blank addresses in the
  // side panel so a bad address never silently disappears.
  const [unmappableIds, setUnmappableIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Reset whenever the user leaves the map view so a stale list from a
  // previous filter set doesn't leak into the table view's state.
  useEffect(() => {
    if (viewMode !== "map") setUnmappableIds(new Set());
  }, [viewMode]);
  const handleUnmappableChange = useCallback((ids: string[]) => {
    setUnmappableIds((prev) => {
      // Bail out if the set is unchanged so we don't trigger a render
      // loop with the map's effect.
      if (prev.size === ids.length && ids.every((id) => prev.has(id))) {
        return prev;
      }
      return new Set(ids);
    });
  }, []);

  const toMappable = useCallback(
    (p: Property): MappableProperty => {
      const stats = bedStatsByPropertyId.get(p.id);
      // Mirror the table cell exactly: only the *active* lease drives
      // the renewal badge, and only urgency levels other than "ok"
      // surface a badge — same `showRenewal` rule the table row uses,
      // so the bubble can never show a warning the table doesn't (or
      // vice versa).
      const activeLease = leases.find(
        (l) => l.propertyId === p.id && l.status === "Active",
      );
      const renewal = activeLease ? getRenewalInfo(activeLease.endDate) : null;
      const bubbleRenewal =
        renewal && renewal.level !== "ok"
          ? { level: renewal.level, label: renewal.label }
          : null;
      return {
        id: p.id,
        name: p.name,
        address: p.address,
        city: p.city,
        state: p.state,
        zip: p.zip,
        customerName: customerById.get(p.customerId)?.name,
        // Always populate bed stats — properties with no beds get all
        // zeros, which the bubble renders as "0 beds" so the operator
        // sees we know about the property but it isn't bedded yet.
        totalBeds: stats?.total ?? 0,
        occupied: stats?.occupied ?? 0,
        vacant: stats?.vacant ?? 0,
        rentPerBed: computeRentPerBed(p.monthlyRent, stats?.total ?? 0),
        electricPerBed: computeElectricPerBed(
          monthlyElectricByPropertyId.get(p.id) ?? 0,
          stats?.total ?? 0,
        ),
        rentPlusElectricPerBed: computeRentPlusElectricPerBed(
          p.monthlyRent,
          monthlyElectricByPropertyId.get(p.id) ?? 0,
          stats?.total ?? 0,
        ),
        lat: p.lat ?? null,
        lng: p.lng ?? null,
        renewal: bubbleRenewal,
        coordsVerified: p.coordsVerified ?? false,
      };
    },
    [bedStatsByPropertyId, customerById, leases, monthlyElectricByPropertyId],
  );

  // Split the filtered list for the map view: properties with at least
  // one address field go on the map; the rest go in the side panel so
  // the operator can see they exist (and click through to fix them)
  // even though we have nothing to drop a pin on. Geocode failures
  // reported back from the map join the side panel too.
  const { mappableProperties, propertiesWithoutAddress } = useMemo(() => {
    const withAddr: MappableProperty[] = [];
    const without: Property[] = [];
    for (const p of filtered) {
      const hasAnyAddress =
        `${p.address}${p.city}${p.state}${p.zip}`.trim().length > 0;
      const isGeocodeFailure = unmappableIds.has(p.id);
      if (hasAnyAddress && !isGeocodeFailure) {
        withAddr.push(toMappable(p));
      } else {
        without.push(p);
      }
    }
    return { mappableProperties: withAddr, propertiesWithoutAddress: without };
  }, [filtered, unmappableIds, toMappable]);

  // The map needs the full set of address-bearing properties so it can
  // try to geocode every one — geocode failures only get pushed to the
  // side panel after they're reported back via onUnmappableChange.
  // Stored lat/lng go along for the ride so the map can render those
  // pins synchronously without burning a Google round-trip.
  const mapInputProperties = useMemo<MappableProperty[]>(() => {
    return filtered
      .filter((p) => `${p.address}${p.city}${p.state}${p.zip}`.trim().length > 0)
      .map(toMappable);
  }, [filtered, toMappable]);

  // Persist freshly-resolved coordinates back onto the property so the
  // next time anyone visits the map view we paint pins instantly with
  // no geocode round-trip. The map component only fires this for
  // properties that arrived without stored coords, so we never write
  // back the same value we just read.
  const handleGeocoded = useCallback(
    (id: string, point: { lat: number; lng: number }) => {
      updateProperty(id, { lat: point.lat, lng: point.lng });
    },
    [updateProperty],
  );

  const handleDownloadCsv = () => {
    const rows = filtered.map((property) => {
      const propBeds = beds.filter((b) => b.propertyId === property.id);
      const occupied = propBeds.filter((b) => b.status === "Occupied").length;
      const vacant = propBeds.length - occupied;
      const activeLease = leases.find((l) => l.propertyId === property.id && l.status === "Active");
      const renewal = activeLease ? getRenewalInfo(activeLease.endDate) : null;
      const overallRating = computeOverallRating(property.ratings);
      const customer = customerById.get(property.customerId);
      return { property, customer, occupied, vacant, propBeds, activeLease, renewal, overallRating };
    });
    const csv = toCsv(rows, [
      { header: "Property",        value: (r) => r.property.name },
      { header: "Customer",        value: (r) => r.customer?.name ?? "" },
      { header: "Address",         value: (r) => r.property.address },
      { header: "City",            value: (r) => r.property.city },
      { header: "State",           value: (r) => r.property.state },
      { header: "ZIP",             value: (r) => r.property.zip },
      { header: "Total Beds",      value: (r) => r.propBeds.length },
      { header: "Occupied",        value: (r) => r.occupied },
      { header: "Vacant",          value: (r) => r.vacant },
      { header: "Monthly Rent",    value: (r) => r.property.monthlyRent },
      { header: "Status",          value: (r) => r.property.status },
      { header: "Overall Rating",  value: (r) => (r.overallRating === null ? "" : r.overallRating) },
      { header: "Lease End Date",  value: (r) => r.activeLease?.endDate ?? "" },
      { header: "Days to Renewal", value: (r) => (r.renewal ? r.renewal.days : "") },
      { header: "Landlord",        value: (r) => r.property.landlordName },
      { header: "Landlord Email",  value: (r) => r.property.landlordEmail },
      { header: "Landlord Phone",  value: (r) => r.property.landlordPhone },
    ]);
    downloadCsv(timestampedCsvName("housingops-properties"), csv);
    toast({
      title: t("toasts.propertiesExportedTitle"),
      description: t("toasts.propertiesExportedDescription", { count: filtered.length }),
    });
  };

  return (
    <MainLayout>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="p-8 max-w-7xl mx-auto space-y-8"
      >
        <PageHeader
          title={t("pages.properties.title")}
          description={t("pages.properties.description")}
          actions={<>
            {/* Table/Map toggle. Persisted with the rest of the toolbar
                prefs so the operator's last choice survives refresh and
                back-navigation. */}
            <div
              className="inline-flex rounded-md border overflow-hidden"
              role="group"
              aria-label={t("pages.properties.viewLabel")}
              data-testid="properties-view-toggle"
            >
              <Button
                type="button"
                variant={viewMode === "table" ? "default" : "ghost"}
                size="sm"
                className="rounded-none border-0"
                onClick={() => setViewMode("table")}
                aria-pressed={viewMode === "table"}
                data-testid="button-view-table"
              >
                <TableIcon className="mr-2 h-4 w-4" />
                {t("pages.properties.tableView")}
              </Button>
              <Button
                type="button"
                variant={viewMode === "map" ? "default" : "ghost"}
                size="sm"
                className="rounded-none border-0"
                onClick={() => setViewMode("map")}
                aria-pressed={viewMode === "map"}
                data-testid="button-view-map"
              >
                <MapIcon className="mr-2 h-4 w-4" />
                {t("pages.properties.mapView")}
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={isLoading || filtered.length === 0}
              data-testid="button-download-properties-csv"
            >
              <Download className="mr-2 h-4 w-4" />
              {t("pages.properties.downloadCsv")}
            </Button>
            <Button onClick={openAdd} data-testid="button-add-property">
              <Plus className="mr-2 h-4 w-4" />
              {t("pages.properties.addProperty")}
            </Button>
          </>}
        />

        <HousingAuditPanel properties={properties} leases={leases} />

        {(activeCustomerName || needsReviewFilter === "NeedsReview") && (
          <div className="flex items-center gap-2 flex-wrap">
            {activeCustomerName && (
              <Badge variant="secondary" className="gap-1.5 px-2 py-1" data-testid="badge-customer-filter">
                <Briefcase className="h-3 w-3" />
                {t("pages.properties.filteredByCustomer")} <span className="font-semibold">{activeCustomerName}</span>
                <button
                  type="button"
                  onClick={() => updateCustomerFilter(ALL_CUSTOMERS)}
                  className="ml-1 rounded-sm p-0.5 hover:bg-background/40"
                  aria-label={t("pages.properties.clearCustomerFilter")}
                  data-testid="button-clear-customer-filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {needsReviewFilter === "NeedsReview" && (
              <Badge
                variant="secondary"
                className="gap-1.5 px-2 py-1 border-amber-300 text-amber-800 bg-amber-50 dark:text-amber-200 dark:bg-amber-950/40"
                data-testid="badge-needs-review-filter"
              >
                <AlertTriangle className="h-3 w-3" />
                {t("pages.properties.needsReviewBadge")}
                <button
                  type="button"
                  onClick={clearNeedsReviewFilter}
                  className="ml-1 rounded-sm p-0.5 hover:bg-background/40"
                  aria-label={t("pages.properties.clearNeedsReview")}
                  data-testid="button-clear-needs-review-filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </div>
        )}

        {/*
          Rolled-up "addresses Google can't pinpoint" panel. Sits above
          the toolbar/table card so it's visible regardless of view mode
          (table OR map) and stays put when the operator scrolls down
          the table — without this the only way to spot bad addresses
          was to flip into the map view, which most operators don't.

          Driven by `useGeocodeFailures`, which subscribes to the shared
          module-level geocode cache. Failures land here whether they
          were observed by the portfolio map below or by a per-property
          Location card on /properties/:id earlier in the session, so
          the operator can fix every rejected address in one pass
          instead of discovering them one detail page at a time.

          The panel is unconditionally hidden when the failure set is
          empty so a healthy session shows nothing at all — no empty
          state, no nudge to look for problems that aren't there.
        */}
        {(propertiesNeedingAddressFix.length > 0 ||
          dismissedPropertiesForReview.length > 0) && (
          <Card
            className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20"
            data-testid="addresses-needing-review-panel"
          >
            <CardContent className="p-4 space-y-3">
              {propertiesNeedingAddressFix.length > 0 && (
              <>
              <div className="flex items-center gap-2">
                <MapPinOff className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <h2 className="text-sm font-semibold">
                  {t("pages.properties.addressReview.title")}
                </h2>
                <Badge
                  variant="secondary"
                  className="text-[11px]"
                  data-testid="addresses-needing-review-count"
                >
                  {propertiesNeedingAddressFix.length}
                </Badge>
                {/*
                  "Retry all" — only meaningful when there are 2+
                  flagged addresses (a single row is already a one-
                  click operation via its own per-row Retry, and
                  showing both controls for a count of 1 would be
                  busywork). Hands every snapshotted address off to
                  `handleRetryAddress` sequentially so we never have
                  two parallel Google requests for the same address
                  (the SDK's `inFlightGeocodes` already dedupes, but
                  going one at a time also keeps the per-row spinner
                  pattern predictable and avoids a thundering-herd
                  retry burst right after a partial outage). The
                  button doubles as a combined progress indicator —
                  "Retrying X of Y…" reads off the snapshot taken at
                  click time so the denominator stays stable even as
                  successful rows drop out mid-iteration.
                */}
                {(propertiesNeedingAddressFix.length >= 2 ||
                  isBulkRetrying) && (
                  // Keep the button visible mid-bulk-run even after
                  // successful retries shrink the count below 2 — the
                  // run owns the indicator's denominator and would
                  // otherwise vanish on the very render that's supposed
                  // to show "Retrying N of N…".
                  <button
                    type="button"
                    onClick={handleRetryAll}
                    disabled={isBulkRetrying}
                    className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-card px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-60 disabled:cursor-not-allowed"
                    aria-label={t("pages.properties.addressReview.retryAllAria")}
                    aria-busy={isBulkRetrying}
                    title={t("pages.properties.addressReview.retryAllTitle")}
                    data-testid="retry-all-addresses-needing-review"
                  >
                    {isBulkRetrying ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {isBulkRetrying && bulkRetryProgress
                      ? t("pages.properties.addressReview.retryingProgress", {
                          done: Math.min(bulkRetryProgress.done + 1, bulkRetryProgress.total),
                          total: bulkRetryProgress.total,
                        })
                      : t("pages.properties.addressReview.retryAll")}
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("pages.properties.addressReview.helper")}
              </p>
              <ul
                className="divide-y rounded-md border bg-card"
                data-testid="addresses-needing-review-list"
              >
                {propertiesNeedingAddressFix.map((p) => {
                  const customer = customerById.get(p.customerId);
                  // Mirror the address shown on the property-detail
                  // page so an operator scanning this list recognizes
                  // exactly what string Google rejected — using the
                  // same comma-joined form keeps the two views from
                  // drifting visually.
                  const addrDisplay = formatGeocodeAddress(p);
                  // Look up the last-recorded-failure timestamp.
                  // Missing entries (shouldn't happen in steady state
                  // since the cache and the timestamp Map are updated
                  // together) simply hide the label — an empty stamp
                  // is better than rendering "Checked Invalid Date
                  // ago". The label itself self-refreshes on a
                  // minute-tick so an idle page keeps the relative
                  // time honest without us having to re-render here.
                  const lastCheckedAt = geocodeFailureTimestamps.get(addrDisplay);
                  const isRetrying = retryingAddresses.has(addrDisplay);
                  return (
                    // Row is a flex container with three independently
                    // clickable controls — the main "open property"
                    // button, "Retry", and "Dismiss" — instead of a
                    // single wrapping <button>. Native <button>s can't
                    // nest, and a click on Retry/Dismiss must NOT also
                    // fire navigation, so the affordances live as
                    // siblings sharing a hover state on the parent.
                    <li
                      key={p.id}
                      className="flex items-stretch hover:bg-muted/50 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => navigate(`/properties/${p.id}`)}
                        className="flex-1 min-w-0 text-left px-3 py-2 flex items-start gap-2"
                        data-testid={`address-needing-review-${p.id}`}
                      >
                        <Home className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium truncate">
                            {p.name}
                          </span>
                          <span className="block text-xs text-muted-foreground truncate">
                            {addrDisplay}
                          </span>
                          {customer && (
                            <span className="block text-[11px] text-muted-foreground/80 truncate">
                              {customer.name}
                            </span>
                          )}
                          {typeof lastCheckedAt === "number" && (
                            // Surfaces how stale the failure is so an
                            // operator can prioritize fresh flags over
                            // weeks-old ones. The label component
                            // owns its own minute-tick subscription
                            // so this row keeps reading "5 minutes
                            // ago" → "6 minutes ago" while the page
                            // sits idle, without forcing the rest of
                            // the Properties screen to re-render.
                            // Stamped via a stable testid (NOT the
                            // relative-time text, which would churn
                            // every minute) so tests can assert on
                            // presence + content without race
                            // conditions.
                            <CheckedAgoLabel
                              className="block text-[11px] text-muted-foreground/70 truncate"
                              testId={`address-needing-review-checked-${p.id}`}
                              timestamp={lastCheckedAt}
                            />
                          )}
                        </span>
                        <ChevronRight className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                      </button>
                      {/*
                        Re-run the geocode for this single address. A
                        one-time Google outage or a flaky network blip
                        leaves the row stuck in the panel until the
                        operator either dismisses it or edits the
                        address — neither of which is right when the
                        underlying address is fine. Retry calls into
                        `retryGeocode`, which bypasses the cached
                        `null` so Google actually sees a fresh request;
                        on success the shared cache writes the new
                        coords, the success-overriding-failure path
                        fires the listener, and `useGeocodeFailures`
                        drops the row on the next render with no
                        further bookkeeping needed here. The button is
                        disabled while in flight so a double-click
                        can't double-spend Google quota.
                      */}
                      <button
                        type="button"
                        onClick={() => handleRetryAddress(addrDisplay)}
                        disabled={isRetrying}
                        className="shrink-0 px-3 text-xs text-muted-foreground hover:text-foreground border-l flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                        aria-label={t("pages.properties.addressReview.retryAria", { name: p.name })}
                        aria-busy={isRetrying}
                        title={t("pages.properties.addressReview.retryTitle")}
                        data-testid={`retry-address-needing-review-${p.id}`}
                      >
                        {isRetrying ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        {isRetrying ? t("pages.properties.addressReview.retrying") : t("pages.properties.addressReview.retry")}
                      </button>
                      {/*
                        Dismiss the row for the rest of the session.
                        Calls into the shared SDK module so any other
                        Maps surface subscribed to the failure cache
                        (e.g. a per-property Location card open in
                        another tab — though uncommon) sees the
                        same suppression. Re-flagging the same
                        address via a future geocode attempt clears
                        the dismissal automatically (see
                        `dismissGeocodeFailure` jsdoc).
                      */}
                      <button
                        type="button"
                        onClick={() => dismissGeocodeFailure(addrDisplay)}
                        className="shrink-0 px-3 text-xs text-muted-foreground hover:text-foreground border-l flex items-center gap-1"
                        aria-label={t("pages.properties.addressReview.dismissAria", { name: p.name })}
                        title={t("pages.properties.addressReview.dismissTitle")}
                        data-testid={`dismiss-address-needing-review-${p.id}`}
                      >
                        <X className="h-3.5 w-3.5" />
                        {t("pages.properties.addressReview.dismiss")}
                      </button>
                    </li>
                  );
                })}
              </ul>
              </>
              )}
              {/*
                Dismissed-this-session footer. Surfaces a compact
                "n dismissed — show" affordance so an operator who
                hid an address by mistake can find it again and
                undo the dismissal — without this the only recovery
                was a hard refresh, which would also blow away the
                rest of the in-session failure cache.

                The footer is only rendered when there's actually
                something to undo, so a clean session shows nothing
                extra below the active list. When ALL active failures
                have been dismissed, the parent panel keeps rendering
                with just this footer so the operator can still
                review and undo — otherwise the dismiss path would
                be a one-way trip the moment the active list empties.
              */}
              {dismissedPropertiesForReview.length > 0 && (
                <div
                  className={
                    propertiesNeedingAddressFix.length > 0
                      ? "border-t pt-3 -mx-1 px-1 space-y-2"
                      : "space-y-2"
                  }
                  data-testid="dismissed-addresses-summary"
                >
                  <button
                    type="button"
                    onClick={() => setIsDismissedExpanded((v) => !v)}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    aria-expanded={isDismissedExpanded}
                    data-testid="toggle-dismissed-addresses"
                  >
                    <span data-testid="dismissed-addresses-count">
                      {dismissedPropertiesForReview.length}
                    </span>
                    {t("pages.properties.addressReview.dismissedSuffix")}
                    {isDismissedExpanded ? t("pages.properties.addressReview.hide") : t("pages.properties.addressReview.show")}
                  </button>
                  {isDismissedExpanded && (
                    <ul
                      className="divide-y rounded-md border bg-card"
                      data-testid="dismissed-addresses-list"
                    >
                      {dismissedPropertiesForReview.map((p) => {
                        const customer = customerById.get(p.customerId);
                        const addrDisplay = formatGeocodeAddress(p);
                        return (
                          <li
                            key={p.id}
                            className="flex items-stretch hover:bg-muted/50 transition-colors"
                          >
                            <div className="flex-1 min-w-0 px-3 py-2 flex items-start gap-2">
                              <Home className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium truncate">
                                  {p.name}
                                </span>
                                <span className="block text-xs text-muted-foreground truncate">
                                  {addrDisplay}
                                </span>
                                {customer && (
                                  <span className="block text-[11px] text-muted-foreground/80 truncate">
                                    {customer.name}
                                  </span>
                                )}
                              </span>
                            </div>
                            {/*
                              Restore the row to the active list. The
                              undismiss path notifies both the failure
                              and dismissed channels in one shot, so
                              the active rollup grows back and the
                              footer count drops on the next render
                              with no extra plumbing here.
                            */}
                            <button
                              type="button"
                              onClick={() => undismissGeocodeFailure(addrDisplay)}
                              className="shrink-0 px-3 text-xs text-muted-foreground hover:text-foreground border-l flex items-center gap-1"
                              aria-label={t("pages.properties.addressReview.undoAria", { name: p.name })}
                              title={t("pages.properties.addressReview.undoTitle")}
                              data-testid={`undismiss-address-needing-review-${p.id}`}
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              {t("pages.properties.addressReview.undo")}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("pages.properties.searchPlaceholder")}
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-search-properties"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Select value={customerFilter} onValueChange={updateCustomerFilter}>
                  <SelectTrigger className="w-full sm:w-56" data-testid="select-customer-filter">
                    <SelectValue placeholder={t("pages.properties.customerPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_CUSTOMERS}>{t("pages.properties.allCustomers")}</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-40" data-testid="select-status-filter">
                    <SelectValue placeholder={t("pages.properties.statusPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">{t("pages.properties.allStatuses")}</SelectItem>
                    <SelectItem value="Active">{t("pages.properties.statusActive")}</SelectItem>
                    <SelectItem value="Inactive">{t("pages.properties.statusInactive")}</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={ratingFilterCategory}
                  onValueChange={(v) => setRatingFilterCategory(v as RatingFilterCategory)}
                >
                  <SelectTrigger
                    className="w-full sm:w-44"
                    data-testid="select-rating-filter-category"
                    aria-label={t("pages.properties.ratingCategoryAria")}
                  >
                    <SelectValue placeholder={t("pages.properties.ratingCategoryPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {RATING_SORT_OPTIONS.map((o) => (
                      <SelectItem key={o.key} value={o.key}>
                        {t(`pages.properties.ratingCategoryLabels.${o.key}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={minRating} onValueChange={(v) => setMinRating(v as MinRating)}>
                  <SelectTrigger className="w-full sm:w-36" data-testid="select-min-rating">
                    <SelectValue placeholder={t("pages.properties.minRatingPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">{t("pages.properties.anyRating")}</SelectItem>
                    <SelectItem value="3">{t("pages.properties.starsPlus3")}</SelectItem>
                    <SelectItem value="4">{t("pages.properties.starsPlus4")}</SelectItem>
                    <SelectItem value="5">{t("pages.properties.stars5")}</SelectItem>
                  </SelectContent>
                </Select>
                {minRating !== "any" && (
                  <Badge
                    variant="secondary"
                    className="self-center gap-1"
                    data-testid="badge-rating-filter-active"
                  >
                    {t(`pages.properties.ratingCategoryLabels.${ratingFilterCategory}`)}
                    {" "}
                    ≥ {minRating}
                    <button
                      type="button"
                      onClick={() => {
                        setMinRating("any");
                        setRatingFilterCategory("overall");
                      }}
                      className="ml-1 hover:text-foreground"
                      aria-label={t("pages.properties.clearRatingFilter")}
                      data-testid="button-clear-rating-filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
              </div>
            </div>

            {viewMode === "map" ? (
              <div
                className="p-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]"
                data-testid="properties-map-view"
              >
                <div className="min-w-0">
                  {isLoading ? (
                    <div
                      className="aspect-[16/9] w-full rounded-lg border bg-muted animate-pulse"
                      data-testid="portfolio-map-skeleton"
                    />
                  ) : mappableProperties.length === 0 &&
                    propertiesWithoutAddress.length === 0 ? (
                    <div
                      className="rounded-lg border bg-muted/30 p-8 text-center text-sm text-muted-foreground"
                      data-testid="empty-map-view"
                    >
                      <Home className="mx-auto h-6 w-6 mb-2 opacity-50" />
                      {t("pages.properties.map.noMatchFilters")}
                    </div>
                  ) : (
                    <PortfolioMap
                      properties={mapInputProperties}
                      onPinClick={(id) => navigate(`/properties/${id}`)}
                      onUnmappableChange={handleUnmappableChange}
                      onGeocoded={handleGeocoded}
                    />
                  )}
                  {!isLoading && mappableProperties.length === 0 &&
                    propertiesWithoutAddress.length > 0 && (
                      <p
                        className="mt-3 text-xs text-muted-foreground"
                        data-testid="map-view-no-mapped-note"
                      >
                        {t("pages.properties.map.noMappedNote", { count: propertiesWithoutAddress.length })}
                      </p>
                    )}
                </div>
                <aside
                  className="rounded-lg border bg-card"
                  data-testid="properties-without-address-panel"
                  aria-label={t("pages.properties.map.withoutAddressAria")}
                >
                  <div className="p-3 border-b flex items-center gap-2">
                    <MapPinOff className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold">{t("pages.properties.map.missingAddress")}</h2>
                    <Badge
                      variant="secondary"
                      className="ml-auto text-[11px]"
                      data-testid="properties-without-address-count"
                    >
                      {propertiesWithoutAddress.length}
                    </Badge>
                  </div>
                  {propertiesWithoutAddress.length === 0 ? (
                    <p
                      className="p-3 text-xs text-muted-foreground"
                      data-testid="properties-without-address-empty"
                    >
                      {t("pages.properties.map.everyHasAddress")}
                    </p>
                  ) : (
                    <ul className="divide-y max-h-[28rem] overflow-y-auto">
                      {propertiesWithoutAddress.map((p) => {
                        const customer = customerById.get(p.customerId);
                        return (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => navigate(`/properties/${p.id}`)}
                              className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors flex items-start gap-2"
                              data-testid={`property-without-address-${p.id}`}
                            >
                              <Home className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium truncate">
                                  {p.name}
                                </span>
                                {customer && (
                                  <span className="block text-xs text-muted-foreground truncate">
                                    {customer.name}
                                  </span>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </aside>
              </div>
            ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.properties.table.property")}</TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={toggleCustomerSort}
                      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                      data-testid="button-sort-customer"
                    >
                      {t("pages.properties.table.customer")}
                      {customerSortDir === "asc" ? (
                        <ArrowUp className="h-3.5 w-3.5" />
                      ) : customerSortDir === "desc" ? (
                        <ArrowDown className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead>{t("pages.properties.table.address")}</TableHead>
                  <TableHead>{t("pages.properties.table.city")}</TableHead>
                  <TableHead className="text-center">
                    <button
                      type="button"
                      onClick={toggleTotalBedsSort}
                      className="inline-flex items-center gap-1 mx-auto hover:text-foreground transition-colors"
                      data-testid="button-sort-total-beds"
                      aria-label={`${t("pages.properties.table.sortByTotalBeds")}${sortAriaSuffix(totalBedsSortDir)}`}
                    >
                      {t("pages.properties.table.totalBeds")}
                      {numericSortIcon(totalBedsSortDir)}
                    </button>
                  </TableHead>
                  <TableHead className="text-center">
                    <button
                      type="button"
                      onClick={toggleOccupiedSort}
                      className="inline-flex items-center gap-1 mx-auto hover:text-foreground transition-colors"
                      data-testid="button-sort-occupied"
                      aria-label={`${t("pages.properties.table.sortByOccupied")}${sortAriaSuffix(occupiedSortDir)}`}
                    >
                      {t("pages.properties.table.occupied")}
                      {numericSortIcon(occupiedSortDir)}
                    </button>
                  </TableHead>
                  <TableHead className="text-center">
                    <button
                      type="button"
                      onClick={toggleVacantSort}
                      className="inline-flex items-center gap-1 mx-auto hover:text-foreground transition-colors"
                      data-testid="button-sort-vacant"
                      aria-label={`${t("pages.properties.table.sortByVacant")}${sortAriaSuffix(vacantSortDir)}`}
                    >
                      {t("pages.properties.table.vacant")}
                      {numericSortIcon(vacantSortDir)}
                    </button>
                  </TableHead>
                  <TableHead className="text-center">{t("pages.properties.table.status")}</TableHead>
                  <TableHead>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                          data-testid="button-sort-rating"
                          aria-label={`${t("pages.properties.table.sortByRating")} (currently ${
                            ratingSortDir
                              ? `${t(`pages.properties.ratingCategoryLabels.${ratingSortCategory}`)} ${ratingSortDir === "asc" ? t("pages.properties.table.ascending") : t("pages.properties.table.descending")}`
                              : t("pages.properties.table.unsorted")
                          })`}
                        >
                          {t(`pages.properties.ratingCategoryLabels.${ratingSortCategory}`)}
                          {ratingSortDir === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : ratingSortDir === "desc" ? (
                            <ArrowDown className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
                          )}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-52">
                        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {t("pages.properties.table.sortByRatingHeader")}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {RATING_SORT_OPTIONS.map((opt) => {
                          const isActive = sortKey === "rating" && ratingSortCategory === opt.key;
                          const dir: SortDir = isActive ? sortDir : null;
                          return (
                            <DropdownMenuItem
                              key={opt.key}
                              onClick={() => cycleRatingSort(opt.key)}
                              className="justify-between gap-3"
                              data-testid={`menu-item-sort-rating-${opt.key}`}
                            >
                              <span className={isActive ? "font-semibold" : ""}>{t(`pages.properties.ratingCategoryLabels.${opt.key}`)}</span>
                              {dir === "asc" ? (
                                <ArrowUp className="h-3.5 w-3.5" />
                              ) : dir === "desc" ? (
                                <ArrowDown className="h-3.5 w-3.5" />
                              ) : (
                                <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
                              )}
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableHead>
                  <TableHead>{t("pages.properties.table.leaseRenewal")}</TableHead>
                  <TableHead>{t("pages.properties.table.insurance")}</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <SkeletonRows rows={6} columns={12} />
                ) : filtered.length === 0 ? (
                  <EmptyStateRow
                    colSpan={12}
                    icon={Home}
                    title={t("pages.properties.empty.noPropertiesFound")}
                    description={
                      properties.length === 0
                        ? t("pages.properties.empty.addFirstDescription")
                        : t("pages.properties.empty.tryClearing")
                    }
                    action={
                      properties.length === 0 ? (
                        <Button onClick={openAdd} data-testid="button-add-property-empty">
                          <Plus className="mr-2 h-4 w-4" />
                          {t("pages.properties.addProperty")}
                        </Button>
                      ) : undefined
                    }
                    testId="empty-properties-table"
                  />
                ) : (
                  customerGroups.flatMap((group) => {
                    const isExpanded = isGroupEffectivelyExpanded(group.customer.id);
                    const headerRow = (
                      <TableRow
                        key={`group-${group.customer.id}`}
                        className="cursor-pointer hover:bg-muted/40 bg-muted/20 border-b"
                        onClick={() => toggleCustomerGroup(group.customer.id)}
                        data-testid={`row-customer-group-${group.customer.id}`}
                        data-expanded={isExpanded ? "true" : "false"}
                      >
                        <TableCell colSpan={12} className="py-2.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleCustomerGroup(group.customer.id);
                            }}
                            className="inline-flex items-center gap-2 text-sm font-semibold text-foreground hover:text-foreground/90 focus:outline-none"
                            aria-expanded={isExpanded}
                            aria-controls={`group-${group.customer.id}-rows`}
                            data-testid={`button-toggle-customer-group-${group.customer.id}`}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{group.customer.name}</span>
                            <Badge
                              variant="secondary"
                              className="text-[11px]"
                              data-testid={`badge-customer-group-count-${group.customer.id}`}
                            >
                              Properties · {group.properties.length}
                            </Badge>
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                    if (!isExpanded) return [headerRow];
                    const propertyRows = group.properties.map((property, i) => {
                    // Per-row derived data (beds/occupancy/active lease/
                    // renewal/insurance cert/customer) is precomputed in
                    // the `propertyRowDataById` memo so unrelated re-renders
                    // don't redo the filter/find/IIFE chains for every
                    // visible row.
                    const rowData = propertyRowDataById.get(property.id);
                    const propBeds = rowData?.propBeds ?? [];
                    const occupied = rowData?.occupied ?? 0;
                    const vacant = rowData?.vacant ?? 0;
                    const activeLease = rowData?.activeLease;
                    const renewal = rowData?.renewal ?? null;
                    const showRenewal = renewal && renewal.level !== "ok";
                    const showNoEndDate = rowData?.showNoEndDate ?? false;
                    const overallRating = rowData?.overallRating ?? null;
                    const customer = rowData?.customer;
                    const worstInsuranceCert = rowData?.worstInsuranceCert ?? null;

                    return (
                      <motion.tr
                        key={property.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="cursor-pointer hover:bg-muted/50 border-b transition-colors group"
                        onClick={() => navigate(`/properties/${property.id}`)}
                        data-testid={`row-property-${property.id}`}
                      >
                        <td className="p-4">
                          {(() => {
                            // Only override the displayed text when the
                            // customer-aware helper actually stripped the
                            // customer prefix (i.e. the result differs from
                            // the raw name). For non-matching rows we leave
                            // the original `property.name` untouched so we
                            // don't accidentally hide secondary segments
                            // like `(Baraboo, WI)` that aren't a customer
                            // duplicate.
                            const formatted = formatPropertyName(property.name, {
                              customerName: customer?.name,
                            });
                            const stripped =
                              !!customer?.name &&
                              formatted.secondary === null &&
                              formatted.primary !== (property.name ?? "").trim();
                            // Multi-building properties (Task #570) get a
                            // small "N buildings" badge after the name so
                            // operators can spot duplexes / multi-units
                            // without drilling in. Single-building rows
                            // (the back-filled common case) stay clean.
                            // Building count comes from the per-row memo so
                            // we don't re-walk `buildings` for every visible
                            // property on every render.
                            const propertyBuildingCount = rowData?.buildingCount ?? 0;
                            return (
                              <div className="flex items-center gap-2">
                                {/* Plain navigating link — the row opens the
                                    property detail; the name is NOT inline-
                                    editable here (rename lives on the detail
                                    page) so selecting it can't trip into edit
                                    mode. */}
                                <span
                                  className="font-semibold leading-snug line-clamp-2 group-hover:text-primary group-hover:underline underline-offset-2 transition-colors"
                                  title={`Open ${property.name}`}
                                  data-testid={`link-property-name-${property.id}`}
                                >
                                  {stripped ? formatted.primary : property.name}
                                </span>
                                {propertyBuildingCount > 1 && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] font-medium"
                                    data-testid={`badge-property-buildings-${property.id}`}
                                  >
                                    {propertyBuildingCount} buildings
                                  </Badge>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="p-4 text-sm" data-testid={`cell-customer-${property.id}`}>
                          <div className="flex items-center gap-1.5">
                            <Briefcase className="h-3 w-3 text-muted-foreground shrink-0" />
                            <Select
                              value={property.customerId ?? ""}
                              onValueChange={(v) => updateProperty(property.id, { customerId: v })}
                            >
                              <SelectTrigger
                                className="h-7 text-sm w-44 border-transparent hover:border-border bg-transparent"
                                data-testid={`select-customer-${property.id}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <SelectValue placeholder="Unassigned" />
                              </SelectTrigger>
                              <SelectContent onClick={(e) => e.stopPropagation()}>
                                {customers.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {customer && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateCustomerFilter(customer.id);
                                }}
                                className="text-xs text-muted-foreground hover:text-foreground hover:underline shrink-0"
                                data-testid={`button-filter-customer-${property.id}`}
                                aria-label={`Filter by customer ${customer.name}`}
                                title={`Filter list by ${customer.name}`}
                              >
                                filter
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-sm text-muted-foreground">
                          <InlineEdit
                            value={property.address}
                            onSave={(v) => updateProperty(property.id, { address: v })}
                            inputClassName="w-48"
                            testId={`inline-edit-property-address-${property.id}`}
                          />
                        </td>
                        <td className="p-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <InlineEdit
                              value={property.city}
                              onSave={(v) => updateProperty(property.id, { city: v })}
                              inputClassName="w-32"
                              testId={`inline-edit-property-city-${property.id}`}
                            />
                            <span className="text-muted-foreground">,</span>
                            <InlineEdit
                              value={property.state}
                              onSave={(v) => updateProperty(property.id, { state: v })}
                              inputClassName="w-14"
                              testId={`inline-edit-property-state-${property.id}`}
                            />
                          </div>
                        </td>
                        <td className="p-4 text-center text-sm">{propBeds.length}</td>
                        <td className="p-4 text-center">
                          <span className="text-sm font-medium text-green-600">{occupied}</span>
                        </td>
                        <td className="p-4 text-center">
                          <span className={`text-sm font-medium ${vacant > 0 ? "text-amber-500" : "text-muted-foreground"}`}>{vacant}</span>
                        </td>
                        <td className="p-4 text-center">
                          <div className="inline-flex items-center gap-1.5">
                            {/* One-click status toggle (Active <-> Inactive). */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                updateProperty(property.id, {
                                  status: property.status === "Active" ? "Inactive" : "Active",
                                });
                              }}
                              title={
                                property.status === "Active"
                                  ? "Click to deactivate"
                                  : "Click to reactivate"
                              }
                              data-testid={`button-toggle-status-${property.id}`}
                            >
                              <Badge
                                variant={property.status === "Active" ? "default" : "secondary"}
                                className="cursor-pointer"
                              >
                                {property.status === "Active"
                                  ? t("pages.properties.statusActive")
                                  : t("pages.properties.statusInactive")}
                              </Badge>
                            </button>
                            {/* One-click type cycle (Town house -> Apartment -> Motel -> ...). */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const opts = PROPERTY_TYPE_OPTIONS;
                                const idx = property.propertyType
                                  ? opts.indexOf(property.propertyType)
                                  : -1;
                                updateProperty(property.id, {
                                  propertyType: opts[(idx + 1) % opts.length],
                                });
                              }}
                              title="Click to change type"
                              data-testid={`button-property-type-${property.id}`}
                            >
                              <Badge
                                variant="outline"
                                className={`text-[11px] font-medium cursor-pointer ${
                                  property.propertyType ? "" : "text-muted-foreground"
                                }`}
                                data-testid={`badge-property-type-${property.id}`}
                              >
                                {property.propertyType ?? t("pages.properties.addDialog.noType")}
                              </Badge>
                            </button>
                          </div>
                        </td>
                        <td className="p-4" data-testid={`cell-rating-${property.id}`}>
                          {overallRating === null ? null : (
                            <HoverCard openDelay={120} closeDelay={80}>
                              <HoverCardTrigger asChild>
                                <button
                                  type="button"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1.5 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                                  aria-label={`${property.name} rating breakdown`}
                                  data-testid={`rating-trigger-${property.id}`}
                                >
                                  <StarRating value={overallRating} readOnly size="sm" ariaLabel={`${property.name} overall rating`} />
                                  <span className="text-xs font-medium tabular-nums">{overallRating.toFixed(1)}</span>
                                </button>
                              </HoverCardTrigger>
                              <HoverCardContent
                                align="start"
                                sideOffset={6}
                                className="w-64 p-3"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`rating-breakdown-${property.id}`}
                              >
                                <div className="flex items-center justify-between pb-2 mb-2 border-b">
                                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Overall
                                  </span>
                                  <span className="inline-flex items-center gap-1.5">
                                    <StarRating value={overallRating} readOnly size="sm" ariaLabel="Overall" />
                                    <span className="text-xs font-semibold tabular-nums">{overallRating.toFixed(1)}</span>
                                  </span>
                                </div>
                                <ul className="space-y-1.5">
                                  {RATING_CATEGORIES.map(({ key, label }) => {
                                    const v = property.ratings?.[key] ?? 0;
                                    return (
                                      <li
                                        key={key}
                                        className="flex items-center justify-between gap-2 text-xs"
                                        data-testid={`rating-breakdown-${property.id}-${key}`}
                                      >
                                        <span className="text-muted-foreground">{label}</span>
                                        <span className="inline-flex items-center gap-1.5">
                                          {v > 0 ? (
                                            <>
                                              <StarRating value={v} readOnly size="sm" ariaLabel={`${label} rating`} />
                                              <span className="font-medium tabular-nums w-4 text-right">{v}</span>
                                            </>
                                          ) : (
                                            <span className="text-muted-foreground italic">{t("pages.properties.notRated")}</span>
                                          )}
                                        </span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </HoverCardContent>
                            </HoverCard>
                          )}
                        </td>
                        <td className="p-4">
                          {showRenewal && renewal ? (
                            <Badge variant="outline" className={`text-[11px] font-medium ${renewal.badgeClass}`}>
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              {renewal.label}
                            </Badge>
                          ) : showNoEndDate && activeLease ? (
                            // Inline end-date editor (task #430). Clicking
                            // the badge opens the same RenewLeasePopover
                            // used elsewhere so operators can fill in the
                            // missing date right from the row.
                            <RenewLeasePopover
                              currentEndDate={activeLease.endDate}
                              currentStatus={activeLease.status}
                              propertyName={property.name}
                              onRenew={(newEndDate, newStatus) =>
                                updateLease(activeLease.id, {
                                  endDate: newEndDate,
                                  status: newStatus,
                                })
                              }
                              align="start"
                              trigger={
                                <button
                                  type="button"
                                  onClick={(e) => e.stopPropagation()}
                                  data-testid={`badge-no-end-date-${property.id}`}
                                  title="Click to set the lease end date"
                                  className="inline-flex items-center rounded-md border border-dashed border-input bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  No end date
                                </button>
                              }
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          {worstInsuranceCert ? (
                            <Badge
                              variant="outline"
                              className={`text-[11px] font-medium ${
                                worstInsuranceCert.days < 0
                                  ? "bg-red-100 text-red-800 border-red-200"
                                  : "bg-amber-100 text-amber-800 border-amber-200"
                              }`}
                              data-testid={`badge-insurance-expiry-${property.id}`}
                            >
                              <ShieldCheck className="h-3 w-3 mr-1" />
                              {worstInsuranceCert.days < 0
                                ? "Insurance expired"
                                : `Insurance expiring ${formatYMDPretty(worstInsuranceCert.coverageEnd)}`}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </td>
                      </motion.tr>
                    );
                    });
                    return [headerRow, ...propertyRows];
                  })
                )}
              </TableBody>
            </Table>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Add Property Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("pages.properties.addDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("pages.properties.addDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="prop-name">{t("pages.properties.addDialog.propertyName")}</Label>
              <Input
                id="prop-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t("pages.properties.addDialog.propertyNamePlaceholder")}
                data-testid="input-property-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prop-customer">{t("pages.properties.addDialog.customerLabel")}</Label>
              <Select
                value={showNewCustomerForm ? NEW_CUSTOMER_VALUE : draft.customerId}
                onValueChange={(v) => {
                  if (v === NEW_CUSTOMER_VALUE) {
                    setShowNewCustomerForm(true);
                    setDraft({ ...draft, customerId: "" });
                  } else {
                    setShowNewCustomerForm(false);
                    setDraft({ ...draft, customerId: v });
                  }
                }}
              >
                <SelectTrigger id="prop-customer" data-testid="select-property-customer">
                  <SelectValue placeholder={t("pages.properties.addDialog.customerPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_CUSTOMER_VALUE}>{t("pages.properties.addDialog.createNewCustomer")}</SelectItem>
                  {customers.length > 0 && <div className="my-1 h-px bg-border" />}
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {showNewCustomerForm && (
              <div className="space-y-3 p-3 rounded-md border bg-muted/30">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("pages.properties.addDialog.newCustomer")}
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="new-cust-name">{t("pages.properties.addDialog.companyName")}</Label>
                  <Input
                    id="new-cust-name"
                    value={newCustomer.name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                    data-testid="input-new-customer-name"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-cust-contact">{t("pages.properties.addDialog.contact")}</Label>
                    <Input
                      id="new-cust-contact"
                      value={newCustomer.contactName}
                      onChange={(e) => setNewCustomer({ ...newCustomer, contactName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-cust-phone">{t("pages.properties.addDialog.phone")}</Label>
                    <Input
                      id="new-cust-phone"
                      value={newCustomer.phone}
                      onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-cust-email">{t("pages.properties.dialog.email")}</Label>
                  <Input
                    id="new-cust-email"
                    type="email"
                    value={newCustomer.email}
                    onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="prop-type">{t("pages.properties.addDialog.type")}</Label>
              <Select
                value={draft.propertyType ?? NO_PROPERTY_TYPE_VALUE}
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    propertyType:
                      v === NO_PROPERTY_TYPE_VALUE ? null : (v as PropertyType),
                  })
                }
              >
                <SelectTrigger id="prop-type" data-testid="select-property-type">
                  <SelectValue placeholder={t("pages.properties.addDialog.noType")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROPERTY_TYPE_VALUE}>{t("pages.properties.addDialog.noType")}</SelectItem>
                  {PROPERTY_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {t(`common.propertyTypes.${opt}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prop-address">{t("pages.properties.addDialog.address")}</Label>
              <Input
                id="prop-address"
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                placeholder={t("pages.properties.addDialog.addressPlaceholder")}
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label htmlFor="prop-city">{t("pages.properties.addDialog.city")}</Label>
                <Input
                  id="prop-city"
                  value={draft.city}
                  onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prop-state">{t("pages.properties.addDialog.state")}</Label>
                <Input
                  id="prop-state"
                  value={draft.state}
                  onChange={(e) => setDraft({ ...draft, state: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prop-zip">{t("pages.properties.addDialog.zip")}</Label>
                <Input
                  id="prop-zip"
                  value={draft.zip}
                  onChange={(e) => setDraft({ ...draft, zip: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t("pages.properties.dialog.cancel")}</Button>
            <Button onClick={handleSaveProperty} disabled={saving} data-testid="button-save-property">
              {saving ? t("pages.properties.dialog.saving") : t("pages.properties.dialog.addAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
