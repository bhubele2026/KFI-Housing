import { useState } from "react";
import { useParams, Link } from "wouter";
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
  Home, Phone, Mail, Globe, Calendar, TrendingUp, TrendingDown,
} from "lucide-react";
import { Lease, Bed, Occupant, Utility } from "@/data/mockData";
import { motion } from "framer-motion";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

function InlineEdit({ value, onSave, type = "text", prefix }: { value: string | number; onSave: (v: string) => void; type?: string; prefix?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

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
  const { properties, leases, beds, occupants, utilities, updateProperty, updateLease, addLease, deleteLease, updateBed, updateOccupant, updateUtility, addUtility, deleteUtility } = useData();

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
  const propUtils = utilities.filter(u => u.propertyId === id).sort((a, b) => a.year - b.year || a.month - b.month);
  const activeLease = propLeases.find(l => l.status === "Active");

  const occupiedBeds = propBeds.filter(b => b.status === "Occupied").length;
  const vacantBeds = propBeds.length - occupiedBeds;
  const monthlyRevenue = propOccupants.reduce((s, o) => s + o.chargePerBed, 0);
  const latestUtils = propUtils.slice(-1)[0];
  const monthlyUtilCost = latestUtils ? latestUtils.total : 0;
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
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard label="Total Beds" value={propBeds.length} icon={BedDouble} />
          <StatCard label="Occupied" value={occupiedBeds} icon={Users} color="text-green-600" />
          <StatCard label="Vacant" value={vacantBeds} icon={BedDouble} color={vacantBeds > 0 ? "text-amber-500" : "text-muted-foreground"} />
          <StatCard label="Monthly Revenue" value={`$${monthlyRevenue.toLocaleString()}`} icon={TrendingUp} color="text-green-600" />
          <StatCard label="Monthly Cost" value={`$${totalCost.toLocaleString()}`} icon={TrendingDown} color="text-destructive" />
          <StatCard label="Net Profit" value={`${profit >= 0 ? "+" : ""}$${profit.toLocaleString()}`} icon={DollarSign} color={profit >= 0 ? "text-green-600" : "text-destructive"} />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid grid-cols-6 w-full max-w-3xl">
            <TabsTrigger value="overview"><Home className="h-3.5 w-3.5 mr-1.5" />Info</TabsTrigger>
            <TabsTrigger value="leases"><KeyRound className="h-3.5 w-3.5 mr-1.5" />Leases</TabsTrigger>
            <TabsTrigger value="beds"><BedDouble className="h-3.5 w-3.5 mr-1.5" />Beds</TabsTrigger>
            <TabsTrigger value="occupants"><Users className="h-3.5 w-3.5 mr-1.5" />Occupants</TabsTrigger>
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
                    <Textarea
                      defaultValue={property.notes}
                      className="text-sm min-h-[72px]"
                      onBlur={e => updateProperty(id, { notes: e.target.value })}
                    />
                  </div>
                </CardContent>
              </Card>

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
                      <Textarea
                        defaultValue={property.paymentNotes}
                        className="text-sm min-h-[60px]"
                        onBlur={e => updateProperty(id, { paymentNotes: e.target.value })}
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

          {/* ── BEDS TAB ── */}
          <TabsContent value="beds" className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex gap-4 text-sm">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />{occupiedBeds} Occupied</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />{vacantBeds} Vacant</span>
              </div>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bed #</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Occupant</TableHead>
                      <TableHead className="text-right">Charge / Bed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {propBeds.map(bed => {
                      const occ = occupants.find(o => o.bedId === bed.id && o.status === "Active");
                      return (
                        <TableRow key={bed.id}>
                          <TableCell className="font-medium">{bed.bedNumber}</TableCell>
                          <TableCell>
                            <InlineEdit value={bed.room} onSave={v => updateBed(bed.id, { room: v })} />
                          </TableCell>
                          <TableCell>
                            <Select value={bed.status} onValueChange={v => updateBed(bed.id, { status: v as any })}>
                              <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Occupied">Occupied</SelectItem>
                                <SelectItem value="Vacant">Vacant</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {occ ? occ.name : <span className="italic text-muted-foreground/50">Vacant</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            {occ ? (
                              <InlineEdit value={occ.chargePerBed} prefix="$" type="number" onSave={v => updateOccupant(occ.id, { chargePerBed: parseFloat(v) })} />
                            ) : (
                              <span className="text-sm text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── OCCUPANTS TAB ── */}
          <TabsContent value="occupants" className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">{propOccupants.length} active occupant{propOccupants.length !== 1 ? "s" : ""}</p>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Employee ID</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Bed</TableHead>
                      <TableHead>Move-in</TableHead>
                      <TableHead className="text-right">Charge / Bed</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {propOccupants.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No active occupants.</TableCell></TableRow>
                    ) : propOccupants.map(occ => {
                      const bed = beds.find(b => b.id === occ.bedId);
                      return (
                        <TableRow key={occ.id}>
                          <TableCell className="font-medium"><InlineEdit value={occ.name} onSave={v => updateOccupant(occ.id, { name: v })} /></TableCell>
                          <TableCell><InlineEdit value={occ.employeeId} onSave={v => updateOccupant(occ.id, { employeeId: v })} /></TableCell>
                          <TableCell><InlineEdit value={occ.company} onSave={v => updateOccupant(occ.id, { company: v })} /></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{bed ? `Bed ${bed.bedNumber}` : "—"}</TableCell>
                          <TableCell><InlineEdit value={occ.moveInDate} onSave={v => updateOccupant(occ.id, { moveInDate: v })} /></TableCell>
                          <TableCell className="text-right"><InlineEdit value={occ.chargePerBed} prefix="$" type="number" onSave={v => updateOccupant(occ.id, { chargePerBed: parseFloat(v) })} /></TableCell>
                          <TableCell><InlineEdit value={occ.email} onSave={v => updateOccupant(occ.id, { email: v })} /></TableCell>
                          <TableCell><InlineEdit value={occ.phone} onSave={v => updateOccupant(occ.id, { phone: v })} /></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── UTILITIES TAB ── */}
          <TabsContent value="utilities" className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">{propUtils.length} utility records</p>
              <AddUtilityDialog propertyId={id} onAdd={addUtility} />
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Electric</TableHead>
                      <TableHead className="text-right">Gas</TableHead>
                      <TableHead className="text-right">Water</TableHead>
                      <TableHead className="text-right">Internet</TableHead>
                      <TableHead className="text-right">Trash</TableHead>
                      <TableHead className="text-right">Other</TableHead>
                      <TableHead className="text-right font-semibold">Total</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {propUtils.length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="h-24 text-center text-muted-foreground">No utility records.</TableCell></TableRow>
                    ) : propUtils.map(u => {
                      const total = u.electric + u.gas + u.water + u.internet + u.trash + u.other;
                      return (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium whitespace-nowrap">{MONTHS[u.month - 1]} {u.year}</TableCell>
                          {(["electric", "gas", "water", "internet", "trash", "other"] as const).map(field => (
                            <TableCell key={field} className="text-right">
                              <InlineEdit value={parseFloat(u[field].toFixed(2))} prefix="$" type="number" onSave={v => {
                                const updated = { ...u, [field]: parseFloat(v) };
                                const newTotal = updated.electric + updated.gas + updated.water + updated.internet + updated.trash + updated.other;
                                updateUtility(u.id, { [field]: parseFloat(v), total: Math.round(newTotal * 100) / 100 });
                              }} />
                            </TableCell>
                          ))}
                          <TableCell className="text-right font-semibold">${total.toFixed(2)}</TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteUtility(u.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
                    <span className="text-muted-foreground">{occ.name} (Bed charge)</span>
                    <span className="font-medium text-green-600">+${occ.chargePerBed.toLocaleString()}</span>
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
                {latestUtils && (
                  <>
                    <div className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                      <span className="text-muted-foreground">Electric ({MONTHS[(latestUtils.month ?? 1) - 1]})</span>
                      <span className="text-destructive">-${latestUtils.electric.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                      <span className="text-muted-foreground">Gas</span>
                      <span className="text-destructive">-${latestUtils.gas.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                      <span className="text-muted-foreground">Water</span>
                      <span className="text-destructive">-${latestUtils.water.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                      <span className="text-muted-foreground">Internet</span>
                      <span className="text-destructive">-${latestUtils.internet.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                      <span className="text-muted-foreground">Trash</span>
                      <span className="text-destructive">-${latestUtils.trash.toFixed(2)}</span>
                    </div>
                    {latestUtils.other > 0 && (
                      <div className="flex justify-between text-sm py-1.5 border-b border-dashed border-border/50">
                        <span className="text-muted-foreground">Other</span>
                        <span className="text-destructive">-${latestUtils.other.toFixed(2)}</span>
                      </div>
                    )}
                  </>
                )}
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

function AddUtilityDialog({ propertyId, onAdd }: { propertyId: string; onAdd: (u: Utility) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ month: "1", year: "2024", electric: "", gas: "", water: "", internet: "99.99", trash: "45", other: "0" });

  const submit = () => {
    const fields = { electric: parseFloat(form.electric) || 0, gas: parseFloat(form.gas) || 0, water: parseFloat(form.water) || 0, internet: parseFloat(form.internet) || 0, trash: parseFloat(form.trash) || 0, other: parseFloat(form.other) || 0 };
    const total = Object.values(fields).reduce((s, v) => s + v, 0);
    onAdd({ id: `u-${Date.now()}`, propertyId, month: parseInt(form.month), year: parseInt(form.year), ...fields, total: Math.round(total * 100) / 100 });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1.5" />Add Month</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add Utility Record</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Month</Label>
              <Select value={form.month} onValueChange={v => setForm(f => ({ ...f, month: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Year</Label><Input type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} /></div>
            {(["electric", "gas", "water", "internet", "trash", "other"] as const).map(field => (
              <div key={field}><Label className="capitalize">{field} ($)</Label><Input type="number" value={(form as any)[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} /></div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit}>Add Record</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
