import { MainLayout } from "@/components/layout/main-layout";
import { MOCK_PROPERTIES, MOCK_BEDS, MOCK_LEASES, MOCK_UTILITIES } from "@/data/mockData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Badge } from "@/components/ui/badge";

export default function Finance() {
  const financialData = MOCK_PROPERTIES.map(p => {
    // Current month revenue
    const occupiedBeds = MOCK_BEDS.filter(b => b.propertyId === p.id && b.status === "Occupied").length;
    const revenue = occupiedBeds * p.monthlyRent;
    
    // Current month costs
    const leaseCost = MOCK_LEASES.find(l => l.propertyId === p.id && l.status === "Active")?.monthlyRent || 0;
    // Assuming month 3 for current month in mock data
    const utilCost = MOCK_UTILITIES.find(u => u.propertyId === p.id && u.month === 3 && u.year === 2024)?.total || 0;
    const totalCost = leaseCost + utilCost;
    
    return {
      id: p.id,
      name: p.name,
      revenue,
      leaseCost,
      utilCost,
      totalCost,
      profit: revenue - totalCost
    };
  });

  const totals = financialData.reduce((acc, d) => ({
    revenue: acc.revenue + d.revenue,
    leaseCost: acc.leaseCost + d.leaseCost,
    utilCost: acc.utilCost + d.utilCost,
    totalCost: acc.totalCost + d.totalCost,
    profit: acc.profit + d.profit
  }), { revenue: 0, leaseCost: 0, utilCost: 0, totalCost: 0, profit: 0 });

  return (
    <MainLayout>
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Financials</h1>
          <p className="text-muted-foreground mt-1">Profit & loss analysis per property for current month</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Revenue vs Cost by Property</CardTitle>
          </CardHeader>
          <CardContent className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={financialData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(value) => `$${value}`} cursor={{fill: 'transparent'}} />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#0f172a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="totalCost" name="Total Costs" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Lease Cost</TableHead>
                  <TableHead className="text-right">Utility Cost</TableHead>
                  <TableHead className="text-right">Total Cost</TableHead>
                  <TableHead className="text-right">Net Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {financialData.map((data) => (
                  <TableRow key={data.id}>
                    <TableCell className="font-medium">{data.name}</TableCell>
                    <TableCell className="text-right">${data.revenue.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-muted-foreground">${data.leaseCost.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-muted-foreground">${data.utilCost.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium">${data.totalCost.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={data.profit >= 0 ? "default" : "destructive"} className={data.profit >= 0 ? "bg-emerald-500 hover:bg-emerald-600" : ""}>
                        ${Math.abs(data.profit).toLocaleString()} {data.profit >= 0 ? 'Profit' : 'Loss'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell className="font-bold">Total Summary</TableCell>
                  <TableCell className="text-right font-bold">${totals.revenue.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-bold">${totals.leaseCost.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-bold">${totals.utilCost.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-bold">${totals.totalCost.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-bold">
                    <Badge variant={totals.profit >= 0 ? "default" : "destructive"} className={totals.profit >= 0 ? "bg-emerald-500 hover:bg-emerald-600" : ""}>
                      ${Math.abs(totals.profit).toLocaleString()} {totals.profit >= 0 ? 'Profit' : 'Loss'}
                    </Badge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
