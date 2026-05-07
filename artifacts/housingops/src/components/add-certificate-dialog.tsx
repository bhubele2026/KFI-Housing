import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import type { InsuranceCertificate, Property, Customer } from "@/data/mockData";

export interface AddCertificateDialogProps {
  properties: readonly Property[];
  customers: readonly Customer[];
  onAdd: (cert: InsuranceCertificate) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}

export function AddCertificateDialog({
  properties,
  customers,
  onAdd,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  trigger,
}: AddCertificateDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (controlledOnOpenChange ?? (() => {})) : setInternalOpen;

  const [form, setForm] = useState({
    propertyId: "",
    carrier: "",
    policyNumber: "",
    insuredName: "",
    coverageStart: "",
    coverageEnd: "",
    documentUrl: "",
    notes: "",
  });

  const customerById = new Map(customers.map((c) => [c.id, c.name]));

  const submit = () => {
    if (!form.propertyId || !form.carrier) return;
    onAdd({
      id: `ins-${Date.now()}`,
      propertyId: form.propertyId,
      leaseId: "",
      carrier: form.carrier,
      policyNumber: form.policyNumber,
      insuredName: form.insuredName,
      coverageStart: form.coverageStart,
      coverageEnd: form.coverageEnd,
      documentUrl: form.documentUrl,
      notes: form.notes,
    });
    setOpen(false);
    setForm({
      propertyId: "", carrier: "", policyNumber: "", insuredName: "",
      coverageStart: "", coverageEnd: "", documentUrl: "", notes: "",
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" data-testid="button-add-certificate">
            <Plus className="h-4 w-4 mr-1.5" />Add Certificate
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add Insurance Certificate</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <Label>Property</Label>
            <Select
              value={form.propertyId}
              onValueChange={(v) => setForm((f) => ({ ...f, propertyId: v }))}
            >
              <SelectTrigger data-testid="select-certificate-property"><SelectValue placeholder="Select a property" /></SelectTrigger>
              <SelectContent>
                {properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}{customerById.get(p.customerId) ? ` (${customerById.get(p.customerId)})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Carrier</Label>
              <Input
                value={form.carrier}
                onChange={(e) => setForm((f) => ({ ...f, carrier: e.target.value }))}
                placeholder="e.g. Philadelphia Indemnity"
                data-testid="input-certificate-carrier"
              />
            </div>
            <div>
              <Label>Policy #</Label>
              <Input
                value={form.policyNumber}
                onChange={(e) => setForm((f) => ({ ...f, policyNumber: e.target.value }))}
                placeholder="Optional"
                data-testid="input-certificate-policy"
              />
            </div>
            <div className="col-span-2">
              <Label>Insured Name</Label>
              <Input
                value={form.insuredName}
                onChange={(e) => setForm((f) => ({ ...f, insuredName: e.target.value }))}
                placeholder="Named insured on the certificate"
                data-testid="input-certificate-insured"
              />
            </div>
            <div>
              <Label>Coverage Start</Label>
              <Input
                type="date"
                value={form.coverageStart}
                onChange={(e) => setForm((f) => ({ ...f, coverageStart: e.target.value }))}
                data-testid="input-certificate-start"
              />
            </div>
            <div>
              <Label>Coverage End</Label>
              <Input
                type="date"
                value={form.coverageEnd}
                onChange={(e) => setForm((f) => ({ ...f, coverageEnd: e.target.value }))}
                data-testid="input-certificate-end"
              />
            </div>
            <div className="col-span-2">
              <Label>Document URL</Label>
              <Input
                value={form.documentUrl}
                onChange={(e) => setForm((f) => ({ ...f, documentUrl: e.target.value }))}
                placeholder="Link to the source PDF (optional)"
                data-testid="input-certificate-doc"
              />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Optional notes"
              data-testid="input-certificate-notes"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={submit}
              disabled={!form.propertyId || !form.carrier}
              data-testid="button-certificate-submit"
            >
              Add Certificate
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
