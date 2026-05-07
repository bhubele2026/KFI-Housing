import { useMemo } from "react";
import { Link } from "wouter";
import { ArrowLeft, BellOff, ChevronRight } from "lucide-react";
import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { ALL_CUSTOMERS, useCustomerScope } from "@/context/customer-scope";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { PropertyNameCell } from "@/components/property-name-cell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatYMDPretty, formatTodayYMD } from "@/lib/lease-dates";
import type { Lease } from "@/data/mockData";

// Dedicated review page for snoozed lease expiry alerts (Task #428).
// The dashboard's expiring-leases card hides any lease whose
// `snoozedUntil` is strictly after today; previously the only audit
// affordance was a "X snoozed · Unsnooze all" line, which forced
// operators to either remember which rows they had snoozed or blow
// away every snooze at once. This page lists each snoozed lease with
// its property + end date + snooze-until date, and exposes a per-row
// Unsnooze button so operators can selectively restore alerts.
//
// Customer scope is honoured the same way as the dashboard so a
// scoped operator only sees snoozes for properties they manage.

interface SnoozedRow {
  lease: Lease;
  propertyId: string;
  propertyName: string;
  endDate: string;
  snoozedUntil: string;
}

export default function SnoozedLeaseAlerts() {
  const { properties, leases, updateLease } = useData();
  const { customerId } = useCustomerScope();
  const { toast } = useToast();

  const scopedPropertyIds = useMemo(() => {
    const filtered =
      customerId === ALL_CUSTOMERS
        ? properties
        : properties.filter(
            (p) =>
              p.customerId === customerId ||
              (p.sharedWithCustomerIds ?? []).includes(customerId),
          );
    return new Set(filtered.map((p) => p.id));
  }, [properties, customerId]);

  // Snooze rows: every lease in scope whose `snoozedUntil` is strictly
  // after today's YYYY-MM-DD. Sort by snooze-until ascending so the
  // soonest-to-resurface row is at the top — that's what an operator
  // auditing the queue cares about most.
  const todayYMD = formatTodayYMD();
  const snoozedRows = useMemo<SnoozedRow[]>(() => {
    const out: SnoozedRow[] = [];
    for (const l of leases) {
      if (!scopedPropertyIds.has(l.propertyId)) continue;
      const snz = l.snoozedUntil ?? "";
      if (!snz || snz <= todayYMD) continue;
      const propertyName =
        properties.find((p) => p.id === l.propertyId)?.name ?? "—";
      out.push({
        lease: l,
        propertyId: l.propertyId,
        propertyName,
        endDate: l.endDate ?? "",
        snoozedUntil: snz,
      });
    }
    out.sort(
      (a, b) =>
        a.snoozedUntil.localeCompare(b.snoozedUntil) ||
        a.propertyName.localeCompare(b.propertyName),
    );
    return out;
  }, [leases, properties, scopedPropertyIds, todayYMD]);

  const handleUnsnooze = (row: SnoozedRow) => {
    updateLease(row.lease.id, { snoozedUntil: "" });
    toast({
      title: "Snooze cleared",
      description: `${row.propertyName} restored to the alerts panel.`,
    });
  };

  const handleUnsnoozeAll = () => {
    if (snoozedRows.length === 0) return;
    for (const row of snoozedRows) {
      updateLease(row.lease.id, { snoozedUntil: "" });
    }
    toast({
      title: "Snoozes cleared",
      description: `${snoozedRows.length} lease alert${
        snoozedRows.length === 1 ? "" : "s"
      } restored to the panel.`,
    });
  };

  return (
    <MainLayout>
      <PageHeader
        title="Snoozed lease alerts"
        description="Audit which lease expiry alerts are currently hidden from the dashboard, and restore individual rows back to the queue."
        actions={
          <>
            <Link href="/dashboard">
              <Button
                variant="outline"
                size="sm"
                data-testid="button-back-to-dashboard"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to dashboard
              </Button>
            </Link>
            {snoozedRows.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnsnoozeAll}
                data-testid="button-unsnooze-all"
              >
                Unsnooze all
              </Button>
            )}
          </>
        }
      />

      <div className="mt-6">
        {snoozedRows.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title="No snoozed lease alerts"
            description="When you snooze a lease expiry alert from the dashboard, it'll show up here until the snooze window ends."
            testId="empty-snoozed-leases"
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table data-testid="table-snoozed-leases">
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Ends</TableHead>
                    <TableHead>Snoozed until</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snoozedRows.map((row) => (
                    <TableRow
                      key={row.lease.id}
                      data-testid={`row-snoozed-lease-${row.lease.id}`}
                    >
                      <TableCell className="font-medium">
                        <Link
                          href={`/leases/${row.lease.id}`}
                          className="inline-flex items-center gap-1 hover:underline text-primary"
                          data-testid={`link-snoozed-lease-${row.lease.id}`}
                        >
                          <PropertyNameCell
                            name={row.propertyName}
                            primaryClassName="text-primary"
                          />
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </Link>
                      </TableCell>
                      <TableCell
                        data-testid={`text-snoozed-lease-end-${row.lease.id}`}
                      >
                        {row.endDate ? (
                          formatYMDPretty(row.endDate)
                        ) : (
                          <span className="italic text-muted-foreground">
                            No end date
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          data-testid={`text-snoozed-lease-until-${row.lease.id}`}
                        >
                          {formatYMDPretty(row.snoozedUntil)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleUnsnooze(row)}
                          data-testid={`button-unsnooze-lease-${row.lease.id}`}
                        >
                          Unsnooze
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
