import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { MainLayout } from "@/components/layout/main-layout";
import { useData, CustomerInUseError } from "@/context/data-store";
import { type Customer, toMonthlyCharge } from "@/data/mockData";
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
import { Search, Plus, Edit2, Trash2, Briefcase, Mail, Phone, ChevronRight, Trophy, TrendingUp, Building2, FileText, Zap, Eye } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const { customers, properties, beds, occupants, addCustomer, updateCustomer, deleteCustomer } = useData();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [draft, setDraft] = useState<Customer>(EMPTY_DRAFT);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  // Per-customer roll-ups: property count, total/occupied beds, occupancy %, and
  // monthly revenue (summed from each occupant's normalized monthly charge).
  // Recomputes whenever properties, beds, or occupants change so the numbers
  // stay in sync with edits elsewhere in the app.
  const statsByCustomer = useMemo(() => {
    const propertiesByCustomer = new Map<string, string[]>();
    for (const p of properties) {
      const list = propertiesByCustomer.get(p.customerId) ?? [];
      list.push(p.id);
      propertiesByCustomer.set(p.customerId, list);
    }

    const bedsByProperty = new Map<string, { total: number; occupied: number }>();
    for (const b of beds) {
      const entry = bedsByProperty.get(b.propertyId) ?? { total: 0, occupied: 0 };
      entry.total += 1;
      if (b.status === "Occupied") entry.occupied += 1;
      bedsByProperty.set(b.propertyId, entry);
    }

    const revenueByProperty = new Map<string, number>();
    for (const o of occupants) {
      if (o.status !== "Active" || !o.propertyId) continue;
      const monthly = toMonthlyCharge(o.chargePerBed, o.billingFrequency ?? "Monthly");
      revenueByProperty.set(o.propertyId, (revenueByProperty.get(o.propertyId) ?? 0) + monthly);
    }

    const map = new Map<
      string,
      { propertyCount: number; totalBeds: number; occupiedBeds: number; occupancyPct: number; monthlyRevenue: number }
    >();
    for (const c of customers) {
      const propIds = propertiesByCustomer.get(c.id) ?? [];
      let totalBeds = 0;
      let occupiedBeds = 0;
      let monthlyRevenue = 0;
      for (const pid of propIds) {
        const bedInfo = bedsByProperty.get(pid);
        if (bedInfo) {
          totalBeds += bedInfo.total;
          occupiedBeds += bedInfo.occupied;
        }
        monthlyRevenue += revenueByProperty.get(pid) ?? 0;
      }
      const occupancyPct = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;
      map.set(c.id, {
        propertyCount: propIds.length,
        totalBeds,
        occupiedBeds,
        occupancyPct,
        monthlyRevenue: Math.round(monthlyRevenue),
      });
    }
    return map;
  }, [customers, properties, beds, occupants]);

  // Top customers across the portfolio (highest occupancy %, highest revenue).
  // Ties broken by revenue / occupancy to give a stable, sensible pick. Only
  // customers with at least one bed (occupancy) or any revenue qualify.
  const topCustomers = useMemo(() => {
    let topOccupancy: { customer: Customer; pct: number; occupied: number; total: number } | null = null;
    let topRevenue: { customer: Customer; revenue: number } | null = null;
    for (const c of customers) {
      const s = statsByCustomer.get(c.id);
      if (!s) continue;
      if (s.totalBeds > 0) {
        if (
          !topOccupancy ||
          s.occupancyPct > topOccupancy.pct ||
          (s.occupancyPct === topOccupancy.pct && s.monthlyRevenue > (statsByCustomer.get(topOccupancy.customer.id)?.monthlyRevenue ?? 0))
        ) {
          topOccupancy = { customer: c, pct: s.occupancyPct, occupied: s.occupiedBeds, total: s.totalBeds };
        }
      }
      if (s.monthlyRevenue > 0) {
        if (!topRevenue || s.monthlyRevenue > topRevenue.revenue) {
          topRevenue = { customer: c, revenue: s.monthlyRevenue };
        }
      }
    }
    return { topOccupancy, topRevenue };
  }, [customers, statsByCustomer]);

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

        {/* Top customers summary — only meaningful when there's data to compare. */}
        {(topCustomers.topOccupancy || topCustomers.topRevenue) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card data-testid="card-top-occupancy">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                      Highest occupancy
                    </p>
                    {topCustomers.topOccupancy ? (
                      <>
                        <p className="text-lg font-semibold">{topCustomers.topOccupancy.customer.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {topCustomers.topOccupancy.occupied}/{topCustomers.topOccupancy.total} beds occupied
                          {" · "}
                          <span className="font-medium text-foreground">
                            {topCustomers.topOccupancy.pct.toFixed(0)}%
                          </span>
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">No bed data yet.</p>
                    )}
                  </div>
                  <div className="p-2 rounded-md bg-emerald-100 text-emerald-700">
                    <Trophy className="h-4 w-4" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-top-revenue">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                      Highest monthly revenue
                    </p>
                    {topCustomers.topRevenue ? (
                      <>
                        <p className="text-lg font-semibold">{topCustomers.topRevenue.customer.name}</p>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">
                            ${topCustomers.topRevenue.revenue.toLocaleString()}
                          </span>
                          /mo across all properties
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">No revenue yet.</p>
                    )}
                  </div>
                  <div className="p-2 rounded-md bg-primary/10 text-primary">
                    <TrendingUp className="h-4 w-4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

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
                  <TableHead className="text-center">Beds</TableHead>
                  <TableHead className="text-right">Revenue / mo</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      {customers.length === 0
                        ? "No customers yet. Add your first customer to get started."
                        : "No customers match your search."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((c, i) => {
                    const stats = statsByCustomer.get(c.id);
                    const count = stats?.propertyCount ?? 0;
                    const totalBeds = stats?.totalBeds ?? 0;
                    const occupiedBeds = stats?.occupiedBeds ?? 0;
                    const occupancyPct = stats?.occupancyPct ?? 0;
                    const monthlyRevenue = stats?.monthlyRevenue ?? 0;
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
                              onClick={() => navigate(`/customers/${encodeURIComponent(c.id)}`)}
                              className="font-semibold text-left hover:underline hover:text-primary transition-colors"
                              data-testid={`link-customer-name-${c.id}`}
                              title={`Open ${c.name}`}
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
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="inline-flex items-center"
                                  data-testid={`link-customer-properties-${c.id}`}
                                  aria-label={`View ${c.name}'s properties or leases`}
                                >
                                  <Badge variant="secondary" className="gap-1 cursor-pointer hover:bg-secondary/70">
                                    {count}
                                    <ChevronRight className="h-3 w-3" />
                                  </Badge>
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="center" className="w-48">
                                <DropdownMenuItem
                                  onClick={() => navigate(`/properties?customer=${encodeURIComponent(c.id)}`)}
                                  data-testid={`link-customer-goto-properties-${c.id}`}
                                >
                                  <Building2 className="mr-2 h-4 w-4" />
                                  View properties
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => navigate(`/leases?customer=${encodeURIComponent(c.id)}`)}
                                  data-testid={`link-customer-goto-leases-${c.id}`}
                                >
                                  <FileText className="mr-2 h-4 w-4" />
                                  View leases
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => navigate(`/utilities?customer=${encodeURIComponent(c.id)}`)}
                                  data-testid={`link-customer-goto-utilities-${c.id}`}
                                >
                                  <Zap className="mr-2 h-4 w-4" />
                                  View utilities
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">0</Badge>
                          )}
                        </td>
                        <td className="p-4 text-center text-sm" data-testid={`cell-customer-beds-${c.id}`}>
                          {totalBeds > 0 ? (
                            <div className="flex flex-col items-center leading-tight">
                              <span className="font-medium tabular-nums">
                                {occupiedBeds}/{totalBeds}
                              </span>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {occupancyPct.toFixed(0)}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4 text-right text-sm tabular-nums" data-testid={`cell-customer-revenue-${c.id}`}>
                          {monthlyRevenue > 0 ? (
                            <span className="font-medium">${monthlyRevenue.toLocaleString()}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => navigate(`/customers/${encodeURIComponent(c.id)}`)}
                              aria-label={`View ${c.name}`}
                              data-testid={`button-view-customer-${c.id}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
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
              {deleteTarget && (statsByCustomer.get(deleteTarget.id)?.propertyCount ?? 0) > 0 ? (
                <>
                  <span className="font-medium">{deleteTarget.name}</span> still owns{" "}
                  {statsByCustomer.get(deleteTarget.id)?.propertyCount} propert
                  {statsByCustomer.get(deleteTarget.id)?.propertyCount === 1 ? "y" : "ies"}.
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
