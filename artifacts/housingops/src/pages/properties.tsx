import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { PropertyNameCell } from "@/components/property-name-cell";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { getRenewalInfo, computeOverallRating, computeRoomTotals, computePricePerSqft, RATING_CATEGORIES, type Property, type Customer, type RatingCategoryKey } from "@/data/mockData";
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
import { Search, Plus, ChevronRight, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Briefcase, X, Download, Home, Map as MapIcon, Table as TableIcon, MapPinOff } from "lucide-react";
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

type SortDir = "asc" | "desc" | null;
type SortKey = "customer" | "rating" | "sqft";
type MinRating = "any" | "3" | "4" | "5";
type RatingSortKey = "overall" | RatingCategoryKey;
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
const VALID_SORT_KEYS = new Set<SortKey>(["customer", "rating", "sqft"]);
const VALID_SORT_DIRS = new Set<Exclude<SortDir, null>>(["asc", "desc"]);
const VALID_RATING_SORT_KEYS = new Set<RatingSortKey>(
  RATING_SORT_OPTIONS.map((o) => o.key),
);
const VALID_VIEW_MODES = new Set<ViewMode>(["table", "map"]);

interface PersistedPrefs {
  statusFilter?: string;
  minRating?: MinRating;
  sortKey?: SortKey;
  sortDir?: Exclude<SortDir, null>;
  ratingSortCategory?: RatingSortKey;
  viewMode?: ViewMode;
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
    return out;
  } catch {
    return {};
  }
}

function writePersistedPrefs(prefs: {
  statusFilter: string;
  minRating: MinRating;
  sortKey: SortKey | null;
  sortDir: SortDir;
  ratingSortCategory: RatingSortKey;
  viewMode: ViewMode;
}): void {
  if (typeof window === "undefined") return;
  try {
    // Only persist non-default values so storage doesn't accumulate
    // stale state — when the user clears everything we drop the key.
    const cleaned: PersistedPrefs = {};
    if (prefs.statusFilter !== "All") cleaned.statusFilter = prefs.statusFilter;
    if (prefs.minRating !== "any") cleaned.minRating = prefs.minRating;
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
}

const EMPTY_PROPERTY_DRAFT: PropertyDraft = {
  name: "",
  customerId: "",
  address: "",
  city: "",
  state: "",
  zip: "",
};

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
  const [, navigate] = useLocation();
  const { properties, beds, leases, rooms, customers, addProperty, addCustomer, updateProperty, isLoading } = useData();
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

  // Persist toolbar prefs whenever they change. writePersistedPrefs
  // strips defaults and removes the storage key entirely when the user
  // is back to a fully-default toolbar, so storage doesn't accumulate
  // stale state.
  useEffect(() => {
    writePersistedPrefs({
      statusFilter,
      minRating,
      sortKey,
      sortDir,
      ratingSortCategory,
      viewMode,
    });
  }, [statusFilter, minRating, sortKey, sortDir, ratingSortCategory, viewMode]);

  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState<PropertyDraft>(EMPTY_PROPERTY_DRAFT);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState<NewCustomerDraft>(EMPTY_NEW_CUSTOMER);

  const customerById = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) map.set(c.id, c);
    return map;
  }, [customers]);

  // Pre-compute $/sqft for every property so the sort comparator stays O(n log n)
  // instead of re-filtering `rooms` for every comparison. `null` when the
  // property has no rent or no sqft — those rows always sort to the end.
  const pricePerSqftByPropertyId = useMemo(() => {
    const totalsByProperty = new Map<string, { totalSqft: number; totalMonthlyRent: number }>();
    for (const r of rooms) {
      const cur = totalsByProperty.get(r.propertyId) ?? { totalSqft: 0, totalMonthlyRent: 0 };
      cur.totalSqft += r.sqft || 0;
      cur.totalMonthlyRent += r.monthlyRent || 0;
      totalsByProperty.set(r.propertyId, cur);
    }
    const map = new Map<string, number | null>();
    for (const p of properties) {
      const t = totalsByProperty.get(p.id);
      map.set(p.id, t ? computePricePerSqft(t.totalMonthlyRent, t.totalSqft) : null);
    }
    return map;
  }, [properties, rooms]);

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
      const matchesCustomer =
        customerFilter === ALL_CUSTOMERS || p.customerId === customerFilter;
      let matchesRating = true;
      if (minRatingValue !== null) {
        const overall = computeOverallRating(p.ratings);
        // Unrated properties are excluded when a minimum is set.
        matchesRating = overall !== null && overall >= minRatingValue;
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
      } else if (sortKey === "sqft") {
        list.sort((a, b) => {
          const ap = pricePerSqftByPropertyId.get(a.id) ?? null;
          const bp = pricePerSqftByPropertyId.get(b.id) ?? null;
          // Properties without a $/sqft (no rent or no sqft) always sort
          // to the end so the active list shows comparable rows first.
          if (ap === null && bp === null) return 0;
          if (ap === null) return 1;
          if (bp === null) return -1;
          const cmp = ap - bp;
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }
    return list;
  }, [properties, search, statusFilter, customerFilter, minRating, sortKey, sortDir, ratingSortCategory, customerById, pricePerSqftByPropertyId]);

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
  const toggleSqftSort = () => cycleSort("sqft");

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
  const sqftSortDir: SortDir = sortKey === "sqft" ? sortDir : null;
  const activeRatingSortLabel =
    sortKey === "rating"
      ? RATING_SORT_OPTIONS.find((o) => o.key === ratingSortCategory)?.label ?? "Rating"
      : "Rating";

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
        title: "Name is required",
        description: "Please enter a property name.",
        variant: "destructive",
      });
      return;
    }

    let customerId = draft.customerId;
    if (showNewCustomerForm) {
      const cName = newCustomer.name.trim();
      if (!cName) {
        toast({
          title: "Customer name is required",
          description: "Please enter a name for the new customer.",
          variant: "destructive",
        });
        return;
      }
      customerId = `cust-${Date.now()}`;
    }
    if (!customerId) {
      toast({
        title: "Customer is required",
        description: "Please select a customer or create a new one.",
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
          });
        } catch {
          toast({
            title: "Couldn't create customer",
            description: "The new customer couldn't be saved. The property was not created.",
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
      };

      try {
        await addProperty(newProperty);
        toast({ title: "Property added", description: `${name} created.` });
        setAddOpen(false);
      } catch {
        toast({
          title: "Couldn't create property",
          description:
            "Saving failed on the server. Please verify the customer exists and try again.",
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

  // Pre-compute total/occupied/vacant bed counts per property so both
  // the table cells AND the map's info bubble pull from the same source
  // — the bubble would otherwise have to re-filter `beds` for every
  // pin, and the two views could drift out of sync if the table's
  // counting logic ever changed.
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

  const toMappable = useCallback(
    (p: Property): MappableProperty => {
      const stats = bedStatsByPropertyId.get(p.id);
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
        lat: p.lat ?? null,
        lng: p.lng ?? null,
      };
    },
    [bedStatsByPropertyId, customerById],
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
      const propRooms = rooms.filter((r) => r.propertyId === property.id);
      const roomTotals = computeRoomTotals(propRooms);
      return { property, customer, occupied, vacant, propBeds, activeLease, renewal, overallRating, roomTotals };
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
      { header: "Total Sqft",      value: (r) => r.roomTotals.totalSqft },
      { header: "$ / Sqft",        value: (r) => computePricePerSqft(r.roomTotals.totalMonthlyRent, r.roomTotals.totalSqft) ?? "" },
      { header: "Charge per Bed",  value: (r) => r.property.chargePerBed },
      { header: "Monthly Rent",    value: (r) => r.property.monthlyRent },
      { header: "Status",          value: (r) => r.property.status },
      { header: "Overall Rating",  value: (r) => (r.overallRating === null ? "" : r.overallRating) },
      { header: "Lease End Date",  value: (r) => r.activeLease?.endDate ?? "" },
      { header: "Days to Renewal", value: (r) => (r.renewal ? r.renewal.days : "") },
      { header: "Landlord",        value: (r) => r.property.landlordName },
      { header: "Landlord Email",  value: (r) => r.property.landlordEmail },
      { header: "Landlord Phone",  value: (r) => r.property.landlordPhone },
    ]);
    downloadCsv(timestampedCsvName("kfi-staffing-properties"), csv);
    toast({
      title: "Properties exported",
      description: `Downloaded ${filtered.length} ${filtered.length === 1 ? "property" : "properties"} as CSV.`,
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Properties</h1>
            <p className="text-muted-foreground mt-1">Select a property to manage it</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Table/Map toggle. Persisted with the rest of the toolbar
                prefs so the operator's last choice survives refresh and
                back-navigation. */}
            <div
              className="inline-flex rounded-md border overflow-hidden"
              role="group"
              aria-label="Properties view"
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
                Table
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
                Map
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={isLoading || filtered.length === 0}
              data-testid="button-download-properties-csv"
            >
              <Download className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
            <Button onClick={openAdd} data-testid="button-add-property">
              <Plus className="mr-2 h-4 w-4" />
              Add Property
            </Button>
          </div>
        </div>

        {activeCustomerName && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 px-2 py-1" data-testid="badge-customer-filter">
              <Briefcase className="h-3 w-3" />
              Filtered by customer: <span className="font-semibold">{activeCustomerName}</span>
              <button
                type="button"
                onClick={() => updateCustomerFilter(ALL_CUSTOMERS)}
                className="ml-1 rounded-sm p-0.5 hover:bg-background/40"
                aria-label="Clear customer filter"
                data-testid="button-clear-customer-filter"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search properties or customers..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-search-properties"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Select value={customerFilter} onValueChange={updateCustomerFilter}>
                  <SelectTrigger className="w-full sm:w-56" data-testid="select-customer-filter">
                    <SelectValue placeholder="Customer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_CUSTOMERS}>All Customers</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-40" data-testid="select-status-filter">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Statuses</SelectItem>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={minRating} onValueChange={(v) => setMinRating(v as MinRating)}>
                  <SelectTrigger className="w-full sm:w-36" data-testid="select-min-rating">
                    <SelectValue placeholder="Min rating" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any rating</SelectItem>
                    <SelectItem value="3">3+ stars</SelectItem>
                    <SelectItem value="4">4+ stars</SelectItem>
                    <SelectItem value="5">5 stars</SelectItem>
                  </SelectContent>
                </Select>
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
                      No properties match the current filters.
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
                        None of the {propertiesWithoutAddress.length}{" "}
                        {propertiesWithoutAddress.length === 1
                          ? "property"
                          : "properties"}{" "}
                        in view has an address yet — see the side panel.
                      </p>
                    )}
                </div>
                <aside
                  className="rounded-lg border bg-card"
                  data-testid="properties-without-address-panel"
                  aria-label="Properties without an address"
                >
                  <div className="p-3 border-b flex items-center gap-2">
                    <MapPinOff className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold">Missing address</h2>
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
                      Every property in view has an address. Pins on the
                      map cover them all.
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
                  <TableHead>Property</TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={toggleCustomerSort}
                      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                      data-testid="button-sort-customer"
                    >
                      Customer
                      {customerSortDir === "asc" ? (
                        <ArrowUp className="h-3.5 w-3.5" />
                      ) : customerSortDir === "desc" ? (
                        <ArrowDown className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead className="text-center">Total Beds</TableHead>
                  <TableHead className="text-center">Occupied</TableHead>
                  <TableHead className="text-center">Vacant</TableHead>
                  <TableHead className="text-right">
                    <button
                      type="button"
                      onClick={toggleSqftSort}
                      className="inline-flex items-center gap-1 hover:text-foreground transition-colors ml-auto"
                      data-testid="button-sort-sqft"
                      aria-label={`Sort by price per square foot (currently ${
                        sqftSortDir
                          ? sqftSortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "unsorted"
                      })`}
                    >
                      Total Sqft / $/sqft
                      {sqftSortDir === "asc" ? (
                        <ArrowUp className="h-3.5 w-3.5" />
                      ) : sqftSortDir === "desc" ? (
                        <ArrowDown className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">Charge / Bed</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                          data-testid="button-sort-rating"
                          aria-label={`Sort by rating (currently ${
                            ratingSortDir
                              ? `${activeRatingSortLabel} ${ratingSortDir === "asc" ? "ascending" : "descending"}`
                              : "unsorted"
                          })`}
                        >
                          {activeRatingSortLabel}
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
                          Sort by rating
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
                              <span className={isActive ? "font-semibold" : ""}>{opt.label}</span>
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
                  <TableHead>Lease Renewal</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <SkeletonRows rows={6} columns={13} />
                ) : filtered.length === 0 ? (
                  <EmptyStateRow
                    colSpan={13}
                    icon={Home}
                    title="No properties found"
                    description={
                      properties.length === 0
                        ? "Add your first property to start tracking beds, leases, and utilities."
                        : "Try clearing your search or filters above."
                    }
                    action={
                      properties.length === 0 ? (
                        <Button onClick={openAdd} data-testid="button-add-property-empty">
                          <Plus className="mr-2 h-4 w-4" />
                          Add Property
                        </Button>
                      ) : undefined
                    }
                    testId="empty-properties-table"
                  />
                ) : (
                  filtered.map((property, i) => {
                    const propBeds = beds.filter((b) => b.propertyId === property.id);
                    const occupied = propBeds.filter((b) => b.status === "Occupied").length;
                    const vacant = propBeds.length - occupied;
                    const activeLease = leases.find((l) => l.propertyId === property.id && l.status === "Active");
                    const renewal = activeLease ? getRenewalInfo(activeLease.endDate) : null;
                    const showRenewal = renewal && renewal.level !== "ok";
                    const overallRating = computeOverallRating(property.ratings);
                    const customer = customerById.get(property.customerId);
                    const propRooms = rooms.filter((r) => r.propertyId === property.id);
                    const propTotals = computeRoomTotals(propRooms);
                    const totalSqft = propTotals.totalSqft;
                    const pricePerSqft = computePricePerSqft(propTotals.totalMonthlyRent, totalSqft);

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
                        <td className="p-4"><PropertyNameCell name={property.name} primaryClassName="font-semibold" /></td>
                        <td className="p-4 text-sm" data-testid={`cell-customer-${property.id}`}>
                          {customer ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateCustomerFilter(customer.id);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-sm hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              data-testid={`button-filter-customer-${property.id}`}
                              aria-label={`Filter by customer ${customer.name}`}
                            >
                              <Briefcase className="h-3 w-3 text-muted-foreground" />
                              {customer.name}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4 text-sm text-muted-foreground">{property.address}</td>
                        <td className="p-4 text-sm text-muted-foreground">{property.city}, {property.state}</td>
                        <td className="p-4 text-center text-sm">{propBeds.length}</td>
                        <td className="p-4 text-center">
                          <span className="text-sm font-medium text-green-600">{occupied}</span>
                        </td>
                        <td className="p-4 text-center">
                          <span className={`text-sm font-medium ${vacant > 0 ? "text-amber-500" : "text-muted-foreground"}`}>{vacant}</span>
                        </td>
                        <td
                          className="p-4 text-right text-sm tabular-nums"
                          data-testid={`cell-total-sqft-${property.id}`}
                        >
                          {totalSqft > 0 ? (
                            pricePerSqft !== null ? (
                              // Both sqft and rent are non-zero → surface the
                              // derived $/sqft via hover so customers can
                              // compare pricing across properties without
                              // adding a whole new column.
                              <HoverCard openDelay={120} closeDelay={80}>
                                <HoverCardTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={(e) => e.stopPropagation()}
                                    className="rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    aria-label={`${property.name} total square footage and price per square foot`}
                                    data-testid={`price-per-sqft-trigger-${property.id}`}
                                  >
                                    {totalSqft.toLocaleString()}
                                    <span className="text-xs text-muted-foreground"> sqft</span>
                                    <span
                                      className="block text-xs text-muted-foreground tabular-nums"
                                      data-testid={`cell-price-per-sqft-${property.id}`}
                                    >
                                      ${pricePerSqft.toFixed(2)}/sqft
                                    </span>
                                  </button>
                                </HoverCardTrigger>
                                <HoverCardContent
                                  align="end"
                                  sideOffset={6}
                                  className="w-56 p-3 text-xs"
                                  onClick={(e) => e.stopPropagation()}
                                  data-testid={`price-per-sqft-breakdown-${property.id}`}
                                >
                                  <p className="font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                                    Price per sqft
                                  </p>
                                  <dl className="space-y-1">
                                    <div className="flex justify-between gap-2">
                                      <dt className="text-muted-foreground">Room rent</dt>
                                      <dd className="font-medium tabular-nums">${propTotals.totalMonthlyRent.toLocaleString()}/mo</dd>
                                    </div>
                                    <div className="flex justify-between gap-2">
                                      <dt className="text-muted-foreground">Total sqft</dt>
                                      <dd className="font-medium tabular-nums">{totalSqft.toLocaleString()}</dd>
                                    </div>
                                    <div className="flex justify-between gap-2 border-t pt-1 mt-1">
                                      <dt className="font-semibold">$ / sqft</dt>
                                      <dd className="font-semibold tabular-nums">${pricePerSqft.toFixed(2)}</dd>
                                    </div>
                                  </dl>
                                </HoverCardContent>
                              </HoverCard>
                            ) : (
                              <>
                                {totalSqft.toLocaleString()}
                                <span className="text-xs text-muted-foreground"> sqft</span>
                              </>
                            )
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4 text-right text-sm font-medium">${property.chargePerBed.toLocaleString()}</td>
                        <td className="p-4 text-center">
                          <Badge variant={property.status === "Active" ? "default" : "secondary"}>
                            {property.status}
                          </Badge>
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
                                            <span className="text-muted-foreground italic">Not rated</span>
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
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </td>
                      </motion.tr>
                    );
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
            <DialogTitle>Add property</DialogTitle>
            <DialogDescription>
              Every property is owned by a customer. Pick an existing one or create a new customer inline.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="prop-name">Property name *</Label>
              <Input
                id="prop-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Birchwood Apartments"
                data-testid="input-property-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prop-customer">Customer *</Label>
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
                  <SelectValue placeholder="Choose a customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                  <SelectItem value={NEW_CUSTOMER_VALUE}>+ Create new customer…</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showNewCustomerForm && (
              <div className="space-y-3 p-3 rounded-md border bg-muted/30">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  New customer
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="new-cust-name">Company name *</Label>
                  <Input
                    id="new-cust-name"
                    value={newCustomer.name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                    data-testid="input-new-customer-name"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-cust-contact">Contact</Label>
                    <Input
                      id="new-cust-contact"
                      value={newCustomer.contactName}
                      onChange={(e) => setNewCustomer({ ...newCustomer, contactName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-cust-phone">Phone</Label>
                    <Input
                      id="new-cust-phone"
                      value={newCustomer.phone}
                      onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-cust-email">Email</Label>
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
              <Label htmlFor="prop-address">Address</Label>
              <Input
                id="prop-address"
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                placeholder="123 Main St"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label htmlFor="prop-city">City</Label>
                <Input
                  id="prop-city"
                  value={draft.city}
                  onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prop-state">State</Label>
                <Input
                  id="prop-state"
                  value={draft.state}
                  onChange={(e) => setDraft({ ...draft, state: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prop-zip">ZIP</Label>
                <Input
                  id="prop-zip"
                  value={draft.zip}
                  onChange={(e) => setDraft({ ...draft, zip: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveProperty} disabled={saving} data-testid="button-save-property">
              {saving ? "Saving…" : "Add property"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
