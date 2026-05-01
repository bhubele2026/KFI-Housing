import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { MainLayout } from "@/components/layout/main-layout";
import { useData, CustomerInUseError } from "@/context/data-store";
import { type Customer } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Plus, Edit2, Trash2, Briefcase, Mail, Phone, ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const EMPTY_DRAFT: Customer = {
  id: "",
  name: "",
  contactName: "",
  email: "",
  phone: "",
  notes: "",
};

export default function Customers() {
  const [location, navigate] = useLocation();
  const { customers, properties, addCustomer, updateCustomer, deleteCustomer } = useData();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [draft, setDraft] = useState<Customer>(EMPTY_DRAFT);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  const propertyCountByCustomer = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of properties) {
      map.set(p.customerId, (map.get(p.customerId) ?? 0) + 1);
    }
    return map;
  }, [properties]);

  // If we arrived via #customer-<id>, briefly highlight that row and scroll to it.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#customer-")) return;
    const targetId = hash.slice("#customer-".length);
    if (!customers.some((c) => c.id === targetId)) return;
    setHighlightedId(targetId);
    const el = document.getElementById(`customer-row-${targetId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlightedId(null), 2200);
    return () => clearTimeout(t);
  }, [customers, location]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return customers;
    return customers.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.contactName.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q),
    );
  }, [customers, search]);

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setDialogOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setDraft(c);
    setDialogOpen(true);
  };

  const handleSave = () => {
    const name = draft.name.trim();
    if (!name) {
      toast({
        title: "Name is required",
        description: "Please enter a customer (company) name.",
        variant: "destructive",
      });
      return;
    }
    const payload: Customer = {
      ...draft,
      name,
      contactName: draft.contactName.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      notes: draft.notes,
    };
    if (editing) {
      updateCustomer(editing.id, payload);
      toast({ title: "Customer updated", description: `${payload.name} saved.` });
    } else {
      const id = `cust-${Date.now()}`;
      addCustomer({ ...payload, id });
      toast({ title: "Customer added", description: `${payload.name} created.` });
    }
    setDialogOpen(false);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCustomer(deleteTarget.id);
      toast({ title: "Customer deleted", description: `${deleteTarget.name} was removed.` });
      setDeleteTarget(null);
    } catch (err) {
      if (err instanceof CustomerInUseError) {
        toast({
          title: "Can't delete this customer",
          description: `${deleteTarget.name} still owns one or more properties. Reassign or remove those properties first.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Delete failed",
          description: "Something went wrong. Please try again.",
          variant: "destructive",
        });
      }
      setDeleteTarget(null);
    }
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
            <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
            <p className="text-muted-foreground mt-1">
              Companies that lease beds across your portfolio.
            </p>
          </div>
          <Button onClick={openAdd} data-testid="button-add-customer">
            <Plus className="mr-2 h-4 w-4" />
            Add Customer
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search customers..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-search-customers"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {filtered.length} of {customers.length} customer{customers.length === 1 ? "" : "s"}
              </span>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Primary Contact</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-center">Properties</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      {customers.length === 0
                        ? "No customers yet. Add your first customer to get started."
                        : "No customers match your search."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((c, i) => {
                    const count = propertyCountByCustomer.get(c.id) ?? 0;
                    const isHighlighted = highlightedId === c.id;
                    return (
                      <motion.tr
                        key={c.id}
                        id={`customer-row-${c.id}`}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className={`border-b hover:bg-muted/40 transition-colors ${
                          isHighlighted ? "bg-primary/5 ring-1 ring-primary/30" : ""
                        }`}
                        data-testid={`row-customer-${c.id}`}
                      >
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-md bg-primary/10">
                              <Briefcase className="h-3.5 w-3.5 text-primary" />
                            </div>
                            <button
                              type="button"
                              onClick={() => navigate(`/properties?customer=${encodeURIComponent(c.id)}`)}
                              className="font-semibold text-left hover:underline hover:text-primary transition-colors"
                              data-testid={`link-customer-name-${c.id}`}
                              title="View this customer's properties"
                            >
                              {c.name}
                            </button>
                          </div>
                        </td>
                        <td className="p-4 text-sm">{c.contactName || <span className="text-muted-foreground">—</span>}</td>
                        <td className="p-4 text-sm">
                          {c.email ? (
                            <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:underline">
                              <Mail className="h-3 w-3 text-muted-foreground" />
                              {c.email}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4 text-sm">
                          {c.phone ? (
                            <span className="inline-flex items-center gap-1">
                              <Phone className="h-3 w-3 text-muted-foreground" />
                              {c.phone}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          {count > 0 ? (
                            <button
                              type="button"
                              onClick={() => navigate(`/properties?customer=${encodeURIComponent(c.id)}`)}
                              className="inline-flex items-center"
                              data-testid={`link-customer-properties-${c.id}`}
                            >
                              <Badge variant="secondary" className="gap-1 cursor-pointer hover:bg-secondary/70">
                                {count}
                                <ChevronRight className="h-3 w-3" />
                              </Badge>
                            </button>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">0</Badge>
                          )}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => openEdit(c)}
                              aria-label={`Edit ${c.name}`}
                              data-testid={`button-edit-customer-${c.id}`}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            {count > 0 ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  {/* span wrapper so Tooltip works even when the button is disabled */}
                                  <span>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                      disabled
                                      aria-label={`Delete ${c.name}`}
                                      aria-disabled="true"
                                      data-testid={`button-delete-customer-${c.id}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-xs">
                                  Can't delete — {c.name} still owns {count} propert{count === 1 ? "y" : "ies"}.
                                  Reassign or remove those properties first.
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                onClick={() => setDeleteTarget(c)}
                                aria-label={`Delete ${c.name}`}
                                data-testid={`button-delete-customer-${c.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </motion.div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit customer" : "Add customer"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update this customer's contact details."
                : "Customers represent the companies that lease beds in your properties."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="cust-name">Company name *</Label>
              <Input
                id="cust-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Acme Energy"
                data-testid="input-customer-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cust-contact">Primary contact</Label>
              <Input
                id="cust-contact"
                value={draft.contactName}
                onChange={(e) => setDraft({ ...draft, contactName: e.target.value })}
                placeholder="Dana Rivera"
                data-testid="input-customer-contact"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cust-phone">Phone</Label>
              <Input
                id="cust-phone"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                placeholder="555-555-1234"
                data-testid="input-customer-phone"
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="cust-email">Email</Label>
              <Input
                id="cust-email"
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="contact@company.com"
                data-testid="input-customer-email"
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="cust-notes">Notes</Label>
              <Textarea
                id="cust-notes"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="Billing terms, preferences, etc."
                className="min-h-[72px]"
                data-testid="input-customer-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} data-testid="button-save-customer">
              {editing ? "Save changes" : "Add customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this customer?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (propertyCountByCustomer.get(deleteTarget.id) ?? 0) > 0 ? (
                <>
                  <span className="font-medium">{deleteTarget.name}</span> still owns{" "}
                  {propertyCountByCustomer.get(deleteTarget.id)} propert
                  {propertyCountByCustomer.get(deleteTarget.id) === 1 ? "y" : "ies"}.
                  You'll need to reassign or remove those properties before this customer
                  can be deleted.
                </>
              ) : (
                <>
                  This permanently removes{" "}
                  <span className="font-medium">{deleteTarget?.name}</span>. This action
                  cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-customer-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-delete-customer-confirm"
            >
              Delete customer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
