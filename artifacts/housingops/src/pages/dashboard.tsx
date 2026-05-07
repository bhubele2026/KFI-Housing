import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, BedDouble, Zap, DollarSign, TrendingUp, Users, Briefcase, Trophy, AlertTriangle, Receipt, Wand2, CalendarClock, UserCheck, ArrowRight, History, ShieldCheck, BellOff, CheckCircle2, RotateCcw, Undo2 } from "lucide-react";
import { ToastAction } from "@/components/ui/toast";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUnplacedPayroll,
  getListUnplacedPayrollQueryKey,
  useListRoomNightLogs,
  type UnplacedPayrollRow,
  type LowConfidencePayrollMatch,
} from "@workspace/api-client-react";
import { getHotelRateMonthRisk, currentMonthKey } from "@/lib/hotel-rate-status";
import { AssignOccupantDialog } from "@/components/assign-occupant-dialog";
import { EmptyState, EmptyStateRow } from "@/components/empty-state";
import { computeOverallRating, computeRentPerBed, computeElectricPerBed, computeRentPlusElectricPerBed, RATING_CATEGORIES, sumActiveRentEstimated, estimateLeaseMonthlyRent, daysUntil, sumCustomerResponsibleRent, getCustomerResponsibleLeases, type RatingCategoryKey, type Lease, type Occupant } from "@/data/mockData";
import { formatYMDPretty, formatTodayYMD, addDaysToToday } from "@/lib/lease-dates";
import { isPendingPlacementProperty } from "@/lib/pending-placement";
import { StarRating } from "@/components/star-rating";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PropertyNameCell } from "@/components/property-name-cell";
import { formatPropertyName } from "@/lib/property-name";
import { computeShiftPairs, roomHasAnyShift } from "@/lib/shift-pairs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  recordPayrollReconciliation,
  useRecentPayrollReconciliations,
  type PayrollReconciliationKind,
} from "@/lib/recent-payroll-reconciliations";

type TopPropertiesSortKey = "overall" | RatingCategoryKey;

// Lightweight "N <unit> ago" formatter for the recent-reconciliations
// audit trail. The card never lives long enough on screen to need a
// self-refreshing tick (entries are session-scoped and the operator
// usually clicks through immediately), so a one-shot string is fine.
function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - timestamp);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

export default function Dashboard() {
  const { properties, beds, rooms, leases, utilities, insuranceCertificates, customers, occupants, addOccupant, updateBed, updateOccupant, updateLease } = useData();
  const { toast } = useToast();
  const [pendingEmployerMove, setPendingEmployerMove] = useState<{
    occupantId: string;
    occupantName: string;
    fromCompany: string;
    toCompany: string;
    propertyName: string | null;
    chargePerBed: number;
    employeeId: string;
  } | null>(null);
  const queryClient = useQueryClient();
  const { data: unplacedPayrollResult } = useListUnplacedPayroll();
  const unplacedPayroll = unplacedPayrollResult?.unmatched;
  const lowConfidencePayroll = unplacedPayrollResult?.lowConfidenceMatches;
  // Audit trail of suggestion-applied payroll rows (Task #351). The
  // unplaced/low-confidence rows silently disappear after a successful
  // refetch — keep the last few here so the operator can sanity-check
  // (or undo via the linked occupant page) if a guess was wrong.
  const recentReconciliations = useRecentPayrollReconciliations();
  // Room-night logs power the hotel-rate "at risk this month" tile —
  // mirrors the leases page (task #319). Hook returns undefined while
  // loading; treat as empty so the tile just shows 0 / no tile.
  const { data: roomNightLogsData } = useListRoomNightLogs();
  const roomNightLogs = useMemo(() => roomNightLogsData ?? [], [roomNightLogsData]);
  const { customerId: customerFilter, setCustomerId: updateCustomerFilter } =
    useCustomerScope();
  const [topRatingSort, setTopRatingSort] = useState<TopPropertiesSortKey>("overall");

  const scopedProperties = useMemo(() => {
    if (customerFilter === ALL_CUSTOMERS) return properties;
    // Shared-housing properties (task #295/#311) surface under every
    // customer in `sharedWithCustomerIds`, in addition to the primary
    // `customerId`, so a scoped dashboard for a shared tenant still
    // sees those properties (and the beds/leases/utilities/occupants
    // derived from them).
    return properties.filter(
      (p) =>
        p.customerId === customerFilter ||
        (p.sharedWithCustomerIds ?? []).includes(customerFilter),
    );
  }, [properties, customerFilter]);

  const scopedPropertyIds = useMemo(
    () => new Set(scopedProperties.map((p) => p.id)),
    [scopedProperties],
  );

  const scopedBeds = useMemo(
    () => beds.filter((b) => scopedPropertyIds.has(b.propertyId)),
    [beds, scopedPropertyIds],
  );

  const scopedLeases = useMemo(
    () => leases.filter((l) => scopedPropertyIds.has(l.propertyId)),
    [leases, scopedPropertyIds],
  );

  const scopedUtilities = useMemo(
    () => utilities.filter((u) => scopedPropertyIds.has(u.propertyId)),
    [utilities, scopedPropertyIds],
  );

  const scopedOccupants = useMemo(
    () =>
      occupants.filter(
        (o) => o.propertyId !== null && scopedPropertyIds.has(o.propertyId),
      ),
    [occupants, scopedPropertyIds],
  );

  // Payroll-reconciliation counters (Task #304). Only consider Active
  // occupants — Former occupants don't show up in the property page so
  // counting them in the dashboard total would mislead the operator.
  // "Auto-reconciled" = `chargeSource === "payroll"`; everything else
  // (including occupants the seeder couldn't match) is "manually set".
  const activeOccupants = useMemo(
    () => scopedOccupants.filter((o) => o.status === "Active"),
    [scopedOccupants],
  );
  const autoReconciledOccupantCount = useMemo(
    () => activeOccupants.filter((o) => o.chargeSource === "payroll").length,
    [activeOccupants],
  );
  const manualOccupantCount = activeOccupants.length - autoReconciledOccupantCount;

  // Per-customer reconciliation breakdown (Task #331). Operators want to
  // see *which* customer still has manual rows so they can chase the
  // right payroll cycle. Group active in-scope occupants by their
  // property's customerId, then rank by manual count desc (tie-break by
  // name) so the worst offender sits at the top. When a single customer
  // is filtered the list collapses to one row, which is still useful as
  // a same-card confirmation of the totals above.
  const reconciliationByCustomer = useMemo(() => {
    const propertyCustomerById = new Map(
      scopedProperties.map((p) => [p.id, p.customerId] as const),
    );
    const customerNameById = new Map(customers.map((c) => [c.id, c.name] as const));
    const map = new Map<
      string,
      { customerId: string; customerName: string; manual: number; auto: number }
    >();
    for (const o of activeOccupants) {
      if (o.propertyId === null) continue;
      const customerId = propertyCustomerById.get(o.propertyId);
      if (!customerId) continue;
      const existing =
        map.get(customerId) ?? {
          customerId,
          customerName: customerNameById.get(customerId) ?? "Unknown customer",
          manual: 0,
          auto: 0,
        };
      if (o.chargeSource === "payroll") existing.auto += 1;
      else existing.manual += 1;
      map.set(customerId, existing);
    }
    return Array.from(map.values()).sort(
      (a, b) => b.manual - a.manual || a.customerName.localeCompare(b.customerName),
    );
  }, [activeOccupants, scopedProperties, customers]);

  const customerPaidRentByCustomer = useMemo(() => {
    const rows: { customerId: string; customerName: string; rent: number; leaseCount: number }[] = [];
    let portfolioTotal = 0;
    for (const c of customers) {
      const rent = sumCustomerResponsibleRent(scopedLeases, scopedProperties, c.id);
      if (rent <= 0) continue;
      const leaseCount = getCustomerResponsibleLeases(scopedLeases, scopedProperties, c.id).length;
      rows.push({ customerId: c.id, customerName: c.name, rent, leaseCount });
      portfolioTotal += rent;
    }
    rows.sort((a, b) => b.rent - a.rent || a.customerName.localeCompare(b.customerName));
    return { rows, total: portfolioTotal };
  }, [customers, scopedLeases, scopedProperties]);

  interface OverriddenOccupant {
    occupant: Occupant;
    propertyName: string;
    propertyId: string | null;
  }
  const overriddenOccupants = useMemo<OverriddenOccupant[]>(() => {
    const out: OverriddenOccupant[] = [];
    for (const o of activeOccupants) {
      if (o.chargeSource !== "manual_override") continue;
      const prop = o.propertyId
        ? scopedProperties.find((p) => p.id === o.propertyId)
        : null;
      out.push({
        occupant: o,
        propertyName: prop?.name ?? "—",
        propertyId: o.propertyId,
      });
    }
    out.sort((a, b) => a.occupant.name.localeCompare(b.occupant.name));
    return out;
  }, [activeOccupants, scopedProperties]);

  const overriddenByCustomer = useMemo(() => {
    const map = new Map<
      string,
      { customer: string; rows: OverriddenOccupant[] }
    >();
    for (const entry of overriddenOccupants) {
      const cust = entry.occupant.chargeSourceCustomer || entry.occupant.company || "Unknown";
      const existing = map.get(cust) ?? { customer: cust, rows: [] };
      existing.rows.push(entry);
      map.set(cust, existing);
    }
    return Array.from(map.values()).sort(
      (a, b) => b.rows.length - a.rows.length || a.customer.localeCompare(b.customer),
    );
  }, [overriddenOccupants]);

  const [reclaimingIds, setReclaimingIds] = useState<Set<string>>(new Set());
  const [reclaimingAll, setReclaimingAll] = useState(false);

  const handleReclaimSingle = async (occupantId: string) => {
    setReclaimingIds((prev) => new Set(prev).add(occupantId));
    try {
      const baseUrl = import.meta.env.BASE_URL ?? "/";
      const res = await fetch(
        `${baseUrl}api/payroll/unplaced?reclaimOverridden=true&reclaimOccupantIds=${encodeURIComponent(occupantId)}`,
      );
      if (!res.ok) {
        toast({
          title: "Re-claim failed",
          description: `Server returned ${res.status}. Try again or re-claim all.`,
          variant: "destructive",
        });
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: getListUnplacedPayrollQueryKey(),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/occupants"] });
      toast({
        title: "Re-claimed from payroll",
        description: "The occupant's charge has been reset to the payroll value.",
      });
    } finally {
      setReclaimingIds((prev) => {
        const next = new Set(prev);
        next.delete(occupantId);
        return next;
      });
    }
  };

  const handleReclaimAll = async () => {
    setReclaimingAll(true);
    try {
      const baseUrl = import.meta.env.BASE_URL ?? "/";
      const res = await fetch(`${baseUrl}api/payroll/unplaced?reclaimOverridden=true`);
      if (!res.ok) {
        toast({
          title: "Re-claim failed",
          description: `Server returned ${res.status}. Try again later.`,
          variant: "destructive",
        });
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: getListUnplacedPayrollQueryKey(),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/occupants"] });
      toast({
        title: "All overrides re-claimed",
        description: `${overriddenOccupants.length} occupant${overriddenOccupants.length === 1 ? "" : "s"} reset to payroll values.`,
      });
    } finally {
      setReclaimingAll(false);
    }
  };

  // "Needs review" mirrors the per-page filters that the dashboard tiles
  // deep-link into. Each predicate matches what the corresponding page
  // shows when `?needsReview=1` is set — keeping the counts in sync with
  // what the operator sees after clicking through.
  // - Occupants: falsy moveInDate (mirrors the inline badge in occupants.tsx)
  // - Leases:    importer-flagged needsReview (ambiguous source cell)
  // - Properties: monthlyRent of 0 / unset (property missing rent)
  // Pending-placement buckets (Task #348). Synthetic
  // "Roster — Pending Placement (<Customer>)" properties hold payroll-only
  // people who haven't been placed in a real bed yet. Surface them on
  // the dashboard so the operator doesn't have to scroll the Properties
  // list to find each bucket. Counts use Active occupants pinned to the
  // bucket — mirrors what the per-property board shows.
  const pendingPlacementBuckets = useMemo(() => {
    return scopedProperties
      .filter((p) => isPendingPlacementProperty(p.name))
      .map((p) => ({
        property: p,
        count: scopedOccupants.filter(
          (o) => o.propertyId === p.id && o.status === "Active",
        ).length,
      }))
      .sort((a, b) => b.count - a.count || a.property.name.localeCompare(b.property.name));
  }, [scopedProperties, scopedOccupants]);

  const needsReviewOccupantCount = useMemo(
    () => scopedOccupants.filter((o) => !o.moveInDate).length,
    [scopedOccupants],
  );
  const needsReviewLeaseCount = useMemo(
    () => scopedLeases.filter((l) => l.needsReview).length,
    [scopedLeases],
  );
  // Mirrors the `?needsDates=1` predicate on /leases (task #363):
  // any lease with a blank start OR end date is part of the triage
  // queue. Surfaced here (task #367) so operators can find the queue
  // from the dashboard without remembering the URL filter.
  const needsDatesLeaseCount = useMemo(
    () => scopedLeases.filter((l) => !l.startDate || !l.endDate).length,
    [scopedLeases],
  );
  const needsReviewPropertyCount = useMemo(
    () => scopedProperties.filter((p) => !(p.monthlyRent && p.monthlyRent > 0)).length,
    [scopedProperties],
  );
  // Hotel-rate "at risk this month" — every Active/Upcoming hotel-rate
  // lease in scope whose current calendar month either has no log yet
  // or logged fewer nights than the agreement's minimum. Mirrors the
  // tile on /leases (task #319) so operators can spot the warning
  // straight from the dashboard.
  // Computed per render (cheap) so the tile label flips correctly if
  // the dashboard stays open across a month boundary, instead of
  // freezing to the month at mount.
  const currentMonth = currentMonthKey();
  const hotelRateAtRiskCount = useMemo(
    () =>
      scopedLeases
        .filter((l) => l.status === "Active" || l.status === "Upcoming")
        .filter((l) => getHotelRateMonthRisk(l, roomNightLogs, currentMonth) !== null)
        .length,
    [scopedLeases, roomNightLogs, currentMonth],
  );
  // Suffix the deep-link with the active customer scope so the linked
  // page lands on the same scope the operator is already looking at.
  const customerQuerySuffix =
    customerFilter === ALL_CUSTOMERS
      ? ""
      : `&customer=${encodeURIComponent(customerFilter)}`;
  const needsReviewItems = [
    {
      key: "occupants" as const,
      count: needsReviewOccupantCount,
      label: "Occupants missing a move-in date",
      cta: "Review occupants",
      href: `/occupants?needsReview=1${customerQuerySuffix}`,
      testId: "needs-review-occupants",
    },
    {
      key: "leases" as const,
      count: needsReviewLeaseCount,
      label: "Leases flagged for review",
      cta: "Review leases",
      href: `/leases?needsReview=1${customerQuerySuffix}`,
      testId: "needs-review-leases",
    },
    {
      key: "leases-needs-dates" as const,
      count: needsDatesLeaseCount,
      label: "Leases missing term dates",
      cta: "Review missing dates",
      href: `/leases?needsDates=1${customerQuerySuffix}`,
      testId: "needs-review-leases-needs-dates",
    },
    {
      key: "properties" as const,
      count: needsReviewPropertyCount,
      label: "Properties missing monthly rent",
      cta: "Review properties",
      href: `/properties?needsReview=1${customerQuerySuffix}`,
      testId: "needs-review-properties",
    },
    {
      key: "hotel-rate-at-risk" as const,
      count: hotelRateAtRiskCount,
      label: `Hotel-rate leases at risk this month (${currentMonth})`,
      cta: "Review hotel-rate leases",
      // `?atRisk=1` (task #358) narrows the leases table itself to just
      // the at-risk rows so the dashboard count and the filtered table
      // line up. Customer scope is preserved so the two counts match.
      href: `/leases?atRisk=1${customerQuerySuffix}`,
      testId: "needs-review-hotel-rate-at-risk",
    },
  ].filter((item) => item.count > 0);

  // ── Expiring-soon lease alerts (Task #326) ────────────────────────
  // Surface leases whose end date is approaching (within 90 days) or
  // recently passed (within the last 30 days) so operators can renew /
  // backfill paperwork before the term silently flips to "Expired".
  // Buckets mirror the colour scale used by `getRenewalInfo` on the
  // Leases page so the dashboard reads consistently with the table.
  // - critical: ≤ 30 days left (red)
  // - warning : 31–60 days left (amber)
  // - soon    : 61–90 days left (yellow)
  // - expired : 1–30 days past end (slate, visually distinct)
  // Leases with blank term dates and Upcoming leases are skipped — the
  // first have no calendar to compare against, the second aren't an
  // expiry risk yet.
  type ExpiryBucket = "critical" | "warning" | "soon" | "expired";
  interface ExpiringLease {
    lease: Lease;
    propertyName: string;
    days: number;
    bucket: ExpiryBucket;
  }
  // Snooze support (Task #357). A lease whose `snoozedUntil` date is
  // strictly after today is hidden from the alerts panel — operators
  // dismiss / snooze rows for renewals already in flight so the panel
  // keeps signalling work that still needs attention. We compute today
  // once per render via `formatTodayYMD` and compare YYYY-MM-DD strings
  // lexicographically (safe because the format is fixed-width).
  const todayYMD = formatTodayYMD();
  // Bucket every in-window lease (visible or snoozed) so the header
  // can show "X snoozed" alongside the visible count without double
  // counting.
  const allInWindowLeases = useMemo<ExpiringLease[]>(() => {
    const out: ExpiringLease[] = [];
    for (const l of scopedLeases) {
      if (!l.endDate) continue;
      if (l.status === "Upcoming") continue;
      // Intentionally NOT wrapped in try/catch: per `lib/lease-dates.ts`,
      // `daysUntil` throws loudly on a malformed date so we never silently
      // drop a lease that should be visible. The API boundary already
      // rejects anything other than `^\d{4}-\d{2}-\d{2}$`, so reaching
      // this throw means a real data bug worth surfacing.
      const days = daysUntil(l.endDate);
      let bucket: ExpiryBucket;
      if (days < 0) {
        if (days < -30) continue;
        bucket = "expired";
      } else if (days <= 30) {
        bucket = "critical";
      } else if (days <= 60) {
        bucket = "warning";
      } else if (days <= 90) {
        bucket = "soon";
      } else {
        continue;
      }
      const propertyName =
        scopedProperties.find((p) => p.id === l.propertyId)?.name ?? "—";
      out.push({ lease: l, propertyName, days, bucket });
    }
    // Sort by urgency: most-overdue first (most negative), then
    // soonest-expiring upcoming dates.
    out.sort((a, b) => a.days - b.days);
    return out;
  }, [scopedLeases, scopedProperties]);

  // Active alerts = in-window AND not currently snoozed. A snooze is
  // active when `snoozedUntil` (a YYYY-MM-DD or "") is strictly after
  // today's YYYY-MM-DD — the snoozed lease reappears the day the snooze
  // window passes.
  const expiringLeases = useMemo<ExpiringLease[]>(
    () =>
      allInWindowLeases.filter(({ lease }) => {
        const snz = lease.snoozedUntil ?? "";
        return !(snz && snz > todayYMD);
      }),
    [allInWindowLeases, todayYMD],
  );
  const snoozedLeases = useMemo<ExpiringLease[]>(
    () =>
      allInWindowLeases.filter(({ lease }) => {
        const snz = lease.snoozedUntil ?? "";
        return snz && snz > todayYMD;
      }),
    [allInWindowLeases, todayYMD],
  );

  const expiringCounts = useMemo(() => {
    const counts = { critical: 0, warning: 0, soon: 0, expired: 0 };
    for (const e of expiringLeases) counts[e.bucket] += 1;
    return counts;
  }, [expiringLeases]);

  // ── Expiring insurance certificates (Task #333) ───────────────────
  // Surface every certificate whose `coverageEnd` is within the next 30
  // days (or expired in the last 30) so operators can chase a renewed
  // PDF before coverage actually lapses. Threshold matches the property
  // page badge so the dashboard and detail view always agree on
  // "expiring soon". Certs without a coverage end date are skipped — a
  // blank window has no calendar to alert on.
  interface ExpiringCert {
    id: string;
    propertyId: string;
    propertyName: string;
    carrier: string;
    policyNumber: string;
    coverageEnd: string;
    days: number;
    expired: boolean;
  }
  const scopedCerts = useMemo(
    () => insuranceCertificates.filter((c) => scopedPropertyIds.has(c.propertyId)),
    [insuranceCertificates, scopedPropertyIds],
  );
  const expiringCerts = useMemo<ExpiringCert[]>(() => {
    const out: ExpiringCert[] = [];
    for (const c of scopedCerts) {
      if (!c.coverageEnd) continue;
      const days = daysUntil(c.coverageEnd);
      if (days < -30 || days > 30) continue;
      const propertyName =
        scopedProperties.find((p) => p.id === c.propertyId)?.name ?? "—";
      out.push({
        id: c.id,
        propertyId: c.propertyId,
        propertyName,
        carrier: c.carrier,
        policyNumber: c.policyNumber,
        coverageEnd: c.coverageEnd,
        days,
        expired: days < 0,
      });
    }
    out.sort((a, b) => a.days - b.days);
    return out;
  }, [scopedCerts, scopedProperties]);

  const expiryBucketStyle: Record<
    ExpiryBucket,
    { badge: string; row: string; label: string }
  > = {
    expired: {
      badge: "bg-slate-200 text-slate-800 border-slate-300",
      row: "border-l-4 border-l-slate-400 bg-slate-50/40 dark:bg-slate-950/20",
      label: "Expired",
    },
    critical: {
      badge: "bg-red-100 text-red-800 border-red-200",
      row: "border-l-4 border-l-red-500",
      label: "≤ 30 days",
    },
    warning: {
      badge: "bg-amber-100 text-amber-800 border-amber-200",
      row: "border-l-4 border-l-amber-500",
      label: "31–60 days",
    },
    soon: {
      badge: "bg-yellow-100 text-yellow-800 border-yellow-200",
      row: "border-l-4 border-l-yellow-500",
      label: "61–90 days",
    },
  };

  function expiryRowLabel(days: number): string {
    if (days < 0) {
      const abs = Math.abs(days);
      return `Expired ${abs} day${abs === 1 ? "" : "s"} ago`;
    }
    if (days === 0) return "Expires today";
    return `${days} day${days === 1 ? "" : "s"} left`;
  }

  const totalProperties = scopedProperties.length;
  const totalBeds = scopedBeds.length;
  const occupiedBeds = scopedBeds.filter((b) => b.status === "Occupied").length;
  const vacantBeds = scopedBeds.filter((b) => b.status === "Vacant").length;
  const occupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;

  const totalMonthlyRevenue = scopedProperties.reduce((acc, p) => {
    const occupied = scopedBeds.filter((b) => b.propertyId === p.id && b.status === "Occupied");
    return acc + occupied.length * p.monthlyRent;
  }, 0);

  // Use the hotel-rate–aware estimator so corporate-rate agreements
  // (nightly × room-nights from the latest logged month) contribute to
  // the dashboard's Monthly Costs / Net Profit tiles instead of being
  // silently treated as $0. Monthly leases are unchanged because
  // `estimateLeaseMonthlyRent` returns their stored `monthlyRent` as-is.
  const totalMonthlyLeaseCosts = scopedLeases
    .filter((l) => l.status === "Active")
    .reduce((acc, l) => acc + estimateLeaseMonthlyRent(l, roomNightLogs), 0);
  const currentMonthUtilities = scopedUtilities.reduce((acc, u) => acc + u.monthlyCost, 0);
  const totalMonthlyCosts = totalMonthlyLeaseCosts + currentMonthUtilities;
  const netProfit = totalMonthlyRevenue - totalMonthlyCosts;

  // Portfolio-wide per-bed unit economics. Sums first, then divides —
  // not an average of per-property ratios — so a 100-bed property
  // weighs 100x a 1-bed property and the number matches what an
  // operator would compute with a calculator across the whole book.
  const portfolioMonthlyRent = scopedProperties.reduce((s, p) => s + (p.monthlyRent || 0), 0);
  const portfolioMonthlyElectric = scopedUtilities.reduce(
    (s, u) => (u.type === "Electric" ? s + (u.monthlyCost || 0) : s),
    0,
  );
  const portfolioRentPerBed = computeRentPerBed(portfolioMonthlyRent, totalBeds);
  const portfolioElectricPerBed = computeElectricPerBed(portfolioMonthlyElectric, totalBeds);
  const portfolioRentPlusElectricPerBed = computeRentPlusElectricPerBed(
    portfolioMonthlyRent,
    portfolioMonthlyElectric,
    totalBeds,
  );

  const topRatedProperties = useMemo(() => {
    const scored = scopedProperties.map((p) => {
      const overall = computeOverallRating(p.ratings);
      const score =
        topRatingSort === "overall" ? overall : (p.ratings?.[topRatingSort] ?? 0) || null;
      return { property: p, overall, score };
    });
    return scored
      .filter((row) => row.score !== null && row.score > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 5);
  }, [scopedProperties, topRatingSort]);

  const sortLabel =
    topRatingSort === "overall"
      ? "Overall"
      : RATING_CATEGORIES.find((c) => c.key === topRatingSort)?.label ?? "Overall";

  // Carry the property id through chartData so downstream lookups (customer
  // name, occupancy %, row keys) don't depend on `name` — two properties can
  // share a name in the demo data, which would otherwise mis-map rows. The
  // `name` field is kept purely for display via the chart tickFormatter.
  // Lease cost sums every Active lease for the property — picking just the
  // first match silently under-reports rent (matches finance.tsx behavior).
  const chartData = useMemo(
    () =>
      scopedProperties.map((p) => {
        const revenue = scopedBeds.filter((b) => b.propertyId === p.id && b.status === "Occupied").length * p.monthlyRent;
        const leaseCost = sumActiveRentEstimated(scopedLeases, roomNightLogs, p.id);
        const utilCost = scopedUtilities.filter((u) => u.propertyId === p.id).reduce((acc, u) => acc + u.monthlyCost, 0);
        return {
          id: p.id,
          name: p.name,
          Revenue: revenue,
          Cost: leaseCost + utilCost,
          Profit: revenue - (leaseCost + utilCost),
        };
      }),
    [scopedProperties, scopedBeds, scopedLeases, scopedUtilities, roomNightLogs],
  );

  const cards = [
    { title: "Properties", value: totalProperties, icon: Building2, trend: "+2 this year" },
    { title: "Total Beds", value: totalBeds, icon: BedDouble, trend: `${occupiedBeds} occupied` },
    { title: "Occupancy", value: `${occupancyRate.toFixed(1)}%`, icon: Users, trend: `${vacantBeds} vacant` },
    { title: "Monthly Revenue", value: `$${totalMonthlyRevenue.toLocaleString()}`, icon: TrendingUp, trend: "Target: $45k" },
    { title: "Monthly Costs", value: `$${totalMonthlyCosts.toLocaleString()}`, icon: DollarSign, trend: "Leases + Utilities" },
    { title: "Net Profit", value: `$${netProfit.toLocaleString()}`, icon: Zap, trend: netProfit >= 0 ? "+12% vs last month" : "Needs attention" },
    {
      title: "Rent / Bed",
      value:
        portfolioRentPerBed === null
          ? "—"
          : `$${portfolioRentPerBed.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      icon: BedDouble,
      trend: `$${portfolioMonthlyRent.toLocaleString()} ÷ ${totalBeds} bed${totalBeds === 1 ? "" : "s"}`,
    },
    {
      title: "Electric / Bed",
      value:
        portfolioElectricPerBed === null
          ? "—"
          : `$${portfolioElectricPerBed.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      icon: Zap,
      trend: `$${portfolioMonthlyElectric.toLocaleString()} electric ÷ ${totalBeds} bed${totalBeds === 1 ? "" : "s"}`,
    },
    {
      title: "Rent + Electric / Bed",
      value:
        portfolioRentPlusElectricPerBed === null
          ? "—"
          : `$${portfolioRentPlusElectricPerBed.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
      icon: DollarSign,
      trend: `(Rent + $${portfolioMonthlyElectric.toLocaleString()} electric) ÷ ${totalBeds} bed${totalBeds === 1 ? "" : "s"}`,
    },
  ];

  // Unplaced payroll = deduction rows the seeder couldn't match to an
  // active occupant. Group by customer so the operator can attack one
  // company at a time. Respect the dashboard's customer filter.
  const scopedUnplacedPayroll = useMemo<UnplacedPayrollRow[]>(() => {
    const rows = unplacedPayroll ?? [];
    if (customerFilter === ALL_CUSTOMERS) return rows;
    const customerName = customers.find((c) => c.id === customerFilter)?.name;
    if (!customerName) return [];
    return rows.filter((r) => r.customer === customerName);
  }, [unplacedPayroll, customerFilter, customers]);

  // Map of normalised employeeId → existing occupant. Used by the
  // "Assign to bed" cell below to detect when a payroll row already
  // has a live occupant — typically one seeded into a pending-placement
  // bucket by Task #305 — so the click routes the operator to that
  // bucket instead of calling addOccupant and producing a duplicate
  // (Task #349). Built across ALL occupants, not just scoped ones, so
  // the guard still fires when the dashboard is filtered to a single
  // customer and the matching pending row lives elsewhere in the list.
  const existingOccupantByEmployeeId = useMemo(() => {
    const map = new Map<string, Occupant>();
    for (const o of occupants) {
      if (!o.employeeId) continue;
      const key = o.employeeId.trim().toLowerCase();
      if (!key) continue;
      // First write wins — payroll personIds are supposed to be unique
      // but if two occupants share one we prefer the earliest match
      // (insertion order) for stability across renders.
      if (!map.has(key)) map.set(key, o);
    }
    return map;
  }, [occupants]);
  const propertyById = useMemo(
    () => new Map(properties.map((p) => [p.id, p] as const)),
    [properties],
  );

  const unplacedByCustomer = useMemo(() => {
    const map = new Map<string, { customer: string; rows: UnplacedPayrollRow[]; weeklyTotal: number }>();
    for (const r of scopedUnplacedPayroll) {
      const existing = map.get(r.customer) ?? { customer: r.customer, rows: [], weeklyTotal: 0 };
      existing.rows.push(r);
      existing.weeklyTotal += r.weekly;
      map.set(r.customer, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.weeklyTotal - a.weeklyTotal);
  }, [scopedUnplacedPayroll]);

  // Low-confidence matches = payroll rows the seeder applied via the
  // name-only fallback. The rate is already on someone, but at an
  // employer with two namesakes it may be the wrong someone — surface
  // them so the operator can confirm or redirect. Same scoping rules
  // as the unplaced list above.
  const scopedLowConfidencePayroll = useMemo<LowConfidencePayrollMatch[]>(() => {
    const rows = lowConfidencePayroll ?? [];
    if (customerFilter === ALL_CUSTOMERS) return rows;
    const customerName = customers.find((c) => c.id === customerFilter)?.name;
    if (!customerName) return [];
    return rows.filter((r) => r.customer === customerName);
  }, [lowConfidencePayroll, customerFilter, customers]);

  const lowConfidenceByCustomer = useMemo(() => {
    const map = new Map<string, { customer: string; rows: LowConfidencePayrollMatch[] }>();
    for (const r of scopedLowConfidencePayroll) {
      const existing = map.get(r.customer) ?? { customer: r.customer, rows: [] };
      existing.rows.push(r);
      map.set(r.customer, existing);
    }
    return Array.from(map.values()).sort((a, b) => a.customer.localeCompare(b.customer));
  }, [scopedLowConfidencePayroll]);

  // Combined KPI (Task #355). Sums the two payroll-review tiles so an
  // operator can tell at a glance — without scrolling — whether the
  // dashboard has any payroll rows waiting on them. Scope mirrors the
  // tiles themselves (already customer-filtered above).
  const payrollReviewCount =
    scopedUnplacedPayroll.length + scopedLowConfidencePayroll.length;
  // Click target: prefer the Unplaced tile when it has rows, otherwise
  // the Confirm-match tile. The two cards expose stable DOM ids below
  // so this scroll keeps working even if their order changes.
  const payrollReviewScrollTargetId =
    scopedUnplacedPayroll.length > 0
      ? "card-unplaced-payroll"
      : scopedLowConfidencePayroll.length > 0
        ? "card-low-confidence-payroll"
        : null;
  const scrollToPayrollReview = () => {
    if (!payrollReviewScrollTargetId) return;
    const el = document.getElementById(payrollReviewScrollTargetId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  interface ShiftGapRow {
    propertyId: string;
    propertyName: string;
    roomId: string;
    roomName: string;
    pairLabel: string;
    issue: "half-covered" | "double-booked";
    detail: string;
  }
  const shiftGapRows = useMemo<ShiftGapRow[]>(() => {
    const out: ShiftGapRow[] = [];
    const scopedRooms = rooms.filter((r) => scopedPropertyIds.has(r.propertyId));
    for (const room of scopedRooms) {
      const roomBeds = scopedBeds.filter((b) => b.roomId === room.id);
      if (roomBeds.length < 2) continue;
      if (!roomHasAnyShift(roomBeds, scopedOccupants)) continue;
      const pairs = computeShiftPairs(roomBeds, scopedOccupants);
      for (const pair of pairs) {
        if (pair.isFullyCovered || pair.isEmpty) continue;
        const propertyName =
          scopedProperties.find((p) => p.id === room.propertyId)?.name ?? "—";
        if (pair.hasDuplicate) {
          out.push({
            propertyId: room.propertyId,
            propertyName,
            roomId: room.id,
            roomName: room.name,
            pairLabel: pair.pairLabel,
            issue: "double-booked",
            detail: `Both beds on ${pair.shifts[0]} shift`,
          });
        } else {
          const missing = pair.hasFirst ? "2nd" : "1st";
          out.push({
            propertyId: room.propertyId,
            propertyName,
            roomId: room.id,
            roomName: room.name,
            pairLabel: pair.pairLabel,
            issue: "half-covered",
            detail: `Needs ${missing} shift`,
          });
        }
      }
    }
    out.sort((a, b) => {
      const issueOrder = a.issue === "double-booked" ? 0 : 1;
      const issueOrderB = b.issue === "double-booked" ? 0 : 1;
      if (issueOrder !== issueOrderB) return issueOrder - issueOrderB;
      return a.propertyName.localeCompare(b.propertyName) || a.roomName.localeCompare(b.roomName);
    });
    return out;
  }, [rooms, scopedPropertyIds, scopedBeds, scopedOccupants, scopedProperties]);

  const activeCustomerName =
    customerFilter === ALL_CUSTOMERS
      ? null
      : customers.find((c) => c.id === customerFilter)?.name ?? null;

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <PageHeader
          title="Dashboard"
          description="Overview of your housing operations and financials."
          meta={
            activeCustomerName ? (
              <p
                className="text-xs text-muted-foreground flex items-center gap-1"
                data-testid="text-dashboard-active-customer"
              >
                <Briefcase className="h-3 w-3" />
                Showing only <span className="font-semibold">{activeCustomerName}</span>
              </p>
            ) : null
          }
          actions={
            <Select value={customerFilter} onValueChange={updateCustomerFilter}>
              <SelectTrigger className="w-full sm:w-56" data-testid="select-dashboard-customer-filter">
                <SelectValue placeholder="Customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CUSTOMERS}>All Customers</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

        {payrollReviewCount > 0 && (
          <button
            type="button"
            onClick={scrollToPayrollReview}
            className="w-full text-left rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 flex items-center gap-3 hover:bg-amber-100/60 dark:hover:bg-amber-950/40 transition-colors"
            data-testid="kpi-payroll-needs-review"
          >
            <Receipt className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span
              className="text-lg font-bold tabular-nums"
              data-testid="text-kpi-payroll-needs-review-count"
            >
              {payrollReviewCount}
            </span>
            <span className="text-sm font-medium">
              payroll row{payrollReviewCount === 1 ? "" : "s"} need review
            </span>
            <span className="text-xs text-muted-foreground ml-2 tabular-nums">
              {scopedUnplacedPayroll.length} unplaced ·{" "}
              {scopedLowConfidencePayroll.length} to confirm
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
          </button>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {cards.map((card, i) => (
            <motion.div key={card.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between space-y-0 pb-2">
                    <p className="text-sm font-medium text-muted-foreground">{card.title}</p>
                    <card.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-2xl font-bold">{card.value}</span>
                    <span className="text-xs text-muted-foreground mt-1">{card.trend}</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {pendingPlacementBuckets.length > 0 && (
          <Card
            className="border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20"
            data-testid="card-pending-placement"
          >
            <CardHeader>
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <CardTitle>Pending placement</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-pending-placement-total-count"
                >
                  {pendingPlacementBuckets.reduce((s, b) => s + b.count, 0)} pending ·{" "}
                  {pendingPlacementBuckets.length} bucket
                  {pendingPlacementBuckets.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                People on the weekly housing-deduction roster who haven't been
                placed in a real bed yet. Open a bucket to move each person to
                a property + bed. Empty buckets are listed too so they can be
                cleared away.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {pendingPlacementBuckets.map(({ property, count }) => (
                <Link
                  key={property.id}
                  href={`/properties/${property.id}`}
                  className="flex items-center justify-between rounded-md border bg-card/60 px-4 py-3 hover:bg-accent/40 transition-colors"
                  data-testid={`row-pending-placement-${property.id}`}
                >
                  <div className="min-w-0 flex-1 mr-4">
                    <p
                      className="text-sm font-medium truncate"
                      data-testid={`text-pending-placement-${property.id}-name`}
                    >
                      {property.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className="text-sm font-semibold tabular-nums"
                      data-testid={`text-pending-placement-${property.id}-count`}
                    >
                      {count} {count === 1 ? "person" : "people"} pending
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {needsReviewItems.length > 0 && (
          <Card
            className="border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20"
            data-testid="card-needs-review"
          >
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                <p className="text-sm font-semibold">Needs review</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {needsReviewItems.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-start gap-3 rounded-md border border-amber-200/60 dark:border-amber-800/40 bg-card/60 p-4"
                    data-testid={`tile-${item.testId}`}
                  >
                    <div className="flex flex-col flex-1 min-w-0">
                      <p
                        className="text-2xl font-bold tabular-nums"
                        data-testid={`text-${item.testId}-count`}
                      >
                        {item.count}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">{item.label}.</p>
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="mt-3 self-start"
                        data-testid={`button-${item.testId}-cta`}
                      >
                        <Link href={item.href}>{item.cta}</Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {(expiringLeases.length > 0 || snoozedLeases.length > 0) && (
          <Card data-testid="card-expiring-leases">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Lease expiry alerts</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-expiring-leases-total-count"
                >
                  {expiringLeases.length} lease
                  {expiringLeases.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Leases ending in the next 30 / 60 / 90 days, plus any that
                quietly expired in the last 30 days.
              </p>
              {snoozedLeases.length > 0 && (
                <div
                  className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"
                  data-testid="snoozed-leases-summary"
                >
                  <BellOff className="h-3.5 w-3.5" />
                  <span data-testid="text-snoozed-leases-count">
                    {snoozedLeases.length} snoozed
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    data-testid="button-unsnooze-all-leases"
                    onClick={() => {
                      for (const { lease } of snoozedLeases) {
                        updateLease(lease.id, { snoozedUntil: "" });
                      }
                      toast({
                        title: "Snoozes cleared",
                        description: `${snoozedLeases.length} lease alert${
                          snoozedLeases.length === 1 ? "" : "s"
                        } restored to the panel.`,
                      });
                    }}
                  >
                    Unsnooze all
                  </Button>
                </div>
              )}
              <div
                className="mt-2 flex flex-wrap gap-2 text-xs"
                data-testid="bucket-counts-expiring-leases"
              >
                {expiringCounts.expired > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.expired.badge}`}
                    data-testid="bucket-count-expiring-leases-expired"
                  >
                    {expiringCounts.expired} expired
                  </span>
                )}
                {expiringCounts.critical > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.critical.badge}`}
                    data-testid="bucket-count-expiring-leases-critical"
                  >
                    {expiringCounts.critical} ≤ 30 days
                  </span>
                )}
                {expiringCounts.warning > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.warning.badge}`}
                    data-testid="bucket-count-expiring-leases-warning"
                  >
                    {expiringCounts.warning} 31–60 days
                  </span>
                )}
                {expiringCounts.soon > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.soon.badge}`}
                    data-testid="bucket-count-expiring-leases-soon"
                  >
                    {expiringCounts.soon} 61–90 days
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Ends</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">When</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expiringLeases.map(({ lease, propertyName, days, bucket }) => {
                    const style = expiryBucketStyle[bucket];
                    function snooze(durationDays: number, label: string) {
                      const until = addDaysToToday(durationDays);
                      updateLease(lease.id, { snoozedUntil: until });
                      toast({
                        title: `Snoozed ${label}`,
                        description: `${propertyName} alert hidden until ${formatYMDPretty(until)}.`,
                      });
                    }
                    return (
                      <TableRow
                        key={lease.id}
                        className={style.row}
                        data-testid={`row-expiring-lease-${lease.id}`}
                        data-bucket={bucket}
                      >
                        <TableCell className="font-medium">
                          <Link
                            href={`/leases/${lease.id}`}
                            className="hover:underline text-primary"
                            data-testid={`link-expiring-lease-${lease.id}`}
                          >
                            <PropertyNameCell
                              name={propertyName}
                              primaryClassName="text-primary"
                            />
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums text-muted-foreground">
                          {formatYMDPretty(lease.endDate)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={style.badge}
                            data-testid={`badge-expiring-lease-${lease.id}`}
                          >
                            {style.label}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className="text-right text-sm tabular-nums"
                          data-testid={`text-expiring-lease-${lease.id}-when`}
                        >
                          {expiryRowLabel(days)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                data-testid={`button-snooze-lease-${lease.id}`}
                              >
                                <BellOff className="h-3 w-3 mr-1" />
                                Snooze
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Hide this alert for…</DropdownMenuLabel>
                              <DropdownMenuItem
                                data-testid={`button-snooze-lease-${lease.id}-7d`}
                                onSelect={() => snooze(7, "7 days")}
                              >
                                7 days
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid={`button-snooze-lease-${lease.id}-30d`}
                                onSelect={() => snooze(30, "30 days")}
                              >
                                30 days
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid={`button-snooze-lease-${lease.id}-90d`}
                                onSelect={() => snooze(90, "90 days")}
                              >
                                90 days
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                data-testid={`button-snooze-lease-${lease.id}-renewal`}
                                onSelect={() => snooze(365, "until renewal")}
                              >
                                Renewal in progress (1 year)
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {expiringCerts.length > 0 && (
          <Card data-testid="card-expiring-insurance">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Insurance expiry alerts</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-expiring-insurance-total-count"
                >
                  {expiringCerts.length} certificate
                  {expiringCerts.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Insurance certificates whose coverage ends in the next 30
                days, plus any that quietly lapsed in the last 30 days.
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Carrier</TableHead>
                    <TableHead>Policy #</TableHead>
                    <TableHead>Coverage Ends</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expiringCerts.map((c) => (
                    <TableRow
                      key={c.id}
                      className={
                        c.expired
                          ? "border-l-4 border-l-red-500 bg-red-50/30 dark:bg-red-950/20"
                          : "border-l-4 border-l-amber-500"
                      }
                      data-testid={`row-expiring-insurance-${c.id}`}
                    >
                      <TableCell className="font-medium">
                        <Link
                          href={`/properties/${c.propertyId}`}
                          className="hover:underline text-primary"
                          data-testid={`link-expiring-insurance-${c.id}`}
                        >
                          <PropertyNameCell
                            name={c.propertyName}
                            primaryClassName="text-primary"
                          />
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{c.carrier || "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{c.policyNumber || "—"}</TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {formatYMDPretty(c.coverageEnd)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            c.expired
                              ? "bg-red-100 text-red-800 border-red-200"
                              : "bg-amber-100 text-amber-800 border-amber-200"
                          }
                          data-testid={`badge-expiring-insurance-${c.id}`}
                        >
                          {c.expired ? "Expired" : "≤ 30 days"}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="text-right text-sm tabular-nums"
                        data-testid={`text-expiring-insurance-${c.id}-when`}
                      >
                        {expiryRowLabel(c.days)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card data-testid="card-shift-gaps">
          <CardHeader>
            <div className="flex items-center gap-2">
              <BedDouble className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Bedroom shift coverage</CardTitle>
              {shiftGapRows.length > 0 && (
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-shift-gaps-total-count"
                >
                  {shiftGapRows.length} gap{shiftGapRows.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {shiftGapRows.length > 0
                ? "Hot-bedded bedrooms that are half-covered (missing a shift) or double-booked (two on the same shift)."
                : "All hot-bedded bedrooms are fully covered — every pair has one 1st-shift and one 2nd-shift occupant."}
            </p>
          </CardHeader>
          {shiftGapRows.length > 0 ? (
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Bedroom</TableHead>
                    <TableHead>Issue</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shiftGapRows.map((row) => (
                    <TableRow
                      key={`${row.roomId}-${row.pairLabel}`}
                      className={
                        row.issue === "double-booked"
                          ? "border-l-4 border-l-red-500"
                          : "border-l-4 border-l-amber-500"
                      }
                      data-testid={`row-shift-gap-${row.roomId}-${row.pairLabel}`}
                    >
                      <TableCell className="font-medium">
                        <Link
                          href={`/properties/${row.propertyId}?tab=beds&highlightRoom=${encodeURIComponent(row.roomId)}&highlightBedroom=${encodeURIComponent(row.pairLabel.replace("Bedroom ", ""))}`}
                          className="hover:underline text-primary"
                          data-testid={`link-shift-gap-${row.roomId}-${row.pairLabel}`}
                        >
                          <PropertyNameCell
                            name={row.propertyName}
                            primaryClassName="text-primary"
                          />
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{row.roomName}</TableCell>
                      <TableCell className="text-sm">{row.pairLabel}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            row.issue === "double-booked"
                              ? "bg-red-100 text-red-800 border-red-200"
                              : "bg-amber-100 text-amber-800 border-amber-200"
                          }
                          data-testid={`badge-shift-gap-${row.roomId}-${row.pairLabel}`}
                        >
                          {row.issue === "double-booked" ? "Double-booked" : "Half-covered"}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="text-sm text-muted-foreground"
                        data-testid={`text-shift-gap-detail-${row.roomId}-${row.pairLabel}`}
                      >
                        {row.detail}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          ) : (
            <CardContent>
              <div
                className="flex items-center gap-2 rounded-md border border-green-200 dark:border-green-800 bg-green-50/60 dark:bg-green-950/20 px-4 py-3"
                data-testid="shift-gaps-all-clear"
              >
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                <p className="text-sm text-green-800 dark:text-green-300">
                  All clear — every hot-bedded bedroom has complementary shift coverage.
                </p>
              </div>
            </CardContent>
          )}
        </Card>

        {activeOccupants.length > 0 && (
          <Card data-testid="card-payroll-reconciliation">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">Payroll reconciliation</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p
                    className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400"
                    data-testid="text-payroll-auto-reconciled-count"
                  >
                    {autoReconciledOccupantCount}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Occupant{autoReconciledOccupantCount === 1 ? "" : "s"} with charge auto-set from payroll.
                  </p>
                </div>
                <div>
                  <p
                    className="text-2xl font-bold tabular-nums"
                    data-testid="text-payroll-manual-count"
                  >
                    {manualOccupantCount}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Occupant{manualOccupantCount === 1 ? "" : "s"} with manually-entered charge.
                  </p>
                </div>
                <div>
                  <p
                    className="text-2xl font-bold tabular-nums text-muted-foreground"
                    data-testid="text-payroll-total-count"
                  >
                    {activeOccupants.length}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Total active occupants in scope.
                  </p>
                </div>
              </div>
              {reconciliationByCustomer.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    By customer · ranked by manual rows
                  </p>
                  <Table data-testid="table-payroll-reconciliation-by-customer">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-right">Manual</TableHead>
                        <TableHead className="text-right">Auto</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reconciliationByCustomer.map((row) => {
                        const total = row.manual + row.auto;
                        return (
                          <TableRow
                            key={row.customerId}
                            data-testid={`row-payroll-reconciliation-${row.customerId}`}
                          >
                            <TableCell className="font-medium">{row.customerName}</TableCell>
                            <TableCell
                              className={
                                "text-right tabular-nums " +
                                (row.manual > 0 ? "font-semibold" : "text-muted-foreground")
                              }
                              data-testid={`text-payroll-reconciliation-${row.customerId}-manual`}
                            >
                              {row.manual > 0 ? (
                                <Link
                                  href={`/occupants?chargeSource=manual&customer=${encodeURIComponent(row.customerId)}`}
                                  className="underline decoration-dotted underline-offset-2 hover:decoration-solid cursor-pointer"
                                  data-testid={`link-payroll-reconciliation-${row.customerId}-manual`}
                                >
                                  {row.manual}
                                </Link>
                              ) : (
                                row.manual
                              )}
                            </TableCell>
                            <TableCell
                              className="text-right tabular-nums text-emerald-700 dark:text-emerald-400"
                              data-testid={`text-payroll-reconciliation-${row.customerId}-auto`}
                            >
                              {row.auto}
                            </TableCell>
                            <TableCell
                              className="text-right tabular-nums text-muted-foreground"
                              data-testid={`text-payroll-reconciliation-${row.customerId}-total`}
                            >
                              {total}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {customerPaidRentByCustomer.total > 0 && (
          <Card data-testid="card-customer-paid-rent">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">Customer-paid monthly rent</p>
              </div>
              <p
                className="text-2xl font-bold tabular-nums"
                data-testid="text-customer-paid-rent-total"
              >
                ${customerPaidRentByCustomer.total.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Total monthly rent across all Active leases where the customer is responsible for paying the landlord.
              </p>
              {customerPaidRentByCustomer.rows.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    By customer · ranked by rent
                  </p>
                  <Table data-testid="table-customer-paid-rent-by-customer">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead className="text-right">Leases</TableHead>
                        <TableHead className="text-right">Monthly rent</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerPaidRentByCustomer.rows.map((row) => (
                        <TableRow
                          key={row.customerId}
                          data-testid={`row-customer-paid-rent-${row.customerId}`}
                        >
                          <TableCell className="font-medium">
                            <Link
                              href={`/customers/${row.customerId}`}
                              className="hover:underline text-primary"
                              data-testid={`link-customer-paid-rent-${row.customerId}`}
                            >
                              {row.customerName}
                            </Link>
                          </TableCell>
                          <TableCell
                            className="text-right tabular-nums text-muted-foreground"
                            data-testid={`text-customer-paid-rent-${row.customerId}-leases`}
                          >
                            {row.leaseCount}
                          </TableCell>
                          <TableCell
                            className="text-right tabular-nums font-semibold"
                            data-testid={`text-customer-paid-rent-${row.customerId}-rent`}
                          >
                            ${row.rent.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {overriddenOccupants.length > 0 && (
          <Card id="card-payroll-mismatches" data-testid="card-payroll-mismatches">
            <CardHeader>
              <div className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <CardTitle>Review payroll mismatches</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-payroll-mismatches-count"
                >
                  {overriddenOccupants.length} override{overriddenOccupants.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Occupants whose payroll-set charge was manually edited. Compare
                against the latest payroll run — if the override now agrees with
                payroll, re-claim to let the seeder manage it again.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {overriddenOccupants.length > 1 && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reclaimingAll}
                    onClick={handleReclaimAll}
                    data-testid="button-reclaim-all-overrides"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    {reclaimingAll ? "Re-claiming…" : "Re-claim all from payroll"}
                  </Button>
                </div>
              )}
              {overriddenByCustomer.map((group) => (
                <div
                  key={group.customer}
                  data-testid={`group-overridden-${group.customer}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold">{group.customer}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {group.rows.length} override{group.rows.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Current charge</TableHead>
                        <TableHead>Payroll source</TableHead>
                        <TableHead>Property</TableHead>
                        <TableHead className="w-40" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.rows.map(({ occupant: o, propertyName, propertyId }) => (
                        <TableRow
                          key={o.id}
                          data-testid={`row-overridden-${o.id}`}
                        >
                          <TableCell className="font-medium">
                            {o.name}
                            <Badge
                              variant="outline"
                              className="ml-2 text-[10px] bg-amber-100 text-amber-800 border-amber-200"
                              data-testid={`badge-overridden-${o.id}`}
                            >
                              overridden
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            ${o.chargePerBed.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            <span className="text-xs text-muted-foreground ml-1">
                              /{o.billingFrequency === "Weekly" ? "wk" : "mo"}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {o.chargeSourceCustomer && o.chargeSourcePersonId ? (
                              <div>
                                <div data-testid={`text-overridden-source-customer-${o.id}`}>
                                  {o.chargeSourceCustomer}
                                </div>
                                <div
                                  className="text-xs tabular-nums"
                                  data-testid={`text-overridden-source-person-${o.id}`}
                                >
                                  Person {o.chargeSourcePersonId}
                                </div>
                              </div>
                            ) : (
                              <span className="italic">No payroll link</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {propertyId ? (
                              <Link
                                href={`/properties/${propertyId}`}
                                className="text-primary hover:underline text-sm"
                                data-testid={`link-overridden-property-${o.id}`}
                              >
                                <PropertyNameCell
                                  name={propertyName}
                                  primaryClassName="text-primary"
                                />
                              </Link>
                            ) : (
                              <span className="text-sm text-muted-foreground italic">
                                unassigned
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={reclaimingIds.has(o.id)}
                              onClick={() => handleReclaimSingle(o.id)}
                              data-testid={`button-reclaim-${o.id}`}
                            >
                              <RotateCcw className="h-3 w-3 mr-1" />
                              {reclaimingIds.has(o.id) ? "Re-claiming…" : "Re-claim"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {unplacedByCustomer.length > 0 && (
          <Card id="card-unplaced-payroll" data-testid="card-unplaced-payroll">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Unplaced payroll</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-unplaced-payroll-total-count"
                >
                  {scopedUnplacedPayroll.length} row{scopedUnplacedPayroll.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Payroll deductions that don't yet match an active occupant. Assign each
                person to a bed and the row will drop off after the next sync.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {unplacedByCustomer.map((group) => (
                <div
                  key={group.customer}
                  data-testid={`group-unplaced-${group.customer}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold">{group.customer}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {group.rows.length} row{group.rows.length === 1 ? "" : "s"} · $
                      {group.weeklyTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}/wk
                    </p>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Weekly</TableHead>
                        <TableHead className="w-32" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.rows.map((row) => (
                        <TableRow
                          key={`${row.customer}::${row.personId}`}
                          data-testid={`row-unplaced-${row.personId}`}
                        >
                          <TableCell className="font-medium">
                            <div>{row.name}</div>
                            {row.suggestions.length > 0 && (
                              <div
                                className="mt-1 flex flex-wrap items-center gap-1"
                                data-testid={`suggestions-unplaced-${row.personId}`}
                              >
                                <span
                                  className={
                                    "text-xs inline-flex items-center gap-1 " +
                                    (row.suggestions[0]!.crossEmployer
                                      ? "text-amber-700 dark:text-amber-400"
                                      : "text-muted-foreground")
                                  }
                                >
                                  <Wand2 className="h-3 w-3" />
                                  {row.suggestions[0]!.crossEmployer
                                    ? "Did you mean (different employer):"
                                    : "Did you mean:"}
                                </span>
                                {row.suggestions.map((s) => (
                                  <Button
                                    key={s.occupantId}
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className={
                                      "h-6 px-2 text-xs " +
                                      (s.crossEmployer
                                        ? "text-amber-700 dark:text-amber-400"
                                        : "")
                                    }
                                    onClick={() => {
                                      // Same-employer (typo) suggestions are
                                      // safe to apply in one click: they only
                                      // attach a rate, not change ownership.
                                      // Cross-employer suggestions move the
                                      // occupant to a new company, so prompt
                                      // the operator to confirm the move
                                      // first (task #350).
                                      if (s.crossEmployer) {
                                        setPendingEmployerMove({
                                          occupantId: s.occupantId,
                                          occupantName: s.name,
                                          fromCompany: s.company,
                                          toCompany: row.customer,
                                          propertyName: s.propertyName,
                                          chargePerBed: row.weekly,
                                          employeeId: row.personId,
                                        });
                                        return;
                                      }
                                      updateOccupant(s.occupantId, {
                                        chargePerBed: row.weekly,
                                        billingFrequency: "Weekly",
                                        ...(row.personId
                                          ? { employeeId: row.personId }
                                          : {}),
                                      });
                                      // Audit trail: the row is about to
                                      // disappear from this card on the
                                      // next refetch, so log it before
                                      // refetching so the operator can
                                      // spot a wrong guess afterwards.
                                      recordPayrollReconciliation({
                                        id: `${row.customer}::${row.personId}::${s.occupantId}::${Date.now()}`,
                                        occupantId: s.occupantId,
                                        occupantName: s.name,
                                        propertyName: s.propertyName,
                                        employer: row.customer,
                                        weekly: row.weekly,
                                        kind: s.crossEmployer ? "cross-employer" : "typo",
                                        timestamp: Date.now(),
                                      });
                                      queryClient.invalidateQueries({
                                        queryKey: getListUnplacedPayrollQueryKey(),
                                      });
                                      toast({
                                        title: "Suggestion applied",
                                        description: `${s.name} now matches this payroll row.`,
                                      });
                                    }}
                                    data-testid={`button-apply-suggestion-${row.personId}-${s.occupantId}`}
                                  >
                                    {s.name}
                                    {s.propertyName ? ` @ ${s.propertyName}` : " (unassigned)"}
                                    {s.crossEmployer ? ` — ${s.company}` : ""}
                                  </Button>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            ${row.weekly.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            {(() => {
                              // Task #349: if a live occupant already
                              // owns this employeeId — typically the
                              // pending-placement row seeded by Task
                              // #305 — never offer the "create new
                              // occupant" dialog from here. Doing so
                              // would orphan the pending twin and
                              // double-count the person. Route the
                              // operator to the bucket page (where the
                              // proven Move-to-bed flow updates the
                              // EXISTING row) or, for occupants
                              // already in a real bed, link to that
                              // property so the operator can sort it
                              // out without spawning a duplicate.
                              const key = row.personId
                                ? row.personId.trim().toLowerCase()
                                : "";
                              const existing = key
                                ? existingOccupantByEmployeeId.get(key)
                                : undefined;
                              const existingProperty =
                                existing && existing.propertyId
                                  ? propertyById.get(existing.propertyId) ?? null
                                  : null;
                              if (existing) {
                                // Strict no-duplicate guard: any match
                                // by employeeId disables the create-new
                                // path. If we can resolve the existing
                                // property we deep-link to it; otherwise
                                // (orphaned propertyId or missing row)
                                // fall back to the occupants page so the
                                // operator can still find/clean up the
                                // existing record without spawning a
                                // duplicate from this card.
                                const isPending = existingProperty
                                  ? isPendingPlacementProperty(
                                      existingProperty.name,
                                    )
                                  : false;
                                const href = existingProperty
                                  ? `/properties/${existingProperty.id}`
                                  : `/occupants?focus=${encodeURIComponent(existing.id)}`;
                                const label = !existingProperty
                                  ? "Open occupant"
                                  : isPending
                                    ? "Open pending bucket"
                                    : "Open occupant";
                                return (
                                  <Button
                                    asChild
                                    size="sm"
                                    variant="outline"
                                    data-testid={`button-open-existing-unplaced-${row.personId}`}
                                    data-existing-occupant-id={existing.id}
                                    data-existing-pending={isPending ? "1" : "0"}
                                  >
                                    <Link href={href}>{label}</Link>
                                  </Button>
                                );
                              }
                              return (
                                <AssignOccupantDialog
                                  testIdSuffix={row.personId}
                                  initial={{
                                    name: row.name,
                                    company: row.customer,
                                    employeeId: row.personId,
                                    chargePerBed: row.weekly,
                                    billingFrequency: "Weekly",
                                  }}
                                  trigger={
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      data-testid={`button-assign-unplaced-${row.personId}`}
                                    >
                                      Assign to bed
                                    </Button>
                                  }
                                  onAssign={(occ, bed) => {
                                    addOccupant(occ);
                                    updateBed(bed.id, {
                                      status: "Occupied",
                                      occupantId: occ.id,
                                    });
                                    // Re-run the seeder server-side and
                                    // refetch the unplaced list so this
                                    // row drops off.
                                    queryClient.invalidateQueries({
                                      queryKey: getListUnplacedPayrollQueryKey(),
                                    });
                                  }}
                                />
                              );
                            })()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {lowConfidenceByCustomer.length > 0 && (
          <Card id="card-low-confidence-payroll" data-testid="card-low-confidence-payroll">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <CardTitle>Confirm match</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-low-confidence-payroll-total-count"
                >
                  {scopedLowConfidencePayroll.length} row
                  {scopedLowConfidencePayroll.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Payroll rows that matched an existing occupant only by
                name. At employers with two namesakes the wrong person may
                have received the rate — confirm the right one (or pick a
                different occupant) so the next sync locks the match in by
                Person Id.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              {lowConfidenceByCustomer.map((group) => (
                <div
                  key={group.customer}
                  data-testid={`group-low-confidence-${group.customer}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold">{group.customer}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {group.rows.length} row{group.rows.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Payroll name · Person Id</TableHead>
                        <TableHead>Currently applied to</TableHead>
                        <TableHead className="text-right">Weekly</TableHead>
                        <TableHead className="w-32" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.rows.map((row) => (
                        <TableRow
                          key={`${row.customer}::${row.personId}`}
                          data-testid={`row-low-confidence-${row.personId}`}
                        >
                          <TableCell className="font-medium">
                            <div>{row.name}</div>
                            <div className="text-xs text-muted-foreground tabular-nums">
                              {row.personId}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            <div data-testid={`low-confidence-matched-${row.personId}`}>
                              {row.matched.name}
                              {row.matched.propertyName
                                ? ` @ ${row.matched.propertyName}`
                                : " (unassigned)"}
                            </div>
                            {row.suggestions.length > 0 && (
                              <div
                                className="mt-1 flex flex-wrap items-center gap-1"
                                data-testid={`low-confidence-alternatives-${row.personId}`}
                              >
                                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                                  <Wand2 className="h-3 w-3" />
                                  Did you mean:
                                </span>
                                {row.suggestions.map((s) => (
                                  <Button
                                    key={s.occupantId}
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => {
                                      // Redirect the rate to the
                                      // alternative occupant and stamp
                                      // the payroll Person Id so the
                                      // next sync matches strongly via
                                      // employeeId. The seeder will
                                      // then drop this row from the
                                      // low-confidence list.
                                      updateOccupant(s.occupantId, {
                                        chargePerBed: row.weekly,
                                        billingFrequency: "Weekly",
                                        employeeId: row.personId,
                                      });
                                      // Redirecting from the matched
                                      // namesake to a same-employer
                                      // alternative is the typo class
                                      // of fix. Cross-employer
                                      // alternatives don't appear in
                                      // this list (suggestions are
                                      // ranked same-employer only).
                                      recordPayrollReconciliation({
                                        id: `lc::${row.customer}::${row.personId}::${s.occupantId}::${Date.now()}`,
                                        occupantId: s.occupantId,
                                        occupantName: s.name,
                                        propertyName: s.propertyName,
                                        employer: row.customer,
                                        weekly: row.weekly,
                                        kind: s.crossEmployer ? "cross-employer" : "typo",
                                        timestamp: Date.now(),
                                      });
                                      queryClient.invalidateQueries({
                                        queryKey: getListUnplacedPayrollQueryKey(),
                                      });
                                    }}
                                    data-testid={`button-redirect-low-confidence-${row.personId}-${s.occupantId}`}
                                  >
                                    {s.name}
                                    {s.propertyName ? ` @ ${s.propertyName}` : " (unassigned)"}
                                  </Button>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            ${row.weekly.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                // "Confirm" stamps employeeId on the
                                // already-matched occupant. The seeder
                                // then matches via the strong
                                // employeeId path and the row drops
                                // off the low-confidence list.
                                updateOccupant(row.matched.occupantId, {
                                  employeeId: row.personId,
                                });
                                recordPayrollReconciliation({
                                  id: `lc-confirm::${row.customer}::${row.personId}::${Date.now()}`,
                                  occupantId: row.matched.occupantId,
                                  occupantName: row.matched.name,
                                  propertyName: row.matched.propertyName,
                                  employer: row.customer,
                                  weekly: row.weekly,
                                  kind: "confirm",
                                  timestamp: Date.now(),
                                });
                                queryClient.invalidateQueries({
                                  queryKey: getListUnplacedPayrollQueryKey(),
                                });
                              }}
                              data-testid={`button-confirm-low-confidence-${row.personId}`}
                            >
                              Confirm
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {recentReconciliations.length > 0 && (
          <Card data-testid="card-recent-payroll-reconciliations">
            <CardHeader>
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Recently reconciled from payroll</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-recent-payroll-reconciliations-count"
                >
                  {recentReconciliations.length} entr
                  {recentReconciliations.length === 1 ? "y" : "ies"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Suggestion clicks from this session. Open an occupant to
                sanity-check the new employer / weekly rate, or undo the
                change if the seeder guessed wrong.
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Occupant</TableHead>
                    <TableHead>New employer</TableHead>
                    <TableHead className="text-right">Weekly</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentReconciliations.map((entry) => {
                    const kindStyle: Record<
                      PayrollReconciliationKind,
                      { label: string; className: string }
                    > = {
                      "cross-employer": {
                        label: "Cross-employer",
                        className:
                          "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200",
                      },
                      typo: {
                        label: "Typo fix",
                        className:
                          "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200",
                      },
                      confirm: {
                        label: "Confirmed",
                        className:
                          "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200",
                      },
                    };
                    const style = kindStyle[entry.kind];
                    return (
                      <TableRow
                        key={entry.id}
                        data-testid={`row-recent-reconciliation-${entry.occupantId}`}
                      >
                        <TableCell className="font-medium">
                          <Link
                            href={`/occupants?q=${encodeURIComponent(entry.occupantName)}`}
                            className="text-primary hover:underline"
                            data-testid={`link-recent-reconciliation-${entry.occupantId}`}
                          >
                            {entry.occupantName}
                          </Link>
                          {entry.propertyName ? (
                            <div className="text-xs text-muted-foreground">
                              {entry.propertyName}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground italic">
                              unassigned
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{entry.employer}</span>
                            <Badge
                              variant="outline"
                              className={`text-[10px] uppercase tracking-wide ${style.className}`}
                              data-testid={`badge-recent-reconciliation-kind-${entry.occupantId}`}
                            >
                              {style.label}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          ${entry.weekly.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell
                          className="text-xs text-muted-foreground"
                          data-testid={`text-recent-reconciliation-when-${entry.occupantId}`}
                        >
                          {formatRelativeTime(entry.timestamp)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Occupancy Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{occupiedBeds} Occupied</span>
                <span>{vacantBeds} Vacant</span>
              </div>
              <Progress value={occupancyRate} className="h-4" />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-top-properties">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              <CardTitle>Top Properties by Rating</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Sort by</span>
              <Select
                value={topRatingSort}
                onValueChange={(v) => setTopRatingSort(v as TopPropertiesSortKey)}
              >
                <SelectTrigger className="w-44 h-8" data-testid="select-top-rating-sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overall">Overall</SelectItem>
                  {RATING_CATEGORIES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {topRatedProperties.length === 0 ? (
              <EmptyState
                icon={properties.length === 0 ? Building2 : Trophy}
                title={
                  properties.length === 0
                    ? "No properties yet"
                    : `No ${sortLabel.toLowerCase()} ratings yet`
                }
                description={
                  properties.length === 0
                    ? "Add your first property to start ranking your top performers here."
                    : "Rate your properties to see your top performers ranked here."
                }
                action={
                  <Button asChild data-testid="button-empty-top-rated-cta">
                    <Link href="/properties">
                      {properties.length === 0 ? "Add Property" : "Rate Properties"}
                    </Link>
                  </Button>
                }
                testId="empty-top-rated-properties"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>{sortLabel}</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topRatedProperties.map((row, i) => {
                    const customer = customers.find((c) => c.id === row.property.customerId);
                    const score = row.score ?? 0;
                    return (
                      <TableRow key={row.property.id} data-testid={`row-top-rated-${row.property.id}`}>
                        <TableCell className="text-sm font-semibold tabular-nums text-muted-foreground">
                          {i + 1}
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link
                            href={`/properties/${row.property.id}`}
                            className="hover:underline text-primary"
                          >
                            <PropertyNameCell
                              name={row.property.name}
                              primaryClassName="text-primary"
                            />
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {customer?.name ?? <span className="italic">—</span>}
                        </TableCell>
                        <TableCell>
                          <StarRating value={score} readOnly size="sm" ariaLabel={`${sortLabel} rating`} />
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums">
                          {score.toFixed(1)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <CardTitle>Financial Overview</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="id"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => {
                      const row = chartData.find((d) => d.id === value);
                      return row ? formatPropertyName(row.name).primary : value;
                    }}
                  />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                  <Tooltip
                    formatter={(value) => `$${value}`}
                    labelFormatter={(label) => {
                      const row = chartData.find((d) => d.id === label);
                      return row?.name ?? String(label);
                    }}
                    cursor={{fill: 'transparent'}}
                  />
                  <Legend />
                  <Bar dataKey="Revenue" fill="hsl(217 71% 21%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Cost" fill="hsl(217 25% 65%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Property Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <Table containerClassName="max-h-[300px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10 bg-card">Property</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card">Customer</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card">Occupancy</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card text-right">Profit/Loss</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chartData.length === 0 ? (
                    <EmptyStateRow
                      colSpan={4}
                      icon={Building2}
                      title={
                        properties.length === 0
                          ? "No properties yet"
                          : "No properties match this customer"
                      }
                      description={
                        properties.length === 0
                          ? "Add your first property to start tracking performance here."
                          : "Pick a different customer above, or add properties to this one to see performance."
                      }
                      action={
                        <Button asChild data-testid="button-empty-perf-cta">
                          <Link href="/properties">Add Property</Link>
                        </Button>
                      }
                      testId="empty-property-performance"
                    />
                  ) : (
                    chartData.map((data) => {
                      const property = scopedProperties.find(p => p.id === data.id);
                      const customer = property ? customers.find(c => c.id === property.customerId) : undefined;
                      // Derive occupancy from the actual bed rows for this
                      // property — the static `totalBeds` field on the
                      // property record can drift from reality (or be 0),
                      // which previously inflated occupancy past 100%.
                      const propBeds = scopedBeds.filter(b => b.propertyId === data.id);
                      const propOccupied = propBeds.filter(b => b.status === "Occupied").length;
                      const occupancyPct = propBeds.length > 0
                        ? Math.round((propOccupied / propBeds.length) * 100)
                        : 0;
                      return (
                        <TableRow key={data.id} data-testid={`row-perf-${data.id}`}>
                          <TableCell><PropertyNameCell name={data.name} /></TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {customer?.name ?? <span className="italic">—</span>}
                          </TableCell>
                          <TableCell>{occupancyPct}%</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={data.Profit >= 0 ? "default" : "destructive"} className={data.Profit >= 0 ? "bg-emerald-500 hover:bg-emerald-600" : ""}>
                              ${Math.abs(data.Profit).toLocaleString()} {data.Profit >= 0 ? 'Profit' : 'Loss'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Confirm cross-employer move from a "Did you mean (different
          employer)" suggestion. The same-employer (typo) path applies in
          one click — only the ownership-changing path goes through this
          dialog (task #350). */}
      <AlertDialog
        open={pendingEmployerMove !== null}
        onOpenChange={(open) => { if (!open) setPendingEmployerMove(null); }}
      >
        <AlertDialogContent data-testid="dialog-confirm-employer-move">
          <AlertDialogHeader>
            <AlertDialogTitle>Move occupant to a new employer?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingEmployerMove && (
                <>
                  Move <span className="font-medium">{pendingEmployerMove.occupantName}</span>
                  {" "}from <span className="font-medium">{pendingEmployerMove.fromCompany}</span>
                  {" "}to <span className="font-medium">{pendingEmployerMove.toCompany}</span>
                  {pendingEmployerMove.propertyName ? (
                    <> at <span className="font-medium">{pendingEmployerMove.propertyName}</span></>
                  ) : null}
                  ? This changes which customer the occupant belongs to.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-confirm-employer-move-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-employer-move-confirm"
              onClick={() => {
                const move = pendingEmployerMove;
                if (!move) return;
                const prev = occupants.find((o) => o.id === move.occupantId);
                const prevCompany = prev?.company ?? move.fromCompany;
                const prevChargePerBed = prev?.chargePerBed ?? 0;
                const prevBillingFrequency = prev?.billingFrequency ?? "Monthly";
                const prevEmployeeId = prev?.employeeId ?? "";
                const prevChargeSource = prev?.chargeSource ?? "";
                const prevChargeSourceCustomer = prev?.chargeSourceCustomer ?? "";
                const prevChargeSourcePersonId = prev?.chargeSourcePersonId ?? "";
                updateOccupant(move.occupantId, {
                  chargePerBed: move.chargePerBed,
                  billingFrequency: "Weekly",
                  ...(move.employeeId ? { employeeId: move.employeeId } : {}),
                  company: move.toCompany,
                });
                queryClient.invalidateQueries({
                  queryKey: getListUnplacedPayrollQueryKey(),
                });
                toast({
                  title: "Occupant moved",
                  description: `${move.occupantName} is now under ${move.toCompany}.`,
                  action: (
                    <ToastAction
                      altText="Undo employer move"
                      data-testid="button-undo-employer-move"
                      onClick={() => {
                        updateOccupant(move.occupantId, {
                          company: prevCompany,
                          chargePerBed: prevChargePerBed,
                          billingFrequency: prevBillingFrequency,
                          employeeId: prevEmployeeId,
                          chargeSource: prevChargeSource,
                          chargeSourceCustomer: prevChargeSourceCustomer,
                          chargeSourcePersonId: prevChargeSourcePersonId,
                        });
                        queryClient.invalidateQueries({
                          queryKey: getListUnplacedPayrollQueryKey(),
                        });
                        queryClient.invalidateQueries({ queryKey: ["/api/occupants"] });
                        toast({
                          title: "Move undone",
                          description: `${move.occupantName} restored to ${prevCompany}.`,
                        });
                      }}
                    >
                      <Undo2 className="h-3 w-3 mr-1" />
                      Undo
                    </ToastAction>
                  ),
                });
                setPendingEmployerMove(null);
              }}
            >
              Move occupant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
