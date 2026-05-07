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
import { type Lease, type Property } from "@/data/mockData";
import { cn } from "@/lib/utils";

const NEW_PROPERTY_VALUE = "__new_property__";
const NEW_CUSTOMER_VALUE = "__new_customer__";
/** How many uploads we let the browser fire concurrently. The server has its
 * own cap; this is mostly to keep the queue UI responsive and avoid burning
 * sockets when a manager drops 30 PDFs at once. */
const CLIENT_CONCURRENCY = 3;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

interface PropertyDraft {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  customerId: string;
  newCustomerName: string;
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
  file: File;
  fileName: string;
  status: QueueItemStatus;
  importResult?: LeasePdfImportResponse;
  errorMessage?: string;
  /** Persisted review-form state so navigating back to the queue preserves edits. */
  selectedPropertyId: string;
  propertyDraft: PropertyDraft | null;
  leaseDraft: LeaseDraft | null;
}

function emptyPropertyDraft(extracted: ExtractedLeaseFromPdf): PropertyDraft {
  return {
    name: extracted.propertyName ?? "",
    address: extracted.propertyAddress ?? "",
    city: extracted.city ?? "",
    state: extracted.state ?? "",
    zip: extracted.zip ?? "",
    customerId: "",
    newCustomerName: "",
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
export function UploadLeasePdfDialog({ trigger, onLeaseCreated, onPdfImportFailed }: UploadLeasePdfDialogProps) {
  const { properties, customers, addProperty, addCustomer, addLease } = useData();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
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
        updateQueueItem(item.id, { status: "uploading" });
        try {
          const result = await importLeasePdf(item.file);
          updateQueueItem(item.id, {
            status: "needs-review",
            importResult: result,
            leaseDraft: leaseDraftFromExtracted(result.extracted),
            // Auto-pick the top match only when it's confident; otherwise force
            // an explicit choice in the review form (existing OR create new).
            selectedPropertyId: result.topMatch ? result.topMatch.propertyId : "",
            propertyDraft: null,
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
            file: item.file,
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

    const accepted: QueueItem[] = [];
    const rejected: string[] = [];
    for (const file of list) {
      if (!isPdfFile(file)) {
        rejected.push(`${file.name} — not a PDF`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        rejected.push(`${file.name} — over 10 MB`);
        continue;
      }
      accepted.push({
        id: `qi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        fileName: file.name,
        status: "pending",
        selectedPropertyId: "",
        propertyDraft: null,
        leaseDraft: null,
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
    isFirstBatch: boolean,
  ) => {
    await runUploads(items);
    // If the very first batch produced ONLY failures, and nothing in the
    // queue is reviewable or saved, fall through to the parent's manual
    // fallback so the user isn't stuck staring at a list of red errors.
    if (!isFirstBatch) return;
    setQueue((prev) => {
      const anyUseful = prev.some(
        (q) => q.status === "needs-review" || q.status === "saved",
      );
      if (!anyUseful && prev.length > 0 && prev.every((q) => q.status === "failed")) {
        const summary =
          prev.length === 1
            ? prev[0].errorMessage ?? "Couldn't import the PDF."
            : `None of the ${prev.length} PDFs could be parsed.`;
        toast({
          title: "Couldn't import PDF",
          description: `${summary} Opening manual lease entry — you can add it by hand.`,
          variant: "destructive",
        });
        setOpen(false);
        onPdfImportFailed?.();
      }
      return prev;
    });
  };

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

  const handleSelectProperty = (value: string) => {
    if (!reviewingItem) return;
    if (value === NEW_PROPERTY_VALUE) {
      const draft =
        reviewingItem.propertyDraft ??
        (reviewingItem.importResult
          ? emptyPropertyDraft(reviewingItem.importResult.extracted)
          : null);
      updateQueueItem(reviewingItem.id, {
        selectedPropertyId: value,
        propertyDraft: draft,
      });
    } else {
      updateQueueItem(reviewingItem.id, {
        selectedPropertyId: value,
        propertyDraft: null,
      });
    }
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
    if (reviewingItem.selectedPropertyId === NEW_PROPERTY_VALUE) {
      const p = reviewingItem.propertyDraft;
      if (!p) return false;
      if (!p.name.trim()) return false;
      if (!p.customerId) return false;
      if (p.customerId === NEW_CUSTOMER_VALUE && !p.newCustomerName.trim()) return false;
      return true;
    }
    return !!reviewingItem.selectedPropertyId;
  })();

  const handleSaveReviewing = async () => {
    if (!reviewingItem || !reviewingItem.leaseDraft || saving) return;

    let propertyId = reviewingItem.selectedPropertyId;
    setSaving(true);
    try {
      if (
        reviewingItem.selectedPropertyId === NEW_PROPERTY_VALUE &&
        reviewingItem.propertyDraft
      ) {
        const draft = reviewingItem.propertyDraft;
        let customerId = draft.customerId;
        if (customerId === NEW_CUSTOMER_VALUE) {
          customerId = `cust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          try {
            await addCustomer({
              id: customerId,
              name: draft.newCustomerName.trim(),
              contactName: "",
              email: "",
              phone: "",
              notes: "Created from lease PDF import.",
              state: "",
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
      }

      // Buyout cost only carries through when the toggle is on AND the input
      // parses to a finite number — same invariant the lease detail page
      // uses, so the saved row matches what the reviewer was looking at.
      const buyoutAvailable = reviewingItem.leaseDraft.buyoutAvailable;
      const parsedBuyoutCost = parseFloat(reviewingItem.leaseDraft.buyoutCost);
      const buyoutCost =
        buyoutAvailable && Number.isFinite(parsedBuyoutCost)
          ? parsedBuyoutCost
          : null;

      const newLease: Lease = {
        id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        propertyId,
        startDate: reviewingItem.leaseDraft.startDate,
        endDate: reviewingItem.leaseDraft.endDate,
        monthlyRent: parseFloat(reviewingItem.leaseDraft.monthlyRent) || 0,
        securityDeposit: parseFloat(reviewingItem.leaseDraft.securityDeposit) || 0,
        status: reviewingItem.leaseDraft.status,
        notes: reviewingItem.leaseDraft.notes,
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
        customerResponsibleForRent: false,
      };
      addLease(newLease);

      const property = properties.find((p) => p.id === propertyId);
      toast({
        title: "Lease imported",
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

            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-add-more-pdfs"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add more files
              </Button>
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

        {stage === "review" && reviewingItem && reviewingItem.importResult && reviewingItem.leaseDraft && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="font-normal">
                <FileUp className="h-3 w-3 mr-1" />
                {reviewingItem.fileName}
              </Badge>
              <ConfidenceBadge confidence={reviewingItem.importResult.extracted.confidence} />
              {reviewingItem.importResult.extracted.landlordName && (
                <Badge variant="outline" className="font-normal">
                  Landlord: {reviewingItem.importResult.extracted.landlordName}
                </Badge>
              )}
            </div>

            <PdfFixupsSection fixups={reviewingItem.importResult.fixups ?? []} />

            <Separator />

            {/* ── Property section ─────────────────────────────────────── */}
            <div>
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <Building2 className="h-4 w-4" />
                Property
              </Label>
              {reviewingItem.importResult.candidates.length > 0 ? (
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

            {reviewingItem.selectedPropertyId === NEW_PROPERTY_VALUE && reviewingItem.propertyDraft && (
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
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-prop-customer">Customer *</Label>
                  <Select
                    value={reviewingItem.propertyDraft.customerId}
                    onValueChange={(v) => updateReviewingPropertyDraft({ customerId: v })}
                  >
                    <SelectTrigger id="pdf-prop-customer" data-testid="select-pdf-property-customer">
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
                </div>
                {reviewingItem.propertyDraft.customerId === NEW_CUSTOMER_VALUE && (
                  <div className="space-y-1.5">
                    <Label htmlFor="pdf-new-customer-name">New customer name *</Label>
                    <Input
                      id="pdf-new-customer-name"
                      value={reviewingItem.propertyDraft.newCustomerName}
                      onChange={(e) =>
                        updateReviewingPropertyDraft({ newCustomerName: e.target.value })
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
  const sizeKb = Math.max(1, Math.round(item.file.size / 1024));
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
          {sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`}
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
