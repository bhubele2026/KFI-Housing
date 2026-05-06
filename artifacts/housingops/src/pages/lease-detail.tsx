import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useLocation, useSearch } from "wouter";
import { useUnsavedChangesPrompt } from "@/hooks/use-unsaved-changes-prompt";
import { motion } from "framer-motion";
import {
  ChevronLeft, KeyRound, Calendar, AlertTriangle, Briefcase,
  Building2, FileText, CalendarPlus, DollarSign, Trash2,
  Save, Hotel, Plus, ExternalLink, CheckCircle2, ChevronDown,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListRoomNightLogs,
  useCreateRoomNightLog,
  useUpdateRoomNightLog,
  useDeleteRoomNightLog,
  getListRoomNightLogsQueryKey,
} from "@workspace/api-client-react";
import { extractSourcePdfFilename, sourcePdfHref } from "@/lib/lease-source-pdf";

import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import {
  getRenewalInfo,
  type Lease,
  type RentFrequency,
} from "@/data/mockData";

// Same conversion factors used by the property-detail Payment Details card
// so the lease page and property page can never disagree about how many
// weekly payments make up a month.
const RENT_FREQUENCY_FACTOR: Record<RentFrequency, number> = {
  Weekly: 12 / 52,
  "Bi-Weekly": 12 / 26,
  Monthly: 1,
};
const RENT_FREQUENCY_SHORT: Record<RentFrequency, string> = {
  Weekly: "wk",
  "Bi-Weekly": "2-wk",
  Monthly: "mo",
};

/**
 * Read the `?from=` query string used by the leases-table to remember where
 * the user came from. We use this for the breadcrumb / back-link so a
 * lease opened from a Property's Leases tab returns to that property,
 * while a lease opened from the global Leases page returns to /leases.
 *
 * Falls back to "/leases" when no `from` is present (direct nav, refresh,
 * or pasted link).
 */
function useOriginFromSearch(): {
  path: string;
  pathname: string;
  isPropertyOrigin: boolean;
} {
  // wouter's `useLocation` drops the search portion, so we use `useSearch`
  // which subscribes to the live query string via the browser history
  // events (popstate / push / replace). Reading `window.location.search`
  // directly would only sample once per render and miss client-side
  // navigations that change *only* the query string (no path change).
  const search = useSearch();
  const fromRaw = new URLSearchParams(search).get("from");
  const path = fromRaw && fromRaw.startsWith("/") ? fromRaw : "/leases";
  // The `from` value may include its own query string — e.g.
  // `/properties/p1?tab=leases` so the property page reopens on the
  // Leases tab. Split that off so the property-id match below isn't
  // confused by the trailing `?tab=...`. The full `path` is still used
  // verbatim as the back-link href so the tab info survives the round
  // trip.
  const queryIdx = path.indexOf("?");
  const pathname = queryIdx === -1 ? path : path.slice(0, queryIdx);
  return {
    path,
    pathname,
    isPropertyOrigin: pathname.startsWith("/properties/"),
  };
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { RenewLeasePopover } from "@/components/renew-lease-popover";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { NotFoundScreen } from "@/components/not-found-screen";

// We deliberately reuse the inline editors from the Property Detail page so
// every lease field on this page commits with the same save-on-blur +
// optimistic-update pattern that operators are already used to.
import { InlineEdit, NotesEditor } from "@/pages/property-detail";

/**
 * Build the initial draft for the create-mode page (`/leases/new`). All
 * fields use sensible "operator can change anything later" defaults:
 *   • Dates: today → today + 1 year (a typical residential term).
 *   • Amounts: 0 (operators always need to set these explicitly anyway).
 *   • Status: "Upcoming" — rarely is a freshly-typed lease already in
 *     effect, and Upcoming makes the renewal alerts on the leases page
 *     skip it until it actually starts.
 *   • Buyout: off, no clauses, no included items — the operator opts in
 *     to each of those from the same form.
 *
 * The propertyId is seeded from `?propertyId=` so a placeholder click
 * lands with the property pre-selected (and locked, see the property
 * card below).
 */
function makeCreateDraft(propertyId: string): Lease {
  const today = new Date();
  const oneYear = new Date(today);
  oneYear.setFullYear(today.getFullYear() + 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    id: "",
    propertyId,
    startDate: fmt(today),
    endDate: fmt(oneYear),
    monthlyRent: 0,
    securityDeposit: 0,
    status: "Upcoming",
    notes: "",
    clauses: "",
    buyoutAvailable: false,
    buyoutCost: null,
    rateType: "monthly",
    nightlyRate: 0,
    guaranteedRooms: 0,
    monthlyRoomNightMin: 0,
    longStayTaxExempt: false,
    customerResponsibleForRent: false,
  };
}

/**
 * Room-night log editor — list + add/delete entries for a hotel-rate lease.
 * Entries are stored against the lease via the `/room-night-logs` API
 * (added with task #299). We keep the UI deliberately simple: one row per
 * (month, nights, notes) record so staff can just type the month and the
 * number of nights consumed.
 */
function RoomNightLogSection({
  leaseId,
  monthlyRoomNightMin,
}: {
  leaseId: string;
  monthlyRoomNightMin: number;
}) {
  const queryClient = useQueryClient();
  const logsQuery = useListRoomNightLogs();
  const createLog = useCreateRoomNightLog();
  const updateLog = useUpdateRoomNightLog();
  const deleteLog = useDeleteRoomNightLog();

  const allLogs = logsQuery.data ?? [];
  const logs = useMemo(
    () =>
      allLogs
        .filter((l) => l.leaseId === leaseId)
        .slice()
        .sort((a, b) => (a.month < b.month ? 1 : -1)),
    [allLogs, leaseId],
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListRoomNightLogsQueryKey() });

  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [draftMonth, setDraftMonth] = useState(defaultMonth);
  const [draftNights, setDraftNights] = useState("");
  const [draftNotes, setDraftNotes] = useState("");

  const handleAdd = async () => {
    const nights = parseInt(draftNights, 10);
    if (!/^\d{4}-\d{2}$/.test(draftMonth) || !Number.isFinite(nights)) return;
    await createLog.mutateAsync({
      data: {
        id: `rnl-${leaseId}-${draftMonth}-${Date.now()}`,
        leaseId,
        month: draftMonth,
        roomNights: nights,
        notes: draftNotes,
      },
    });
    setDraftNights("");
    setDraftNotes("");
    void invalidate();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Room-Night Log
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3" data-testid="room-night-log-section">
        <p className="text-xs text-muted-foreground">
          Record actual revenue-producing room-nights consumed each month.
          {monthlyRoomNightMin > 0
            ? ` Minimum is ${monthlyRoomNightMin} nights/month — months below this are flagged.`
            : ""}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col">
            <Label htmlFor="rnl-month" className="text-xs text-muted-foreground">Month</Label>
            <Input
              id="rnl-month"
              type="month"
              value={draftMonth}
              onChange={(e) => setDraftMonth(e.target.value)}
              className="h-8 w-36"
              data-testid="input-rnl-month"
            />
          </div>
          <div className="flex flex-col">
            <Label htmlFor="rnl-nights" className="text-xs text-muted-foreground">Nights</Label>
            <Input
              id="rnl-nights"
              type="number"
              min={0}
              value={draftNights}
              onChange={(e) => setDraftNights(e.target.value)}
              className="h-8 w-24"
              data-testid="input-rnl-nights"
            />
          </div>
          <div className="flex flex-col grow min-w-[160px]">
            <Label htmlFor="rnl-notes" className="text-xs text-muted-foreground">Notes</Label>
            <Input
              id="rnl-notes"
              value={draftNotes}
              onChange={(e) => setDraftNotes(e.target.value)}
              className="h-8"
              placeholder="Optional"
              data-testid="input-rnl-notes"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleAdd}
            disabled={createLog.isPending || draftNights === ""}
            data-testid="button-add-rnl"
          >
            <Plus className="h-3 w-3 mr-1" /> Log
          </Button>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No entries yet.</p>
        ) : (
          <div className="space-y-1">
            {logs.map((log) => {
              const belowMin =
                monthlyRoomNightMin > 0 && log.roomNights < monthlyRoomNightMin;
              return (
                <div
                  key={log.id}
                  className="flex items-center justify-between gap-2 py-1 border-b border-dashed border-border/40 text-sm"
                  data-testid={`rnl-row-${log.id}`}
                >
                  <span className="font-mono w-20 shrink-0">{log.month}</span>
                  <InlineEdit
                    value={log.roomNights}
                    type="number"
                    onSave={async (v) => {
                      await updateLog.mutateAsync({
                        id: log.id,
                        data: { roomNights: parseInt(v, 10) || 0 },
                      });
                      void invalidate();
                    }}
                    testId={`inline-rnl-nights-${log.id}`}
                  />
                  {belowMin && (
                    <Badge variant="destructive" className="text-[10px]">Below min</Badge>
                  )}
                  <span className="grow text-xs text-muted-foreground truncate" title={log.notes}>
                    {log.notes}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={async () => {
                      await deleteLog.mutateAsync({ id: log.id });
                      void invalidate();
                    }}
                    data-testid={`button-delete-rnl-${log.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Inline preview of the lease's source PDF — collapsed by default so the
 * lease page stays compact, expandable when an operator wants to compare
 * the record against the original document line-by-line (Task #325).
 *
 * The browser's native PDF viewer renders the embedded `<iframe>`, which
 * works for every PDF served from `/api/attached-assets/:filename`. We
 * defer mounting the iframe until the section is opened the first time
 * so closed cards never trigger a download.
 *
 * Missing-file fallback: the api-server returns a JSON 404 when the file
 * isn't on disk; rendering that JSON inside the iframe would be ugly, so
 * we HEAD-check on first open and swap in a small "file not found" notice
 * instead. The "View source PDF" link in the page header is unchanged
 * either way so operators always have an out.
 */
function LeaseSourcePdfPreview({ filename }: { filename: string }) {
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [missing, setMissing] = useState<boolean | null>(null);
  const href = sourcePdfHref(filename);

  useEffect(() => {
    if (!hasOpened) return;
    if (missing !== null) return;
    let cancelled = false;
    fetch(href, { method: "HEAD" })
      .then((res) => {
        if (cancelled) return;
        setMissing(!res.ok);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hasOpened, href, missing]);

  return (
    <Card data-testid="card-lease-source-pdf-preview">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Source PDF Preview
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1.5 h-7"
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => {
                const next = !o;
                if (next) setHasOpened(true);
                return next;
              });
            }}
            data-testid="button-toggle-source-pdf-preview"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
            {open ? "Hide" : "Show"}
          </Button>
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent>
          <p
            className="text-xs text-muted-foreground mb-2 truncate"
            title={filename}
          >
            {filename}
          </p>
          {missing === true ? (
            <div
              className="rounded border border-dashed border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground"
              data-testid="text-source-pdf-missing"
            >
              The source PDF is no longer available on disk. The link in the
              page header will also fail until the file is restored.
            </div>
          ) : missing === null ? (
            // Hold the slot at the same height as the iframe while the HEAD
            // check is in flight. Without this, the iframe would render
            // first and could briefly display the api-server's JSON 404
            // payload before the fallback message swaps in.
            <Skeleton
              className="w-full h-[70vh] rounded"
              data-testid="skeleton-source-pdf"
            />
          ) : (
            <iframe
              src={href}
              title={`Source PDF: ${filename}`}
              className="w-full h-[70vh] rounded border border-border bg-muted"
              data-testid="iframe-source-pdf"
            />
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function LeaseDetail() {
  // useParams returns `{}` for the `/leases/new` route (registered separately
  // in App.tsx with no `:id` segment), so an undefined id flips us into
  // create mode. The same component handles both surfaces because the form
  // layout, field editors, and back-link logic are identical — only the
  // commit path differs (local draft + Save vs. optimistic per-field save).
  const { id } = useParams<{ id?: string }>();
  const isCreateMode = !id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const {
    leases, properties, customers, isLoading,
    updateLease, addLease, deleteLease,
  } = useData();

  // ?propertyId= locks the create form to a single property. Used when the
  // user lands here from a placeholder row on a Property's Leases tab —
  // re-picking the property would be confusing and risky in that flow.
  // Subscribe to the live query string via wouter's `useSearch` so that
  // any client-side navigation that changes the query (without changing
  // the path) is reflected here — including a future "switch property"
  // link on this same page.
  const search = useSearch();
  const requestedPropertyId = useMemo(
    () => new URLSearchParams(search).get("propertyId") ?? "",
    [search],
  );
  // `?focus=rent` is set by the leases-table "Fix" quick-action on flagged
  // leases (task #301). When present we open the rent inline editor on
  // mount and scroll it into view so the operator lands ready to type the
  // corrected weekly cost (which the lease stores as a derived monthly
  // amount). Read once at mount — re-reading on query changes would
  // re-focus mid-edit if the URL is rewritten elsewhere.
  const initialFocusFieldRef = useRef<string | null>(
    new URLSearchParams(search).get("focus"),
  );
  const focusRentOnMount = initialFocusFieldRef.current === "rent";
  const rentRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focusRentOnMount) return;
    if (!rentRowRef.current) return;
    rentRowRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusRentOnMount]);

  // Pending property re-attachment requires explicit confirm. We hold the
  // candidate id here while the AlertDialog is open and clear it on close.
  // (Edit-mode only: in create mode there's no committed lease to "move",
  // so property changes apply directly to the draft.)
  const [pendingPropertyId, setPendingPropertyId] = useState<string | null>(null);

  // Local draft used for create mode. Lazy-initialized once with the
  // ?propertyId= query value so a placeholder click pre-fills the form.
  const [draft, setDraft] = useState<Lease>(() => makeCreateDraft(requestedPropertyId));

  // Tracks whether the operator has touched ANY field on the create form.
  // Flipped to `true` from `applyUpdate` (the single funnel every field
  // editor writes through) so we don't have to instrument each editor
  // individually. The stale-propertyId scrub effect below deliberately
  // bypasses this — that mutation is system-driven, not user-driven, and
  // shouldn't arm the unsaved-changes guard.
  const [isDirty, setIsDirty] = useState(false);

  // One-shot bypass for the post-save replace navigation. Set to true from
  // `saveCreate` immediately before `navigate(...)` so the unsaved-changes
  // prompt doesn't fire on the redirect from /leases/new → /leases/<newId>.
  const { bypassNextNavigation } = useUnsavedChangesPrompt(
    isCreateMode && isDirty,
  );

  // Resolve the locked property only if `?propertyId=` actually refers to a
  // known property. If the operator hand-edits the URL with a bogus id we
  // want to *fall back* to the picker so they can't save an orphaned lease
  // bound to a non-existent property. While the data store is still loading
  // we trust the requested id (avoids a flicker between "locked" and
  // "unlocked" on first render); the worst case there is the picker
  // appearing one render later, which is the same UX as the unlocked path.
  const lockedPropertyId = useMemo(() => {
    if (!requestedPropertyId) return "";
    if (isLoading) return requestedPropertyId;
    return properties.some((p) => p.id === requestedPropertyId)
      ? requestedPropertyId
      : "";
  }, [requestedPropertyId, isLoading, properties]);

  const realLease = useMemo(
    () => (isCreateMode ? undefined : leases.find((l) => l.id === id)),
    [isCreateMode, leases, id],
  );

  // `lease` is the working object every renderer below reads from. In edit
  // mode it points at the persisted lease; in create mode it's the local
  // draft. Both shapes are the same `Lease` type so the form code is
  // identical.
  const lease = isCreateMode ? draft : realLease;

  // If the lock falls through because the requested property doesn't
  // exist, scrub the stale value out of the draft so the Select picker
  // renders with no selection (rather than displaying a phantom value
  // it has no option for) and the operator is forced to pick a real
  // property before Save can succeed. The `draft.propertyId ===
  // requestedPropertyId` guard is critical: it ensures we only ever
  // scrub the *original* bogus seed value. Once the operator picks a
  // real property from the picker, draft.propertyId moves off of the
  // requested id and this effect goes quiet — otherwise it would
  // re-fire on every re-render and clobber every selection the
  // operator makes.
  useEffect(() => {
    if (!isCreateMode) return;
    if (isLoading) return;
    if (!requestedPropertyId) return;
    if (lockedPropertyId) return;
    if (draft.propertyId !== requestedPropertyId) return;
    setDraft((d) => ({ ...d, propertyId: "" }));
  }, [isCreateMode, isLoading, requestedPropertyId, lockedPropertyId, draft.propertyId]);

  // Keep the draft's propertyId in sync with the *live* locked property.
  // The draft is seeded once at mount from `?propertyId=`, but `useSearch`
  // makes `requestedPropertyId` (and therefore `lockedPropertyId`) re-derive
  // whenever the query string changes — e.g. a future "switch property"
  // link on this page that updates the URL while staying on /leases/new.
  // Without this effect the locked panel and the header would re-render
  // against the new property while `draft.propertyId` (and the eventual
  // saved lease) silently kept the original id.
  //
  // We only sync when the lock actually resolves to a real property
  // (lockedPropertyId is non-empty); when the lock falls through, the
  // scrub-effect above takes over instead so the picker can show. We also
  // don't touch draft.propertyId when there's no lock at all, so any
  // selection the operator made from the picker (after a bogus-id
  // fallback, or with no `?propertyId=` in the URL) is preserved.
  useEffect(() => {
    if (!isCreateMode) return;
    if (!lockedPropertyId) return;
    if (draft.propertyId === lockedPropertyId) return;
    setDraft((d) => ({ ...d, propertyId: lockedPropertyId }));
  }, [isCreateMode, lockedPropertyId, draft.propertyId]);

  const property = useMemo(
    () => (lease ? properties.find((p) => p.id === lease.propertyId) : undefined),
    [lease, properties],
  );
  const customer = useMemo(
    () => (property ? customers.find((c) => c.id === property.customerId) : undefined),
    [property, customers],
  );

  // Derived monthly buyout cost / renewal info. Recomputed each render off
  // `lease`, so as soon as an optimistic update settles into the cache the
  // header re-renders with the new numbers.
  const renewal = lease ? getRenewalInfo(lease.endDate) : null;

  // Resolve the back-link target from the `?from=` query string written by
  // leases-table when the lease was opened. A lease opened from a
  // property's Leases tab returns to that property; a lease opened from
  // the global Leases page returns to /leases. Falls back to /leases on
  // direct nav.
  const origin = useOriginFromSearch();
  const originProperty = origin.isPropertyOrigin
    ? properties.find((p) => `/properties/${p.id}` === origin.pathname)
    : undefined;
  const backLabel = origin.isPropertyOrigin
    ? originProperty
      ? `Back to ${originProperty.name}`
      : "Back to property"
    : "Back to Leases";

  // Property's billing frequency (Weekly / Bi-Weekly / Monthly). The lease
  // always stores rent as a monthly amount, but operators expect to see the
  // figure in the same cadence as the rest of the property — otherwise the
  // number on this page won't match the number on the property page.
  const propertyFrequency: RentFrequency =
    (property?.rentFrequency as RentFrequency | undefined) ?? "Monthly";
  const frequencyFactor = RENT_FREQUENCY_FACTOR[propertyFrequency];
  const monthlyRent = lease?.monthlyRent ?? 0;
  const rentInPropertyFrequency =
    Math.round(monthlyRent * frequencyFactor * 100) / 100;

  // Field-update helper. ONE branch between create and edit lives here so
  // every field editor below stays mode-agnostic: just call
  // `applyUpdate({ field: value })` and the right thing happens.
  //
  // In create mode this is also where the dirty flag flips on, so the
  // unsaved-changes guard arms as soon as the operator touches anything.
  const applyUpdate = (updates: Partial<Lease>) => {
    if (isCreateMode) {
      setDraft((d) => ({ ...d, ...updates }));
      setIsDirty(true);
    } else if (realLease) {
      updateLease(realLease.id, updates);
    }
  };

  // Reset the pending-confirm state if the user navigates between leases
  // while a dialog is open — guards against confirming a re-attach against
  // the wrong lease.
  useEffect(() => {
    setPendingPropertyId(null);
  }, [id]);

  if (!isCreateMode && isLoading && !realLease) {
    return (
      <MainLayout>
        <div className="p-8 max-w-5xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </MainLayout>
    );
  }

  if (!isCreateMode && !realLease) {
    return (
      <MainLayout>
        <NotFoundScreen
          title="Lease not found"
          description="This lease may have been deleted. Head back to the dashboard or pick another lease from the list."
          secondary={{
            label: backLabel,
            href: origin.path,
            testId: "button-back-to-leases",
          }}
          testId="lease-detail-not-found"
        />
      </MainLayout>
    );
  }

  // After the early returns above, `lease` is guaranteed defined: edit mode
  // returns early if `realLease` is missing; create mode always has the
  // local draft. This narrowing keeps every JSX site below safe to read
  // `lease.x` directly.
  if (!lease) return null;

  const confirmReattach = () => {
    if (!pendingPropertyId || !realLease) return;
    const targetProperty = properties.find((p) => p.id === pendingPropertyId);
    updateLease(realLease.id, { propertyId: pendingPropertyId });
    setPendingPropertyId(null);
    toast({
      title: "Lease moved",
      description: targetProperty
        ? `Now attached to ${targetProperty.name}.`
        : "Property re-attached.",
    });
  };

  // Save handler for create mode. Validates the minimum-viable lease (a
  // property + start/end dates), generates the id locally so we can navigate
  // straight to the edit page after the optimistic insert, and threads the
  // `?from=` origin through so "Back" still returns to the surface the
  // operator came from.
  const saveCreate = () => {
    // Two failure modes both surface the same toast: an empty draft
    // (operator never picked a property) and a stale draft (the
    // ?propertyId= the page mounted with no longer matches anything in
    // the data store — e.g. hand-edited URL or a property deleted in
    // another tab). The lock fallback drops the picker in front of the
    // operator in that case but the draft still carries the original
    // bogus id, so we *must* re-check at save time to avoid persisting
    // an orphaned lease that nothing in the rest of the app can render.
    const propertyExists =
      !!draft.propertyId &&
      properties.some((p) => p.id === draft.propertyId);
    if (!propertyExists) {
      toast({
        title: "Pick a property first",
        description: "Choose which property this lease covers before saving.",
        variant: "destructive",
      });
      return;
    }
    if (!draft.startDate || !draft.endDate) {
      toast({
        title: "Set start and end dates",
        description: "Both dates are required to save the lease.",
        variant: "destructive",
      });
      return;
    }
    const newId = `l-${Date.now()}`;
    addLease({ ...draft, id: newId });
    toast({
      title: "Lease created",
      description: property ? `Saved a new lease for ${property.name}.` : undefined,
    });
    // `replace: true` so the browser Back button skips the create form
    // (which would otherwise re-open with a fresh empty draft).
    const fromQs = origin.path && origin.path !== "/leases"
      ? `?from=${encodeURIComponent(origin.path)}`
      : "";
    // Skip the unsaved-changes prompt for THIS navigation only — the
    // operator just hit Save, the draft is now persisted, and the
    // "discard?" dialog would be a confusing false positive on the
    // success path. The bypass is one-shot, so any subsequent
    // navigation in a different flow is still guarded.
    bypassNextNavigation();
    navigate(`/leases/${newId}${fromQs}`, { replace: true });
  };

  return (
    <MainLayout>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="p-8 max-w-5xl mx-auto space-y-6"
      >
        {/* Breadcrumb — first crumb adapts to where the user came from. */}
        <div className="flex items-center gap-3 text-sm">
          <Link href={origin.path}>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground hover:text-foreground"
              data-testid="button-back-leases"
            >
              <ChevronLeft className="h-4 w-4" />
              {backLabel}
            </Button>
          </Link>
          <span className="text-muted-foreground">/</span>
          {property ? (
            <Link href={`/properties/${property.id}`}>
              <button
                type="button"
                className="font-medium hover:underline"
                data-testid="link-lease-property"
              >
                {property.name}
              </button>
            </Link>
          ) : (
            <span className="italic text-muted-foreground">Unattached</span>
          )}
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">{isCreateMode ? "New" : "Lease"}</span>
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <KeyRound className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="lease-detail-title">
                {isCreateMode ? "New lease" : "Lease"} — {property ? property.name : isCreateMode ? "Pick a property" : "Unattached"}
              </h1>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                <Calendar className="h-3.5 w-3.5" />
                {lease.startDate || "—"} → {lease.endDate || "—"}
              </p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge
                  variant={
                    lease.status === "Active"
                      ? "default"
                      : lease.status === "Expired"
                      ? "destructive"
                      : "secondary"
                  }
                  data-testid="badge-lease-status"
                >
                  {lease.status}
                </Badge>
                {renewal && renewal.level !== "ok" && (
                  <Badge
                    variant="outline"
                    className={`text-xs font-medium ${renewal.badgeClass}`}
                    data-testid="badge-lease-renewal"
                  >
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {renewal.label}
                  </Badge>
                )}
                {customer && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <Briefcase className="h-3 w-3" />
                    {customer.name}
                  </Badge>
                )}
                {!isCreateMode && lease.needsReview && (
                  <Badge
                    variant="outline"
                    className="gap-1 text-[11px] font-medium border-amber-300 bg-amber-50 text-amber-800"
                    data-testid="badge-lease-needs-review"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Needs review
                  </Badge>
                )}
                {(lease.customerResponsibleForRent ?? false) && (
                  // Corporate-responsibility badge (task #313). Mirrors the
                  // pill on the leases table so operators recognize the
                  // same signal regardless of where they opened the lease.
                  <Badge
                    variant="outline"
                    className="text-xs gap-1 border-indigo-300 bg-indigo-50 text-indigo-800"
                    title="The customer (not the occupant) is on the hook for rent, utilities, and damages on this lease."
                    data-testid="badge-lease-customer-responsible"
                  >
                    <Briefcase className="h-3 w-3" />
                    {customer ? `${customer.name} pays` : "Customer pays"}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/*
              "View source PDF" — every seeded lease records the original
              PDF filename in its notes/clauses (e.g. `Source:
              Lease_-1331_..._kfi-staff_1778107848648.pdf`). Surface a
              one-click link to the api-server's attached-assets endpoint
              so audits don't require digging through the workspace by
              hand (Task #308). Hidden when no source is recorded.
            */}
            {!isCreateMode && (() => {
              const sourcePdf = extractSourcePdfFilename(lease.notes, lease.clauses);
              if (!sourcePdf) return null;
              return (
                <a
                  href={sourcePdfHref(sourcePdf)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="link-lease-source-pdf"
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    title={sourcePdf}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    View source PDF
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </Button>
                </a>
              );
            })()}
            {isCreateMode ? (
              // Create mode: a single "Save lease" CTA replaces Renew + Delete
              // since neither makes sense before the lease exists. The button
              // is wired to the same validation + addLease + navigate flow
              // tested in lease-detail.test.tsx.
              <Button
                size="sm"
                onClick={saveCreate}
                data-testid="button-save-new-lease"
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                Save lease
              </Button>
            ) : (
              <>
                {lease.needsReview && (
                  // Explicit "Mark as reviewed" action so operators can clear
                  // the importer-set flag once they've corrected the data.
                  // Without this, the badge only goes away by editing the
                  // underlying `needsReview` field — which the UI never
                  // exposed — so flagged leases lingered forever (Task #317).
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
                    onClick={() => {
                      if (!realLease) return;
                      // Route through the same applyUpdate funnel every other
                      // editor on this page uses so the optimistic-save path
                      // and dirty-flag bookkeeping stay consistent.
                      applyUpdate({ needsReview: false });
                      toast({
                        title: "Marked as reviewed",
                        description: "The 'Needs review' flag has been cleared.",
                      });
                    }}
                    data-testid="button-mark-lease-reviewed"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Mark as reviewed
                  </Button>
                )}
                <RenewLeasePopover
                  currentEndDate={lease.endDate}
                  currentStatus={lease.status}
                  propertyName={property?.name}
                  onRenew={(newEndDate, newStatus) =>
                    applyUpdate({ endDate: newEndDate, status: newStatus })
                  }
                  trigger={
                    <Button size="sm" variant="outline" className="gap-1" data-testid="button-renew-lease">
                      <CalendarPlus className="h-3.5 w-3.5" />
                      Renew
                    </Button>
                  }
                />
                <ConfirmDeleteButton
                  title="Delete this lease?"
                  description="This permanently removes the lease record. You can't undo this."
                  onConfirm={() => {
                    if (realLease) {
                      deleteLease(realLease.id);
                      toast({ title: "Lease deleted" });
                      navigate("/leases");
                    }
                  }}
                  testId="dialog-confirm-delete-lease-detail"
                  trigger={
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      data-testid="button-delete-lease-detail"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Delete
                    </Button>
                  }
                />
              </>
            )}
          </div>
        </div>

        {/* Two-column form layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Source PDF inline preview (spans both columns when open) ── */}
          {!isCreateMode && (() => {
            const sourcePdf = extractSourcePdfFilename(lease.notes, lease.clauses);
            if (!sourcePdf) return null;
            return (
              <div className="lg:col-span-2">
                <LeaseSourcePdfPreview filename={sourcePdf} />
              </div>
            );
          })()}

          {/* ── Lease Terms ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Lease Terms
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                <span className="text-sm text-muted-foreground w-40 shrink-0">Start Date</span>
                <InlineEdit
                  value={lease.startDate}
                  type="date"
                  onSave={(v) => applyUpdate( { startDate: v })}
                  testId="inline-lease-start"
                />
              </div>
              <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                <span className="text-sm text-muted-foreground w-40 shrink-0">End Date</span>
                <InlineEdit
                  value={lease.endDate}
                  type="date"
                  onSave={(v) => applyUpdate( { endDate: v })}
                  testId="inline-lease-end"
                />
              </div>
              <div
                className="flex items-center justify-between py-1 border-b border-dashed border-border/50"
                ref={rentRowRef}
                data-testid="lease-rent-row"
              >
                <span className="text-sm text-muted-foreground w-40 shrink-0">Rent (monthly)</span>
                <div className="flex items-center gap-2">
                  <InlineEdit
                    value={lease.monthlyRent}
                    prefix="$"
                    type="number"
                    startEditing={focusRentOnMount}
                    onSave={(v) =>
                      applyUpdate( { monthlyRent: parseFloat(v) || 0 })
                    }
                    testId="inline-lease-rent"
                  />
                  {/*
                    Property's billing cadence — show the equivalent amount
                    when the property is billed Weekly / Bi-Weekly so the
                    figure here matches what the operator sees on the
                    property page (which displays in the property's
                    frequency). Hidden for Monthly properties since the two
                    numbers are identical.
                  */}
                  {propertyFrequency !== "Monthly" && (
                    <span
                      className="text-xs text-muted-foreground tabular-nums"
                      data-testid="lease-rent-frequency-equivalent"
                      title={`Property bills ${propertyFrequency.toLowerCase()}`}
                    >
                      ≈ ${rentInPropertyFrequency.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                      /{RENT_FREQUENCY_SHORT[propertyFrequency]}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                <span className="text-sm text-muted-foreground w-40 shrink-0">Security Deposit</span>
                <InlineEdit
                  value={lease.securityDeposit}
                  prefix="$"
                  type="number"
                  onSave={(v) => applyUpdate( { securityDeposit: parseFloat(v) || 0 })}
                  testId="inline-lease-deposit"
                />
              </div>
              <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                <span className="text-sm text-muted-foreground w-40 shrink-0">Status</span>
                <Select
                  value={lease.status}
                  onValueChange={(v) =>
                    applyUpdate( { status: v as typeof lease.status })
                  }
                >
                  <SelectTrigger className="h-7 text-sm w-36" data-testid="select-lease-status-detail">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Expired">Expired</SelectItem>
                    <SelectItem value="Upcoming">Upcoming</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="py-1">
                <span className="text-sm text-muted-foreground block mb-1">Notes</span>
                <NotesEditor
                  value={lease.notes}
                  className="text-sm min-h-[72px]"
                  onSave={(v) => applyUpdate( { notes: v })}
                />
              </div>
            </CardContent>
          </Card>

          {/* ── Property Attachment ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Property
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3" data-testid="lease-property-card">
              <p className="text-xs text-muted-foreground">
                {isCreateMode
                  ? lockedPropertyId
                    ? "This lease will be attached to the property below. Open the lease detail page later to re-attach if needed."
                    : "Choose the property this lease covers."
                  : "Choose the property this lease covers. Re-attaching always asks you to confirm — the rent / deposit on the lease come along with it, but bed assignments stay on the original property."}
              </p>
              {/*
                Lock fell through: `?propertyId=` was present but didn't
                resolve to a real property (deleted, hand-edited URL,
                stale bookmark, or a link shared between users with
                different scopes). Without this notice the operator just
                sees the picker with nothing pre-selected and has to
                guess why their click-through didn't carry over. Once
                they pick a property the notice disappears, since the
                situation is resolved.
              */}
              {isCreateMode &&
                requestedPropertyId &&
                !lockedPropertyId &&
                !lease.propertyId && (
                  <div
                    className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2"
                    data-testid="lease-property-missing-notice"
                    role="status"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      The property you were creating a lease for was not
                      found — pick another property below.
                    </span>
                  </div>
                )}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Attached property</Label>
                {isCreateMode && lockedPropertyId ? (
                  // Locked-mode display: render a plain non-interactive panel
                  // so the operator can see (but not change) the bound
                  // property. We deliberately do NOT use a disabled Select —
                  // its trigger still grabs focus on tab and confuses
                  // screen readers about what is editable.
                  <div
                    className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium"
                    data-testid="lease-property-locked"
                  >
                    {property ? property.name : "Unknown property"}
                    {property?.address && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {property.address}
                      </span>
                    )}
                  </div>
                ) : (
                  <Select
                    value={lease.propertyId}
                    onValueChange={(v) => {
                      if (v === lease.propertyId) return;
                      // Create mode applies the change directly — there's no
                      // committed lease to "move" yet, so the confirm dialog
                      // would just be noise.
                      if (isCreateMode) {
                        applyUpdate({ propertyId: v });
                      } else {
                        setPendingPropertyId(v);
                      }
                    }}
                  >
                    <SelectTrigger
                      className="text-sm"
                      data-testid="select-lease-property"
                    >
                      <SelectValue placeholder="Choose a property" />
                    </SelectTrigger>
                    <SelectContent>
                      {properties.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          No properties yet.
                        </div>
                      ) : (
                        properties.map((p) => {
                          const owner = customers.find((c) => c.id === p.customerId);
                          // Show name + address + customer so operators can
                          // disambiguate two units at the same complex (same
                          // owner) — and two units with the same name across
                          // different owners. The address is the most
                          // discriminating field, so it sits between the two
                          // human-readable names.
                          const parts = [p.name];
                          if (p.address) parts.push(p.address);
                          if (owner) parts.push(owner.name);
                          const label = parts.join(" — ");
                          return (
                            <SelectItem key={p.id} value={p.id}>
                              {label}
                            </SelectItem>
                          );
                        })
                      )}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {property && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    {property.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {property.address}, {property.city}, {property.state} {property.zip}
                  </div>
                  {customer && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Briefcase className="h-3 w-3" />
                      {customer.name}
                    </div>
                  )}
                  <Link href={`/properties/${property.id}`}>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline mt-1"
                      data-testid="link-open-property"
                    >
                      Open property →
                    </button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Clauses (free-form text) ── */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Clauses
              </CardTitle>
            </CardHeader>
            <CardContent>
              <NotesEditor
                value={lease.clauses ?? ""}
                className="text-sm min-h-[120px] font-mono"
                onSave={(v) => applyUpdate( { clauses: v })}
              />
            </CardContent>
          </Card>

          {/* ── Hotel / Room-Night Agreement ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Hotel className="h-4 w-4" />
                Hotel / Room-Night Agreement
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <Label htmlFor="rate-type" className="text-sm">
                    Rate type
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    Switch to "Room-night" for hotel-rate agreements like a motel block.
                  </span>
                </div>
                <Select
                  value={lease.rateType ?? "monthly"}
                  onValueChange={(v) =>
                    applyUpdate({ rateType: v as "monthly" | "room-night" })
                  }
                >
                  <SelectTrigger className="h-7 text-sm w-40" data-testid="select-rate-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="room-night">Room-night</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {(lease.rateType ?? "monthly") === "room-night" && (
                <div className="space-y-3 pt-2 border-t border-dashed border-border/50">
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm text-muted-foreground w-44 shrink-0">Nightly rate</span>
                    <InlineEdit
                      value={lease.nightlyRate ?? 0}
                      prefix="$"
                      type="number"
                      onSave={(v) => applyUpdate({ nightlyRate: parseFloat(v) || 0 })}
                      testId="inline-nightly-rate"
                    />
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm text-muted-foreground w-44 shrink-0">Guaranteed rooms</span>
                    <InlineEdit
                      value={lease.guaranteedRooms ?? 0}
                      type="number"
                      onSave={(v) => applyUpdate({ guaranteedRooms: parseInt(v, 10) || 0 })}
                      testId="inline-guaranteed-rooms"
                    />
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm text-muted-foreground w-44 shrink-0">Monthly room-night min</span>
                    <InlineEdit
                      value={lease.monthlyRoomNightMin ?? 0}
                      type="number"
                      onSave={(v) => applyUpdate({ monthlyRoomNightMin: parseInt(v, 10) || 0 })}
                      testId="inline-monthly-room-night-min"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 py-1">
                    <div className="flex flex-col">
                      <Label htmlFor="long-stay-tax-exempt" className="text-sm">
                        Long Stay (30+ day) tax exempt
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        Stays of 30+ consecutive nights are exempt from lodging tax.
                      </span>
                    </div>
                    <Switch
                      id="long-stay-tax-exempt"
                      checked={lease.longStayTaxExempt ?? false}
                      onCheckedChange={(checked) =>
                        applyUpdate({ longStayTaxExempt: checked })
                      }
                      data-testid="switch-long-stay-tax-exempt"
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Room-Night Log (only meaningful for hotel-rate leases) ── */}
          {!isCreateMode && (lease.rateType ?? "monthly") === "room-night" && (
            <RoomNightLogSection
              leaseId={lease.id}
              monthlyRoomNightMin={lease.monthlyRoomNightMin ?? 0}
            />
          )}

          {/* ── Buyout ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Buyout Option
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <Label htmlFor="buyout-available" className="text-sm">
                    Buyout available
                  </Label>
                  <span className="text-xs text-muted-foreground">
                    Tenant can exit early by paying a fixed fee.
                  </span>
                </div>
                <Switch
                  id="buyout-available"
                  checked={lease.buyoutAvailable ?? false}
                  onCheckedChange={(checked) => {
                    // Clearing the buyout cost when the toggle goes off keeps
                    // the data tidy (no orphan cost on a non-buyout lease).
                    applyUpdate( {
                      buyoutAvailable: checked,
                      buyoutCost: checked ? lease.buyoutCost ?? null : null,
                    });
                  }}
                  data-testid="switch-buyout-available"
                />
              </div>
              {(lease.buyoutAvailable ?? false) && (
                <div className="flex items-center justify-between py-1 border-t border-dashed border-border/50 pt-3">
                  <span className="text-sm text-muted-foreground w-40 shrink-0">Buyout Cost</span>
                  <InlineEdit
                    value={
                      lease.buyoutCost == null ? "" : String(lease.buyoutCost)
                    }
                    prefix="$"
                    type="number"
                    placeholder="Set buyout cost"
                    onSave={(v) => {
                      const trimmed = v.trim();
                      const next = trimmed === "" ? null : parseFloat(trimmed);
                      applyUpdate( {
                        buyoutCost: Number.isFinite(next as number) ? (next as number) : null,
                      });
                    }}
                    testId="inline-buyout-cost"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* Re-attachment confirm */}
      <AlertDialog
        open={pendingPropertyId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPropertyId(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-confirm-reattach">
          <AlertDialogHeader>
            <AlertDialogTitle>Move this lease to another property?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const target = properties.find((p) => p.id === pendingPropertyId);
                const targetName = target?.name ?? "the new property";
                return (
                  <>
                    The lease's rent, dates, and other terms will follow it to{" "}
                    <span className="font-semibold">{targetName}</span>. Bed
                    assignments stay on the original property.
                  </>
                );
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reattach">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmReattach}
              data-testid="button-confirm-reattach"
            >
              Move lease
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
