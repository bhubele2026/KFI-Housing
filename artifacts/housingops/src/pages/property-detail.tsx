import { useEffect, useRef, useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  ChevronLeft, Building2, Edit2, Check, X, Plus, Trash2,
  BedDouble, Users, Zap, DollarSign, KeyRound, CreditCard,
  Home, Phone, Mail, Globe, Calendar, TrendingUp, TrendingDown, AlertTriangle, CalendarPlus,
  Sofa, Refrigerator, Utensils, Bath, WashingMachine, Thermometer, Tv,
  ShieldCheck, Trees, Sparkles, CheckCircle2, Star, Briefcase,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Lease, Bed, Occupant, Utility, UTILITY_TYPES, BILLING_FREQUENCIES, toMonthlyCharge, getRenewalInfo, FURNISHING_CATEGORIES, ALL_FURNISHINGS_COUNT, RATING_CATEGORIES, EMPTY_RATINGS, computeOverallRating, type Ratings } from "@/data/mockData";
import { motion } from "framer-motion";
import { RenewLeasePopover } from "@/components/renew-lease-popover";
import { StarRating } from "@/components/star-rating";
import { Skeleton } from "@/components/ui/skeleton";

const FURNISHING_ICONS: Record<string, LucideIcon> = {
  BedDouble, Sofa, Refrigerator, Utensils, Bath, WashingMachine,
  Thermometer, Tv, ShieldCheck, Trees, Building2, Sparkles,
};

const TYPE_COLORS: Record<string, string> = {
  Electric: "bg-yellow-100 text-yellow-800",
  Gas:      "bg-orange-100 text-orange-800",
  Propane:  "bg-amber-100 text-amber-800",
  Water:    "bg-blue-100 text-blue-800",
  Garbage:  "bg-slate-100 text-slate-700",
  Internet: "bg-purple-100 text-purple-800",
  Other:    "bg-gray-100 text-gray-700",
};

function StatCard({ label, value, sub, icon: Icon, color = "text-foreground" }: { label: string; value: string | number; sub?: string; icon?: React.ElementType; color?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          {Icon && <div className="p-2 rounded-lg bg-muted"><Icon className="h-4 w-4 text-muted-foreground" /></div>}
        </div>
      </CardContent>
    </Card>
  );
}

function BedMap({ beds, occupants, propertyId, onAddBed, onDeleteBed }: {
  beds: Bed[];
  occupants: Occupant[];
  propertyId: string;
  onAddBed: (bed: Bed) => void;
  onDeleteBed: (id: string) => void;
}) {
  const occupied = beds.filter(b => b.status === "Occupied").length;
  const pct = beds.length > 0 ? Math.round((occupied / beds.length) * 100) : 0;

  const addBed = () => {
    const nextNum = beds.length > 0 ? Math.max(...beds.map(b => b.bedNumber)) + 1 : 1;
    onAddBed({ id: `bed-${Date.now()}`, propertyId, bedNumber: nextNum, room: "", status: "Vacant", occupantId: null });
  };

  const removeBed = () => {
    const vacants = beds.filter(b => b.status === "Vacant").sort((a, b) => b.bedNumber - a.bedNumber);
    if (vacants.length > 0) onDeleteBed(vacants[0].id);
  };

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BedDouble className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Bed Occupancy</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500 inline-block" />Occupied ({occupied})</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-rose-400 inline-block" />Vacant ({beds.length - occupied})</span>
              {beds.length > 0 && <span className="font-medium text-foreground">{pct}% full</span>}
            </div>
            <div className="flex items-center gap-1 border rounded-lg p-0.5">
              <Button
                size="icon" variant="ghost"
                className="h-6 w-6 rounded-md text-muted-foreground hover:text-destructive"
                onClick={removeBed}
                disabled={beds.filter(b => b.status === "Vacant").length === 0}
              >
                <span className="text-base leading-none font-bold">−</span>
              </Button>
              <span className="text-xs font-semibold w-8 text-center tabular-nums">{beds.length} beds</span>
              <Button
                size="icon" variant="ghost"
                className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
                onClick={addBed}
              >
                <span className="text-base leading-none font-bold">+</span>
              </Button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {beds.sort((a, b) => a.bedNumber - b.bedNumber).map((bed, i) => {
            const occ = bed.occupantId ? occupants.find(o => o.id === bed.occupantId) : null;
            const isOccupied = bed.status === "Occupied";
            return (
              <Tooltip key={bed.id} delayDuration={100}>
                <TooltipTrigger asChild>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.03, type: "spring", stiffness: 300, damping: 20 }}
                    className={`flex flex-col items-center justify-center rounded-lg border-2 cursor-default select-none transition-all hover:scale-110
                      ${isOccupied
                        ? "bg-emerald-50 border-emerald-400 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-600"
                        : "bg-rose-50 border-rose-300 text-rose-500 dark:bg-rose-950 dark:border-rose-700"
                      }`}
                    style={{ width: 52, height: 52 }}
                  >
                    <BedDouble className="h-5 w-5" />
                    <span className="text-[10px] font-bold leading-none mt-0.5">#{bed.bedNumber}</span>
                  </motion.div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-semibold">Bed {bed.bedNumber}{bed.room ? ` · ${bed.room}` : ""}</p>
                  {isOccupied && occ
                    ? <p className="text-muted-foreground">{occ.name}</p>
                    : <p className="text-rose-400">Vacant</p>
                  }
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function RatingsCard({ ratings, onChange }: { ratings: Ratings | undefined; onChange: (next: Ratings) => void }) {
  const current: Ratings = ratings ?? EMPTY_RATINGS;
  const overall = computeOverallRating(current);
  const ratedCount = RATING_CATEGORIES.filter(c => current[c.key] > 0).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Star className="h-4 w-4" />Ratings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Overall summary */}
        <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3" data-testid="ratings-overall">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Overall</p>
            {overall === null ? (
              <p className="text-sm text-muted-foreground mt-1">No ratings yet</p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">
                Average of {ratedCount} rated categor{ratedCount === 1 ? "y" : "ies"}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <StarRating value={overall ?? 0} readOnly size="md" ariaLabel="Overall rating" />
            <span className="text-base font-semibold tabular-nums w-16 text-right" data-testid="ratings-overall-value">
              {overall === null ? "— / 5" : `${overall.toFixed(1)} / 5`}
            </span>
          </div>
        </div>

        {/* Categories */}
        <div className="space-y-2">
          {RATING_CATEGORIES.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between py-1 border-b border-dashed border-border/50 last:border-0">
              <span className="text-sm text-muted-foreground">{label}</span>
              <StarRating
                value={current[key]}
                size="md"
                ariaLabel={`${label} rating`}
                testId={`rating-${key}`}
                onChange={(v) => onChange({ ...current, [key]: v })}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function NotesEditor({ value, onSave, className }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  const lastIncomingRef = useRef(value);

  // Whenever the persisted value changes from outside (e.g. an optimistic
  // patch settles, or a save fails and the data store reverts), pull the new
  // value into the local draft. This makes the textarea visibly snap back to
  // the server-confirmed value after a failed save. On a successful save the
  // incoming value matches the draft, so this is a no-op (no flicker).
  useEffect(() => {
    if (value === lastIncomingRef.current) return;
    lastIncomingRef.current = value;
    setDraft(value);
  }, [value]);

  return (
    <Textarea
      value={draft}
      className={className}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft); }}
    />
  );
}

export function InlineEdit({ value, onSave, type = "text", prefix }: { value: string | number; onSave: (v: string) => void; type?: string; prefix?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const lastIncomingRef = useRef(String(value));

  // Resync the local draft whenever the persisted value changes from the
  // outside — e.g. an optimistic patch settles, or a save fails and the data
  // store reverts. Without this, after a failed save the field would still
  // display the typed value the next time the user opened the editor (the
  // collapsed view already reads from `value`, so it reverts on its own).
  // On a successful save the incoming value matches the draft, so this is a
  // no-op and there is no flicker mid-save.
  useEffect(() => {
    const incoming = String(value);
    if (incoming === lastIncomingRef.current) return;
    lastIncomingRef.current = incoming;
    setDraft(incoming);
  }, [value]);

  const commit = () => { onSave(draft); setEditing(false); };
  const cancel = () => { setDraft(String(value)); setEditing(false); };

  if (!editing) {
    return (
      <span className="group flex items-center gap-1 cursor-pointer" onClick={() => setEditing(true)}>
        <span className="text-sm">{prefix}{value}</span>
        <Edit2 className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Input
        type={type}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        className="h-7 text-sm py-0 w-36"
        autoFocus
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
      />
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={commit}><Check className="h-3 w-3 text-green-600" /></Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={cancel}><X className="h-3 w-3 text-destructive" /></Button>
    </div>
  );
}

export default function PropertyDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { properties, leases, beds, occupants, utilities, customers, isLoading, updateProperty, updateLease, addLease, deleteLease, addBed, deleteBed, updateBed, updateOccupant, addOccupant, updateUtility, addUtility, deleteUtility } = useData();

  if (isLoading) {
    return (
      <MainLayout>
        <div className="p-8 max-w-7xl mx-auto space-y-6" data-testid="property-detail-loading">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-28" />
            <span className="text-muted-foreground">/</span>
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-56" />
              <Skeleton className="h-4 w-72" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-10 w-full max-w-3xl rounded-md" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-72 w-full rounded-xl" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
        </div>
      </MainLayout>
    );
  }

  const property = properties.find(p => p.id === id);
  if (!property) {
    return (
      <MainLayout>
        <div className="p-8 text-center">
          <p className="text-muted-foreground">Property not found.</p>
          <Link href="/properties"><Button variant="link" className="mt-2">Back to Properties</Button></Link>
        </div>
      </MainLayout>
    );
  }

  const propBeds = beds.filter(b => b.propertyId === id);
  const propOccupants = occupants.filter(o => o.propertyId === id && o.status === "Active");
  const propLeases = leases.filter(l => l.propertyId === id);
  const propUtils = utilities.filter(u => u.propertyId === id).sort((a, b) => a.type.localeCompare(b.type) || a.company.localeCompare(b.company));
  const activeLease = propLeases.find(l => l.status === "Active");

  const occupiedBeds = propBeds.filter(b => b.status === "Occupied").length;
  const vacantBeds = propBeds.length - occupiedBeds;
  const monthlyRevenue = propOccupants.reduce((s, o) => s + toMonthlyCharge(o.chargePerBed, o.billingFrequency ?? "Monthly"), 0);
  const monthlyUtilCost = propUtils.reduce((s, u) => s + u.monthlyCost, 0);
  const monthlyLeaseCost = activeLease?.monthlyRent ?? 0;
  const totalCost = monthlyLeaseCost + monthlyUtilCost;
  const profit = monthlyRevenue - totalCost;

  return (
    <MainLayout>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="p-8 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/properties">
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" />
              Properties
            </Button>
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium">{property.name}</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{property.name}</h1>
              <p className="text-sm text-muted-foreground">{property.address}, {property.city}, {property.state} {property.zip}</p>
            </div>
            <Badge variant={property.status === "Active" ? "default" : "secondary"} className="ml-2">
              {property.status}
            </Badge>
            {(() => {
              const overall = computeOverallRating(property.ratings);
              if (overall === null) return null;
              return (
                <div
                  className="flex items-center gap-1.5 ml-1 rounded-md border bg-muted/40 px-2 py-1"
                  data-testid="property-header-rating"
                  title={`Overall rating ${overall.toFixed(1)} out of 5`}
                >
                  <StarRating value={overall} readOnly size="sm" ariaLabel="Overall rating" />
                  <span
                    className="text-xs font-semibold tabular-nums"
                    data-testid="property-header-rating-value"
                  >
                    {overall.toFixed(1)}
                  </span>
                </div>
              );
            })()}
            {activeLease && (() => {
              const renewal = getRenewalInfo(activeLease.endDate);
              if (renewal.level === "ok") return null;
              return (
                <div className="flex items-center gap-1.5 ml-1">
                  <Badge variant="outline" className={`text-xs font-medium ${renewal.badgeClass}`}>
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Renewal: {renewal.label}
                  </Badge>
                  <RenewLeasePopover
                    currentEndDate={activeLease.endDate}
                    propertyName={property.name}
                    onRenew={(newEndDate) =>
                      updateLease(activeLease.id, {
                        endDate: newEndDate,
                        status: activeLease.status === "Expired" ? "Active" : activeLease.status,
                      })
                    }
                    trigger={
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1">
                        <CalendarPlus className="h-3 w-3" />
                        Renew
                      </Button>
                    }
                  />
                </div>
              );
            })()}
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
          <StatCard label="Total Beds" value={propBeds.length} icon={BedDouble} />
          <StatCard label="Occupied" value={occupiedBeds} icon={Users} color="text-green-600" />
          <StatCard label="Vacant" value={vacantBeds} icon={BedDouble} color={vacantBeds > 0 ? "text-amber-500" : "text-muted-foreground"} />
          <StatCard label="Monthly Revenue" value={`$${monthlyRevenue.toLocaleString()}`} icon={TrendingUp} color="text-green-600" />
          <StatCard label="Lease Rent" value={monthlyLeaseCost > 0 ? `$${monthlyLeaseCost.toLocaleString()}` : "—"} icon={KeyRound} color="text-destructive" sub="active lease" />
          <StatCard label="Utility Cost" value={`$${monthlyUtilCost.toLocaleString()}`} icon={Zap} color="text-destructive" sub={`${propUtils.length} service${propUtils.length !== 1 ? "s" : ""}`} />
          <StatCard label="Net Profit" value={`${profit >= 0 ? "+" : ""}$${profit.toLocaleString()}`} icon={DollarSign} color={profit >= 0 ? "text-green-600" : "text-destructive"} />
        </div>

        {/* Bed Map */}
        <BedMap beds={propBeds} occupants={propOccupants} propertyId={id} onAddBed={addBed} onDeleteBed={deleteBed} />

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid grid-cols-6 w-full max-w-3xl">
            <TabsTrigger value="overview"><Home className="h-3.5 w-3.5 mr-1.5" />Info</TabsTrigger>
            <TabsTrigger value="leases"><KeyRound className="h-3.5 w-3.5 mr-1.5" />Leases</TabsTrigger>
            <TabsTrigger value="beds"><BedDouble className="h-3.5 w-3.5 mr-1.5" />Beds</TabsTrigger>
            <TabsTrigger value="furnishings"><Sofa className="h-3.5 w-3.5 mr-1.5" />Furnishings</TabsTrigger>
            <TabsTrigger value="utilities"><Zap className="h-3.5 w-3.5 mr-1.5" />Utilities</TabsTrigger>
            <TabsTrigger value="finance"><DollarSign className="h-3.5 w-3.5 mr-1.5" />Finance</TabsTrigger>
          </TabsList>

          {/* ── OVERVIEW TAB ── */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Property Details */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><Home className="h-4 w-4" />Property Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {([
                    { label: "Property Name", field: "name" },
                    { label: "Address", field: "address" },
                    { label: "City", field: "city" },
                    { label: "State", field: "state" },
                    { label: "ZIP", field: "zip" },
                  ] as { label: string; field: keyof typeof property }[]).map(({ label, field }) => (
                    <div key={field} className="flex items-center justify-between py-1 border-b border-dashed border-border/50 last:border-0">
                      <span className="text-sm text-muted-foreground w-36 shrink-0">{label}</span>
                      <InlineEdit value={property[field] as string} onSave={v => updateProperty(id, { [field]: v } as any)} />
                    </div>
                  ))}
                  <div className="flex items-start justify-between py-1 border-b border-dashed border-border/50 gap-2">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground w-36 shrink-0 pt-1">
                      <Briefcase className="h-3.5 w-3.5" />Customer
                    </div>
                    <div className="flex-1 flex flex-col items-end gap-1.5" data-testid="property-customer-row">
                      {(() => {
                        const currentCustomer = customers.find((c) => c.id === property.customerId);
                        return currentCustomer ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/customers#customer-${currentCustomer.id}`)}
                            className="text-sm font-semibold text-primary hover:underline inline-flex items-center gap-1"
                            data-testid="link-property-customer"
                            title="Open this customer on the Customers page"
                          >
                            {currentCustomer.name}
                            <ChevronLeft className="h-3 w-3 rotate-180" />
                          </button>
                        ) : (
                          <span className="text-sm italic text-muted-foreground">Unassigned</span>
                        );
                      })()}
                      <Select value={property.customerId} onValueChange={v => updateProperty(id, { customerId: v })}>
                        <SelectTrigger className="h-7 text-xs w-56" data-testid="select-property-customer">
                          <SelectValue placeholder="Choose a customer" />
                        </SelectTrigger>
                        <SelectContent>
                          {customers.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                    <span className="text-sm text-muted-foreground w-36 shrink-0">Status</span>
                    <Select value={property.status} onValueChange={v => updateProperty(id, { status: v as "Active" | "Inactive" })}>
                      <SelectTrigger className="h-7 text-sm w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Active">Active</SelectItem>
                        <SelectItem value="Inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                    <span className="text-sm text-muted-foreground w-36 shrink-0">Charge / Bed</span>
                    <InlineEdit value={property.chargePerBed} prefix="$" type="number" onSave={v => updateProperty(id, { chargePerBed: parseFloat(v) })} />
                  </div>
                  <div className="py-1">
                    <span className="text-sm text-muted-foreground block mb-1">Notes</span>
                    <NotesEditor
                      value={property.notes}
                      className="text-sm min-h-[72px]"
                      onSave={v => updateProperty(id, { notes: v })}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Right column: Landlord stacked above Ratings */}
              <div className="space-y-4">
                {/* Landlord Info */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />Landlord / Contact</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {([
                      { label: "Name", field: "landlordName", icon: Users },
                      { label: "Email", field: "landlordEmail", icon: Mail },
                      { label: "Phone", field: "landlordPhone", icon: Phone },
                    ] as { label: string; field: keyof typeof property; icon: React.ElementType }[]).map(({ label, field, icon: Icon }) => (
                      <div key={field} className="flex items-center justify-between py-1 border-b border-dashed border-border/50 last:border-0">
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground w-36 shrink-0">
                          <Icon className="h-3.5 w-3.5" />{label}
                        </div>
                        <InlineEdit value={property[field] as string} onSave={v => updateProperty(id, { [field]: v } as any)} />
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Ratings */}
                <RatingsCard
                  ratings={property.ratings}
                  onChange={(next) => updateProperty(id, { ratings: next })}
                />
              </div>

              {/* Payment Info */}
              <Card className="lg:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4" />Payment Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                    <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                      <span className="text-sm text-muted-foreground w-40 shrink-0">Payment Method</span>
                      <Select value={property.paymentMethod} onValueChange={v => updateProperty(id, { paymentMethod: v as any })}>
                        <SelectTrigger className="h-7 text-sm w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["ACH", "Check", "Wire", "Online Portal", "Money Order"].map(m => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                      <span className="text-sm text-muted-foreground w-40 shrink-0">Pay To</span>
                      <InlineEdit value={property.paymentRecipient} onSave={v => updateProperty(id, { paymentRecipient: v })} />
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                      <span className="text-sm text-muted-foreground w-40 shrink-0">Due Day of Month</span>
                      <InlineEdit value={property.paymentDueDay} type="number" onSave={v => updateProperty(id, { paymentDueDay: parseInt(v) })} />
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                      <span className="text-sm text-muted-foreground w-40 shrink-0">Monthly Rent (Lease)</span>
                      <InlineEdit value={activeLease?.monthlyRent ?? 0} prefix="$" type="number" onSave={v => activeLease && updateLease(activeLease.id, { monthlyRent: parseFloat(v) })} />
                    </div>
                    {property.paymentMethod !== "Online Portal" && (
                      <>
                        <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                          <span className="text-sm text-muted-foreground w-40 shrink-0">Bank Name</span>
                          <InlineEdit value={property.bankName} onSave={v => updateProperty(id, { bankName: v })} />
                        </div>
                        <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                          <span className="text-sm text-muted-foreground w-40 shrink-0">Routing #</span>
                          <InlineEdit value={property.bankRouting} onSave={v => updateProperty(id, { bankRouting: v })} />
                        </div>
                        <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                          <span className="text-sm text-muted-foreground w-40 shrink-0">Account #</span>
                          <InlineEdit value={property.bankAccount} onSave={v => updateProperty(id, { bankAccount: v })} />
                        </div>
                      </>
                    )}
                    {property.paymentMethod === "Online Portal" && (
                      <div className="flex items-center justify-between py-1 border-b border-dashed border-border/50">
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground w-40 shrink-0"><Globe className="h-3.5 w-3.5" />Portal URL</div>
                        <InlineEdit value={property.portalUrl} onSave={v => updateProperty(id, { portalUrl: v })} />
                      </div>
                    )}
                    <div className="sm:col-span-2 pt-1">
                      <span className="text-sm text-muted-foreground block mb-1">Payment Notes</span>
                      <NotesEditor
                        value={property.paymentNotes}
                        className="text-sm min-h-[60px]"
                        onSave={v => updateProperty(id, { paymentNotes: v })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── LEASES TAB ── */}
          <TabsContent value="leases" className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">{propLeases.length} lease{propLeases.length !== 1 ? "s" : ""} for this property</p>
              <AddLeaseDialog propertyId={id} onAdd={addLease} />
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Start Date</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead className="text-right">Monthly Rent</TableHead>
                      <TableHead className="text-right">Security Deposit</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {propLeases.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No leases found.</TableCell></TableRow>
                    ) : propLeases.map(lease => (
                      <TableRow key={lease.id}>
                        <TableCell><InlineEdit value={lease.startDate} onSave={v => updateLease(lease.id, { startDate: v })} /></TableCell>
                        <TableCell><InlineEdit value={lease.endDate} onSave={v => updateLease(lease.id, { endDate: v })} /></TableCell>
                        <TableCell className="text-right"><InlineEdit value={lease.monthlyRent} prefix="$" type="number" onSave={v => updateLease(lease.id, { monthlyRent: parseFloat(v) })} /></TableCell>
                        <TableCell className="text-right"><InlineEdit value={lease.securityDeposit} prefix="$" type="number" onSave={v => updateLease(lease.id, { securityDeposit: parseFloat(v) })} /></TableCell>
                        <TableCell>
                          <Select value={lease.status} onValueChange={v => updateLease(lease.id, { status: v as any })}>
                            <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Active">Active</SelectItem>
                              <SelectItem value="Expired">Expired</SelectItem>
                              <SelectItem value="Upcoming">Upcoming</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <InlineEdit value={lease.notes} onSave={v => updateLease(lease.id, { notes: v })} />
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteLease(lease.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── BEDS TAB (merged with occupants) ── */}
          <TabsContent value="beds" className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />{occupiedBeds} occupied</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />{vacantBeds} vacant</span>
                <span className="text-foreground font-medium">${propOccupants.reduce((s, o) => s + toMonthlyCharge(o.chargePerBed, o.billingFrequency ?? "Monthly"), 0).toLocaleString()}/mo revenue</span>
              </div>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Bed #</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Occupant Name</TableHead>
                      <TableHead>Employee ID</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Move-in</TableHead>
                      <TableHead className="text-right">Charge</TableHead>
                      <TableHead>Billing</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {propBeds.length === 0 ? (
                      <TableRow><TableCell colSpan={11} className="h-24 text-center text-muted-foreground">No beds added yet. Use the + button above.</TableCell></TableRow>
                    ) : propBeds.sort((a, b) => a.bedNumber - b.bedNumber).map(bed => {
                      const occ = occupants.find(o => o.bedId === bed.id && o.status === "Active");
                      const isOccupied = bed.status === "Occupied";

                      const handleStatusChange = (newStatus: string) => {
                        updateBed(bed.id, { status: newStatus as "Occupied" | "Vacant", occupantId: newStatus === "Vacant" ? null : bed.occupantId });
                        if (newStatus === "Vacant" && occ) {
                          updateOccupant(occ.id, { status: "Former", bedId: null });
                        }
                      };

                      return (
                        <TableRow key={bed.id} className={isOccupied ? "" : "bg-muted/20"}>
                          <TableCell className="font-bold text-center">{bed.bedNumber}</TableCell>
                          <TableCell>
                            <InlineEdit value={bed.room || ""} onSave={v => updateBed(bed.id, { room: v })} />
                          </TableCell>
                          <TableCell>
                            <Select value={bed.status} onValueChange={handleStatusChange}>
                              <SelectTrigger className={`h-7 text-xs w-28 ${isOccupied ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-rose-300 text-rose-600 bg-rose-50"}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Occupied">Occupied</SelectItem>
                                <SelectItem value="Vacant">Vacant</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          {occ ? (
                            <>
                              <TableCell className="font-medium"><InlineEdit value={occ.name} onSave={v => updateOccupant(occ.id, { name: v })} /></TableCell>
                              <TableCell><InlineEdit value={occ.employeeId} onSave={v => updateOccupant(occ.id, { employeeId: v })} /></TableCell>
                              <TableCell><InlineEdit value={occ.company} onSave={v => updateOccupant(occ.id, { company: v })} /></TableCell>
                              <TableCell><InlineEdit value={occ.moveInDate} onSave={v => updateOccupant(occ.id, { moveInDate: v })} /></TableCell>
                              <TableCell className="text-right"><InlineEdit value={occ.chargePerBed} prefix="$" type="number" onSave={v => updateOccupant(occ.id, { chargePerBed: parseFloat(v) })} /></TableCell>
                              <TableCell>
                                <Select value={occ.billingFrequency ?? "Monthly"} onValueChange={v => updateOccupant(occ.id, { billingFrequency: v as any })}>
                                  <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {BILLING_FREQUENCIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell><InlineEdit value={occ.email} onSave={v => updateOccupant(occ.id, { email: v })} /></TableCell>
                              <TableCell><InlineEdit value={occ.phone} onSave={v => updateOccupant(occ.id, { phone: v })} /></TableCell>
                            </>
                          ) : (
                            <>
                              <TableCell colSpan={7}>
                                <AssignOccupantDialog
                                  bedId={bed.id}
                                  propertyId={id}
                                  onAssign={(occ) => {
                                    addOccupant(occ);
                                    updateBed(bed.id, { status: "Occupied", occupantId: occ.id });
                                  }}
                                />
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground/40 text-sm">—</TableCell>
                              <TableCell />
                            </>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── FURNISHINGS TAB ── */}
          <TabsContent value="furnishings" className="space-y-4">
            <FurnishingsPanel
              selected={property.furnishings ?? []}
              onChange={(next) => updateProperty(id, { furnishings: next })}
            />
          </TabsContent>

          {/* ── UTILITIES TAB ── */}
          <TabsContent value="utilities" className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                {propUtils.length} service{propUtils.length !== 1 ? "s" : ""} &mdash; ${propUtils.reduce((s, u) => s + u.monthlyCost, 0).toLocaleString()}/mo total
              </p>
              <AddUtilityDialog propertyId={id} onAdd={addUtility} />
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Account #</TableHead>
                      <TableHead className="text-right">Monthly Cost</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {propUtils.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No utility services added yet.</TableCell></TableRow>
                    ) : propUtils.map(u => (
                      <TableRow key={u.id}>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLORS[u.type] ?? "bg-gray-100 text-gray-700"}`}>
                            <Zap className="h-3 w-3" />{u.type}
                          </span>
                        </TableCell>
                        <TableCell><InlineEdit value={u.company} onSave={v => updateUtility(u.id, { company: v })} /></TableCell>
                        <TableCell className="font-mono text-sm"><InlineEdit value={u.accountNumber} onSave={v => updateUtility(u.id, { accountNumber: v })} /></TableCell>
                        <TableCell className="text-right"><InlineEdit value={u.monthlyCost} prefix="$" type="number" onSave={v => updateUtility(u.id, { monthlyCost: parseFloat(v) })} /></TableCell>
                        <TableCell><InlineEdit value={u.notes || ""} onSave={v => updateUtility(u.id, { notes: v })} /></TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteUtility(u.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── FINANCE TAB ── */}
          <TabsContent value="finance" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><DollarSign className="h-4 w-4" />Monthly Financial Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Separator />
                <div className="space-y-2">
                  <div className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                    <span className="text-muted-foreground">Active Occupants</span>
                    <span className="font-medium">{propOccupants.length}</span>
                  </div>
                  <div className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                    <span className="text-muted-foreground">Occupied Beds</span>
                    <span className="font-medium">{occupiedBeds} / {propBeds.length}</span>
                  </div>
                  <div className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                    <span className="text-muted-foreground">Occupancy Rate</span>
                    <span className="font-medium">{propBeds.length > 0 ? Math.round((occupiedBeds / propBeds.length) * 100) : 0}%</span>
                  </div>
                </div>

                <Separator />
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Revenue</p>
                {propOccupants.map(occ => (
                  <div key={occ.id} className="flex justify-between text-sm py-1 border-b border-dashed border-border/40">
                    <span className="text-muted-foreground">{occ.name} (Bed charge · {occ.billingFrequency ?? "Monthly"})</span>
                    <span className="font-medium text-green-600">+${toMonthlyCharge(occ.chargePerBed, occ.billingFrequency ?? "Monthly").toLocaleString()}/mo</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-semibold py-2 border-b-2 border-border">
                  <span>Total Revenue</span>
                  <span className="text-green-600">+${monthlyRevenue.toLocaleString()}</span>
                </div>

                <Separator />
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Costs</p>
                <div className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                  <span className="text-muted-foreground">Lease (active)</span>
                  <span className="text-destructive">-${monthlyLeaseCost.toLocaleString()}</span>
                </div>
                {propUtils.map(u => (
                  <div key={u.id} className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                    <span className="text-muted-foreground">{u.type} ({u.company})</span>
                    <span className="text-destructive">-${u.monthlyCost.toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-semibold py-2 border-b-2 border-border">
                  <span>Total Costs</span>
                  <span className="text-destructive">-${totalCost.toLocaleString()}</span>
                </div>

                <Separator />
                <div className={`flex justify-between text-base font-bold py-2 ${profit >= 0 ? "text-green-600" : "text-destructive"}`}>
                  <span>Net Profit / Loss</span>
                  <span>{profit >= 0 ? "+" : ""}${profit.toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </motion.div>
    </MainLayout>
  );
}

function AddLeaseDialog({ propertyId, onAdd }: { propertyId: string; onAdd: (l: Lease) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ startDate: "", endDate: "", monthlyRent: "", securityDeposit: "", status: "Active" as Lease["status"], notes: "" });

  const submit = () => {
    if (!form.startDate || !form.endDate || !form.monthlyRent) return;
    onAdd({
      id: `l-${Date.now()}`,
      propertyId,
      startDate: form.startDate,
      endDate: form.endDate,
      monthlyRent: parseFloat(form.monthlyRent),
      securityDeposit: parseFloat(form.securityDeposit) || 0,
      status: form.status,
      notes: form.notes,
    });
    setOpen(false);
    setForm({ startDate: "", endDate: "", monthlyRent: "", securityDeposit: "", status: "Active", notes: "" });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1.5" />Add Lease</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add Lease</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start Date</Label><Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
            <div><Label>End Date</Label><Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            <div><Label>Monthly Rent ($)</Label><Input type="number" value={form.monthlyRent} onChange={e => setForm(f => ({ ...f, monthlyRent: e.target.value }))} /></div>
            <div><Label>Security Deposit ($)</Label><Input type="number" value={form.securityDeposit} onChange={e => setForm(f => ({ ...f, securityDeposit: e.target.value }))} /></div>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as any }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Expired">Expired</SelectItem>
                <SelectItem value="Upcoming">Upcoming</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit}>Add Lease</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssignOccupantDialog({ bedId, propertyId, onAssign }: {
  bedId: string;
  propertyId: string;
  onAssign: (o: Occupant) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", employeeId: "", company: "", moveInDate: "", chargePerBed: "", billingFrequency: "Monthly" as typeof BILLING_FREQUENCIES[number], email: "", phone: "" });

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  const submit = () => {
    if (!form.name) return;
    onAssign({
      id: `occ-${Date.now()}`,
      propertyId,
      bedId,
      name: form.name,
      employeeId: form.employeeId,
      company: form.company,
      moveInDate: form.moveInDate || new Date().toISOString().split("T")[0],
      moveOutDate: null,
      status: "Active",
      chargePerBed: parseFloat(form.chargePerBed) || 0,
      billingFrequency: form.billingFrequency,
      email: form.email,
      phone: form.phone,
    });
    setOpen(false);
    setForm({ name: "", employeeId: "", company: "", moveInDate: "", chargePerBed: "", billingFrequency: "Monthly", email: "", phone: "" });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-xs text-muted-foreground hover:text-foreground italic flex items-center gap-1 transition-colors">
          <Plus className="h-3 w-3" />Assign occupant
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Assign Occupant to Bed</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Full Name *</Label><Input value={form.name} onChange={f("name")} placeholder="Jane Smith" /></div>
            <div><Label>Employee ID</Label><Input value={form.employeeId} onChange={f("employeeId")} placeholder="EMP-001" /></div>
            <div><Label>Company</Label><Input value={form.company} onChange={f("company")} placeholder="Acme Corp" /></div>
            <div><Label>Move-in Date</Label><Input type="date" value={form.moveInDate} onChange={f("moveInDate")} /></div>
            <div><Label>Charge / Bed ($)</Label><Input type="number" value={form.chargePerBed} onChange={f("chargePerBed")} placeholder="0.00" /></div>
            <div>
              <Label>Billing Frequency</Label>
              <Select value={form.billingFrequency} onValueChange={v => setForm(p => ({ ...p, billingFrequency: v as typeof BILLING_FREQUENCIES[number] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BILLING_FREQUENCIES.map(fr => <SelectItem key={fr} value={fr}>{fr}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Email</Label><Input value={form.email} onChange={f("email")} placeholder="jane@company.com" /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={f("phone")} placeholder="555-000-0000" /></div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!form.name}>Assign</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddUtilityDialog({ propertyId, onAdd }: { propertyId: string; onAdd: (u: Utility) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    type: "Electric" as Utility["type"],
    company: "",
    monthlyCost: "",
    accountNumber: "",
    notes: "",
  });

  const submit = () => {
    if (!form.company || !form.monthlyCost) return;
    onAdd({
      id: `u-${Date.now()}`,
      propertyId,
      type: form.type,
      company: form.company,
      monthlyCost: parseFloat(form.monthlyCost),
      accountNumber: form.accountNumber,
      notes: form.notes,
    });
    setOpen(false);
    setForm({ type: "Electric", company: "", monthlyCost: "", accountNumber: "", notes: "" });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1.5" />Add Service</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add Utility Service</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <Label>Type</Label>
            <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as Utility["type"] }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{UTILITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Company</Label><Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="e.g. Austin Energy" /></div>
            <div><Label>Monthly Cost ($)</Label><Input type="number" value={form.monthlyCost} onChange={e => setForm(f => ({ ...f, monthlyCost: e.target.value }))} placeholder="0.00" /></div>
            <div><Label>Account Number</Label><Input value={form.accountNumber} onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} placeholder="Optional" /></div>
          </div>
          <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" /></div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit}>Add Service</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Furnishings Panel ──────────────────────────────────────────────────
function FurnishingsPanel({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const [search, setSearch] = useState("");
  const selectedSet = new Set(selected);
  const totalSelected = selected.length;
  const totalAvailable = ALL_FURNISHINGS_COUNT;
  const pct = totalAvailable === 0 ? 0 : Math.round((totalSelected / totalAvailable) * 100);

  const toggleItem = (item: string) => {
    if (selectedSet.has(item)) {
      onChange(selected.filter(f => f !== item));
    } else {
      onChange([...selected, item]);
    }
  };

  const setCategory = (items: string[], select: boolean) => {
    const others = selected.filter(f => !items.includes(f));
    onChange(select ? [...others, ...items] : others);
  };

  const clearAll = () => onChange([]);

  const q = search.trim().toLowerCase();
  const visibleCategories = FURNISHING_CATEGORIES.map(cat => ({
    ...cat,
    visibleItems: q ? cat.items.filter(i => i.toLowerCase().includes(q)) : cat.items,
  })).filter(cat => cat.visibleItems.length > 0);

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Sofa className="h-4 w-4" /> Furnishings &amp; Amenities
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Track what's included at this property — from beds and appliances to building amenities like a gym or pool.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-2xl font-bold tabular-nums">{totalSelected}<span className="text-sm font-normal text-muted-foreground"> / {totalAvailable}</span></div>
                <div className="text-xs text-muted-foreground">{pct}% included</div>
              </div>
              {totalSelected > 0 && (
                <Button variant="outline" size="sm" onClick={clearAll} data-testid="furnishings-clear-all">
                  <X className="h-3.5 w-3.5 mr-1" /> Clear all
                </Button>
              )}
            </div>
          </div>
          {/* progress bar */}
          <div className="mt-4 h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="h-full bg-emerald-500 rounded-full"
            />
          </div>
          <div className="mt-4">
            <Input
              placeholder="Search furnishings (e.g. 'pool', 'wifi', 'fridge')..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 text-sm"
              data-testid="furnishings-search"
            />
          </div>
        </CardContent>
      </Card>

      {/* Category cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {visibleCategories.length === 0 && (
          <Card className="lg:col-span-2">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No furnishings match "{search}".
            </CardContent>
          </Card>
        )}
        {visibleCategories.map(cat => {
          const Icon = FURNISHING_ICONS[cat.iconName] ?? Sparkles;
          const catSelectedInVisible = cat.visibleItems.filter(i => selectedSet.has(i)).length;
          const catSelectedTotal = cat.items.filter(i => selectedSet.has(i)).length;
          const allInCatSelected = catSelectedTotal === cat.items.length;

          return (
            <Card key={cat.id} data-testid={`furnishings-category-${cat.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {cat.name}
                    <span className="text-xs font-normal text-muted-foreground">
                      {catSelectedTotal}/{cat.items.length}
                    </span>
                  </CardTitle>
                  <button
                    type="button"
                    onClick={() => setCategory(cat.items, !allInCatSelected)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {allInCatSelected ? "Clear" : "Select all"}
                  </button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-1.5">
                  {cat.visibleItems.map(item => {
                    const isOn = selectedSet.has(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => toggleItem(item)}
                        data-testid={`furnishing-${item}`}
                        className={
                          "px-2.5 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1 " +
                          (isOn
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                            : "bg-white text-muted-foreground border-border hover:bg-muted hover:text-foreground")
                        }
                      >
                        {isOn ? <CheckCircle2 className="h-3 w-3" /> : <Plus className="h-3 w-3 opacity-60" />}
                        {item}
                      </button>
                    );
                  })}
                  {cat.visibleItems.length !== cat.items.length && (
                    <span className="text-xs text-muted-foreground self-center px-1">
                      ({cat.items.length - cat.visibleItems.length} more match other searches)
                    </span>
                  )}
                </div>
                {catSelectedInVisible === 0 && cat.visibleItems.length === cat.items.length && (
                  <p className="text-xs text-muted-foreground mt-3 italic">No items selected in this category.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
