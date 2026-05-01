import { useState } from "react";
import { useLocation } from "wouter";
import { MainLayout } from "@/components/layout/main-layout";
import { useData } from "@/context/data-store";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Zap } from "lucide-react";
import { UTILITY_TYPES } from "@/data/mockData";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRows } from "@/components/skeleton-rows";

const TYPE_COLORS: Record<string, string> = {
  Electric: "bg-yellow-100 text-yellow-800",
  Gas:      "bg-orange-100 text-orange-800",
  Propane:  "bg-amber-100 text-amber-800",
  Water:    "bg-blue-100 text-blue-800",
  Garbage:  "bg-slate-100 text-slate-700",
  Internet: "bg-purple-100 text-purple-800",
  Other:    "bg-gray-100 text-gray-700",
};

export default function Utilities() {
  const [, navigate] = useLocation();
  const { utilities, properties, isLoading } = useData();
  const [propertyFilter, setPropertyFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");

  const filtered = utilities.filter(u => {
    const matchesProp = propertyFilter === "All" || u.propertyId === propertyFilter;
    const matchesType = typeFilter === "All" || u.type === typeFilter;
    return matchesProp && matchesType;
  });

  const totalMonthly = filtered.reduce((s, u) => s + u.monthlyCost, 0);

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
            <h1 className="text-3xl font-bold tracking-tight">Utilities</h1>
            <p className="text-muted-foreground mt-1">All utility services across your portfolio</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Monthly</p>
            {isLoading ? (
              <Skeleton className="h-8 w-28 mt-1 ml-auto" />
            ) : (
              <p className="text-2xl font-bold">${totalMonthly.toLocaleString()}</p>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex flex-col sm:flex-row gap-3 items-center">
              <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                <SelectTrigger className="w-full sm:w-56">
                  <SelectValue placeholder="All Properties" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Properties</SelectItem>
                  {properties.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Types</SelectItem>
                  {UTILITY_TYPES.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Account #</TableHead>
                  <TableHead className="text-right">Monthly Cost</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <SkeletonRows rows={6} columns={7} />
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      No utility services found.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {filtered.map((u, i) => {
                      const property = properties.find(p => p.id === u.propertyId);
                      return (
                        <motion.tr
                          key={u.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.02 }}
                          className="border-b cursor-pointer hover:bg-muted/50 transition-colors group"
                          onClick={() => navigate(`/properties/${u.propertyId}?tab=utilities`)}
                          data-testid={`row-utility-${u.id}`}
                        >
                          <td className="p-4 font-medium text-sm">{property?.name}</td>
                          <td className="p-4">
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLORS[u.type] ?? "bg-gray-100 text-gray-700"}`}>
                              <Zap className="h-3 w-3" />
                              {u.type}
                            </span>
                          </td>
                          <td className="p-4 text-sm">{u.company}</td>
                          <td className="p-4 text-sm text-muted-foreground font-mono">{u.accountNumber || "—"}</td>
                          <td className="p-4 text-right font-semibold">${u.monthlyCost.toLocaleString()}</td>
                          <td className="p-4 text-sm text-muted-foreground max-w-[200px] truncate">{u.notes || "—"}</td>
                          <td className="p-4">
                            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </td>
                        </motion.tr>
                      );
                    })}
                    <tr className="bg-muted/40 border-t-2 border-border">
                      <td colSpan={4} className="p-4 text-sm font-semibold text-right text-muted-foreground">
                        {filtered.length} service{filtered.length !== 1 ? "s" : ""} total
                      </td>
                      <td className="p-4 text-right font-bold">${totalMonthly.toLocaleString()}/mo</td>
                      <td colSpan={2} />
                    </tr>
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </motion.div>
    </MainLayout>
  );
}
