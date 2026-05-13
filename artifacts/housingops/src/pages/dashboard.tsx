import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, BedDouble, Zap, DollarSign, TrendingUp, Users, Briefcase, Trophy, AlertTriangle, Receipt, Wand2, CalendarClock, ArrowRight, History, ShieldCheck, BellOff, RotateCcw, Undo2, Send, ChevronDown, Eye, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getOperatorIdentity } from "@/lib/operator-identity";
import { ToastAction } from "@/components/ui/toast";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useRuntimeConfigQuery, useRuntimeConfigStream } from "@/hooks/use-runtime-config";
import {
  useListUnplacedPayroll,
  getListUnplacedPayrollQueryKey,
  useListRoomNightLogs,
  useListAllProjectedMoveIns,
  type ProjectedMoveIn,
  type UnplacedPayrollRow,
  type LowConfidencePayrollMatch,
} from "@workspace/api-client-react";
import {
  projectedMoveInDaysFromToday,
  MoveInDateBadge,
} from "@/lib/projected-move-in-flag";
import { getHotelRateMonthRisk, currentMonthKey } from "@/lib/hotel-rate-status";
import { EmptyState, EmptyStateRow } from "@/components/empty-state";
import { computeOverallRating, computeRentPerBed, computeElectricPerBed, computeRentPlusElectricPerBed, formatUsd, formatUsdWhole, RATING_CATEGORIES, sumActiveRentEstimated, estimateLeaseMonthlyRent, daysUntil, sumCustomerResponsibleRent, getCustomerResponsibleLeases, toMonthlyCharge, type CustomerResponsibleStatusFilter, type RatingCategoryKey, type Lease, type Occupant } from "@/data/mockData";
import { formatYMDPretty, formatTodayYMD, addDaysToToday } from "@/lib/lease-dates";
import { StarRating } from "@/components/star-rating";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PropertyNameCell } from "@/components/property-name-cell";
import { formatPropertyName } from "@/lib/property-name";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { mostRecentSaturday, isSaturdayDate } from "@/lib/finance-pay-weeks";
import {
  recordPayrollReconciliation,
  removePayrollReconciliation,
  useRecentPayrollReconciliations,
  type PayrollReconciliationKind,
} from "@/lib/recent-payroll-reconciliations";

type TopPropertiesSortKey = "overall" | RatingCategoryKey;

// Lightweight "N <unit> ago" formatter for the recent-reconciliations
// audit trail. The card never lives long enough on screen to need a
// self-refreshing tick (entries are session-scoped and the operator
// usually clicks through immediately), so a one-shot string is fine.
function formatRelativeTime(
  t: (key: string, options?: Record<string, unknown>) => string,
  timestamp: number,
  now: number = Date.now(),
): string {
  const diffMs = Math.max(0, now - timestamp);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 5) return t("pages.dashboard.relativeTime.justNow");
  if (sec < 60) return t("pages.dashboard.relativeTime.secondsAgo", { count: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t("pages.dashboard.relativeTime.minutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("pages.dashboard.relativeTime.hoursAgo", { count: hr });
  const day = Math.floor(hr / 24);
  return t("pages.dashboard.relativeTime.daysAgo", { count: day });
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { properties, buildings, beds, rooms, leases, utilities, insuranceCertificates, customers, occupants, addOccupant, updateBed, updateOccupant, updateLease } = useData();
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
  // Portfolio-wide projected move-ins (Task #578). One query feeds the
  // dashboard "Upcoming move-ins" roll-up — we filter by customer scope
  // and date bucket on the client so operators see the same data their
  // selected scope would on each property's Beds tab.
  const { data: allProjectedMoveInsData } = useListAllProjectedMoveIns();
  const allProjectedMoveIns = useMemo<ProjectedMoveIn[]>(
    () => allProjectedMoveInsData ?? [],
    [allProjectedMoveInsData],
  );
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

  const activeOccupants = useMemo(
    () => scopedOccupants.filter((o) => o.status === "Active"),
    [scopedOccupants],
  );

  // Default "Active" preserves the original card behavior; operators can
  // widen to "Upcoming" to forecast future liability or "All" to also catch
  // recently expired customer-responsible leases (task #438).
  const [customerPaidRentStatus, setCustomerPaidRentStatus] =
    useState<CustomerResponsibleStatusFilter>("Active");

  const customerPaidRentByCustomer = useMemo(() => {
    const rows: { customerId: string; customerName: string; rent: number; leaseCount: number }[] = [];
    let portfolioTotal = 0;
    for (const c of customers) {
      const leases = getCustomerResponsibleLeases(scopedLeases, scopedProperties, c.id, customerPaidRentStatus);
      if (leases.length === 0) continue;
      const rent = sumCustomerResponsibleRent(scopedLeases, scopedProperties, c.id, customerPaidRentStatus);
      rows.push({ customerId: c.id, customerName: c.name, rent, leaseCount: leases.length });
      portfolioTotal += rent;
    }
    rows.sort((a, b) => b.rent - a.rent || a.customerName.localeCompare(b.customerName));
    return { rows, total: portfolioTotal };
  }, [customers, scopedLeases, scopedProperties, customerPaidRentStatus]);

  // Visibility is decided across "All" so the card doesn't disappear when an
  // operator picks a status with zero matches — the toggle stays available so
  // they can switch back without scrolling away.
  const hasAnyCustomerPaidRent = useMemo(() => {
    for (const c of customers) {
      if (getCustomerResponsibleLeases(scopedLeases, scopedProperties, c.id, "All").length > 0) {
        return true;
      }
    }
    return false;
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

  const [digestPreviewEnabled, setDigestPreviewEnabled] = useState(false);
  useEffect(() => {
    const baseUrl = import.meta.env.BASE_URL ?? "/";
    fetch(`${baseUrl}api/lease-digest/status`)
      .then((r) => r.json())
      .then((body) => {
        setDigestPreviewEnabled(Boolean(body.previewEnabled));
      })
      .catch(() => {});
  }, []);

  const [sendingDigestPreview, setSendingDigestPreview] = useState(false);
  const [digestSecretDialogOpen, setDigestSecretDialogOpen] = useState(false);
  const [digestSecret, setDigestSecret] = useState("");
  // `digestMode` toggles between actually dispatching the digest
  // ("send") and the dry-run preview that only renders the email
  // payload server-side without invoking the webhook ("dry-run").
  // The same secret-prompt dialog is reused for both flows so the
  // operator only sees one entry point.
  const [digestMode, setDigestMode] = useState<"send" | "dry-run">("send");
  // Holds the rendered DigestEmail payload returned by a successful
  // dry-run so we can show subject/body/recipients in a modal. Null
  // when no preview is being shown.
  const [digestDryRunResult, setDigestDryRunResult] = useState<{
    email: { to: string[]; subject: string; text: string; html: string };
    total: number;
  } | null>(null);

  const handleSendDigestPreview = async () => {
    if (!digestSecret.trim()) return;
    const mode = digestMode;
    setSendingDigestPreview(true);
    setDigestSecretDialogOpen(false);
    try {
      const baseUrl = import.meta.env.BASE_URL ?? "/";
      const res = await fetch(`${baseUrl}api/lease-digest/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: digestSecret.trim(),
          dryRun: mode === "dry-run",
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast({
          title: mode === "dry-run"
            ? t("pages.dashboard.digest.previewRenderFailedTitle")
            : t("pages.dashboard.digest.digestPreviewFailedTitle"),
          description: body.error ?? t("pages.dashboard.digest.serverReturned", { status: res.status }),
          variant: "destructive",
        });
        return;
      }
      if (mode === "dry-run") {
        if (body.email) {
          setDigestDryRunResult({ email: body.email, total: body.total ?? 0 });
        } else {
          toast({
            title: t("pages.dashboard.digest.previewRenderFailedTitle"),
            description: t("pages.dashboard.digest.previewRenderFailedDescription"),
            variant: "destructive",
          });
        }
        return;
      }
      toast({
        title: t("pages.dashboard.digest.previewSentTitle"),
        description: t("pages.dashboard.digest.previewSentDescription", {
          count: body.recipients,
          leases: body.total,
          recipients: body.recipients,
        }),
      });
    } catch (err) {
      toast({
        title: mode === "dry-run"
          ? t("pages.dashboard.digest.previewRenderFailedTitle")
          : t("pages.dashboard.digest.digestPreviewFailedTitle"),
        description: t("pages.dashboard.digest.networkErrorDescription"),
        variant: "destructive",
      });
    } finally {
      setSendingDigestPreview(false);
      setDigestSecret("");
    }
  };

  const openDigestDialog = (mode: "send" | "dry-run") => {
    setDigestMode(mode);
    setDigestSecretDialogOpen(true);
  };

  const [undoingReconciliationIds, setUndoingReconciliationIds] = useState<Set<string>>(new Set());
  const [pendingUndoEntry, setPendingUndoEntry] = useState<(typeof recentReconciliations)[number] | null>(null);

  const executeUndo = async (entry: (typeof recentReconciliations)[number]) => {
    setUndoingReconciliationIds((prev) => new Set(prev).add(entry.id));
    const restoreFields: Record<string, unknown> = {
      chargePerBed: entry.prev.chargePerBed,
      billingFrequency: entry.prev.billingFrequency,
      employeeId: entry.prev.employeeId,
    };
    if (entry.kind === "cross-employer") {
      restoreFields.company = entry.prev.company;
    }
    try {
      const baseUrl = import.meta.env.BASE_URL ?? "/";
      const res = await fetch(
        `${baseUrl}api/occupants/${encodeURIComponent(entry.occupantId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(restoreFields),
        },
      );
      if (!res.ok) {
        toast({
          title: t("pages.dashboard.undoToast.failedTitle"),
          description: t("pages.dashboard.undoToast.failedDescriptionStatus", { status: res.status }),
          variant: "destructive",
        });
        return;
      }
      removePayrollReconciliation(entry.id);
      queryClient.invalidateQueries({
        queryKey: getListUnplacedPayrollQueryKey(),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/occupants"] });
      const desc = entry.kind === "cross-employer"
        ? t("pages.dashboard.undoToast.completeDescriptionCrossEmployer", { occupant: entry.occupantName, prevCompany: entry.prev.company })
        : t("pages.dashboard.undoToast.completeDescriptionDefault", { occupant: entry.occupantName });
      toast({ title: t("pages.dashboard.undoToast.completeTitle"), description: desc });
    } catch {
      toast({
        title: t("pages.dashboard.undoToast.failedTitle"),
        description: t("pages.dashboard.undoToast.failedDescriptionNetwork"),
        variant: "destructive",
      });
    } finally {
      setUndoingReconciliationIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  };

  const handleUndoReconciliation = (entry: (typeof recentReconciliations)[number]) => {
    if (entry.kind === "cross-employer") {
      setPendingUndoEntry(entry);
      return;
    }
    executeUndo(entry);
  };

  const [reclaimingIds, setReclaimingIds] = useState<Set<string>>(new Set());
  const [reclaimingAll, setReclaimingAll] = useState(false);
  // Saturday end-date for the pay-week the operator wants the
  // re-import to write a snapshot for. Defaults to the most-recent
  // Saturday — Task #597's Finance Weekly/Monthly tabs read those
  // snapshots back, so writing one is what makes the re-import flow
  // useful for finance tracking (not just for re-claiming overrides).
  const [reclaimPayWeekEndDate, setReclaimPayWeekEndDate] = useState<string>(
    () => mostRecentSaturday(),
  );
  const reclaimPayWeekIsSaturday = isSaturdayDate(reclaimPayWeekEndDate);

  const handleReclaimSingle = async (occupantId: string) => {
    if (!reclaimPayWeekIsSaturday) {
      toast({
        title: t("pages.finance.payroll.invalidWeekTitle"),
        description: t("pages.finance.payroll.invalidWeekDescription"),
        variant: "destructive",
      });
      return;
    }
    setReclaimingIds((prev) => new Set(prev).add(occupantId));
    try {
      const baseUrl = import.meta.env.BASE_URL ?? "/";
      const res = await fetch(
        `${baseUrl}api/payroll/unplaced?reclaimOverridden=true&reclaimOccupantIds=${encodeURIComponent(occupantId)}&payWeekEndDate=${encodeURIComponent(reclaimPayWeekEndDate)}`,
      );
      if (!res.ok) {
        toast({
          title: t("pages.dashboard.reclaim.failedTitle"),
          description: t("pages.dashboard.reclaim.failedDescriptionSingle", { status: res.status }),
          variant: "destructive",
        });
        return;
      }
      const body = await res.json().catch(() => null);
      await queryClient.invalidateQueries({
        queryKey: getListUnplacedPayrollQueryKey(),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/occupants"] });
      const summary = body?.importSummary;
      toast({
        title: t("pages.dashboard.reclaim.claimedTitle"),
        description: summary
          ? t("pages.dashboard.reclaim.claimedDescriptionWithSummary", {
              count: summary.deductionsImported ?? 0,
              total: formatUsd(Number(summary.totalAmount ?? 0)),
              week: summary.payWeekEndDate ?? reclaimPayWeekEndDate,
            })
          : t("pages.dashboard.reclaim.claimedDescription"),
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
    if (!reclaimPayWeekIsSaturday) {
      toast({
        title: t("pages.finance.payroll.invalidWeekTitle"),
        description: t("pages.finance.payroll.invalidWeekDescription"),
        variant: "destructive",
      });
      return;
    }
    setReclaimingAll(true);
    try {
      const baseUrl = import.meta.env.BASE_URL ?? "/";
      const res = await fetch(`${baseUrl}api/payroll/unplaced?reclaimOverridden=true&payWeekEndDate=${encodeURIComponent(reclaimPayWeekEndDate)}`);
      if (!res.ok) {
        toast({
          title: t("pages.dashboard.reclaim.failedTitle"),
          description: t("pages.dashboard.reclaim.failedDescriptionAll", { status: res.status }),
          variant: "destructive",
        });
        return;
      }
      const body = await res.json().catch(() => null);
      await queryClient.invalidateQueries({
        queryKey: getListUnplacedPayrollQueryKey(),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/occupants"] });
      const summary = body?.importSummary;
      toast({
        title: t("pages.dashboard.reclaim.allClaimedTitle"),
        description: summary
          ? t("pages.dashboard.reclaim.allClaimedDescriptionWithSummary", {
              count: summary.deductionsImported ?? 0,
              total: formatUsd(Number(summary.totalAmount ?? 0)),
              week: summary.payWeekEndDate ?? reclaimPayWeekEndDate,
            })
          : t("pages.dashboard.reclaim.allClaimedDescription", { count: overriddenOccupants.length }),
      });
    } finally {
      setReclaimingAll(false);
    }
  };

  // Always-available payroll snapshot import (Task #597). Even with
  // zero overrides to reclaim, operators still need a way to write a
  // payroll_deductions snapshot for a chosen Saturday pay-week so the
  // Finance Weekly / Monthly / By-Customer tabs have data to roll up.
  // The previous flow gated this behind `overriddenOccupants.length > 0`,
  // which left fresh deployments with no UI path at all.
  const [importingSnapshot, setImportingSnapshot] = useState(false);
  const handleImportSnapshot = async () => {
    if (!reclaimPayWeekIsSaturday) {
      toast({
        title: t("pages.finance.payroll.invalidWeekTitle"),
        description: t("pages.finance.payroll.invalidWeekDescription"),
        variant: "destructive",
      });
      return;
    }
    setImportingSnapshot(true);
    try {
      const baseUrl = import.meta.env.BASE_URL ?? "/";
      const res = await fetch(
        `${baseUrl}api/payroll/unplaced?payWeekEndDate=${encodeURIComponent(reclaimPayWeekEndDate)}`,
      );
      if (!res.ok) {
        toast({
          title: t("pages.dashboard.payrollSnapshot.importFailedTitle"),
          description: t("pages.dashboard.payrollSnapshot.importFailedDescription", { status: res.status }),
          variant: "destructive",
        });
        return;
      }
      const body = await res.json().catch(() => null);
      const summary = body?.importSummary;
      const week = summary?.payWeekEndDate ?? reclaimPayWeekEndDate;
      toast({
        title: t("pages.dashboard.payrollSnapshot.importedTitle"),
        description: summary
          ? t("pages.dashboard.payrollSnapshot.importedDescription", {
              count: summary.deductionsImported ?? 0,
              total: formatUsd(Number(summary.totalAmount ?? 0)),
              week,
            })
          : t("pages.dashboard.payrollSnapshot.importedDescriptionEmpty", { week }),
      });
    } finally {
      setImportingSnapshot(false);
    }
  };

  // "Needs review" mirrors the per-page filters that the dashboard tiles
  // deep-link into. Each predicate matches what the corresponding page
  // shows when `?needsReview=1` is set — keeping the counts in sync with
  // what the operator sees after clicking through.
  // - Occupants: falsy moveInDate (mirrors the inline badge in occupants.tsx)
  // - Leases:    importer-flagged needsReview (ambiguous source cell)
  // - Properties: monthlyRent of 0 / unset (property missing rent)
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
    // Rent-free properties (task #497) are intentionally $0 rent, so
    // they don't count toward the missing-rent triage tile.
    () => scopedProperties.filter((p) => !p.rentFree && !(p.monthlyRent && p.monthlyRent > 0)).length,
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
      label: t("pages.dashboard.needsReviewItems.occupantsLabel"),
      cta: t("pages.dashboard.needsReviewItems.reviewOccupantsCta"),
      href: `/occupants?needsReview=1${customerQuerySuffix}`,
      testId: "needs-review-occupants",
    },
    {
      key: "leases" as const,
      count: needsReviewLeaseCount,
      label: t("pages.dashboard.needsReviewItems.leasesLabel"),
      cta: t("pages.dashboard.needsReviewItems.reviewLeasesCta"),
      href: `/leases?needsReview=1${customerQuerySuffix}`,
      testId: "needs-review-leases",
    },
    {
      key: "leases-needs-dates" as const,
      count: needsDatesLeaseCount,
      label: t("pages.dashboard.needsReviewItems.leasesMissingDatesLabel"),
      cta: t("pages.dashboard.needsReviewItems.reviewMissingDatesCta"),
      href: `/leases?needsDates=1${customerQuerySuffix}`,
      testId: "needs-review-leases-needs-dates",
    },
    {
      key: "properties" as const,
      count: needsReviewPropertyCount,
      label: t("pages.dashboard.needsReviewItems.propertiesLabel"),
      cta: t("pages.dashboard.needsReviewItems.reviewPropertiesCta"),
      href: `/properties?needsReview=1${customerQuerySuffix}`,
      testId: "needs-review-properties",
    },
    {
      key: "hotel-rate-at-risk" as const,
      count: hotelRateAtRiskCount,
      label: t("pages.dashboard.needsReviewItems.hotelRateAtRiskLabel", { month: currentMonth }),
      cta: t("pages.dashboard.needsReviewItems.reviewHotelRateCta"),
      // `?atRisk=1` (task #358) narrows the leases table itself to just
      // the at-risk rows so the dashboard count and the filtered table
      // line up. Customer scope is preserved so the two counts match.
      href: `/leases?atRisk=1${customerQuerySuffix}`,
      testId: "needs-review-hotel-rate-at-risk",
    },
  ].filter((item) => item.count > 0);

  // ── Upcoming projected move-ins roll-up (Task #578) ──────────────
  // Portfolio-wide variant of the per-property "Projected Move-Ins"
  // card on the Beds tab. Lists every active (not-yet-converted)
  // projection across the operator's currently-scoped properties so
  // they don't have to open each property to see who's arriving soon.
  // Sorted by date ascending; rows whose date is already past surface
  // first as "Overdue" so nothing slips.
  interface UpcomingMoveInRow {
    moveIn: ProjectedMoveIn;
    propertyId: string;
    propertyName: string;
    days: number;
    // Building label (Task #587). Only populated when the parent
    // property has more than one building; resolved via bed → room
    // → buildingId since ProjectedMoveIn only carries `bedId`.
    buildingName: string | null;
  }
  const upcomingMoveIns = useMemo<UpcomingMoveInRow[]>(() => {
    // Lookups built once per memo run so the inner loop stays O(1).
    const bedById = new Map(beds.map((b) => [b.id, b]));
    const roomById = new Map(rooms.map((r) => [r.id, r]));
    const buildingById = new Map(buildings.map((b) => [b.id, b]));
    const buildingsByProperty = new Map<string, number>();
    for (const b of buildings) {
      buildingsByProperty.set(b.propertyId, (buildingsByProperty.get(b.propertyId) ?? 0) + 1);
    }
    const out: UpcomingMoveInRow[] = [];
    for (const m of allProjectedMoveIns) {
      if (!scopedPropertyIds.has(m.propertyId)) continue;
      const days = projectedMoveInDaysFromToday(m.projectedMoveInDate);
      if (days === null) continue;
      const propertyName =
        scopedProperties.find((p) => p.id === m.propertyId)?.name ?? "—";
      let buildingName: string | null = null;
      if ((buildingsByProperty.get(m.propertyId) ?? 0) > 1) {
        const bed = m.bedId ? bedById.get(m.bedId) : undefined;
        const room = bed ? roomById.get(bed.roomId) : undefined;
        const bld = room?.buildingId ? buildingById.get(room.buildingId) : undefined;
        buildingName = bld ? bld.name : "Building unassigned";
      }
      out.push({ moveIn: m, propertyId: m.propertyId, propertyName, days, buildingName });
    }
    // Most-overdue first (most negative `days`), then soonest
    // upcoming arrivals. Matches the ascending-by-date semantics the
    // server already returns the list with — reapplying here in case
    // the cache was hydrated from a different ordering.
    out.sort((a, b) => a.days - b.days);
    return out;
  }, [allProjectedMoveIns, scopedPropertyIds, scopedProperties, beds, rooms, buildings]);
  const upcomingMoveInCounts = useMemo(() => {
    let overdue = 0;
    let next7 = 0;
    for (const r of upcomingMoveIns) {
      if (r.days < 0) overdue++;
      else if (r.days <= 7) next7++;
    }
    return { total: upcomingMoveIns.length, overdue, next7 };
  }, [upcomingMoveIns]);

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
    // Building label (Task #587). Only populated when the parent
    // property has more than one building, so single-building setups
    // stay noise-free.
    buildingName: string | null;
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
    const buildingById = new Map(buildings.map((b) => [b.id, b]));
    const buildingsByProperty = new Map<string, number>();
    for (const b of buildings) {
      buildingsByProperty.set(b.propertyId, (buildingsByProperty.get(b.propertyId) ?? 0) + 1);
    }
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
      let buildingName: string | null = null;
      if ((buildingsByProperty.get(l.propertyId) ?? 0) > 1) {
        const bld = l.buildingId ? buildingById.get(l.buildingId) : undefined;
        buildingName = bld ? bld.name : "Building unassigned";
      }
      out.push({ lease: l, propertyName, days, bucket, buildingName });
    }
    // Sort by urgency: most-overdue first (most negative), then
    // soonest-expiring upcoming dates.
    out.sort((a, b) => a.days - b.days);
    return out;
  }, [scopedLeases, scopedProperties, buildings]);

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

  // ── Notice deadline approaching (Task #492) ─────────────────────────
  // Surface leases whose `noticePeriodDays` (with property fallback)
  // makes their non-renewal notice deadline land within the next
  // NOTICE_LEAD_DAYS days. Reuses the same `snoozedUntil` plumbing as
  // the lease-expiry panel above so an operator who snoozes a row
  // there also silences the notice-deadline reminder for the same
  // lease — there is intentionally no second snooze surface.
  //
  // Both thresholds flow from `/api/config` so the dashboard alert
  // cards and the weekly digest agree on what counts as "approaching"
  // and "low" — operators set `NOTICE_LEAD_DAYS` /
  // `LOW_OCCUPANCY_THRESHOLD_PCT` once on the api-server and the
  // override lights up in both surfaces. The literal fallbacks here
  // are the documented defaults the api-server itself uses when the
  // env vars are unset, so a tab that mounts before the config query
  // resolves still uses the same numbers.
  const runtimeConfig = useRuntimeConfigQuery(true).data;
  useRuntimeConfigStream(true);
  const NOTICE_LEAD_DAYS = runtimeConfig?.noticeLeadDays ?? 30;
  const LOW_OCCUPANCY_THRESHOLD_PCT =
    runtimeConfig?.lowOccupancyThresholdPct ?? 80;
  interface NoticeDeadline {
    lease: Lease;
    propertyName: string;
    noticePeriodDays: number;
    daysUntilDeadline: number;
    noticeDeadline: string; // YYYY-MM-DD
  }
  const noticeDeadlineLeases = useMemo<NoticeDeadline[]>(() => {
    const out: NoticeDeadline[] = [];
    for (const l of scopedLeases) {
      if (!l.endDate || l.status === "Upcoming") continue;
      const snz = l.snoozedUntil ?? "";
      if (snz && snz > todayYMD) continue;
      const property = scopedProperties.find((p) => p.id === l.propertyId);
      const notice =
        l.noticePeriodDays != null
          ? l.noticePeriodDays
          : property?.defaultNoticePeriodDays ?? null;
      if (notice == null) continue;
      const daysToEnd = daysUntil(l.endDate);
      const daysUntilDeadline = daysToEnd - notice;
      if (daysUntilDeadline < 0 || daysUntilDeadline > NOTICE_LEAD_DAYS) continue;
      out.push({
        lease: l,
        propertyName: property?.name ?? "—",
        noticePeriodDays: notice,
        daysUntilDeadline,
        noticeDeadline: addDaysToToday(daysUntilDeadline),
      });
    }
    out.sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline);
    return out;
  }, [scopedLeases, scopedProperties, todayYMD]);

  // ── Low combined-occupancy customers (Task #492) ────────────────────
  // For each customer in scope, sum total/occupied beds across every
  // property they own OR are listed on `sharedWithCustomerIds` for, and
  // flag those below LOW_OCCUPANCY_THRESHOLD_PCT. Mirrors the
  // computation on customer-detail.tsx so the dashboard alert and the
  // detail page agree on what "low" means.
  interface LowOccupancyEntry {
    customerId: string;
    customerName: string;
    totalBeds: number;
    occupiedBeds: number;
    occupancyPct: number;
  }
  const lowOccupancyCustomers = useMemo<LowOccupancyEntry[]>(() => {
    const bedsByProperty = new Map<
      string,
      { total: number; occupied: number }
    >();
    for (const b of scopedBeds) {
      const entry = bedsByProperty.get(b.propertyId) ?? {
        total: 0,
        occupied: 0,
      };
      entry.total += 1;
      if (b.status === "Occupied") entry.occupied += 1;
      bedsByProperty.set(b.propertyId, entry);
    }
    const out: LowOccupancyEntry[] = [];
    for (const c of customers) {
      let total = 0;
      let occupied = 0;
      for (const p of scopedProperties) {
        const owns =
          p.customerId === c.id ||
          (p.sharedWithCustomerIds ?? []).includes(c.id);
        if (!owns) continue;
        const bed = bedsByProperty.get(p.id);
        if (!bed) continue;
        total += bed.total;
        occupied += bed.occupied;
      }
      if (total === 0) continue;
      const pct = (occupied / total) * 100;
      if (pct >= LOW_OCCUPANCY_THRESHOLD_PCT) continue;
      out.push({
        customerId: c.id,
        customerName: c.name,
        totalBeds: total,
        occupiedBeds: occupied,
        occupancyPct: pct,
      });
    }
    out.sort((a, b) => a.occupancyPct - b.occupancyPct);
    return out;
  }, [customers, scopedProperties, scopedBeds]);

  // ── Expiring insurance certificates (Task #333, enhanced Task #398) ─
  // Surface every certificate whose `coverageEnd` is within the next 90
  // days (or expired in the last 30) so operators can chase a renewed
  // PDF before coverage actually lapses. Buckets mirror the lease expiry
  // widget: critical (≤30d), warning (31-60d), soon (61-90d), expired.
  // Grouped by property so operators see all certs for a given property
  // together.
  type CertExpiryBucket = "critical" | "warning" | "soon" | "expired";
  interface ExpiringCert {
    id: string;
    propertyId: string;
    propertyName: string;
    carrier: string;
    policyNumber: string;
    coverageEnd: string;
    days: number;
    bucket: CertExpiryBucket;
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
      let bucket: CertExpiryBucket;
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
        scopedProperties.find((p) => p.id === c.propertyId)?.name ?? "—";
      out.push({
        id: c.id,
        propertyId: c.propertyId,
        propertyName,
        carrier: c.carrier,
        policyNumber: c.policyNumber,
        coverageEnd: c.coverageEnd,
        days,
        bucket,
      });
    }
    out.sort((a, b) => a.days - b.days);
    return out;
  }, [scopedCerts, scopedProperties]);

  const expiringCertCounts = useMemo(() => {
    const counts = { critical: 0, warning: 0, soon: 0, expired: 0 };
    for (const c of expiringCerts) counts[c.bucket] += 1;
    return counts;
  }, [expiringCerts]);

  const certsByProperty = useMemo(() => {
    const map = new Map<string, ExpiringCert[]>();
    for (const c of expiringCerts) {
      const existing = map.get(c.propertyId) ?? [];
      existing.push(c);
      map.set(c.propertyId, existing);
    }
    return Array.from(map.entries()).map(([propertyId, certs]) => ({
      propertyId,
      propertyName: certs[0].propertyName,
      certs,
      worstBucket: certs[0].bucket,
    }));
  }, [expiringCerts]);

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
      return t("pages.dashboard.expiry.expiredDaysAgo", { count: abs });
    }
    if (days === 0) return t("pages.dashboard.expiry.expiresToday");
    return t("pages.dashboard.expiry.daysLeft", { count: days });
  }

  const totalProperties = scopedProperties.length;
  const totalBeds = scopedBeds.length;
  const occupiedBeds = scopedBeds.filter((b) => b.status === "Occupied").length;
  const vacantBeds = scopedBeds.filter((b) => b.status === "Vacant").length;
  const occupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;

  // "Recovered Rent" = what active occupants are actually paying back
  // via payroll deductions, NOT the theoretical full per-bed list price.
  // If no occupants have a chargePerBed set yet, this is $0 — which
  // correctly reflects that nothing has been recovered.
  const totalMonthlyRevenue = activeOccupants.reduce(
    (acc, o) =>
      acc +
      toMonthlyCharge(o.chargePerBed || 0, o.billingFrequency ?? "Monthly"),
    0,
  );

  // Use the hotel-rate–aware estimator so corporate-rate agreements
  // (nightly × room-nights from the latest logged month) contribute to
  // the dashboard's Monthly Costs / Net Profit tiles instead of being
  // silently treated as $0. Monthly leases are unchanged because
  // `estimateLeaseMonthlyRent` returns their stored `monthlyRent` as-is.
  const totalMonthlyLeaseCosts = scopedLeases
    .filter((l) => l.status === "Active")
    .reduce((acc, l) => acc + estimateLeaseMonthlyRent(l, roomNightLogs), 0);
  // Per-property utilities-included-in-rent share (task #518). For
  // each property, compute the fraction of active leases whose rent
  // already bundles utilities, then pro-rate that property's tracked
  // utility expense by `(1 - share)` so dollars already netted into
  // the lease cost above aren't subtracted a second time as utilities.
  const utilitiesIncludedShareByProp = new Map<string, number>();
  for (const p of scopedProperties) {
    const propActive = scopedLeases.filter(
      (l) => l.propertyId === p.id && l.status === "Active",
    );
    if (propActive.length === 0) continue;
    const flagged = propActive.filter((l) => l.utilitiesIncludedInRent).length;
    utilitiesIncludedShareByProp.set(p.id, flagged / propActive.length);
  }
  const currentMonthUtilities = scopedUtilities.reduce((acc, u) => {
    const share = utilitiesIncludedShareByProp.get(u.propertyId) ?? 0;
    return acc + u.monthlyCost * (1 - share);
  }, 0);
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
      ? t("pages.dashboard.topProperties.overall")
      : t(`pages.dashboard.ratings.${topRatingSort}` as const, {
          defaultValue:
            RATING_CATEGORIES.find((c) => c.key === topRatingSort)?.label ??
            "Overall",
        });

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
        const rawUtilCost = scopedUtilities.filter((u) => u.propertyId === p.id).reduce((acc, u) => acc + u.monthlyCost, 0);
        // Apply the same utilities-included-in-rent pro-rate (task
        // #518) used by the Monthly Costs / Net Profit tiles above so
        // the bar chart agrees with the headline numbers.
        const utilShare = utilitiesIncludedShareByProp.get(p.id) ?? 0;
        const utilCost = rawUtilCost * (1 - utilShare);
        return {
          id: p.id,
          name: p.name,
          Revenue: revenue,
          Cost: leaseCost + utilCost,
          Profit: revenue - (leaseCost + utilCost),
        };
      }),
    // `utilitiesIncludedShareByProp` is rebuilt every render from the
    // same `scopedLeases` + `scopedProperties` inputs already listed
    // here, so listing those upstream inputs keeps the chart in sync
    // without needing the map's identity in the dep array.
    [scopedProperties, scopedBeds, scopedLeases, scopedUtilities, roomNightLogs],
  );

  const cards = [
    { title: t("pages.dashboard.metrics.properties"), value: totalProperties, icon: Building2, trend: t("pages.dashboard.metrics.trend.thisYear") },
    { title: t("pages.dashboard.metrics.totalBeds"), value: totalBeds, icon: BedDouble, trend: t("pages.dashboard.metrics.trend.occupied", { count: occupiedBeds }) },
    { title: t("pages.dashboard.metrics.occupancy"), value: `${occupancyRate.toFixed(1)}%`, icon: Users, trend: t("pages.dashboard.metrics.trend.vacant", { count: vacantBeds }) },
    { title: t("pages.dashboard.metrics.monthlyRevenue"), value: formatUsdWhole(totalMonthlyRevenue), icon: TrendingUp, trend: t("pages.dashboard.metrics.trend.target") },
    { title: t("pages.dashboard.metrics.monthlyCosts"), value: formatUsdWhole(totalMonthlyCosts), icon: DollarSign, trend: t("pages.dashboard.metrics.trend.leasesUtilities") },
    { title: t("pages.dashboard.metrics.netProfit"), value: formatUsdWhole(netProfit), icon: Zap, trend: netProfit >= 0 ? t("pages.dashboard.metrics.trend.vsLastMonth") : t("pages.dashboard.metrics.trend.needsAttention") },
    {
      title: t("pages.dashboard.metrics.rentPerBed"),
      value: portfolioRentPerBed === null ? "—" : formatUsdWhole(portfolioRentPerBed),
      icon: BedDouble,
      trend: t("pages.dashboard.metrics.trend.rentPerBedBreakdown", { count: totalBeds, rent: formatUsdWhole(portfolioMonthlyRent) }),
    },
    {
      title: t("pages.dashboard.metrics.electricPerBed"),
      value: portfolioElectricPerBed === null ? "—" : formatUsdWhole(portfolioElectricPerBed),
      icon: Zap,
      trend: t("pages.dashboard.metrics.trend.electricPerBedBreakdown", { count: totalBeds, electric: formatUsdWhole(portfolioMonthlyElectric) }),
    },
    {
      title: t("pages.dashboard.metrics.rentPlusElectricPerBed"),
      value: portfolioRentPlusElectricPerBed === null ? "—" : formatUsdWhole(portfolioRentPlusElectricPerBed),
      icon: DollarSign,
      trend: t("pages.dashboard.metrics.trend.rentPlusElectricPerBedBreakdown", { count: totalBeds, electric: formatUsdWhole(portfolioMonthlyElectric) }),
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

  const activeCustomerName =
    customerFilter === ALL_CUSTOMERS
      ? null
      : customers.find((c) => c.id === customerFilter)?.name ?? null;

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <PageHeader
          title={t("pages.dashboard.title")}
          description={t("pages.dashboard.description")}
          meta={
            activeCustomerName ? (
              <p
                className="text-xs text-muted-foreground flex items-center gap-1"
                data-testid="text-dashboard-active-customer"
              >
                <Briefcase className="h-3 w-3" />
                {t("pages.dashboard.showingOnly")} <span className="font-semibold">{activeCustomerName}</span>
              </p>
            ) : null
          }
          actions={
            <Select value={customerFilter} onValueChange={updateCustomerFilter}>
              <SelectTrigger className="w-full sm:w-56" data-testid="select-dashboard-customer-filter">
                <SelectValue placeholder={t("pages.dashboard.customerPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CUSTOMERS}>{t("pages.dashboard.allCustomers")}</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {cards.map((card, i) => (
            <motion.div key={card.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-tight">{card.title}</p>
                      <p className="text-lg font-bold mt-0.5 leading-tight whitespace-nowrap">{card.value}</p>
                    </div>
                    <div className="p-1 rounded-md bg-muted shrink-0"><card.icon className="h-3 w-3 text-muted-foreground" /></div>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{card.trend}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {needsReviewItems.length > 0 && (
          <Card
            className="border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20"
            data-testid="card-needs-review"
          >
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                <p className="text-sm font-semibold">{t("pages.dashboard.needsReview.title")}</p>
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

        {upcomingMoveIns.length > 0 && (
          <Card data-testid="card-upcoming-move-ins">
            <CardHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <CalendarClock className="h-4 w-4 text-blue-600" />
                <CardTitle>Upcoming move-ins</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-upcoming-move-ins-total-count"
                >
                  {upcomingMoveInCounts.total} planned
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Active projected move-ins across every property in
                scope. Overdue rows surface first; rows due in the
                next 7 days are flagged. Click a row to jump to the
                property's Beds tab.
              </p>
              <div
                className="mt-2 flex flex-wrap gap-2 text-xs"
                data-testid="bucket-counts-upcoming-move-ins"
              >
                {upcomingMoveInCounts.overdue > 0 && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 bg-rose-100 text-rose-900 border-rose-200"
                    data-testid="bucket-count-upcoming-move-ins-overdue"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {upcomingMoveInCounts.overdue} overdue
                  </span>
                )}
                {upcomingMoveInCounts.next7 > 0 && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 bg-amber-100 text-amber-900 border-amber-200"
                    data-testid="bucket-count-upcoming-move-ins-next7"
                  >
                    {upcomingMoveInCounts.next7} in next 7 days
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingMoveIns.map(({ moveIn, propertyId, propertyName, days, buildingName }) => {
                    const overdue = days < 0;
                    return (
                      <TableRow
                        key={moveIn.id}
                        className={overdue ? "bg-rose-50/40 dark:bg-rose-950/20" : undefined}
                        data-testid={`row-upcoming-move-in-${moveIn.id}`}
                        data-bucket={
                          overdue
                            ? "overdue"
                            : days === 0
                              ? "today"
                              : days <= 7
                                ? "soon"
                                : "later"
                        }
                      >
                        <TableCell className="font-medium">
                          <Link
                            href={`/properties/${propertyId}?tab=beds`}
                            className="hover:underline text-primary"
                            data-testid={`link-upcoming-move-in-${moveIn.id}`}
                          >
                            {moveIn.personName || "(no name)"}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          <div className="flex flex-col">
                            <PropertyNameCell name={propertyName} />
                            {buildingName && (
                              <span
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80"
                                data-testid={`upcoming-move-in-building-${moveIn.id}`}
                              >
                                <Building2 className="h-3 w-3" />
                                {buildingName}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums text-muted-foreground">
                          {formatYMDPretty(moveIn.projectedMoveInDate)}
                        </TableCell>
                        <TableCell className="text-right">
                          <MoveInDateBadge
                            date={moveIn.projectedMoveInDate}
                            testId={`badge-upcoming-move-in-${moveIn.id}`}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {(expiringLeases.length > 0 || snoozedLeases.length > 0) && (
          <Card data-testid="card-expiring-leases">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                <CardTitle>{t("pages.dashboard.leaseExpiry.title")}</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-expiring-leases-total-count"
                >
                  {t("pages.dashboard.leaseExpiry.leaseCount", { count: expiringLeases.length })}
                </span>
                {digestPreviewEnabled && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        disabled={sendingDigestPreview}
                        data-testid="button-send-digest-preview"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {sendingDigestPreview ? t("pages.dashboard.leaseExpiry.sending") : t("pages.dashboard.leaseExpiry.sendPreview")}
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => openDigestDialog("send")}
                        data-testid="menuitem-send-digest-now"
                      >
                        <Send className="h-3.5 w-3.5 mr-2" />
                        {t("pages.dashboard.leaseExpiry.sendNow")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => openDigestDialog("dry-run")}
                        data-testid="menuitem-preview-digest-dryrun"
                      >
                        <Eye className="h-3.5 w-3.5 mr-2" />
                        {t("pages.dashboard.leaseExpiry.previewWithoutSending")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("pages.dashboard.leaseExpiry.helperText")}
              </p>
              {snoozedLeases.length > 0 && (
                <div
                  className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"
                  data-testid="snoozed-leases-summary"
                >
                  <BellOff className="h-3.5 w-3.5" />
                  <span data-testid="text-snoozed-leases-count">
                    {t("pages.dashboard.leaseExpiry.snoozedCount", { count: snoozedLeases.length })}
                  </span>
                  <Link
                    href="/leases/snoozed"
                    className="text-xs text-primary hover:underline"
                    data-testid="link-review-snoozed-leases"
                  >
                    {t("pages.dashboard.leaseExpiry.review")}
                  </Link>
                  {(() => {
                    // Surface "who snoozed and when" from the most recent
                    // snooze action across the visible snoozed rows
                    // (task #429). We pick the entry with the largest
                    // `snoozedAt` so the tooltip always points at the
                    // freshest audit stamp; older snoozes are still
                    // recorded on the row itself.
                    const recent = snoozedLeases
                      .map((s) => s.lease)
                      .filter((l) => (l.snoozedAt ?? "") !== "")
                      .sort((a, b) =>
                        (b.snoozedAt ?? "").localeCompare(a.snoozedAt ?? ""),
                      )[0];
                    if (!recent) return null;
                    const who = recent.snoozedBy?.trim() || "unknown";
                    const when = recent.snoozedAt ?? "";
                    let whenLabel = when;
                    try {
                      whenLabel = new Date(when).toLocaleString();
                    } catch {
                      // Fall back to the raw ISO string if Date can't
                      // parse it (defensive — server always writes ISO).
                    }
                    return (
                      // Wrap in a local TooltipProvider so this audit
                      // tooltip works even if the dashboard is mounted
                      // outside the App-level provider (e.g. unit
                      // tests). Radix tooltips require an enclosing
                      // provider to read context.
                      <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className="inline-flex items-center"
                            data-testid="snoozed-leases-audit-trigger"
                          >
                            <Info className="h-3.5 w-3.5 cursor-help" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          data-testid="snoozed-leases-audit-tooltip"
                        >
                          <div className="text-xs">
                            <div>
                              <Trans
                                i18nKey="pages.dashboard.leaseExpiry.recentSnoozeBy"
                                values={{ who }}
                                components={{
                                  1: (
                                    <span
                                      className="font-medium"
                                      data-testid="snoozed-leases-audit-by"
                                    />
                                  ),
                                }}
                              />
                            </div>
                            <div
                              className="text-muted-foreground"
                              data-testid="snoozed-leases-audit-at"
                            >
                              {whenLabel}
                            </div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                      </TooltipProvider>
                    );
                  })()}
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    data-testid="button-unsnooze-all-leases"
                    onClick={() => {
                      for (const { lease } of snoozedLeases) {
                        updateLease(lease.id, {
                          snoozedUntil: "",
                          snoozedAt: "",
                          snoozedBy: "",
                        });
                      }
                      toast({
                        title: t("pages.dashboard.leaseExpiry.snoozesClearedTitle"),
                        description: t("pages.dashboard.leaseExpiry.snoozesClearedDescription", {
                          count: snoozedLeases.length,
                        }),
                      });
                    }}
                  >
                    {t("pages.dashboard.leaseExpiry.unsnoozeAll")}
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
                    {t("pages.dashboard.expiry.expiredBucket", { count: expiringCounts.expired })}
                  </span>
                )}
                {expiringCounts.critical > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.critical.badge}`}
                    data-testid="bucket-count-expiring-leases-critical"
                  >
                    {t("pages.dashboard.expiry.criticalBucket", { count: expiringCounts.critical })}
                  </span>
                )}
                {expiringCounts.warning > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.warning.badge}`}
                    data-testid="bucket-count-expiring-leases-warning"
                  >
                    {t("pages.dashboard.expiry.warningBucket", { count: expiringCounts.warning })}
                  </span>
                )}
                {expiringCounts.soon > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.soon.badge}`}
                    data-testid="bucket-count-expiring-leases-soon"
                  >
                    {t("pages.dashboard.expiry.soonBucket", { count: expiringCounts.soon })}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("pages.dashboard.expiry.propertyHeader")}</TableHead>
                    <TableHead>{t("pages.dashboard.expiry.endsHeader")}</TableHead>
                    <TableHead>{t("pages.dashboard.expiry.statusHeader")}</TableHead>
                    <TableHead className="text-right">{t("pages.dashboard.expiry.whenHeader")}</TableHead>
                    <TableHead className="text-right">{t("pages.dashboard.expiry.actionsHeader")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expiringLeases.map(({ lease, propertyName, days, bucket, buildingName }) => {
                    const style = expiryBucketStyle[bucket];
                    function snooze(durationDays: number, label: string) {
                      const until = addDaysToToday(durationDays);
                      // Audit fields (task #429): record who hid the
                      // alert and when so a teammate investigating a
                      // missed renewal can see the full trail. The
                      // server keeps these alongside `snoozedUntil`
                      // and we clear them on unsnooze below.
                      const snoozedAt = new Date().toISOString();
                      const snoozedBy = getOperatorIdentity();
                      updateLease(lease.id, {
                        snoozedUntil: until,
                        snoozedAt,
                        snoozedBy,
                      });
                      toast({
                        title: t("pages.dashboard.expiry.snoozedTitle", { label }),
                        description: t("pages.dashboard.expiry.snoozedDescription", {
                          property: propertyName,
                          until: formatYMDPretty(until),
                        }),
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
                          {buildingName && (
                            <span
                              className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground"
                              data-testid={`expiring-lease-building-${lease.id}`}
                            >
                              <Building2 className="h-3 w-3" />
                              {buildingName}
                            </span>
                          )}
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
                                {t("pages.dashboard.expiry.snooze")}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>{t("pages.dashboard.expiry.hideForLabel")}</DropdownMenuLabel>
                              <DropdownMenuItem
                                data-testid={`button-snooze-lease-${lease.id}-7d`}
                                onSelect={() => snooze(7, t("pages.dashboard.expiry.days7"))}
                              >
                                {t("pages.dashboard.expiry.days7")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid={`button-snooze-lease-${lease.id}-30d`}
                                onSelect={() => snooze(30, t("pages.dashboard.expiry.days30"))}
                              >
                                {t("pages.dashboard.expiry.days30")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid={`button-snooze-lease-${lease.id}-90d`}
                                onSelect={() => snooze(90, t("pages.dashboard.expiry.days90"))}
                              >
                                {t("pages.dashboard.expiry.days90")}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                data-testid={`button-snooze-lease-${lease.id}-renewal`}
                                onSelect={() => snooze(365, t("pages.dashboard.expiry.untilRenewal"))}
                              >
                                {t("pages.dashboard.expiry.renewalInProgress")}
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

        {/* Task #492: Notice deadline approaching */}
        {noticeDeadlineLeases.length > 0 && (
          <Card data-testid="card-notice-deadline-approaching">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                <CardTitle>{t("pages.dashboard.noticeDeadline.title")}</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-notice-deadline-count"
                >
                  {t("pages.dashboard.noticeDeadline.leaseCount", { count: noticeDeadlineLeases.length })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("pages.dashboard.noticeDeadline.helperText", { days: NOTICE_LEAD_DAYS })}
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("pages.dashboard.noticeDeadline.propertyHeader")}</TableHead>
                    <TableHead>{t("pages.dashboard.noticeDeadline.noticeByHeader")}</TableHead>
                    <TableHead>{t("pages.dashboard.noticeDeadline.endsHeader")}</TableHead>
                    <TableHead className="text-right">{t("pages.dashboard.noticeDeadline.noticeHeader")}</TableHead>
                    <TableHead className="text-right">{t("pages.dashboard.noticeDeadline.whenHeader")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {noticeDeadlineLeases.map((e) => (
                    <TableRow
                      key={e.lease.id}
                      data-testid={`row-notice-deadline-${e.lease.id}`}
                    >
                      <TableCell className="font-medium">
                        <Link
                          href={`/leases/${e.lease.id}`}
                          className="hover:underline text-primary"
                        >
                          {e.propertyName}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatYMDPretty(e.noticeDeadline)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatYMDPretty(e.lease.endDate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {e.noticePeriodDays}d
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {e.daysUntilDeadline === 0
                          ? t("pages.dashboard.noticeDeadline.today")
                          : `${e.daysUntilDeadline}d`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Task #492: Low combined occupancy */}
        {lowOccupancyCustomers.length > 0 && (
          <Card data-testid="card-low-combined-occupancy">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                <CardTitle>{t("pages.dashboard.lowOccupancy.title")}</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-low-occupancy-count"
                >
                  {t("pages.dashboard.lowOccupancy.customerCount", { count: lowOccupancyCustomers.length })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("pages.dashboard.lowOccupancy.helperText", { pct: LOW_OCCUPANCY_THRESHOLD_PCT })}
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("pages.dashboard.lowOccupancy.customerHeader")}</TableHead>
                    <TableHead className="text-right">{t("pages.dashboard.lowOccupancy.bedsHeader")}</TableHead>
                    <TableHead className="text-right">{t("pages.dashboard.lowOccupancy.occupancyHeader")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowOccupancyCustomers.map((c) => (
                    <TableRow
                      key={c.customerId}
                      data-testid={`row-low-occupancy-${c.customerId}`}
                    >
                      <TableCell className="font-medium">
                        <Link
                          href={`/customers/${c.customerId}`}
                          className="hover:underline text-primary"
                        >
                          {c.customerName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.occupiedBeds}/{c.totalBeds}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.occupancyPct.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {expiringCerts.length > 0 && (
          <Card data-testid="card-expiring-insurance">
            <CardHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <CardTitle>{t("pages.dashboard.insurance.title")}</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-expiring-insurance-total-count"
                >
                  {t("pages.dashboard.insurance.certificateCount", { count: expiringCerts.length })}{" "}
                  {t("pages.dashboard.insurance.across")}{" "}
                  {t("pages.dashboard.insurance.propertyCount", { count: certsByProperty.length })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("pages.dashboard.insurance.helperText")}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {expiringCertCounts.expired > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.expired.badge}`}
                    data-testid="bucket-count-expiring-insurance-expired"
                  >
                    {t("pages.dashboard.insurance.expiredBucket", { count: expiringCertCounts.expired })}
                  </span>
                )}
                {expiringCertCounts.critical > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.critical.badge}`}
                    data-testid="bucket-count-expiring-insurance-critical"
                  >
                    {t("pages.dashboard.insurance.criticalBucket", { count: expiringCertCounts.critical })}
                  </span>
                )}
                {expiringCertCounts.warning > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.warning.badge}`}
                    data-testid="bucket-count-expiring-insurance-warning"
                  >
                    {t("pages.dashboard.insurance.warningBucket", { count: expiringCertCounts.warning })}
                  </span>
                )}
                {expiringCertCounts.soon > 0 && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${expiryBucketStyle.soon.badge}`}
                    data-testid="bucket-count-expiring-insurance-soon"
                  >
                    {t("pages.dashboard.insurance.soonBucket", { count: expiringCertCounts.soon })}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("pages.dashboard.insurance.propertyHeader")}</TableHead>
                    <TableHead>{t("pages.dashboard.insurance.carrierHeader")}</TableHead>
                    <TableHead>{t("pages.dashboard.insurance.policyHeader")}</TableHead>
                    <TableHead>{t("pages.dashboard.insurance.coverageEndsHeader")}</TableHead>
                    <TableHead>{t("pages.dashboard.insurance.statusHeader")}</TableHead>
                    <TableHead className="text-right">{t("pages.dashboard.insurance.whenHeader")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {certsByProperty.map((group) =>
                    group.certs.map((c, idx) => {
                      const style = expiryBucketStyle[c.bucket];
                      return (
                        <TableRow
                          key={c.id}
                          className={`${style.row}${idx > 0 ? " border-t-0" : ""}`}
                          data-testid={`row-expiring-insurance-${c.id}`}
                        >
                          <TableCell className="font-medium">
                            {idx === 0 ? (
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
                            ) : (
                              <span className="text-xs text-muted-foreground italic">{t("pages.dashboard.insurance.sameProperty")}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{c.carrier || "—"}</TableCell>
                          <TableCell className="font-mono text-sm">{c.policyNumber || "—"}</TableCell>
                          <TableCell className="text-sm tabular-nums text-muted-foreground">
                            {formatYMDPretty(c.coverageEnd)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={style.badge}
                              data-testid={`badge-expiring-insurance-${c.id}`}
                            >
                              {style.label}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className="text-right text-sm tabular-nums"
                            data-testid={`text-expiring-insurance-${c.id}-when`}
                          >
                            {expiryRowLabel(c.days)}
                          </TableCell>
                        </TableRow>
                      );
                    }),
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {hasAnyCustomerPaidRent && (
          <Card data-testid="card-customer-paid-rent">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">{t("pages.dashboard.customerPaidRent.title")}</p>
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={customerPaidRentStatus}
                  onValueChange={(v) => {
                    if (v === "Active" || v === "Upcoming" || v === "All") {
                      setCustomerPaidRentStatus(v);
                    }
                  }}
                  className="ml-auto"
                  data-testid="toggle-customer-paid-rent-status"
                >
                  <ToggleGroupItem value="Active" data-testid="toggle-customer-paid-rent-status-active">
                    {t("pages.dashboard.customerPaidRent.statusActive")}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="Upcoming" data-testid="toggle-customer-paid-rent-status-upcoming">
                    {t("pages.dashboard.customerPaidRent.statusUpcoming")}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="All" data-testid="toggle-customer-paid-rent-status-all">
                    {t("pages.dashboard.customerPaidRent.statusAll")}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <p
                className="text-2xl font-bold tabular-nums"
                data-testid="text-customer-paid-rent-total"
              >
                {formatUsd(customerPaidRentByCustomer.total)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {customerPaidRentStatus === "Active"
                  ? t("pages.dashboard.customerPaidRent.descriptionActive")
                  : customerPaidRentStatus === "Upcoming"
                    ? t("pages.dashboard.customerPaidRent.descriptionUpcoming")
                    : t("pages.dashboard.customerPaidRent.descriptionAll")}
              </p>
              {customerPaidRentByCustomer.rows.length === 0 ? (
                <p
                  className="text-sm text-muted-foreground mt-6"
                  data-testid="text-customer-paid-rent-empty"
                >
                  {customerPaidRentStatus === "Active"
                    ? t("pages.dashboard.customerPaidRent.emptyActive")
                    : customerPaidRentStatus === "Upcoming"
                      ? t("pages.dashboard.customerPaidRent.emptyUpcoming")
                      : t("pages.dashboard.customerPaidRent.emptyAll")}
                </p>
              ) : (
                <div className="mt-6">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    {t("pages.dashboard.customerPaidRent.byCustomerHeading")}
                  </p>
                  <Table data-testid="table-customer-paid-rent-by-customer">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("pages.dashboard.customerPaidRent.customerHeader")}</TableHead>
                        <TableHead className="text-right">{t("pages.dashboard.customerPaidRent.leasesHeader")}</TableHead>
                        <TableHead className="text-right">{t("pages.dashboard.customerPaidRent.monthlyRentHeader")}</TableHead>
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
                            {formatUsd(row.rent)}
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

        <Card id="card-payroll-snapshot" data-testid="card-payroll-snapshot">
          <CardHeader>
            <div className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-muted-foreground" />
              <CardTitle>{t("pages.dashboard.payrollSnapshot.title")}</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t("pages.dashboard.payrollSnapshot.helperText")}
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex flex-col gap-1 flex-1 max-w-xs">
                <Label htmlFor="input-import-pay-week" className="text-xs">
                  {t("pages.finance.payroll.payWeekEndingSaturday")}
                </Label>
                <Input
                  id="input-import-pay-week"
                  type="date"
                  value={reclaimPayWeekEndDate}
                  onChange={(e) => setReclaimPayWeekEndDate(e.target.value)}
                  data-testid="input-import-pay-week-end-date"
                />
                {!reclaimPayWeekIsSaturday && (
                  <p className="text-xs text-destructive" data-testid="text-import-pay-week-not-saturday">
                    {t("pages.finance.payroll.notSaturday")}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={importingSnapshot || !reclaimPayWeekIsSaturday}
                onClick={handleImportSnapshot}
                data-testid="button-import-payroll-snapshot"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                {importingSnapshot
                  ? t("pages.dashboard.payrollSnapshot.importing")
                  : t("pages.dashboard.payrollSnapshot.import")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {overriddenOccupants.length > 0 && (
          <Card id="card-payroll-mismatches" data-testid="card-payroll-mismatches">
            <CardHeader>
              <div className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <CardTitle>{t("pages.dashboard.payrollMismatches.title")}</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-payroll-mismatches-count"
                >
                  {t("pages.dashboard.payrollMismatches.overrideCount", { count: overriddenOccupants.length })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("pages.dashboard.payrollMismatches.helperText")}
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-end justify-end gap-3 border rounded-md p-3 bg-muted/30">
                <div className="flex flex-col gap-1 flex-1 max-w-xs">
                  <Label htmlFor="input-reclaim-pay-week" className="text-xs">
                    {t("pages.finance.payroll.payWeekEndingSaturday")}
                  </Label>
                  <Input
                    id="input-reclaim-pay-week"
                    type="date"
                    value={reclaimPayWeekEndDate}
                    onChange={(e) => setReclaimPayWeekEndDate(e.target.value)}
                    data-testid="input-reclaim-pay-week-end-date"
                  />
                  {!reclaimPayWeekIsSaturday && (
                    <p className="text-xs text-destructive" data-testid="text-reclaim-pay-week-not-saturday">
                      {t("pages.finance.payroll.notSaturday")}
                    </p>
                  )}
                </div>
                {overriddenOccupants.length > 1 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reclaimingAll || !reclaimPayWeekIsSaturday}
                    onClick={handleReclaimAll}
                    data-testid="button-reclaim-all-overrides"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    {reclaimingAll
                      ? t("pages.dashboard.payrollMismatches.reclaimAllLoading")
                      : t("pages.dashboard.payrollMismatches.reclaimAll")}
                  </Button>
                )}
              </div>
              {overriddenByCustomer.map((group) => (
                <div
                  key={group.customer}
                  data-testid={`group-overridden-${group.customer}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold">{group.customer}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {t("pages.dashboard.payrollMismatches.overrideCount", { count: group.rows.length })}
                    </p>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("pages.dashboard.payrollMismatches.nameHeader")}</TableHead>
                        <TableHead className="text-right">{t("pages.dashboard.payrollMismatches.currentChargeHeader")}</TableHead>
                        <TableHead>{t("pages.dashboard.payrollMismatches.payrollSourceHeader")}</TableHead>
                        <TableHead>{t("pages.dashboard.payrollMismatches.propertyHeader")}</TableHead>
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
                              {t("pages.dashboard.payrollMismatches.overriddenBadge")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatUsd(o.chargePerBed)}
                            <span className="text-xs text-muted-foreground ml-1">
                              /{o.billingFrequency === "Weekly"
                                ? t("pages.dashboard.payrollMismatches.weeklyAbbrev")
                                : t("pages.dashboard.payrollMismatches.monthlyAbbrev")}
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
                                  {t("pages.dashboard.payrollMismatches.person", { id: o.chargeSourcePersonId })}
                                </div>
                              </div>
                            ) : (
                              <span className="italic">{t("pages.dashboard.payrollMismatches.noPayrollLink")}</span>
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
                                {t("pages.dashboard.payrollMismatches.unassigned")}
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
                              {reclaimingIds.has(o.id)
                                ? t("pages.dashboard.payrollMismatches.reclaimLoading")
                                : t("pages.dashboard.payrollMismatches.reclaim")}
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


        {lowConfidenceByCustomer.length > 0 && (
          <Card id="card-low-confidence-payroll" data-testid="card-low-confidence-payroll">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <CardTitle>{t("pages.dashboard.confirmMatch.title")}</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-low-confidence-payroll-total-count"
                >
                  {t("pages.dashboard.confirmMatch.rowCount", { count: scopedLowConfidencePayroll.length })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("pages.dashboard.confirmMatch.helperText")}
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
                      {t("pages.dashboard.confirmMatch.rowCount", { count: group.rows.length })}
                    </p>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("pages.dashboard.confirmMatch.payrollNameHeader")}</TableHead>
                        <TableHead>{t("pages.dashboard.confirmMatch.currentlyAppliedHeader")}</TableHead>
                        <TableHead className="text-right">{t("pages.dashboard.confirmMatch.weeklyHeader")}</TableHead>
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
                                ? t("pages.dashboard.confirmMatch.atProperty", { property: row.matched.propertyName })
                                : t("pages.dashboard.confirmMatch.unassignedSuffix")}
                            </div>
                            {row.suggestions.length > 0 && (
                              <div
                                className="mt-1 flex flex-wrap items-center gap-1"
                                data-testid={`low-confidence-alternatives-${row.personId}`}
                              >
                                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                                  <Wand2 className="h-3 w-3" />
                                  {t("pages.dashboard.confirmMatch.didYouMean")}
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
                                      const prevOccLc = occupants.find((o) => o.id === s.occupantId);
                                      const prevLc = {
                                        chargePerBed: prevOccLc?.chargePerBed ?? 0,
                                        billingFrequency: prevOccLc?.billingFrequency ?? "Monthly",
                                        employeeId: prevOccLc?.employeeId ?? "",
                                        company: prevOccLc?.company ?? "",
                                      };
                                      updateOccupant(s.occupantId, {
                                        chargePerBed: row.weekly,
                                        billingFrequency: "Weekly",
                                        employeeId: row.personId,
                                      });
                                      recordPayrollReconciliation({
                                        id: `lc::${row.customer}::${row.personId}::${s.occupantId}::${Date.now()}`,
                                        occupantId: s.occupantId,
                                        occupantName: s.name,
                                        propertyName: s.propertyName,
                                        employer: row.customer,
                                        weekly: row.weekly,
                                        kind: s.crossEmployer ? "cross-employer" : "typo",
                                        timestamp: Date.now(),
                                        prev: prevLc,
                                      });
                                      queryClient.invalidateQueries({
                                        queryKey: getListUnplacedPayrollQueryKey(),
                                      });
                                    }}
                                    data-testid={`button-redirect-low-confidence-${row.personId}-${s.occupantId}`}
                                  >
                                    {s.name}
                                    {s.propertyName
                                      ? t("pages.dashboard.confirmMatch.atProperty", { property: s.propertyName })
                                      : t("pages.dashboard.confirmMatch.unassignedSuffix")}
                                  </Button>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatUsd(row.weekly)}
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
                                const prevOccConf = occupants.find((o) => o.id === row.matched.occupantId);
                                const prevConf = {
                                  chargePerBed: prevOccConf?.chargePerBed ?? 0,
                                  billingFrequency: prevOccConf?.billingFrequency ?? "Monthly",
                                  employeeId: prevOccConf?.employeeId ?? "",
                                  company: prevOccConf?.company ?? "",
                                };
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
                                  prev: prevConf,
                                });
                                queryClient.invalidateQueries({
                                  queryKey: getListUnplacedPayrollQueryKey(),
                                });
                              }}
                              data-testid={`button-confirm-low-confidence-${row.personId}`}
                            >
                              {t("pages.dashboard.confirmMatch.confirm")}
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
                <CardTitle>{t("pages.dashboard.recentReconciliations.title")}</CardTitle>
                <span
                  className="text-xs text-muted-foreground ml-auto tabular-nums"
                  data-testid="text-recent-payroll-reconciliations-count"
                >
                  {t("pages.dashboard.recentReconciliations.entryCount", { count: recentReconciliations.length })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t("pages.dashboard.recentReconciliations.helperText")}
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("pages.dashboard.recentReconciliations.occupantHeader")}</TableHead>
                    <TableHead>{t("pages.dashboard.recentReconciliations.newEmployerHeader")}</TableHead>
                    <TableHead className="text-right">{t("pages.dashboard.recentReconciliations.weeklyHeader")}</TableHead>
                    <TableHead>{t("pages.dashboard.recentReconciliations.whenHeader")}</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentReconciliations.map((entry) => {
                    const kindStyle: Record<
                      PayrollReconciliationKind,
                      { label: string; className: string }
                    > = {
                      "cross-employer": {
                        label: t("pages.dashboard.recentReconciliations.kindCrossEmployer"),
                        className:
                          "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200",
                      },
                      typo: {
                        label: t("pages.dashboard.recentReconciliations.kindTypo"),
                        className:
                          "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200",
                      },
                      confirm: {
                        label: t("pages.dashboard.recentReconciliations.kindConfirmed"),
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
                              {t("pages.dashboard.recentReconciliations.unassigned")}
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
                          {formatUsd(entry.weekly)}
                        </TableCell>
                        <TableCell
                          className="text-xs text-muted-foreground"
                          data-testid={`text-recent-reconciliation-when-${entry.occupantId}`}
                        >
                          {formatRelativeTime(t, entry.timestamp)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={undoingReconciliationIds.has(entry.id)}
                            onClick={() => handleUndoReconciliation(entry)}
                            data-testid={`button-undo-reconciliation-${entry.occupantId}`}
                          >
                            <Undo2 className="h-3 w-3 mr-1" />
                            {undoingReconciliationIds.has(entry.id) ? t("pages.dashboard.reconciliation.undoing") : t("pages.dashboard.reconciliation.undo")}
                          </Button>
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
            <CardTitle>{t("pages.dashboard.occupancyCard.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{t("pages.dashboard.occupancyCard.occupied", { count: occupiedBeds })}</span>
                <span>{t("pages.dashboard.occupancyCard.vacant", { count: vacantBeds })}</span>
              </div>
              <Progress value={occupancyRate} className="h-4" />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-top-properties">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              <CardTitle>{t("pages.dashboard.topProperties.title")}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("pages.dashboard.topProperties.sortBy")}</span>
              <Select
                value={topRatingSort}
                onValueChange={(v) => setTopRatingSort(v as TopPropertiesSortKey)}
              >
                <SelectTrigger className="w-44 h-8" data-testid="select-top-rating-sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overall">{t("pages.dashboard.topProperties.overall")}</SelectItem>
                  {RATING_CATEGORIES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>{t(`pages.dashboard.ratings.${c.key}` as const, { defaultValue: c.label })}</SelectItem>
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
                    ? t("pages.dashboard.emptyProperties.title")
                    : t("pages.dashboard.topProperties.noRatingsTitle", { label: sortLabel.toLowerCase() })
                }
                description={
                  properties.length === 0
                    ? t("pages.dashboard.emptyProperties.topRatedDescription")
                    : t("pages.dashboard.topProperties.noRatingsDescription")
                }
                action={
                  <Button asChild data-testid="button-empty-top-rated-cta">
                    <Link href="/properties">
                      {properties.length === 0
                        ? t("pages.dashboard.emptyProperties.addProperty")
                        : t("pages.dashboard.topProperties.ratePropertiesAction")}
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
                    <TableHead>{t("pages.dashboard.topProperties.property")}</TableHead>
                    <TableHead>{t("pages.dashboard.topProperties.customer")}</TableHead>
                    <TableHead>{sortLabel}</TableHead>
                    <TableHead className="text-right">{t("pages.dashboard.topProperties.score")}</TableHead>
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
                          <StarRating value={score} readOnly size="sm" ariaLabel={t("pages.dashboard.topProperties.ratingAriaLabel", { label: sortLabel })} />
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
              <CardTitle>{t("pages.dashboard.financialOverview")}</CardTitle>
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
                  <RechartsTooltip
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
              <CardTitle>{t("dashboardExtra.propertyPerformance")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table containerClassName="max-h-[300px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10 bg-card">{t("dashboardExtra.property")}</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card">{t("dashboardExtra.customer")}</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card">{t("dashboardExtra.occupancy")}</TableHead>
                    <TableHead className="sticky top-0 z-10 bg-card text-right">{t("dashboardExtra.profitLoss")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chartData.length === 0 ? (
                    <EmptyStateRow
                      colSpan={4}
                      icon={Building2}
                      title={
                        properties.length === 0
                          ? t("pages.dashboard.emptyProperties.title")
                          : t("pages.dashboard.performance.noMatchTitle")
                      }
                      description={
                        properties.length === 0
                          ? t("pages.dashboard.emptyProperties.performanceDescription")
                          : t("pages.dashboard.performance.noMatchDescription")
                      }
                      action={
                        <Button asChild data-testid="button-empty-perf-cta">
                          <Link href="/properties">{t("pages.dashboard.emptyProperties.addProperty")}</Link>
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
                              {formatUsd(Math.abs(data.Profit))} {data.Profit >= 0 ? t("pages.dashboard.performance.profitBadge") : t("pages.dashboard.performance.lossBadge")}
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

      <AlertDialog
        open={pendingUndoEntry !== null}
        onOpenChange={(open) => { if (!open) setPendingUndoEntry(null); }}
      >
        <AlertDialogContent data-testid="dialog-confirm-undo-cross-employer">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pages.dashboard.crossEmployer.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingUndoEntry && (
                <Trans
                  i18nKey="pages.dashboard.crossEmployer.confirmDescription"
                  values={{
                    occupant: pendingUndoEntry.occupantName,
                    employer: pendingUndoEntry.employer,
                    prevCompany: pendingUndoEntry.prev.company,
                  }}
                  components={{
                    1: <span className="font-medium" />,
                    3: <span className="font-medium" />,
                    5: <span className="font-medium" />,
                  }}
                />
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-confirm-undo-cross-employer-cancel">
              {t("pages.dashboard.crossEmployer.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-undo-cross-employer-confirm"
              onClick={() => {
                if (pendingUndoEntry) executeUndo(pendingUndoEntry);
                setPendingUndoEntry(null);
              }}
            >
              {t("pages.dashboard.crossEmployer.undoChange")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            <AlertDialogTitle>{t("pages.dashboard.employerMove.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingEmployerMove && (
                <Trans
                  i18nKey={
                    pendingEmployerMove.propertyName
                      ? "pages.dashboard.employerMove.confirmDescriptionWithProperty"
                      : "pages.dashboard.employerMove.confirmDescription"
                  }
                  values={{
                    occupant: pendingEmployerMove.occupantName,
                    from: pendingEmployerMove.fromCompany,
                    to: pendingEmployerMove.toCompany,
                    property: pendingEmployerMove.propertyName ?? "",
                  }}
                  components={{
                    1: <span className="font-medium" />,
                    3: <span className="font-medium" />,
                    5: <span className="font-medium" />,
                    7: <span className="font-medium" />,
                  }}
                />
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-confirm-employer-move-cancel">
              {t("pages.dashboard.employerMove.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-employer-move-confirm"
              onClick={() => {
                const move = pendingEmployerMove;
                if (!move) return;
                const prevOccMove = occupants.find((o) => o.id === move.occupantId);
                const prevCompany = prevOccMove?.company ?? move.fromCompany;
                const prevChargePerBed = prevOccMove?.chargePerBed ?? 0;
                const prevBillingFrequency = prevOccMove?.billingFrequency ?? "Monthly";
                const prevEmployeeId = prevOccMove?.employeeId ?? "";
                const prevChargeSource = prevOccMove?.chargeSource ?? "";
                const prevChargeSourceCustomer = prevOccMove?.chargeSourceCustomer ?? "";
                const prevChargeSourcePersonId = prevOccMove?.chargeSourcePersonId ?? "";
                updateOccupant(move.occupantId, {
                  chargePerBed: move.chargePerBed,
                  billingFrequency: "Weekly",
                  ...(move.employeeId ? { employeeId: move.employeeId } : {}),
                  company: move.toCompany,
                });
                recordPayrollReconciliation({
                  id: `ce::${move.toCompany}::${move.employeeId}::${move.occupantId}::${Date.now()}`,
                  occupantId: move.occupantId,
                  occupantName: move.occupantName,
                  propertyName: move.propertyName,
                  employer: move.toCompany,
                  weekly: move.chargePerBed,
                  kind: "cross-employer",
                  timestamp: Date.now(),
                  prev: {
                    chargePerBed: prevChargePerBed,
                    billingFrequency: prevBillingFrequency,
                    employeeId: prevEmployeeId,
                    company: prevCompany,
                  },
                });
                queryClient.invalidateQueries({
                  queryKey: getListUnplacedPayrollQueryKey(),
                });
                toast({
                  title: t("pages.dashboard.employerMove.movedTitle"),
                  description: t("pages.dashboard.employerMove.movedDescription", {
                    occupant: move.occupantName,
                    employer: move.toCompany,
                  }),
                  action: (
                    <ToastAction
                      altText={t("pages.dashboard.employerMove.undoAltText")}
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
                          title: t("pages.dashboard.employerMove.undoneTitle"),
                          description: t("pages.dashboard.employerMove.undoneDescription", {
                            occupant: move.occupantName,
                            prevCompany,
                          }),
                        });
                      }}
                    >
                      <Undo2 className="h-3 w-3 mr-1" />
                      {t("pages.dashboard.employerMove.undoButton")}
                    </ToastAction>
                  ),
                });
                setPendingEmployerMove(null);
              }}
            >
              {t("pages.dashboard.employerMove.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={digestSecretDialogOpen} onOpenChange={(open) => { setDigestSecretDialogOpen(open); if (!open) setDigestSecret(""); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {digestMode === "dry-run"
                ? t("pages.dashboard.digest.dryRunTitle")
                : t("pages.dashboard.digest.sendTitle")}
            </DialogTitle>
            <DialogDescription>
              {digestMode === "dry-run"
                ? t("pages.dashboard.digest.dryRunDescription")
                : t("pages.dashboard.digest.sendDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="digest-secret">{t("pages.dashboard.digest.adminSecretLabel")}</Label>
            <Input
              id="digest-secret"
              type="password"
              placeholder={t("pages.dashboard.digest.adminSecretPlaceholder")}
              value={digestSecret}
              onChange={(e) => setDigestSecret(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && digestSecret.trim()) handleSendDigestPreview(); }}
              data-testid="input-digest-secret"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDigestSecretDialogOpen(false)}>{t("pages.dashboard.digest.cancel")}</Button>
            <Button onClick={handleSendDigestPreview} disabled={!digestSecret.trim()} data-testid="button-confirm-digest-preview">
              {digestMode === "dry-run" ? (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  {t("pages.dashboard.digest.renderPreview")}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  {t("pages.dashboard.digest.sendNow")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={digestDryRunResult !== null}
        onOpenChange={(open) => { if (!open) setDigestDryRunResult(null); }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" data-testid="dialog-digest-dryrun-preview">
          <DialogHeader>
            <DialogTitle>{t("pages.dashboard.digest.emailPreviewTitle")}</DialogTitle>
            <DialogDescription>
              {t("pages.dashboard.digest.emailPreviewDescription")}
            </DialogDescription>
          </DialogHeader>
          {digestDryRunResult && (
            <div className="grid gap-3 py-2 overflow-y-auto pr-1">
              <div className="grid gap-1 text-sm">
                <Label className="text-xs text-muted-foreground">{t("pages.dashboard.digest.to")}</Label>
                <div className="font-mono text-xs break-all" data-testid="text-digest-preview-to">
                  {digestDryRunResult.email.to.join(", ")}
                </div>
              </div>
              <div className="grid gap-1 text-sm">
                <Label className="text-xs text-muted-foreground">{t("pages.dashboard.digest.subject")}</Label>
                <div className="font-medium" data-testid="text-digest-preview-subject">
                  {digestDryRunResult.email.subject}
                </div>
              </div>
              <div className="grid gap-1 text-sm">
                <Label className="text-xs text-muted-foreground">
                  {t("pages.dashboard.digest.renderedHtml", { count: digestDryRunResult.total })}
                </Label>
                <div
                  className="rounded-md border bg-muted/30 p-3 text-sm prose prose-sm max-w-none [&_a]:text-primary"
                  data-testid="text-digest-preview-html"
                  dangerouslySetInnerHTML={{ __html: digestDryRunResult.email.html }}
                />
              </div>
              <div className="grid gap-1 text-sm">
                <Label className="text-xs text-muted-foreground">{t("pages.dashboard.digest.plainTextBody")}</Label>
                <pre
                  className="rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap font-mono"
                  data-testid="text-digest-preview-text"
                >{digestDryRunResult.email.text}</pre>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDigestDryRunResult(null)} data-testid="button-close-digest-preview">
              {t("pages.dashboard.digest.close")}
            </Button>
            <Button
              onClick={() => {
                setDigestDryRunResult(null);
                openDigestDialog("send");
              }}
              data-testid="button-send-after-preview"
            >
              <Send className="h-4 w-4 mr-2" />
              {t("pages.dashboard.digest.sendNowToRecipients")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
