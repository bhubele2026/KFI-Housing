import { useEffect, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FileUp, Loader2, Sparkles, Building2, Plus } from "lucide-react";
import { useData } from "@/context/data-store";
import { useToast } from "@/hooks/use-toast";
import {
  importLeasePdf,
  LeasePdfImportError,
  type LeasePdfImportResponse,
  type ExtractedLeaseFromPdf,
  type PropertyMatchCandidate,
} from "@/lib/lease-pdf-import";
import type { Lease, Property } from "@/data/mockData";

const NEW_PROPERTY_VALUE = "__new_property__";
const NEW_CUSTOMER_VALUE = "__new_customer__";

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
  };
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

export interface UploadLeasePdfDialogProps {
  /** Optional custom trigger; defaults to an "Upload lease PDF" button. */
  trigger?: React.ReactNode;
  /** Callback fired after a lease is successfully created so the parent can show its own toast / scroll. */
  onLeaseCreated?: (lease: Lease) => void;
  /**
   * Called when PDF parsing or extraction fails so the parent can offer
   * a graceful fallback (e.g. open the manual Add Lease dialog).
   */
  onPdfImportFailed?: () => void;
}

/**
 * Multi-step dialog:
 *   1. Pick a PDF + upload → POST /api/leases/import-pdf
 *   2. Review the extracted fields, choose to attach to an existing
 *      property or create a new one (optionally inline-creating its
 *      customer), edit anything that's wrong, then save.
 *
 * The PDF itself is never stored — only the extracted fields land in
 * our DB.
 */
export function UploadLeasePdfDialog({ trigger, onLeaseCreated, onPdfImportFailed }: UploadLeasePdfDialogProps) {
  const { properties, customers, addProperty, addCustomer, addLease } = useData();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"pick" | "uploading" | "review">("pick");
  const [importResult, setImportResult] = useState<LeasePdfImportResponse | null>(null);
  const [fileName, setFileName] = useState<string>("");

  // Review stage controls.
  // selectedPropertyId: existing property id, NEW_PROPERTY_VALUE, or "" while undecided.
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [propertyDraft, setPropertyDraft] = useState<PropertyDraft | null>(null);
  const [leaseDraft, setLeaseDraft] = useState<LeaseDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset everything whenever the dialog closes so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setStage("pick");
      setImportResult(null);
      setFileName("");
      setSelectedPropertyId("");
      setPropertyDraft(null);
      setLeaseDraft(null);
      setSaving(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open]);

  const handleFileChosen = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setStage("uploading");
    try {
      const result = await importLeasePdf(file);
      setImportResult(result);
      setLeaseDraft(leaseDraftFromExtracted(result.extracted));
      // Default selection: ONLY auto-pick when there's a confident top match.
      // For low-confidence runs we leave it unset so the user has to make an
      // intentional choice (existing property OR explicit "create new").
      if (result.topMatch) {
        setSelectedPropertyId(result.topMatch.propertyId);
        setPropertyDraft(null);
      } else {
        setSelectedPropertyId("");
        setPropertyDraft(null);
      }
      setStage("review");
    } catch (err) {
      const message =
        err instanceof LeasePdfImportError
          ? err.message
          : "Failed to upload lease PDF. Please try again.";
      toast({
        title: "Couldn't import PDF",
        description: `${message} Opening manual lease entry — you can add it by hand.`,
        variant: "destructive",
      });
      // Close this dialog and hand off to the manual Add Lease dialog so the
      // user doesn't lose their place. The parent owns the fallback UI; we
      // just signal it via onPdfImportFailed.
      setOpen(false);
      onPdfImportFailed?.();
    }
  };

  const handleSelectProperty = (value: string) => {
    setSelectedPropertyId(value);
    if (value === NEW_PROPERTY_VALUE && importResult) {
      setPropertyDraft((prev) => prev ?? emptyPropertyDraft(importResult.extracted));
    } else {
      setPropertyDraft(null);
    }
  };

  const canSave = (() => {
    if (!leaseDraft || !leaseDraft.startDate || !leaseDraft.endDate || !leaseDraft.monthlyRent) {
      return false;
    }
    if (selectedPropertyId === NEW_PROPERTY_VALUE) {
      if (!propertyDraft) return false;
      if (!propertyDraft.name.trim()) return false;
      if (!propertyDraft.customerId) return false;
      if (
        propertyDraft.customerId === NEW_CUSTOMER_VALUE &&
        !propertyDraft.newCustomerName.trim()
      ) {
        return false;
      }
      return true;
    }
    return !!selectedPropertyId;
  })();

  const handleSave = async () => {
    if (!leaseDraft || saving) return;

    let propertyId = selectedPropertyId;

    setSaving(true);
    try {
      // Resolve / create property.
      if (selectedPropertyId === NEW_PROPERTY_VALUE && propertyDraft) {
        // First make sure we have a customer id — inline-create if needed.
        let customerId = propertyDraft.customerId;
        if (customerId === NEW_CUSTOMER_VALUE) {
          customerId = `cust-${Date.now()}`;
          try {
            await addCustomer({
              id: customerId,
              name: propertyDraft.newCustomerName.trim(),
              contactName: "",
              email: "",
              phone: "",
              notes: "Created from lease PDF import.",
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
          id: `prop-${Date.now()}`,
          customerId,
          name: propertyDraft.name.trim(),
          address: propertyDraft.address.trim(),
          city: propertyDraft.city.trim(),
          state: propertyDraft.state.trim(),
          zip: propertyDraft.zip.trim(),
          totalBeds: 0,
          monthlyRent: 0,
          chargePerBed: 0,
          status: "Active",
          landlordName: importResult?.extracted.landlordName ?? "",
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
            description:
              "Saving the new property failed on the server. The lease was not created.",
            variant: "destructive",
          });
          return;
        }
      }

      const newLease: Lease = {
        id: `l-${Date.now()}`,
        propertyId,
        startDate: leaseDraft.startDate,
        endDate: leaseDraft.endDate,
        monthlyRent: parseFloat(leaseDraft.monthlyRent) || 0,
        securityDeposit: parseFloat(leaseDraft.securityDeposit) || 0,
        status: leaseDraft.status,
        notes: leaseDraft.notes,
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
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

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
            {stage === "review" ? "Review extracted lease" : "Import lease from PDF"}
          </DialogTitle>
          <DialogDescription>
            {stage === "review"
              ? "Confirm the details parsed from the PDF, then attach it to an existing property or create a new one. The PDF itself is not stored."
              : "Pick a single text-based lease PDF. We'll extract the key fields with AI and let you review them before saving."}
          </DialogDescription>
        </DialogHeader>

        {stage === "pick" && (
          <div className="space-y-3 py-2">
            <Input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={(e) => handleFileChosen(e.target.files?.[0])}
              data-testid="input-lease-pdf-file"
            />
            <p className="text-xs text-muted-foreground">
              Max 10 MB. Image-only / scanned PDFs aren't supported (OCR is off).
            </p>
          </div>
        )}

        {stage === "uploading" && (
          <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>
              Reading <span className="font-medium text-foreground">{fileName}</span> and
              extracting lease fields…
            </span>
          </div>
        )}

        {stage === "review" && importResult && leaseDraft && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="font-normal">
                <FileUp className="h-3 w-3 mr-1" />
                {fileName}
              </Badge>
              <ConfidenceBadge confidence={importResult.extracted.confidence} />
              {importResult.extracted.landlordName && (
                <Badge variant="outline" className="font-normal">
                  Landlord: {importResult.extracted.landlordName}
                </Badge>
              )}
            </div>

            <Separator />

            {/* ── Property section ─────────────────────────────────────── */}
            <div>
              <Label className="text-sm font-semibold flex items-center gap-1.5">
                <Building2 className="h-4 w-4" />
                Property
              </Label>
              {importResult.candidates.length > 0 ? (
                <PropertyMatchPicker
                  candidates={importResult.candidates}
                  topMatch={importResult.topMatch}
                  selectedValue={selectedPropertyId}
                  onSelect={handleSelectProperty}
                />
              ) : (
                <p className="text-xs text-muted-foreground mt-1">
                  No close matches found in your portfolio. We'll create a new property.
                </p>
              )}
              <Select value={selectedPropertyId} onValueChange={handleSelectProperty}>
                <SelectTrigger
                  className="mt-2"
                  data-testid="select-pdf-property-target"
                >
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

            {selectedPropertyId === NEW_PROPERTY_VALUE && propertyDraft && (
              <div className="space-y-3 p-3 rounded-md border bg-muted/30">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  New property
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-prop-name">Property name *</Label>
                  <Input
                    id="pdf-prop-name"
                    value={propertyDraft.name}
                    onChange={(e) =>
                      setPropertyDraft({ ...propertyDraft, name: e.target.value })
                    }
                    data-testid="input-pdf-property-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-prop-address">Address</Label>
                  <Input
                    id="pdf-prop-address"
                    value={propertyDraft.address}
                    onChange={(e) =>
                      setPropertyDraft({ ...propertyDraft, address: e.target.value })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label htmlFor="pdf-prop-city">City</Label>
                    <Input
                      id="pdf-prop-city"
                      value={propertyDraft.city}
                      onChange={(e) =>
                        setPropertyDraft({ ...propertyDraft, city: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pdf-prop-state">State</Label>
                    <Input
                      id="pdf-prop-state"
                      value={propertyDraft.state}
                      onChange={(e) =>
                        setPropertyDraft({ ...propertyDraft, state: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pdf-prop-zip">ZIP</Label>
                    <Input
                      id="pdf-prop-zip"
                      value={propertyDraft.zip}
                      onChange={(e) =>
                        setPropertyDraft({ ...propertyDraft, zip: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-prop-customer">Customer *</Label>
                  <Select
                    value={propertyDraft.customerId}
                    onValueChange={(v) =>
                      setPropertyDraft({ ...propertyDraft, customerId: v })
                    }
                  >
                    <SelectTrigger
                      id="pdf-prop-customer"
                      data-testid="select-pdf-property-customer"
                    >
                      <SelectValue placeholder="Choose a customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={NEW_CUSTOMER_VALUE}>
                        + Create new customer…
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {propertyDraft.customerId === NEW_CUSTOMER_VALUE && (
                  <div className="space-y-1.5">
                    <Label htmlFor="pdf-new-customer-name">New customer name *</Label>
                    <Input
                      id="pdf-new-customer-name"
                      value={propertyDraft.newCustomerName}
                      onChange={(e) =>
                        setPropertyDraft({
                          ...propertyDraft,
                          newCustomerName: e.target.value,
                        })
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
                    value={leaseDraft.startDate}
                    onChange={(e) =>
                      setLeaseDraft({ ...leaseDraft, startDate: e.target.value })
                    }
                    data-testid="input-pdf-lease-start"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-lease-end">End date *</Label>
                  <Input
                    id="pdf-lease-end"
                    type="date"
                    value={leaseDraft.endDate}
                    onChange={(e) =>
                      setLeaseDraft({ ...leaseDraft, endDate: e.target.value })
                    }
                    data-testid="input-pdf-lease-end"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-lease-rent">Monthly rent ($) *</Label>
                  <Input
                    id="pdf-lease-rent"
                    type="number"
                    value={leaseDraft.monthlyRent}
                    onChange={(e) =>
                      setLeaseDraft({ ...leaseDraft, monthlyRent: e.target.value })
                    }
                    data-testid="input-pdf-lease-rent"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pdf-lease-deposit">Security deposit ($)</Label>
                  <Input
                    id="pdf-lease-deposit"
                    type="number"
                    value={leaseDraft.securityDeposit}
                    onChange={(e) =>
                      setLeaseDraft({ ...leaseDraft, securityDeposit: e.target.value })
                    }
                    data-testid="input-pdf-lease-deposit"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pdf-lease-status">Status</Label>
                <Select
                  value={leaseDraft.status}
                  onValueChange={(v) =>
                    setLeaseDraft({ ...leaseDraft, status: v as Lease["status"] })
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
                  value={leaseDraft.notes}
                  onChange={(e) =>
                    setLeaseDraft({ ...leaseDraft, notes: e.target.value })
                  }
                  data-testid="textarea-pdf-lease-notes"
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {stage === "review" ? (
            <>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!canSave || saving}
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
          ) : (
            <Button variant="outline" onClick={() => setOpen(false)} disabled={stage === "uploading"}>
              {stage === "uploading" ? "Working…" : "Cancel"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
