import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  DollarSign,
  FileText,
  FileUp,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Building2,
  Users,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useData } from "@/context/data-store";
import { useToast } from "@/hooks/use-toast";
import {
  importLeasePdf,
  LeasePdfImportError,
  type LeasePdfImportResponse,
  type LeasePdfFixup,
  type ExtractedLeaseFromPdf,
  type PropertyMatchCandidate,
} from "@/lib/lease-pdf-import";
import {
  recordLeaseUpload,
  clearLeaseUpload,
  useRecentLeaseUploads,
  type RecentLeaseUpload,
} from "@/lib/recent-lease-uploads";
import { type Building, type Lease, type Property } from "@/data/mockData";
import { cn } from "@/lib/utils";

const NEW_PROPERTY_VALUE = "__new_property__";
const NEW_CUSTOMER_VALUE = "__new_customer__";
/** How many uploads we let the browser fire concurrently. The server has its
 * own cap; this is mostly to keep the queue UI responsive and avoid burning
 * sockets when a manager drops 30 PDFs at once. */
const CLIENT_CONCURRENCY = 3;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
/** Re-exported so callers that render their own drop surface (e.g. the
 * property-detail Leases tab visible drop zone, Task #622) share the same
 * size cap as the upload dialog. */
export const MAX_LEASE_PDF_FILE_SIZE_BYTES = MAX_FILE_SIZE_BYTES;

interface PropertyDraft {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface LeaseDraft {
  startDate: string;
  endDate: string;
  monthlyRent: string;
  securityDeposit: string;
  status: Lease["status"];
  notes: string;
  // Extended fields auto-extracted from the PDF (task #121). Stored on the
  // draft so the operator can confirm / edit them in the reviewer dialog
  // before the lease is saved.
  clauses: string;
  buyoutAvailable: boolean;
  /** Stored as a string so the input stays controlled and "" means "unset". */
  buyoutCost: string;
}

type QueueItemStatus =
  | "pending"
  | "uploading"
  | "needs-review"
  | "saved"
  | "failed";

interface QueueItem {
  id: string;
  file: File | null;
  fileName: string;
  status: QueueItemStatus;
  importResult?: LeasePdfImportResponse;
  errorMessage?: string;
  /** True when this item was created via the "Enter manually" entry point
   *  (no PDF was uploaded). Used to hide PDF-specific UI like the file size
   *  badge, fixups, and confidence chip in the review form. */
  manualEntry?: boolean;
  /** Persisted review-form state so navigating back to the queue preserves edits. */
  selectedPropertyId: string;
  /** Empty string = "All buildings / unassigned". Stored as a string so the
   *  Select stays controlled; sent as null on the lease when blank. Only
   *  surfaced when the dialog is locked to a property and that property has
   *  more than one building (Task #608, mirrors AddLeaseDialog behavior). */
  buildingId: string;
  propertyDraft: PropertyDraft | null;
  leaseDraft: LeaseDraft | null;
  /**
   * Customer the operator confirmed in the review form. Always editable —
   * not just when creating a new property — so the operator can re-assign
   * an existing property's customer at the same time they import the lease,
   * or pick the right customer when the auto-matched property happens to
   * be wrong. Empty string = "make me pick"; NEW_CUSTOMER_VALUE = inline
   * create.
   */
  customerId: string;
  newCustomerName: string;
}

function emptyPropertyDraft(extracted?: ExtractedLeaseFromPdf): PropertyDraft {
  return {
    name: extracted?.propertyName ?? "",
    address: extracted?.propertyAddress ?? "",
    city: extracted?.city ?? "",
    state: extracted?.state ?? "",
    zip: extracted?.zip ?? "",
  };
}

function blankLeaseDraft(): LeaseDraft {
  return {
    startDate: "",
    endDate: "",
    monthlyRent: "",
    securityDeposit: "",
    status: "Active",
    notes: "",
    clauses: "",
    buyoutAvailable: false,
    buyoutCost: "",
  };
}

function leaseDraftFromExtracted(extracted: ExtractedLeaseFromPdf): LeaseDraft {
  return {
    startDate: extracted.startDate ?? "",
    endDate: extracted.endDate ?? "",
    monthlyRent: extracted.monthlyRent != null ? String(extracted.monthlyRent) : "",
    securityDeposit: extracted.securityDeposit != null ? String(extracted.securityDeposit) : "",
    status: "Active",
    notes: extracted.notes ?? "",
    clauses: extracted.clauses ?? "",
    buyoutAvailable: extracted.buyoutAvailable ?? false,
    buyoutCost:
      extracted.buyoutAvailable && extracted.buyoutCost != null
        ? String(extracted.buyoutCost)
        : "",
  };
}

function isPdfFile(file: File): boolean {
  const lcType = (file.type ?? "").toLowerCase();
  const lcName = (file.name ?? "").toLowerCase();
  return lcType === "application/pdf" || lcName.endsWith(".pdf");
}

/**
 * Run the same PDF + 10 MB validation the dialog applies, returning the
 * accepted files plus human-readable reasons for each rejection. Shared with
 * the property-detail Leases tab drop zone (Task #622) so both entry points
 * behave identically.
 */
export function partitionLeasePdfFiles(
  files: FileList | File[] | null | undefined,
): { accepted: File[]; rejected: string[] } {
  const accepted: File[] = [];
  const rejected: string[] = [];
  if (!files) return { accepted, rejected };
  const list = Array.from(files);
  for (const file of list) {
    if (!isPdfFile(file)) {
      rejected.push(`${file.name} — not a PDF`);
      continue;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      rejected.push(`${file.name} — over 10 MB`);
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejected };
}

function ConfidenceBadge({ confidence }: { confidence: ExtractedLeaseFromPdf["confidence"] }) {
  const variant: "default" | "secondary" | "destructive" =
    confidence === "high" ? "default" : confidence === "medium" ? "secondary" : "destructive";
  return (
    <Badge variant={variant} className="gap-1">
      <Sparkles className="h-3 w-3" />
      {confidence} confidence
    </Badge>
  );
}

function StatusBadge({ status }: { status: QueueItemStatus }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className="gap-1">
          Queued
        </Badge>
      );
    case "uploading":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Uploading
        </Badge>
      );
    case "needs-review":
      return (
        <Badge variant="default" className="gap-1">
          <Sparkles className="h-3 w-3" />
          Needs review
        </Badge>
      );
    case "saved":
      return (
        <Badge variant="default" className="gap-1 bg-emerald-600 text-white">
          <CheckCircle2 className="h-3 w-3" />
          Saved
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      );
  }
}

export interface UploadLeasePdfDialogProps {
  /** Optional custom trigger; defaults to an "Upload lease PDF" button. */
  trigger?: React.ReactNode;
  /** Called for each lease successfully created so the parent can react (toast, scroll, etc). */
  onLeaseCreated?: (lease: Lease) => void;
  /**
   * Called when the very first file in a brand-new batch fails to parse so the
   * parent can offer a graceful fallback (e.g. open the manual Add Lease
   * dialog). Only fires when no other file in the batch needs review — we
   * don't want to yank the user out of a batch where some files succeeded.
   */
  onPdfImportFailed?: () => void;
  /**
   * Lock the dialog to a specific property (Task #608). When set:
   *   - the property pick / match UI is hidden and every imported lease is
   *     attached to this property regardless of what the matcher returned;
   *   - the customer pick is hidden — leases inherit the property's customer;
   *   - the pick stage shows an "Enter manually" option so this dialog can
   *     fully replace the property-detail Add Lease button.
   * Leases page callers (no `propertyId`) keep the original cross-property
   * upload UX.
   */
  propertyId?: string;
  /**
   * Buildings under the locked property. When more than one is provided we
   * render a Building picker in the review form so multi-building properties
   * can attach the lease to the correct one. Ignored when `propertyId`
   * isn't set.
   */
  buildings?: readonly Building[];
  /**
   * Controlled open state (Task #622). When provided the dialog is fully
   * controlled — callers (e.g. the property-detail Leases tab dropzone)
   * open / close it themselves so they can pre-stage files via
   * `pendingFiles` before showing the queue stage.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Files to push into the dialog's upload queue once it opens. Used by the
   * visible drop zone on the property-detail Leases tab so a drop / pick
   * outside the dialog still ends up in the same upload + review flow.
   * The dialog consumes the batch exactly once and then calls
   * `onPendingFilesConsumed` so the parent can clear its own buffer.
   */
  pendingFiles?: File[] | null;
  onPendingFilesConsumed?: () => void;
}

/**
 * Multi-step dialog for batch lease PDF import:
 *   1. Pick (drag/drop or file picker) one or more PDFs → enqueued and
 *      uploaded with a small concurrency cap.
 *   2. Queue: per-file status (uploading / needs review / saved / failed)
 *      with a Review button on each ready item.
 *   3. Review: same form as the original single-file flow — pick existing
 *      property or create new, edit fields, save. After save we mark the
 *      item Saved and (if any remain) advance to the next needs-review item.
 *
 * The PDF itself is never stored — only the extracted fields land in our DB.
 */
export function UploadLeasePdfDialog({
  trigger,
  onLeaseCreated,
  onPdfImportFailed,
  propertyId: lockedPropertyId,
  buildings,
  open: openProp,
  onOpenChange,
  pendingFiles,
  onPendingFilesConsumed,
}: UploadLeasePdfDialogProps) {
  const { properties, customers, addProperty, addCustomer, addLease, updateProperty } = useData();
  const { toast } = useToast();

  // Resolve the locked property once so downstream branches don't have to
  // keep re-scanning the properties list. When the prop is set but the id
  // doesn't (yet) match anything in cache, we still treat the dialog as
  // locked — the operator can't pick a different property here.
  const lockedProperty = lockedPropertyId
    ? properties.find((p) => p.id === lockedPropertyId) ?? null
    : null;
  const lockedCustomerId = lockedProperty?.customerId ?? "";
  // Buildings under the locked property — only render the picker when
  // there's a real choice to make (single-building properties keep the
  // one-click flow). Matches AddLeaseDialog's `showBuildingPicker` rule.
  const lockedPropertyBuildings = lockedPropertyId
    ? (buildings ?? []).filter((b) => b.propertyId === lockedPropertyId)
    : [];
  const showBuildingPicker = !!lockedPropertyId && lockedPropertyBuildings.length > 1;

  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? (openProp as boolean) : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [stage, setStage] = useState<"pick" | "queue" | "review">("pick");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recentUploads = useRecentLeaseUploads();

  // Reset everything whenever the dialog closes so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setStage("pick");
      setQueue([]);
      setReviewingId(null);
      setSaving(false);
      setIsDragging(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open]);

  const reviewingItem = useMemo(
    () => (reviewingId ? queue.find((q) => q.id === reviewingId) ?? null : null),
    [queue, reviewingId],
  );

  const updateQueueItem = (id: string, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  /**
   * Run uploads with a small concurrency cap. We re-read the latest queue via
   * setQueue's functional updater so per-item state changes don't race.
   *
   * Each per-file outcome is also mirrored into the session-scoped
   * "recent uploads" store so the user can see what happened across dialog
   * open/close, and (for failures) retry without re-picking the file.
   */
  const runUploads = async (items: QueueItem[]) => {
    let cursor = 0;
    const next = (): QueueItem | undefined => {
      const item = items[cursor];
      cursor += 1;
      return item;
    };

    const worker = async () => {
      while (true) {
        const item = next();
        if (!item) return;
        // Manual-entry items have no underlying File and never enter the
        // upload queue — guard anyway so this worker stays typesafe.
        if (!item.file) continue;
        const itemFile = item.file;
        updateQueueItem(item.id, { status: "uploading" });
        try {
          const result = await importLeasePdf(itemFile);
          // Pre-fill the customer slot from the auto-matched property's
          // current customer, if any — operators can still override it
          // in the review form (e.g. when the matched property happens
          // to belong to the wrong customer in the PDF).
          const matchedPropertyCustomerId = result.topMatch
            ? properties.find((p) => p.id === result.topMatch!.propertyId)?.customerId ?? ""
            : "";
          // When the dialog is locked to a property, ignore matcher
          // suggestions and pin the upload to that property/customer —
          // operators picked "Add Lease" on a specific property and
          // expect the lease to land there, not on a fuzzy match.
          const resolvedPropertyId = lockedPropertyId
            ? lockedPropertyId
            : result.topMatch
              ? result.topMatch.propertyId
              : "";
          const resolvedCustomerId = lockedPropertyId
            ? lockedCustomerId
            : matchedPropertyCustomerId;
          updateQueueItem(item.id, {
            status: "needs-review",
            importResult: result,
            leaseDraft: leaseDraftFromExtracted(result.extracted),
            selectedPropertyId: resolvedPropertyId,
            propertyDraft: null,
            customerId: resolvedCustomerId,
            newCustomerName: "",
          });
          recordLeaseUpload({
            id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            fileName: item.fileName,
            status: "parsed",
            timestamp: Date.now(),
          });
        } catch (err) {
          const message =
            err instanceof LeasePdfImportError
              ? err.message
              : "Failed to upload this lease PDF.";
          updateQueueItem(item.id, {
            status: "failed",
            errorMessage: message,
          });
          // Hold on to the original File so the recent-uploads list can offer
          // a one-click Retry without making the user re-pick it.
          recordLeaseUpload({
            id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            fileName: item.fileName,
            status: "failed",
            errorMessage: message,
            file: itemFile,
            timestamp: Date.now(),
          });
        }
      }
    };

    const workerCount = Math.min(CLIENT_CONCURRENCY, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  };

  /**
   * Take a list of File objects (from picker or drop), validate them, enqueue
   * the valid ones, then kick off uploads. Invalid files surface a single
   * combined toast so the user knows what was skipped.
   *
   * If `replacingId` is provided (i.e. this is a retry of a previously failed
   * entry from the recent-uploads list), that entry is cleared first to keep
   * the history tidy — the fresh outcome will be re-recorded by `runUploads`.
   */
  const handleFilesChosen = (
    files: FileList | File[] | null,
    replacingId?: string,
  ) => {
    if (!files) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    if (replacingId) clearLeaseUpload(replacingId);

    const { accepted: acceptedFiles, rejected } = partitionLeasePdfFiles(list);
    const accepted: QueueItem[] = [];
    for (const file of acceptedFiles) {
      accepted.push({
        id: `qi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        fileName: file.name,
        status: "pending",
        // When the dialog is locked to a property, pre-seed every queue
        // item so the post-upload override (and any failure path) already
        // points at the right property/customer instead of forcing the
        // operator to re-pick. Building stays unset by default — the
        // explicit picker handles multi-building properties.
        selectedPropertyId: lockedPropertyId ?? "",
        buildingId: "",
        propertyDraft: null,
        leaseDraft: null,
        customerId: lockedCustomerId,
        newCustomerName: "",
      });
    }

    if (rejected.length > 0) {
      toast({
        title: rejected.length === 1 ? "File skipped" : `${rejected.length} files skipped`,
        description: rejected.join("\n"),
        variant: "destructive",
      });
    }
    if (accepted.length === 0) return;

    // First batch enters from the pick stage; subsequent batches (the
    // "Add more files" button on the queue) append in place.
    const isFirstBatch = queue.length === 0;
    setQueue((prev) => [...prev, ...accepted]);
    setStage("queue");
    if (fileInputRef.current) fileInputRef.current.value = "";

    void runUploadsAndMaybeFallback(accepted, isFirstBatch);
  };

  const runUploadsAndMaybeFallback = async (
    items: QueueItem[],
    _isFirstBatch: boolean,
  ) => {
    await runUploads(items);
    // Stay in the queue even when every file failed — the failed rows now
    // offer an "Add manually" button so the operator can enter the lease
    // (incl. creating a new property) without leaving this dialog.
  };

  // Consume any files pushed in via the controlled `pendingFiles` prop
  // (Task #622). We track the batch reference so the same array doesn't
  // get fed in twice if the parent re-renders before clearing it.
  const consumedPendingRef = useRef<File[] | null>(null);
  useEffect(() => {
    if (!open) return;
    if (!pendingFiles || pendingFiles.length === 0) return;
    if (consumedPendingRef.current === pendingFiles) return;
    consumedPendingRef.current = pendingFiles;
    handleFilesChosen(pendingFiles);
    onPendingFilesConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingFiles]);
  useEffect(() => {
    if (!open) consumedPendingRef.current = null;
  }, [open]);

  // ── Drag and drop ────────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const dt = e.dataTransfer;
    if (!dt) return;
    const dropped: File[] = [];
    if (dt.items && dt.items.length > 0) {
      for (let i = 0; i < dt.items.length; i++) {
        const it = dt.items[i];
        if (it.kind === "file") {
          const f = it.getAsFile();
          if (f) dropped.push(f);
        }
      }
    } else if (dt.files) {
      for (let i = 0; i < dt.files.length; i++) {
        dropped.push(dt.files[i]);
      }
    }
    handleFilesChosen(dropped);
  };

  // ── Review actions ───────────────────────────────────────────────────────
  const handleStartReview = (id: string) => {
    // For failed parses, seed empty drafts so the operator can still add the
    // lease manually (incl. "+ Create new property") instead of being stuck.
    const target = queue.find((q) => q.id === id);
    if (target && (target.status === "failed" || !target.leaseDraft)) {
      updateQueueItem(id, {
        status: "needs-review",
        leaseDraft: target.leaseDraft ?? blankLeaseDraft(),
        selectedPropertyId: target.selectedPropertyId || "",
        propertyDraft: target.propertyDraft ?? null,
      });
    }
    setReviewingId(id);
    setStage("review");
  };

  const handleBackToQueue = () => {
    setReviewingId(null);
    setStage("queue");
  };

  const handleRetryUpload = (entry: RecentLeaseUpload) => {
    if (!entry.file) return;
    // Re-enqueue the saved File through the same batch path as a normal pick;
    // `replacingId` clears the stale failed entry so we don't end up with
    // duplicate Retry rows.
    handleFilesChosen([entry.file], entry.id);
  };

  /**
   * "Enter manually" entry point — only available when the dialog is
   * locked to a property (Task #608). Creates a synthetic queue item with
   * no PDF and blank lease drafts, then jumps straight into the review
   * stage so the operator can fill in the fields by hand without leaving
   * the Add Lease flow. Equivalent to the original AddLeaseDialog manual
   * path on the property detail page, but rendered through this dialog
   * so the upload + manual entry points stay unified.
   */
  const handleEnterManually = () => {
    if (!lockedPropertyId) return;
    const id = `qi-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const manualItem: QueueItem = {
      id,
      file: null,
      fileName: "Manual entry",
      status: "needs-review",
      manualEntry: true,
      selectedPropertyId: lockedPropertyId,
      buildingId: "",
      propertyDraft: null,
      leaseDraft: blankLeaseDraft(),
      customerId: lockedCustomerId,
      newCustomerName: "",
    };
    setQueue((prev) => [...prev, manualItem]);
    setReviewingId(id);
    setStage("review");
  };

  const handleSelectProperty = (value: string) => {
    if (!reviewingItem) return;
    if (value === NEW_PROPERTY_VALUE) {
      const draft =
        reviewingItem.propertyDraft ??
        emptyPropertyDraft(reviewingItem.importResult?.extracted);
      updateQueueItem(reviewingItem.id, {
        selectedPropertyId: value,
        propertyDraft: draft,
        // New properties always need an explicit customer pick from
        // the operator — clear any auto-fill from the previous match.
        customerId: reviewingItem.customerId === NEW_CUSTOMER_VALUE
          ? NEW_CUSTOMER_VALUE
          : "",
      });
    } else {
      // Snap the customer field to the picked property's current customer
      // so the form always shows the truth on screen. Operators can then
      // change it (which also re-assigns the property on save).
      const picked = properties.find((p) => p.id === value);
      updateQueueItem(reviewingItem.id, {
        selectedPropertyId: value,
        propertyDraft: null,
        customerId: picked?.customerId ?? "",
        newCustomerName: "",
      });
    }
  };

  const updateReviewingCustomer = (
    patch: Partial<Pick<QueueItem, "customerId" | "newCustomerName">>,
  ) => {
    if (!reviewingItem) return;
    updateQueueItem(reviewingItem.id, patch);
  };

  const updateReviewingPropertyDraft = (patch: Partial<PropertyDraft>) => {
    if (!reviewingItem || !reviewingItem.propertyDraft) return;
    updateQueueItem(reviewingItem.id, {
      propertyDraft: { ...reviewingItem.propertyDraft, ...patch },
    });
  };

  const updateReviewingLeaseDraft = (patch: Partial<LeaseDraft>) => {
    if (!reviewingItem || !reviewingItem.leaseDraft) return;
    updateQueueItem(reviewingItem.id, {
      leaseDraft: { ...reviewingItem.leaseDraft, ...patch },
    });
  };

  const canSaveReviewing = (() => {
    if (!reviewingItem) return false;
    const lease = reviewingItem.leaseDraft;
    if (!lease || !lease.startDate || !lease.endDate || !lease.monthlyRent) return false;
    // When the dialog is locked to a property the customer + property
    // are inherited automatically, so skip the cross-property checks —
    // operators just need the lease fields filled in.
    if (lockedPropertyId) {
      return reviewingItem.selectedPropertyId === lockedPropertyId;
    }
    // Customer is always required now — the operator must confirm who
    // owns this lease before we save (whether the property is new or
    // already in the portfolio).
    if (!reviewingItem.customerId) return false;
    if (
      reviewingItem.customerId === NEW_CUSTOMER_VALUE &&
      !reviewingItem.newCustomerName.trim()
    ) {
      return false;
    }
    if (reviewingItem.selectedPropertyId === NEW_PROPERTY_VALUE) {
      const p = reviewingItem.propertyDraft;
      if (!p) return false;
      if (!p.name.trim()) return false;
      return true;
    }
    return !!reviewingItem.selectedPropertyId;
  })();

  const handleSaveReviewing = async () => {
    if (!reviewingItem || !reviewingItem.leaseDraft || saving) return;

    let propertyId = reviewingItem.selectedPropertyId;
    setSaving(true);
    try {
      // Locked-to-a-property flow (Task #608): skip every cross-property
      // branch — property is fixed, customer is inherited, and there's no
      // new-property draft to create. The lease just lands on the locked
      // property with the inherited customer.
      if (lockedPropertyId) {
        propertyId = lockedPropertyId;
      } else {
      // Resolve the customer up-front. This block runs for BOTH paths
      // (new property and existing property) so the operator's customer
      // pick — including inline "+ Create new customer" — is always
      // honoured, not just when they're also creating a new property.
      let customerId = reviewingItem.customerId;
      if (customerId === NEW_CUSTOMER_VALUE) {
        customerId = `cust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        try {
          await addCustomer({
            id: customerId,
            name: reviewingItem.newCustomerName.trim(),
            contactName: "",
            email: "",
            phone: "",
            notes: "Created from lease PDF import.",
            isInactive: false,
            state: "",
            customShifts: [],
          });
        } catch {
          toast({
            title: "Couldn't create customer",
            description: "The new customer couldn't be saved. Lease was not created.",
            variant: "destructive",
          });
          return;
        }
      }

      if (
        reviewingItem.selectedPropertyId === NEW_PROPERTY_VALUE &&
        reviewingItem.propertyDraft
      ) {
        const draft = reviewingItem.propertyDraft;
        const newProperty: Property = {
          id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          customerId,
          name: draft.name.trim(),
          address: draft.address.trim(),
          city: draft.city.trim(),
          state: draft.state.trim(),
          zip: draft.zip.trim(),
          totalBeds: 0,
          monthlyRent: 0,
          chargePerBed: 0,
          status: "Active",
          landlordName: reviewingItem.importResult?.extracted.landlordName ?? "",
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
          const saved = await addProperty(newProperty);
          propertyId = saved.id;
        } catch {
          toast({
            title: "Couldn't create property",
            description: "Saving the new property failed on the server. The lease was not created.",
            variant: "destructive",
          });
          return;
        }
      } else {
        // Existing property — re-assign the customer if the operator
        // picked a different one (or just confirmed the auto-created
        // new customer). Keeps the property's `customerId` consistent
        // with the lease the operator just confirmed.
        const existing = properties.find((p) => p.id === propertyId);
        if (existing && existing.customerId !== customerId) {
          try {
            await updateProperty(existing.id, { customerId });
          } catch {
            toast({
              title: "Couldn't update property's customer",
              description:
                "The lease wasn't created. Try again, or change the customer from the property page.",
              variant: "destructive",
            });
            return;
          }
        }
      }
      } // end of !lockedPropertyId branch

      // Buyout cost only carries through when the toggle is on AND the input
      // parses to a finite number — same invariant the lease detail page
      // uses, so the saved row matches what the reviewer was looking at.
      const buyoutAvailable = reviewingItem.leaseDraft.buyoutAvailable;
      const parsedBuyoutCost = parseFloat(reviewingItem.leaseDraft.buyoutCost);
      const buyoutCost =
        buyoutAvailable && Number.isFinite(parsedBuyoutCost)
          ? parsedBuyoutCost
          : null;

      // Task #492: inherit `noticePeriodDays` from the parent property
      // at creation time so the new lease is immediately eligible for
      // the notice-deadline alert (and the value is pinned even if the
      // property default later changes). PDF import never tries to
      // parse a notice period out of free text — operators can edit
      // the inherited value on the lease detail page if needed.
      const parentProperty = properties.find((p) => p.id === propertyId);
      const inheritedNoticePeriodDays =
        parentProperty?.defaultNoticePeriodDays ?? null;
      const newLease: Lease = {
        id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        propertyId,
        // Building only carries through when the operator explicitly
        // picked one — otherwise the lease applies at the property level
        // (same null-means-unscoped semantics as AddLeaseDialog).
        buildingId: reviewingItem.buildingId ? reviewingItem.buildingId : null,
        startDate: reviewingItem.leaseDraft.startDate,
        endDate: reviewingItem.leaseDraft.endDate,
        monthlyRent: parseFloat(reviewingItem.leaseDraft.monthlyRent) || 0,
        securityDeposit: parseFloat(reviewingItem.leaseDraft.securityDeposit) || 0,
        status: reviewingItem.leaseDraft.status,
        notes: reviewingItem.leaseDraft.notes,
        noticePeriodDays: inheritedNoticePeriodDays,
        // Auto-extracted from the PDF and confirmed by the operator in the
        // reviewer dialog (task #121). Operators can still tweak anything
        // further on the lease detail page after import.
        clauses: reviewingItem.leaseDraft.clauses,
        buyoutAvailable,
        buyoutCost,
        // Hotel-rate fields (task #299) aren't extracted from PDFs yet —
        // default to "monthly" so PDF-imported leases keep behaving as
        // standard monthly leases. Operators can flip them on from the
        // lease detail page when needed.
        rateType: "monthly",
        nightlyRate: 0,
        guaranteedRooms: 0,
        monthlyRoomNightMin: 0,
        longStayTaxExempt: false,
        utilitiesIncludedInRent: false,
        customerResponsibleForRent: false,
      };
      addLease(newLease);

      const property = properties.find((p) => p.id === propertyId);
      const isManual = reviewingItem.manualEntry;
      toast({
        title: isManual ? "Lease added" : "Lease imported",
        description: property
          ? `Attached to ${property.name}.`
          : "New lease and property created from PDF.",
      });
      onLeaseCreated?.(newLease);

      // Mark this item saved and advance to the next needs-review item, if any.
      const savedItemId = reviewingItem.id;
      setQueue((prev) => {
        const updated = prev.map((q) =>
          q.id === savedItemId ? { ...q, status: "saved" as const } : q,
        );
        const nextItem = updated.find(
          (q) => q.id !== savedItemId && q.status === "needs-review",
        );
        if (nextItem) {
          setReviewingId(nextItem.id);
          setStage("review");
        } else {
          setReviewingId(null);
          setStage("queue");
        }
        return updated;
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Derived counters for the queue header & footer ──────────────────────
  const counts = useMemo(() => {
    const c = { uploading: 0, needsReview: 0, saved: 0, failed: 0, pending: 0 };
    for (const q of queue) {
      if (q.status === "uploading") c.uploading += 1;
      else if (q.status === "needs-review") c.needsReview += 1;
      else if (q.status === "saved") c.saved += 1;
      else if (q.status === "failed") c.failed += 1;
      else if (q.status === "pending") c.pending += 1;
    }
    return c;
  }, [queue]);

  const allDone =
    queue.length > 0 &&
    counts.uploading === 0 &&
    counts.pending === 0 &&
    counts.needsReview === 0;

  const triggerEl = trigger ?? (
    <Button variant="outline" data-testid="button-upload-lease-pdf">
      <FileUp className="h-4 w-4 mr-1.5" />
      Upload lease PDF
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{triggerEl}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {stage === "review"
              ? "Review extracted lease"
              : stage === "queue"
                ? "Lease PDF import"
                : "Import leases from PDF"}
          </DialogTitle>
          <DialogDescription>
            {stage === "review"
              ? "Confirm the details parsed from the PDF, then attach it to an existing property or create a new one. The PDF itself is not stored."
              : stage === "queue"
                ? "Each PDF is parsed independently. Review and save them one at a time — you can do this in any order."
                : "Drop one or more text-based lease PDFs (or pick them). We'll extract the key fields with AI and let you review each one before saving."}
          </DialogDescription>
        </DialogHeader>

        {stage === "pick" && (
          <div className="space-y-3 py-2">
            {lockedPropertyId && lockedProperty && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="text-pdf-locked-property-hint"
              >
                Leases will be attached to{" "}
                <span className="font-medium text-foreground">
                  {lockedProperty.name}
                </span>
                .
              </p>
            )}
            <div
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              data-testid="dropzone-lease-pdfs"
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors",
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/40",
              )}
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">
                Drag and drop lease PDFs here, or click to choose files
              </p>
              <p className="text-xs text-muted-foreground">
                Multiple files supported. Max 10&nbsp;MB each. Image-only / scanned
                PDFs aren't supported (OCR is off).
              </p>
            </div>
            <Input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => handleFilesChosen(e.target.files)}
              data-testid="input-lease-pdf-file"
            />
            {lockedPropertyId && (
              <div
                className="flex items-center gap-2 text-xs text-muted-foreground"
                data-testid="pdf-manual-entry-row"
              >
                <span>Don't have a PDF?</span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={handleEnterManually}
                  data-testid="button-enter-lease-manually"
                >
                  Enter the lease details manually
                </Button>
              </div>
            )}
            {recentUploads.length > 0 && (
              <RecentUploadsList
                uploads={recentUploads}
                onRetry={handleRetryUpload}
                onDismiss={(id) => clearLeaseUpload(id)}
              />
            )}
          </div>
        )}

        {stage === "queue" && (
          <div className="space-y-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {queue.length} {queue.length === 1 ? "file" : "files"}
              </span>
              {counts.uploading > 0 && <span>· {counts.uploading} uploading</span>}
              {counts.needsReview > 0 && <span>· {counts.needsReview} need review</span>}
              {counts.saved > 0 && <span>· {counts.saved} saved</span>}
              {counts.failed > 0 && <span>· {counts.failed} failed</span>}
            </div>

            <div
              className="space-y-2"
              data-testid="lease-pdf-queue"
            >
              {queue.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  onReview={() => handleStartReview(item.id)}
                />
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-add-more-pdfs"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add more files
              </Button>
              {lockedPropertyId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleEnterManually}
                  data-testid="button-enter-lease-manually-queue"
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Enter manually
                </Button>
              )}
              <Input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={(e) => handleFilesChosen(e.target.files)}
                data-testid="input-lease-pdf-file-more"
              />
            </div>
          </div>
        )}

        {stage === "review" && reviewingItem && reviewingItem.leaseDraft && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="font-normal">
                <FileUp className="h-3 w-3 mr-1" />
                {reviewingItem.fileName}
              </Badge>
              {reviewingItem.importResult ? (
                <>
                  <ConfidenceBadge confidence={reviewingItem.importResult.extracted.confidence} />
                  {reviewingItem.importResult.extracted.landlordName && (
                    <Badge variant="outline" className="font-normal">
                      Landlord: {reviewingItem.importResult.extracted.landlordName}
                    </Badge>
                  )}
                </>
              ) : reviewingItem.manualEntry ? (
                <Badge variant="secondary" className="font-normal">
                  Manual entry — no PDF
                </Badge>
              ) : (
                <Badge variant="secondary" className="font-normal">
                  Manual entry — PDF couldn't be parsed
                </Badge>
              )}
            </div>

            {reviewingItem.importResult && (
              <>
                <PdfFixupsSection fixups={reviewingItem.importResult.fixups ?? []} />
                <Separator />
              </>
            )}

            {/* ── Locked property header + building picker (Task #608) ──
                Replaces the property + customer pickers when the dialog
                was opened from a specific property. Shows what the lease
                will land on as a non-editable summary and exposes the
                building choice when the property has more than one. */}
            {lockedPropertyId && (
              <div className="space-y-2" data-testid="pdf-locked-property">
                <Label className="text-sm font-semibold flex items-center gap-1.5">
                  <Building2 className="h-4 w-4" />
                  Property
                </Label>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  <p className="font-medium">
                    {lockedProperty?.name ?? lockedPropertyId}
                  </p>
                  {lockedProperty?.address && (
                    <p className="text-xs text-muted-foreground">
                      {lockedProperty.address}
                    </p>
                  )}
                </div>
                {showBuildingPicker && (
                  <div className="space-y-1.5">
                    <Label htmlFor="pdf-lease-building">Building</Label>
                    <Select
                      value={reviewingItem.buildingId || "__all__"}
                      onValueChange={(v) =>
                        updateQueueItem(reviewingItem.id, {
                          buildingId: v === "__all__" ? "" : v,
                        })
                      }
                    >
                      <SelectTrigger
                        id="pdf-lease-building"
                        data-testid="select-pdf-lease-building"
                      >
                        <SelectValue placeholder="All buildings" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All buildings</SelectItem>
                        {lockedPropertyBuildings.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {/* ── Property section ─────────────────────────────────────── */}
            {!lockedPropertyId && (
            <div>
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <Building2 className="h-4 w-4" />
                Property
              </Label>
              {reviewingItem.importResult ? (
                reviewingItem.importResult.candidates.length > 0 ? (
                  <PropertyMatchPicker
                    candidates={reviewingItem.importResult.candidates}
                    topMatch={reviewingItem.importResult.topMatch}
                    selectedValue={reviewingItem.selectedPropertyId}
                    onSelect={handleSelectProperty}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    No close matches found in your portfolio. We'll create a new property.
                  </p>
                )
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  Pick an existing property or create a new one below, then fill in the lease details.
                </p>
              )}
              <Select value={reviewingItem.selectedPropertyId} onValueChange={handleSelectProperty}>
                <SelectTrigger className="mt-2" data-testid="select-pdf-property-target">
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.address ? ` — ${p.address}` : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_PROPERTY_VALUE}>+ Create new property…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            )}

            {!lockedPropertyId && reviewingItem.selectedPropertyId === NEW_PROPERTY_VALUE && reviewingItem.propertyDraft && (
              <div className="space-y-3 p-3 rounded-md border bg-muted/30">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  New property
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-prop-name">Property name *</Label>
                  <Input
                    id="pdf-prop-name"
                    value={reviewingItem.propertyDraft.name}
                    onChange={(e) => updateReviewingPropertyDraft({ name: e.target.value })}
                    data-testid="input-pdf-property-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-prop-address">Address</Label>
                  <Input
                    id="pdf-prop-address"
                    value={reviewingItem.propertyDraft.address}
                    onChange={(e) => updateReviewingPropertyDraft({ address: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label htmlFor="pdf-prop-city">City</Label>
                    <Input
                      id="pdf-prop-city"
                      value={reviewingItem.propertyDraft.city}
                      onChange={(e) => updateReviewingPropertyDraft({ city: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pdf-prop-state">State</Label>
                    <Input
                      id="pdf-prop-state"
                      value={reviewingItem.propertyDraft.state}
                      onChange={(e) => updateReviewingPropertyDraft({ state: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pdf-prop-zip">ZIP</Label>
                    <Input
                      id="pdf-prop-zip"
                      value={reviewingItem.propertyDraft.zip}
                      onChange={(e) => updateReviewingPropertyDraft({ zip: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── Customer section (always visible) ────────────────────
                Surfaces the customer pick for every lease — not just
                new properties — so operators can re-assign an existing
                property's customer at the same time they import the
                lease, or correct an auto-matched property that belongs
                to the wrong customer in the PDF. Hidden when the dialog
                is locked to a single property (Task #608) — the customer
                is inherited from the property and changing it from the
                lease form would be confusing in that context. */}
            {!lockedPropertyId && (
            <div className="space-y-1.5">
              <Label
                htmlFor="pdf-lease-customer"
                className="text-sm font-semibold flex items-center gap-1.5"
              >
                <Users className="h-4 w-4" />
                Customer *
              </Label>
              <Select
                value={reviewingItem.customerId}
                onValueChange={(v) => updateReviewingCustomer({ customerId: v })}
              >
                <SelectTrigger id="pdf-lease-customer" data-testid="select-pdf-lease-customer">
                  <SelectValue placeholder="Choose a customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_CUSTOMER_VALUE}>+ Create new customer…</SelectItem>
                </SelectContent>
              </Select>
              {(() => {
                if (
                  reviewingItem.selectedPropertyId &&
                  reviewingItem.selectedPropertyId !== NEW_PROPERTY_VALUE &&
                  reviewingItem.customerId &&
                  reviewingItem.customerId !== NEW_CUSTOMER_VALUE
                ) {
                  const picked = properties.find(
                    (p) => p.id === reviewingItem.selectedPropertyId,
                  );
                  if (picked && picked.customerId !== reviewingItem.customerId) {
                    return (
                      <p
                        className="text-xs text-amber-600 dark:text-amber-400"
                        data-testid="text-pdf-customer-reassign"
                      >
                        Saving will re-assign “{picked.name}” to this customer.
                      </p>
                    );
                  }
                }
                return null;
              })()}
              {reviewingItem.customerId === NEW_CUSTOMER_VALUE && (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="pdf-new-customer-name">New customer name *</Label>
                  <Input
                    id="pdf-new-customer-name"
                    value={reviewingItem.newCustomerName}
                    onChange={(e) =>
                      updateReviewingCustomer({ newCustomerName: e.target.value })
                    }
                    data-testid="input-pdf-new-customer-name"
                  />
                </div>
              )}
            </div>
            )}

            <Separator />

            {/* ── Lease fields ─────────────────────────────────────────── */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">Lease details</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-lease-start">Start date *</Label>
                  <Input
                    id="pdf-lease-start"
                    type="date"
                    value={reviewingItem.leaseDraft.startDate}
                    onChange={(e) => updateReviewingLeaseDraft({ startDate: e.target.value })}
                    data-testid="input-pdf-lease-start"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-lease-end">End date *</Label>
                  <Input
                    id="pdf-lease-end"
                    type="date"
                    value={reviewingItem.leaseDraft.endDate}
                    onChange={(e) => updateReviewingLeaseDraft({ endDate: e.target.value })}
                    data-testid="input-pdf-lease-end"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-lease-rent">Monthly rent ($) *</Label>
                  <Input
                    id="pdf-lease-rent"
                    type="number"
                    value={reviewingItem.leaseDraft.monthlyRent}
                    onChange={(e) => updateReviewingLeaseDraft({ monthlyRent: e.target.value })}
                    data-testid="input-pdf-lease-rent"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-lease-deposit">Security deposit ($)</Label>
                  <Input
                    id="pdf-lease-deposit"
                    type="number"
                    value={reviewingItem.leaseDraft.securityDeposit}
                    onChange={(e) => updateReviewingLeaseDraft({ securityDeposit: e.target.value })}
                    data-testid="input-pdf-lease-deposit"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pdf-lease-status">Status</Label>
                <Select
                  value={reviewingItem.leaseDraft.status}
                  onValueChange={(v) =>
                    updateReviewingLeaseDraft({ status: v as Lease["status"] })
                  }
                >
                  <SelectTrigger id="pdf-lease-status" data-testid="select-pdf-lease-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Expired">Expired</SelectItem>
                    <SelectItem value="Upcoming">Upcoming</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pdf-lease-notes">Notes</Label>
                <Textarea
                  id="pdf-lease-notes"
                  value={reviewingItem.leaseDraft.notes}
                  onChange={(e) => updateReviewingLeaseDraft({ notes: e.target.value })}
                  data-testid="textarea-pdf-lease-notes"
                />
              </div>
            </div>

            <Separator />

            {/* ── Auto-extracted: clauses / included items / buyout ─────
                These four fields used to be left blank after a PDF import
                (task #121). Now they're pre-filled from the LLM extraction
                so the operator just confirms before saving. */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label
                  htmlFor="pdf-lease-clauses"
                  className="text-sm font-semibold flex items-center gap-1.5"
                >
                  <FileText className="h-4 w-4" />
                  Clauses
                </Label>
                <p className="text-xs text-muted-foreground">
                  Notable clauses pulled from the PDF — pet policy, late fees,
                  parking rules, etc. Edit anything you'd like to keep on the
                  lease.
                </p>
                <Textarea
                  id="pdf-lease-clauses"
                  value={reviewingItem.leaseDraft.clauses}
                  onChange={(e) => updateReviewingLeaseDraft({ clauses: e.target.value })}
                  className="min-h-[100px] font-mono text-sm"
                  placeholder="No notable clauses extracted."
                  data-testid="textarea-pdf-lease-clauses"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4" />
                  Buyout option
                </Label>
                <div
                  className="flex items-center justify-between gap-2 rounded-md border p-3"
                  data-testid="pdf-buyout-row"
                >
                  <div className="flex flex-col">
                    <Label htmlFor="pdf-buyout-available" className="text-sm">
                      Buyout available
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      Tenant can exit early by paying a fixed fee.
                    </span>
                  </div>
                  <Switch
                    id="pdf-buyout-available"
                    checked={reviewingItem.leaseDraft.buyoutAvailable}
                    onCheckedChange={(checked) => {
                      // Mirror the lease detail page: clearing the toggle
                      // also clears any cost so we don't carry an orphan
                      // amount on a non-buyout lease.
                      updateReviewingLeaseDraft({
                        buyoutAvailable: checked,
                        buyoutCost: checked ? reviewingItem.leaseDraft?.buyoutCost ?? "" : "",
                      });
                    }}
                    data-testid="switch-pdf-buyout-available"
                  />
                </div>
                {reviewingItem.leaseDraft.buyoutAvailable && (
                  <div className="space-y-1.5">
                    <Label htmlFor="pdf-buyout-cost" className="text-sm">
                      Buyout cost ($)
                    </Label>
                    <Input
                      id="pdf-buyout-cost"
                      type="number"
                      placeholder="e.g. 2500"
                      value={reviewingItem.leaseDraft.buyoutCost}
                      onChange={(e) => updateReviewingLeaseDraft({ buyoutCost: e.target.value })}
                      data-testid="input-pdf-buyout-cost"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {stage === "review" ? (
            <>
              <Button
                variant="outline"
                onClick={handleBackToQueue}
                disabled={saving}
                data-testid="button-back-to-queue"
              >
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Back to queue
              </Button>
              <Button
                onClick={handleSaveReviewing}
                disabled={!canSaveReviewing || saving}
                data-testid="button-confirm-pdf-import"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-1.5" />
                    Save lease
                  </>
                )}
              </Button>
            </>
          ) : stage === "queue" ? (
            <Button
              variant={allDone ? "default" : "outline"}
              onClick={() => setOpen(false)}
              data-testid="button-close-pdf-queue"
            >
              {allDone ? (
                <>
                  <Check className="h-4 w-4 mr-1.5" />
                  Done
                </>
              ) : (
                "Close"
              )}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QueueRow({
  item,
  onReview,
}: {
  item: QueueItem;
  onReview: () => void;
}) {
  // Manual-entry items don't have an underlying File, so guard the size
  // calculation — the row still renders fine without a size suffix.
  const sizeKb = item.file ? Math.max(1, Math.round(item.file.size / 1024)) : 0;
  const sizeLabel = item.file
    ? sizeKb >= 1024
      ? `${(sizeKb / 1024).toFixed(1)} MB`
      : `${sizeKb} KB`
    : "Manual entry — no file";
  return (
    <div
      className="flex items-center gap-3 rounded-md border px-3 py-2"
      data-testid={`queue-row-${item.id}`}
    >
      <FileUp className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate" title={item.fileName}>
          {item.fileName}
        </p>
        <p className="text-xs text-muted-foreground">
          {sizeLabel}
          {item.status === "failed" && item.errorMessage ? ` — ${item.errorMessage}` : ""}
        </p>
      </div>
      <StatusBadge status={item.status} />
      {item.status === "needs-review" && (
        <Button
          size="sm"
          variant="default"
          onClick={onReview}
          data-testid={`button-review-${item.id}`}
        >
          Review
        </Button>
      )}
      {item.status === "failed" && (
        <Button
          size="sm"
          variant="outline"
          onClick={onReview}
          data-testid={`button-add-manually-${item.id}`}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add manually
        </Button>
      )}
    </div>
  );
}

function RecentUploadsList({
  uploads,
  onRetry,
  onDismiss,
}: {
  uploads: RecentLeaseUpload[];
  onRetry: (upload: RecentLeaseUpload) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      className="rounded-md border bg-muted/20 p-3 space-y-2"
      data-testid="recent-lease-uploads"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Recent uploads (this session)
      </p>
      <ul className="space-y-1.5">
        {uploads.map((entry) => {
          const isFailed = entry.status === "failed";
          const canRetry = isFailed && !!entry.file;
          return (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-2 rounded-md bg-background border px-2.5 py-1.5"
              data-testid={`recent-lease-upload-${entry.id}`}
            >
              <div className="flex items-start gap-2 min-w-0">
                {isFailed ? (
                  <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" title={entry.fileName}>
                    {entry.fileName}
                  </p>
                  <p
                    className={`text-xs truncate ${
                      isFailed ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {isFailed
                      ? entry.errorMessage ?? "Upload failed."
                      : "Parsed — ready to review."}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {canRetry && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={() => onRetry(entry)}
                    data-testid={`button-retry-upload-${entry.id}`}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Retry
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => onDismiss(entry.id)}
                  className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Dismiss ${entry.fileName}`}
                  data-testid={`button-dismiss-upload-${entry.id}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {uploads.some((u) => u.status === "failed" && !u.file) && (
        <p className="text-[11px] text-muted-foreground">
          Some failed uploads can't be retried automatically — re-pick the PDF above.
        </p>
      )}
    </div>
  );
}

function PdfFixupsSection({ fixups }: { fixups: LeasePdfFixup[] }) {
  if (fixups.length === 0) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
        data-testid="pdf-no-fixups-message"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        No fix-ups needed — every cell was canonical.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="pdf-fixups-section">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        <p className="text-sm font-medium">
          {fixups.length} value{fixups.length === 1 ? " was" : "s were"} rewritten
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        The extracted values below were automatically corrected before review.
      </p>
      <div className="space-y-1">
        {fixups.map((f, i) => (
          <div
            key={`${f.field}-${i}`}
            className="flex items-start gap-1.5 text-xs"
          >
            <Badge variant="secondary" className="shrink-0 font-mono text-[11px] px-1.5">
              {f.field}
            </Badge>
            <span className="text-muted-foreground truncate" title={f.before}>
              {f.before}
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground mt-0.5" />
            <span className="font-medium truncate" title={f.after}>
              {f.after}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PropertyMatchPicker({
  candidates,
  topMatch,
  selectedValue,
  onSelect,
}: {
  candidates: PropertyMatchCandidate[];
  topMatch: PropertyMatchCandidate | null;
  selectedValue: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5 mt-1">
      <p className="text-xs text-muted-foreground">
        {topMatch
          ? "We found a likely match. Confirm or pick a different property below."
          : "No high-confidence match — pick the right property or create a new one."}
      </p>
      <div className="grid grid-cols-1 gap-1.5">
        {candidates.slice(0, 3).map((c) => {
          const selected = selectedValue === c.propertyId;
          const pct = Math.round(c.score * 100);
          return (
            <button
              key={c.propertyId}
              type="button"
              onClick={() => onSelect(c.propertyId)}
              className={`text-left rounded-md border px-3 py-2 transition-colors ${
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/40"
              }`}
              data-testid={`pdf-candidate-${c.propertyId}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{c.propertyName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[c.address, c.city, c.state].filter(Boolean).join(", ") || "No address"}
                    {c.customerName ? ` · ${c.customerName}` : ""}
                  </p>
                </div>
                <Badge variant={selected ? "default" : "secondary"} className="shrink-0">
                  {pct}% match
                </Badge>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Reusable visible drop zone (Task #622) ─────────────────────────────────
// Used by the property-detail Leases tab to expose the same drag-and-drop
// surface that lives inside the dialog, without forcing the operator to
// open the dialog first. The component validates files with the same
// shared helper (`partitionLeasePdfFiles`), shows the same "files skipped"
// toast, and hands the accepted Files to the parent — which is responsible
// for routing them into <UploadLeasePdfDialog> via `pendingFiles`.

export interface LeasePdfDropzoneProps {
  /** Called with the validated PDF files. Only fires when at least one
   *  file passes validation. */
  onFilesAccepted: (files: File[]) => void;
  /** Optional headline copy. Defaults to the same wording as the dialog. */
  headline?: string;
  /** Optional helper / sub-text below the headline. */
  helperText?: string;
  /** Hides the zone (read-only views). */
  disabled?: boolean;
  className?: string;
  /** Data-testid for the outer drop region — defaults to a unique id so
   *  the dialog's own dropzone (`dropzone-lease-pdfs`) stays addressable. */
  testId?: string;
}

export function LeasePdfDropzone({
  onFilesAccepted,
  headline = "Drop lease PDFs here, or click to choose",
  helperText = "Multiple files supported. Max 10 MB each. Image-only / scanned PDFs aren't supported (OCR is off).",
  disabled = false,
  className,
  testId = "dropzone-lease-pdfs-inline",
}: LeasePdfDropzoneProps) {
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const acceptFiles = (files: FileList | File[] | null) => {
    const { accepted, rejected } = partitionLeasePdfFiles(files);
    if (rejected.length > 0) {
      toast({
        title: rejected.length === 1 ? "File skipped" : `${rejected.length} files skipped`,
        description: rejected.join("\n"),
        variant: "destructive",
      });
    }
    if (inputRef.current) inputRef.current.value = "";
    if (accepted.length === 0) return;
    onFilesAccepted(accepted);
  };

  if (disabled) return null;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isDragging) setIsDragging(true);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isDragging) setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        const dt = e.dataTransfer;
        if (!dt) return;
        const dropped: File[] = [];
        if (dt.items && dt.items.length > 0) {
          for (let i = 0; i < dt.items.length; i++) {
            const it = dt.items[i];
            if (it.kind === "file") {
              const f = it.getAsFile();
              if (f) dropped.push(f);
            }
          }
        } else if (dt.files) {
          for (let i = 0; i < dt.files.length; i++) dropped.push(dt.files[i]);
        }
        acceptFiles(dropped);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      data-testid={testId}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-4 py-6 text-center cursor-pointer transition-colors",
        isDragging
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/40",
        className,
      )}
    >
      <Upload className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">{headline}</p>
      <p className="text-xs text-muted-foreground">{helperText}</p>
      <Input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(e) => acceptFiles(e.target.files)}
        data-testid={`${testId}-input`}
      />
    </div>
  );
}
