import { useRef, useState } from "react";
import { useData } from "@/context/data-store";
import { useToast } from "@/hooks/use-toast";
import type { Property } from "@/data/mockData";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Lease-draft shape returned by POST /api/properties/from-lease (cast-safe —
 *  the endpoint is direct-fetch, not in the generated client). */
interface LeaseDraft {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  monthlyRent?: number;
  beds?: number;
  landlordName?: string;
  landlordPhone?: string;
  termStart?: string;
  termEnd?: string;
}

const baseUrl = (): string => import.meta.env.BASE_URL ?? "/";

export function AddPropertyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { addProperty } = useData();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<LeaseDraft | null>(null);
  const [needsReview, setNeedsReview] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setDraft(null);
    setNeedsReview([]);
    setErr(null);
    setParsing(false);
    setCreating(false);
  };

  async function parse(file: File) {
    setParsing(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${baseUrl()}api/properties/from-lease`, {
        method: "POST",
        body: fd,
      });
      const body = (await res.json().catch(() => ({}))) as {
        draft?: LeaseDraft;
        needsReview?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || "Couldn't read that lease.");
      setDraft(body.draft ?? {});
      setNeedsReview(body.needsReview ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read that lease.");
    } finally {
      setParsing(false);
    }
  }

  async function create() {
    if (!draft) return;
    setCreating(true);
    const property: Property = {
      id: `prop-${Date.now()}`,
      customerId: "",
      name: (draft.name || draft.address || "New property").trim(),
      address: (draft.address || "").trim(),
      city: (draft.city || "").trim(),
      state: (draft.state || "").trim(),
      zip: (draft.zip || "").trim(),
      totalBeds: Number(draft.beds) || 0,
      monthlyRent: Number(draft.monthlyRent) || 0,
      chargePerBed: 0,
      status: "Active",
      landlordName: (draft.landlordName || "").trim(),
      landlordEmail: "",
      landlordPhone: (draft.landlordPhone || "").trim(),
      paymentMethod: "ACH",
      paymentRecipient: "",
      paymentDueDay: 1,
      paymentNotes: "",
      bankName: "",
      bankRouting: "",
      bankAccount: "",
      portalUrl: "",
      notes: "Created from a dropped lease PDF — verify the flagged fields.",
      furnishings: [],
      propertyType: "Apartment",
    } as Property;
    try {
      await addProperty(property);
      toast({ title: "Property created", description: `${property.name} — review beds & client next.` });
      onOpenChange(false);
      reset();
    } catch {
      toast({ title: "Couldn't create the property", description: "Try again.", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  const flagged = (k: string) => needsReview.includes(k);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a property from a lease</DialogTitle>
        </DialogHeader>

        {!draft ? (
          <div className="space-y-3 pt-1">
            <div
              className="flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand/40 bg-accent/40 p-6 text-center hover:bg-accent"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) parse(f);
              }}
            >
              <div className="text-2xl text-brand">＋</div>
              <b className="mt-2 text-sm text-ink">{parsing ? "Reading the lease…" : "Drop a lease PDF or click to upload"}</b>
              <small className="mt-1 max-w-[220px] text-xs text-muted-foreground">
                We read the address, rent, beds &amp; landlord and set it up for you to review.
              </small>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) parse(f);
              }}
            />
            {err && <p className="text-xs text-risk">{err}</p>}
          </div>
        ) : (
          <div className="space-y-2 pt-1 text-sm">
            <p className="text-xs text-muted-foreground">Review the extracted fields before saving. Flagged fields need a look.</p>
            {([
              ["name", "Name", draft.name],
              ["address", "Address", [draft.address, draft.city, draft.state, draft.zip].filter(Boolean).join(", ")],
              ["monthlyRent", "Rent / mo", draft.monthlyRent != null ? `$${draft.monthlyRent}` : "—"],
              ["beds", "Beds", draft.beds ?? "—"],
              ["landlordName", "Landlord", draft.landlordName || "—"],
              ["term", "Term", [draft.termStart, draft.termEnd].filter(Boolean).join(" → ") || "—"],
            ] as [string, string, React.ReactNode][]).map(([k, label, val]) => (
              <div key={k} className="flex items-center justify-between border-b border-line py-1.5">
                <span className="text-muted-foreground">{label}</span>
                <span className="flex items-center gap-2 font-semibold text-ink tabular-nums">
                  {val || "—"}
                  {flagged(k) && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn">needs a look</span>}
                </span>
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => reset()}>Back</Button>
              <Button size="sm" disabled={creating} onClick={create}>
                {creating ? "Creating…" : "Create property"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
