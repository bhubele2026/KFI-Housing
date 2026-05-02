import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useUnsavedChangesPrompt } from "@/hooks/use-unsaved-changes-prompt";
import { motion } from "framer-motion";
import {
  ChevronLeft, KeyRound, Calendar, AlertTriangle, Briefcase,
  Building2, FileText, ListChecks, CalendarPlus, DollarSign, Trash2,
  CheckCircle2, Plus, Save,
} from "lucide-react";

import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import {
  getRenewalInfo,
  INCLUDED_ITEM_SUGGESTIONS,
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
  // wouter's location string drops the search portion, so we read from
  // window.location directly. This is safe at render time because the
  // browser's location is the source of truth.
  const search = typeof window !== "undefined" ? window.location.search : "";
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

// We deliberately reuse the inline editors from the Property Detail page so
// every lease field on this page commits with the same save-on-blur +
// optimistic-update pattern that operators are already used to.
import { InlineEdit, NotesEditor } from "@/pages/property-detail";

// ── Included-items editor ──────────────────────────────────────────────
// Hybrid checklist + free-form. The checklist surfaces the curated
// `INCLUDED_ITEM_SUGGESTIONS` (Water, Electric, Lawn care, …) so the most
// common cases are one click; anything not on the canonical list can still
// be typed in via the free-form input below — those custom items render in
// their own "Custom" row so they're easy to spot and remove.
//
// Both paths funnel into a single `onChange(string[])` so the caller wires
// straight into the optimistic `updateLease` helper exactly once per edit.
function IncludedItemsEditor({
  value,
  onChange,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  // Case-insensitive set of selected items so toggle/dedupe checks don't
  // care about how the operator typed something originally.
  const selectedSet = useMemo(
    () => new Set(value.map((v) => v.toLowerCase())),
    [value],
  );
  const suggestionSet = useMemo(
    () => new Set(INCLUDED_ITEM_SUGGESTIONS.map((s) => s.toLowerCase())),
    [],
  );
  // Custom items = anything in `value` that isn't part of the canonical
  // suggestion list. Preserves the operator's original casing so display
  // matches what they typed.
  const customItems = useMemo(
    () => value.filter((v) => !suggestionSet.has(v.toLowerCase())),
    [value, suggestionSet],
  );

  const toggleSuggestion = (item: string) => {
    if (selectedSet.has(item.toLowerCase())) {
      onChange(value.filter((v) => v.toLowerCase() !== item.toLowerCase()));
    } else {
      onChange([...value, item]);
    }
  };

  const remove = (item: string) => {
    onChange(value.filter((v) => v !== item));
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    // Avoid duplicates (case-insensitive) so the same item can't be added
    // twice via the free-form input or stomp on a checklist toggle.
    if (!selectedSet.has(trimmed.toLowerCase())) {
      onChange([...value, trimmed]);
    }
    setDraft("");
  };

  return (
    <div className="space-y-3" data-testid="included-items-editor">
      {/* Checklist: curated suggestions render as toggleable chips, mirroring
          the property's furnishings tab so the interaction model is familiar. */}
      <div className="flex flex-wrap gap-1.5" data-testid="included-items-checklist">
        {INCLUDED_ITEM_SUGGESTIONS.map((item) => {
          const isOn = selectedSet.has(item.toLowerCase());
          return (
            <button
              key={item}
              type="button"
              onClick={() => toggleSuggestion(item)}
              data-testid={`included-suggestion-${item}`}
              data-checked={isOn ? "true" : "false"}
              aria-pressed={isOn}
              className={
                "px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1 " +
                (isOn
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                  : "bg-white text-muted-foreground border-border hover:bg-muted hover:text-foreground")
              }
            >
              {isOn ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <Plus className="h-3 w-3 opacity-60" />
              )}
              {item}
            </button>
          );
        })}
      </div>

      {/* Free-form additions, separated visually so operators can tell the
          difference between curated picks and one-off entries. */}
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">
          Anything else? Add a custom item below.
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            placeholder="e.g. Boat slip, EV charger…"
            className="h-8 text-sm"
            data-testid="input-add-included-item"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={commit}
            disabled={draft.trim().length === 0}
            data-testid="button-add-included-item"
          >
            Add
          </Button>
        </div>
        {customItems.length > 0 && (
          <div
            className="flex flex-wrap gap-1.5 pt-1.5"
            data-testid="included-items-custom"
          >
            {customItems.map((item) => (
              <Badge
                key={item}
                variant="secondary"
                className="gap-1.5 pl-2 pr-1"
                data-testid={`chip-included-${item}`}
              >
                {item}
                <button
                  type="button"
                  aria-label={`Remove ${item}`}
                  onClick={() => remove(item)}
                  className="rounded-full p-0.5 hover:bg-background/60"
                  data-testid={`button-remove-included-${item}`}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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
    includedItems: [],
    buyoutAvailable: false,
    buyoutCost: null,
  };
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
  // Read once at mount: the user can't change query strings without a
  // re-render that would re-run the effect chain anyway.
  const requestedPropertyId = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("propertyId") ?? "";
  }, []);

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
        <div className="p-8 max-w-5xl mx-auto">
          <Card>
            <CardContent className="p-12 text-center space-y-3">
              <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
              <h2 className="text-lg font-semibold">Lease not found</h2>
              <p className="text-sm text-muted-foreground">
                This lease may have been deleted. Head back to the Leases page
                to see what's available.
              </p>
              <Link href={origin.path}>
                <Button variant="outline" data-testid="button-back-to-leases">
                  <ChevronLeft className="h-4 w-4 mr-1.5" />
                  {backLabel}
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
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
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  data-testid="button-delete-lease-detail"
                  onClick={() => {
                    if (realLease) {
                      deleteLease(realLease.id);
                      toast({ title: "Lease deleted" });
                      navigate("/leases");
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Two-column form layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
              <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                <span className="text-sm text-muted-foreground w-40 shrink-0">Rent (monthly)</span>
                <div className="flex items-center gap-2">
                  <InlineEdit
                    value={lease.monthlyRent}
                    prefix="$"
                    type="number"
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

          {/* ── Included Items ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ListChecks className="h-4 w-4" />
                Included Items
              </CardTitle>
            </CardHeader>
            <CardContent>
              <IncludedItemsEditor
                value={lease.includedItems ?? []}
                onChange={(next) => applyUpdate( { includedItems: next })}
              />
            </CardContent>
          </Card>

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
