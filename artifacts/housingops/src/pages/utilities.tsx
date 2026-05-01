import { useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { MOCK_UTILITIES, MOCK_PROPERTIES } from "@/data/mockData";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function Utilities() {
  const [propertyFilter, setPropertyFilter] = useState("All");
  const [yearFilter, setYearFilter] = useState("2024");

  const filteredUtilities = MOCK_UTILITIES.filter((u) => {
    const matchesProperty = propertyFilter === "All" || u.propertyId === propertyFilter;
    const matchesYear = yearFilter === "All" || u.year.toString() === yearFilter;
    return matchesProperty && matchesYear;
  });

  const totals = filteredUtilities.reduce((acc, u) => ({
    electric: acc.electric + u.electric,
    gas: acc.gas + u.gas,
    water: acc.water + u.water,
    internet: acc.internet + u.internet,
    total: acc.total + u.total
  }), { electric: 0, gas: 0, water: 0, internet: 0, total: 0 });

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Utilities</h1>
            <p className="text-muted-foreground mt-1">Track monthly utility costs per property</p>
          </div>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Utility Record
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center">
              <Select value={propertyFilter} onValueChange={setPropertyFilter}>
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue placeholder="Property" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Properties</SelectItem>
                  {MOCK_PROPERTIES.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger className="w-full sm:w-32">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Years</SelectItem>
                  <SelectItem value="2024">2024</SelectItem>
                  <SelectItem value="2023">2023</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Month/Year</TableHead>
                  <TableHead className="text-right">Electric</TableHead>
                  <TableHead className="text-right">Gas</TableHead>
                  <TableHead className="text-right">Water</TableHead>
                  <TableHead className="text-right">Internet</TableHead>
                  <TableHead className="text-right font-bold">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUtilities.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center">
                      No utility records found.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {filteredUtilities.map((utility) => {
                      const property = MOCK_PROPERTIES.find(p => p.id === utility.propertyId);
                      const monthName = new Date(2000, utility.month - 1).toLocaleString('default', { month: 'short' });
                      
                      return (
                        <TableRow key={utility.id}>
                          <TableCell className="font-medium">{property?.name}</TableCell>
                          <TableCell>{monthName} {utility.year}</TableCell>
                          <TableCell className="text-right text-muted-foreground">${utility.electric.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">${utility.gas.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">${utility.water.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">${utility.internet.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-medium">${utility.total.toFixed(2)}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={2} className="font-bold text-right">Totals</TableCell>
                      <TableCell className="text-right font-medium">${totals.electric.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium">${totals.gas.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium">${totals.water.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium">${totals.internet.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-bold">${totals.total.toFixed(2)}</TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
