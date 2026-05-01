import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { getRenewalInfo, computeOverallRating, RATING_CATEGORIES, type Property, type Customer } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Search, Plus, ChevronRight, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Briefcase, X } from "lucide-react";
import { motion } from "framer-motion";
import { StarRating } from "@/components/star-rating";
import { SkeletonRows } from "@/components/skeleton-rows";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

type SortDir = "asc" | "desc" | null;
type SortKey = "customer" | "rating";
type MinRating = "any" | "3" | "4" | "5";

interface PropertyDraft {
  name: string;
  customerId: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

const EMPTY_PROPERTY_DRAFT: PropertyDraft = {
  name: "",
  customerId: "",
  address: "",
  city: "",
  state: "",
  zip: "",
};

interface NewCustomerDraft {
  name: string;
  contactName: string;
  email: string;
  phone: string;
}

const EMPTY_NEW_CUSTOMER: NewCustomerDraft = {
  name: "",
  contactName: "",
  email: "",
  phone: "",
};

const NEW_CUSTOMER_VALUE = "__new__";

export default function Properties() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const { properties, beds, leases, customers, addProperty, addCustomer, isLoading } = useData();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [customerFilter, setCustomerFilter] = useState("All");
  const [minRating, setMinRating] = useState<MinRating>("any");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState<PropertyDraft>(EMPTY_PROPERTY_DRAFT);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState<NewCustomerDraft>(EMPTY_NEW_CUSTOMER);

  const customerById = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) map.set(c.id, c);
    return map;
  }, [customers]);

  // Sync ?customer=... URL parameter into the filter state.
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const param = params.get("customer");
    if (param && customers.some((c) => c.id === param)) {
      setCustomerFilter(param);
    } else if (!param && customerFilter !== "All") {
      setCustomerFilter("All");
    }
    // We intentionally only react to URL changes and the customer list shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchString, customers]);

  const updateCustomerFilter = (next: string) => {
    setCustomerFilter(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "All") params.delete("customer");
    else params.set("customer", next);
    const qs = params.toString();
    const base = window.location.pathname;
    navigate(qs ? `${base}?${qs}` : base, { replace: true });
  };

  const filtered = useMemo(() => {
    const minRatingValue = minRating === "any" ? null : Number(minRating);

    const list = properties.filter((p) => {
      const customerName = customerById.get(p.customerId)?.name ?? "";
      const q = search.toLowerCase();
      const matchesSearch =
        p.name.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        customerName.toLowerCase().includes(q);
      const matchesStatus = statusFilter === "All" || p.status === statusFilter;
      const matchesCustomer = customerFilter === "All" || p.customerId === customerFilter;
      let matchesRating = true;
      if (minRatingValue !== null) {
        const overall = computeOverallRating(p.ratings);
        // Unrated properties are excluded when a minimum is set.
        matchesRating = overall !== null && overall >= minRatingValue;
      }
      return matchesSearch && matchesStatus && matchesCustomer && matchesRating;
    });

    if (sortKey && sortDir) {
      if (sortKey === "customer") {
        list.sort((a, b) => {
          const an = customerById.get(a.customerId)?.name ?? "";
          const bn = customerById.get(b.customerId)?.name ?? "";
          const cmp = an.localeCompare(bn);
          return sortDir === "asc" ? cmp : -cmp;
        });
      } else if (sortKey === "rating") {
        list.sort((a, b) => {
          const ar = computeOverallRating(a.ratings);
          const br = computeOverallRating(b.ratings);
          // Unrated properties always sort to the end, regardless of direction.
          if (ar === null && br === null) return 0;
          if (ar === null) return 1;
          if (br === null) return -1;
          const cmp = ar - br;
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }
    return list;
  }, [properties, search, statusFilter, customerFilter, minRating, sortKey, sortDir, customerById]);

  const cycleSort = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    // Same column: asc -> desc -> off
    if (sortDir === "asc") {
      setSortDir("desc");
    } else if (sortDir === "desc") {
      setSortKey(null);
      setSortDir(null);
    } else {
      setSortDir("asc");
    }
  };

  const toggleCustomerSort = () => cycleSort("customer");
  const toggleRatingSort = () => cycleSort("rating");

  const customerSortDir: SortDir = sortKey === "customer" ? sortDir : null;
  const ratingSortDir: SortDir = sortKey === "rating" ? sortDir : null;

  const openAdd = () => {
    setDraft(EMPTY_PROPERTY_DRAFT);
    setShowNewCustomerForm(false);
    setNewCustomer(EMPTY_NEW_CUSTOMER);
    setAddOpen(true);
  };

  const [saving, setSaving] = useState(false);

  const handleSaveProperty = async () => {
    if (saving) return;
    const name = draft.name.trim();
    if (!name) {
      toast({
        title: "Name is required",
        description: "Please enter a property name.",
        variant: "destructive",
      });
      return;
    }

    let customerId = draft.customerId;
    if (showNewCustomerForm) {
      const cName = newCustomer.name.trim();
      if (!cName) {
        toast({
          title: "Customer name is required",
          description: "Please enter a name for the new customer.",
          variant: "destructive",
        });
        return;
      }
      customerId = `cust-${Date.now()}`;
    }
    if (!customerId) {
      toast({
        title: "Customer is required",
        description: "Please select a customer or create a new one.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      // If we're inline-creating a customer, persist it FIRST and await the
      // server response. The property's POST will then pass the backend's
      // foreign-key check on customerId. Without this await they race.
      if (showNewCustomerForm) {
        try {
          await addCustomer({
            id: customerId,
            name: newCustomer.name.trim(),
            contactName: newCustomer.contactName.trim(),
            email: newCustomer.email.trim(),
            phone: newCustomer.phone.trim(),
            notes: "",
          });
        } catch {
          toast({
            title: "Couldn't create customer",
            description: "The new customer couldn't be saved. The property was not created.",
            variant: "destructive",
          });
          return;
        }
      }

      const newProperty: Property = {
        id: `prop-${Date.now()}`,
        customerId,
        name,
        address: draft.address.trim(),
        city: draft.city.trim(),
        state: draft.state.trim(),
        zip: draft.zip.trim(),
        totalBeds: 0,
        monthlyRent: 0,
        chargePerBed: 0,
        status: "Active",
        landlordName: "",
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
        await addProperty(newProperty);
        toast({ title: "Property added", description: `${name} created.` });
        setAddOpen(false);
      } catch {
        toast({
          title: "Couldn't create property",
          description:
            "Saving failed on the server. Please verify the customer exists and try again.",
          variant: "destructive",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const activeCustomerName =
    customerFilter === "All" ? null : customerById.get(customerFilter)?.name ?? null;

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
            <h1 className="text-3xl font-bold tracking-tight">Properties</h1>
            <p className="text-muted-foreground mt-1">Select a property to manage it</p>
          </div>
          <Button onClick={openAdd} data-testid="button-add-property">
            <Plus className="mr-2 h-4 w-4" />
            Add Property
          </Button>
        </div>

        {activeCustomerName && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 px-2 py-1" data-testid="badge-customer-filter">
              <Briefcase className="h-3 w-3" />
              Filtered by customer: <span className="font-semibold">{activeCustomerName}</span>
              <button
                type="button"
                onClick={() => updateCustomerFilter("All")}
                className="ml-1 rounded-sm p-0.5 hover:bg-background/40"
                aria-label="Clear customer filter"
                data-testid="button-clear-customer-filter"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search properties or customers..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-search-properties"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Select value={customerFilter} onValueChange={updateCustomerFilter}>
                  <SelectTrigger className="w-full sm:w-56" data-testid="select-customer-filter">
                    <SelectValue placeholder="Customer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Customers</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-40" data-testid="select-status-filter">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Statuses</SelectItem>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={minRating} onValueChange={(v) => setMinRating(v as MinRating)}>
                  <SelectTrigger className="w-full sm:w-36" data-testid="select-min-rating">
                    <SelectValue placeholder="Min rating" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any rating</SelectItem>
                    <SelectItem value="3">3+ stars</SelectItem>
                    <SelectItem value="4">4+ stars</SelectItem>
                    <SelectItem value="5">5 stars</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={toggleCustomerSort}
                      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                      data-testid="button-sort-customer"
                    >
                      Customer
                      {customerSortDir === "asc" ? (
                        <ArrowUp className="h-3.5 w-3.5" />
                      ) : customerSortDir === "desc" ? (
                        <ArrowDown className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead className="text-center">Total Beds</TableHead>
                  <TableHead className="text-center">Occupied</TableHead>
                  <TableHead className="text-center">Vacant</TableHead>
                  <TableHead className="text-right">Charge / Bed</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={toggleRatingSort}
                      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                      data-testid="button-sort-rating"
                    >
                      Rating
                      {ratingSortDir === "asc" ? (
                        <ArrowUp className="h-3.5 w-3.5" />
                      ) : ratingSortDir === "desc" ? (
                        <ArrowDown className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead>Lease Renewal</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <SkeletonRows rows={6} columns={11} />
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="h-24 text-center text-muted-foreground">
                      No properties found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((property, i) => {
                    const propBeds = beds.filter((b) => b.propertyId === property.id);
                    const occupied = propBeds.filter((b) => b.status === "Occupied").length;
                    const vacant = propBeds.length - occupied;
                    const activeLease = leases.find((l) => l.propertyId === property.id && l.status === "Active");
                    const renewal = activeLease ? getRenewalInfo(activeLease.endDate) : null;
                    const showRenewal = renewal && renewal.level !== "ok";
                    const overallRating = computeOverallRating(property.ratings);
                    const customer = customerById.get(property.customerId);

                    return (
                      <motion.tr
                        key={property.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="cursor-pointer hover:bg-muted/50 border-b transition-colors group"
                        onClick={() => navigate(`/properties/${property.id}`)}
                        data-testid={`row-property-${property.id}`}
                      >
                        <td className="p-4 font-semibold">{property.name}</td>
                        <td className="p-4 text-sm" data-testid={`cell-customer-${property.id}`}>
                          {customer ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Briefcase className="h-3 w-3 text-muted-foreground" />
                              {customer.name}
                            </span>
                          ) : (
                            <span className="text-muted-foreground italic">Unassigned</span>
                          )}
                        </td>
                        <td className="p-4 text-sm text-muted-foreground">{property.address}</td>
                        <td className="p-4 text-sm text-muted-foreground">{property.city}, {property.state}</td>
                        <td className="p-4 text-center text-sm">{propBeds.length}</td>
                        <td className="p-4 text-center">
                          <span className="text-sm font-medium text-green-600">{occupied}</span>
                        </td>
                        <td className="p-4 text-center">
                          <span className={`text-sm font-medium ${vacant > 0 ? "text-amber-500" : "text-muted-foreground"}`}>{vacant}</span>
                        </td>
                        <td className="p-4 text-right text-sm font-medium">${property.chargePerBed.toLocaleString()}</td>
                        <td className="p-4 text-center">
                          <Badge variant={property.status === "Active" ? "default" : "secondary"}>
                            {property.status}
                          </Badge>
                        </td>
                        <td className="p-4" data-testid={`cell-rating-${property.id}`}>
                          {overallRating === null ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <HoverCard openDelay={120} closeDelay={80}>
                              <HoverCardTrigger asChild>
                                <button
                                  type="button"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1.5 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                                  aria-label={`${property.name} rating breakdown`}
                                  data-testid={`rating-trigger-${property.id}`}
                                >
                                  <StarRating value={overallRating} readOnly size="sm" ariaLabel={`${property.name} overall rating`} />
                                  <span className="text-xs font-medium tabular-nums">{overallRating.toFixed(1)}</span>
                                </button>
                              </HoverCardTrigger>
                              <HoverCardContent
                                align="start"
                                sideOffset={6}
                                className="w-64 p-3"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`rating-breakdown-${property.id}`}
                              >
                                <div className="flex items-center justify-between pb-2 mb-2 border-b">
                                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Overall
                                  </span>
                                  <span className="inline-flex items-center gap-1.5">
                                    <StarRating value={overallRating} readOnly size="sm" ariaLabel="Overall" />
                                    <span className="text-xs font-semibold tabular-nums">{overallRating.toFixed(1)}</span>
                                  </span>
                                </div>
                                <ul className="space-y-1.5">
                                  {RATING_CATEGORIES.map(({ key, label }) => {
                                    const v = property.ratings?.[key] ?? 0;
                                    return (
                                      <li
                                        key={key}
                                        className="flex items-center justify-between gap-2 text-xs"
                                        data-testid={`rating-breakdown-${property.id}-${key}`}
                                      >
                                        <span className="text-muted-foreground">{label}</span>
                                        <span className="inline-flex items-center gap-1.5">
                                          {v > 0 ? (
                                            <>
                                              <StarRating value={v} readOnly size="sm" ariaLabel={`${label} rating`} />
                                              <span className="font-medium tabular-nums w-4 text-right">{v}</span>
                                            </>
                                          ) : (
                                            <span className="text-muted-foreground italic">Not rated</span>
                                          )}
                                        </span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </HoverCardContent>
                            </HoverCard>
                          )}
                        </td>
                        <td className="p-4">
                          {showRenewal && renewal ? (
                            <Badge variant="outline" className={`text-[11px] font-medium ${renewal.badgeClass}`}>
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              {renewal.label}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-4">
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
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

      {/* Add Property Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add property</DialogTitle>
            <DialogDescription>
              Every property is owned by a customer. Pick an existing one or create a new customer inline.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="prop-name">Property name *</Label>
              <Input
                id="prop-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Birchwood Apartments"
                data-testid="input-property-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="prop-customer">Customer *</Label>
              <Select
                value={showNewCustomerForm ? NEW_CUSTOMER_VALUE : draft.customerId}
                onValueChange={(v) => {
                  if (v === NEW_CUSTOMER_VALUE) {
                    setShowNewCustomerForm(true);
                    setDraft({ ...draft, customerId: "" });
                  } else {
                    setShowNewCustomerForm(false);
                    setDraft({ ...draft, customerId: v });
                  }
                }}
              >
                <SelectTrigger id="prop-customer" data-testid="select-property-customer">
                  <SelectValue placeholder="Choose a customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                  <SelectItem value={NEW_CUSTOMER_VALUE}>+ Create new customer…</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showNewCustomerForm && (
              <div className="space-y-3 p-3 rounded-md border bg-muted/30">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  New customer
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="new-cust-name">Company name *</Label>
                  <Input
                    id="new-cust-name"
                    value={newCustomer.name}
                    onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                    data-testid="input-new-customer-name"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-cust-contact">Contact</Label>
                    <Input
                      id="new-cust-contact"
                      value={newCustomer.contactName}
                      onChange={(e) => setNewCustomer({ ...newCustomer, contactName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-cust-phone">Phone</Label>
                    <Input
                      id="new-cust-phone"
                      value={newCustomer.phone}
                      onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-cust-email">Email</Label>
                  <Input
                    id="new-cust-email"
                    type="email"
                    value={newCustomer.email}
                    onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="prop-address">Address</Label>
              <Input
                id="prop-address"
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                placeholder="123 Main St"
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label htmlFor="prop-city">City</Label>
                <Input
                  id="prop-city"
                  value={draft.city}
                  onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prop-state">State</Label>
                <Input
                  id="prop-state"
                  value={draft.state}
                  onChange={(e) => setDraft({ ...draft, state: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prop-zip">ZIP</Label>
                <Input
                  id="prop-zip"
                  value={draft.zip}
                  onChange={(e) => setDraft({ ...draft, zip: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveProperty} disabled={saving} data-testid="button-save-property">
              {saving ? "Saving…" : "Add property"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
