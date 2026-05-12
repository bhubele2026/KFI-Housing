import { useMemo } from "react";
import { Link, useParams } from "wouter";
import {
  ChevronLeft, Briefcase, Building2, Bed, DollarSign, User, AlertTriangle,
} from "lucide-react";
import { useListPayrollDeductions } from "@workspace/api-client-react";

import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyStateRow } from "@/components/empty-state";
import { SkeletonRows } from "@/components/skeleton-rows";
import { shortPropertyName } from "@/lib/property-name";
import { formatUsd } from "@/data/mockData";

// Per-occupant detail page (Task #598 follow-up). Shows the occupant's
// identity + current placement and an immutable, week-by-week table of
// their housing deductions sourced from `payroll_deductions` — the
// per-occupant snapshot the weekly payroll import writes to. Each
// row's `weeklyAmount` is the value that actually deducted on that
// Mon→Sat pay-week (`payWeekEndDate` is the Saturday end-date as
// YYYY-MM-DD), so the same number powers Finance Weekly's "Recovered"
// line and this per-person history. Re-importing the same week
// overwrites the row in place via the (occupantId, payWeekEndDate)
// unique index — the table on this page reflects whatever the most
// recent import wrote.
export default function OccupantDetail() {
  const params = useParams<{ id: string }>();
  const occupantId = params.id;
  const { occupants, properties, beds, isLoading } = useData();

  const occupant = useMemo(
    () => occupants.find((o) => o.id === occupantId) ?? null,
    [occupants, occupantId],
  );
  const property = useMemo(
    () =>
      occupant?.propertyId
        ? properties.find((p) => p.id === occupant.propertyId) ?? null
        : null,
    [properties, occupant],
  );
  const bed = useMemo(
    () => (occupant?.bedId ? beds.find((b) => b.id === occupant.bedId) ?? null : null),
    [beds, occupant],
  );

  // Pull the full deduction feed and filter to this occupant client-side.
  // The dataset is small (≈109 occupants × ~52 weeks/yr) and the existing
  // Finance tabs already pay this download cost on the same hook key, so
  // we get a free cache hit instead of adding a per-occupant route.
  const deductionsQuery = useListPayrollDeductions();
  const deductions = useMemo(() => {
    const rows = deductionsQuery.data ?? [];
    return rows
      .filter((r) => r.occupantId === occupantId)
      .sort((a, b) => b.payWeekEndDate.localeCompare(a.payWeekEndDate));
  }, [deductionsQuery.data, occupantId]);

  const totalDeducted = useMemo(
    () => deductions.reduce((sum, r) => sum + (r.weeklyAmount || 0), 0),
    [deductions],
  );
  const lastWeek = deductions[0] ?? null;
  // Distinguish between "still loading", "failed to load", and "loaded
  // but empty for this occupant" so the summary cards don't render
  // misleading $0 values while the request is in flight or has errored.
  const dedLoading = deductionsQuery.isLoading;
  const dedError = deductionsQuery.isError;

  if (isLoading) {
    return (
      <MainLayout>
        <PageHeader title="Occupant" description="Loading…" />
        <div className="mt-6">
          <SkeletonRows rows={6} columns={3} />
        </div>
      </MainLayout>
    );
  }

  if (!occupant) {
    return (
      <MainLayout>
        <PageHeader
          title="Occupant not found"
          description="This occupant may have been removed."
          actions={
            <Link href="/occupants">
              <Button variant="outline" size="sm" data-testid="link-back-occupants">
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back to occupants
              </Button>
            </Link>
          }
        />
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <PageHeader
        title={occupant.name || "Unnamed occupant"}
        description={
          <span className="flex flex-wrap gap-x-3 gap-y-1 items-center text-sm text-muted-foreground">
            <Badge
              variant={occupant.status === "Active" ? "default" : "secondary"}
              data-testid="occupant-status-badge"
            >
              {occupant.status}
            </Badge>
            {occupant.company && (
              <span className="inline-flex items-center gap-1">
                <Briefcase className="h-3.5 w-3.5" />
                {occupant.company}
              </span>
            )}
            {occupant.employeeId && (
              <span className="inline-flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                #{occupant.employeeId}
              </span>
            )}
          </span>
        }
        actions={
          <Link href="/occupants">
            <Button variant="outline" size="sm" data-testid="link-back-occupants">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back to occupants
            </Button>
          </Link>
        }
      />

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card data-testid="card-current-placement">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Current placement
            </CardTitle>
          </CardHeader>
          <CardContent>
            {property ? (
              <Link
                href={`/properties/${property.id}`}
                className="font-medium text-foreground hover:underline"
                data-testid="link-occupant-property"
              >
                {shortPropertyName(property.name)}
              </Link>
            ) : (
              <span className="text-sm text-muted-foreground">No property assigned</span>
            )}
            {bed && (
              <div className="mt-1 text-sm text-muted-foreground inline-flex items-center gap-1">
                <Bed className="h-3.5 w-3.5" />
                Bed #{bed.bedNumber}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-last-week">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Last week deducted
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dedLoading ? (
              <span className="text-sm text-muted-foreground" data-testid="text-last-week-loading">
                Loading…
              </span>
            ) : dedError ? (
              <span
                className="text-sm text-destructive inline-flex items-center gap-1"
                data-testid="text-last-week-error"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Couldn’t load deductions
              </span>
            ) : lastWeek ? (
              <>
                <div
                  className="font-semibold tabular-nums text-foreground"
                  data-testid="text-last-week-amount"
                >
                  {formatUsd(lastWeek.weeklyAmount)}
                </div>
                <div className="text-sm text-muted-foreground">
                  Week ending {lastWeek.payWeekEndDate}
                </div>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                No deductions imported yet.
              </span>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-total-deducted">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              All-time deducted
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dedLoading ? (
              <span className="text-sm text-muted-foreground" data-testid="text-total-deducted-loading">
                Loading…
              </span>
            ) : dedError ? (
              <span
                className="text-sm text-destructive inline-flex items-center gap-1"
                data-testid="text-total-deducted-error"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Couldn’t load deductions
              </span>
            ) : (
              <>
                <div
                  className="font-semibold tabular-nums text-foreground"
                  data-testid="text-total-deducted"
                >
                  {formatUsd(totalDeducted)}
                </div>
                <div className="text-sm text-muted-foreground">
                  Across {deductions.length} week{deductions.length === 1 ? "" : "s"}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6" data-testid="card-deductions-history">
        <CardHeader>
          <CardTitle className="text-base">Weekly deductions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pay week ending</TableHead>
                <TableHead>Property (at import)</TableHead>
                <TableHead>Customer (at import)</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dedLoading ? (
                <SkeletonRows rows={4} columns={4} />
              ) : dedError ? (
                <EmptyStateRow
                  colSpan={4}
                  icon={AlertTriangle}
                  title="Couldn’t load deductions"
                  description="The deductions feed didn’t respond. Refresh the page to try again."
                  testId="row-deductions-error"
                />
              ) : deductions.length === 0 ? (
                <EmptyStateRow
                  colSpan={4}
                  title="No weekly deductions yet"
                  description="Upload this week's payroll report on the dashboard to populate this occupant's history."
                />
              ) : (
                deductions.map((row) => {
                  const snapshotProperty = properties.find(
                    (p) => p.id === row.propertyId,
                  );
                  return (
                    <TableRow
                      key={row.id}
                      data-testid={`row-deduction-${row.payWeekEndDate}`}
                    >
                      <TableCell className="font-medium tabular-nums">
                        {row.payWeekEndDate}
                      </TableCell>
                      <TableCell>
                        {snapshotProperty
                          ? shortPropertyName(snapshotProperty.name)
                          : row.propertyId || "—"}
                      </TableCell>
                      <TableCell>{row.customerSnapshot || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatUsd(row.weeklyAmount)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </MainLayout>
  );
}
