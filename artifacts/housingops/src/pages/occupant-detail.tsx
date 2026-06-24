import { useMemo } from "react";
import { Link, useParams } from "wouter";
import {
  ChevronLeft, Briefcase, Building2, Bed, DollarSign, User, AlertTriangle,
  IdCard,
} from "lucide-react";
import { useListPayrollDeductions } from "@workspace/api-client-react";

import { MainLayout } from "@/components/layout/main-layout";
import { PageHeader } from "@/components/layout/page-header";
import { useData } from "@/context/data-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyStateRow } from "@/components/empty-state";
import { DeductionBadge } from "@/components/kit";
import { SkeletonRows } from "@/components/skeleton-rows";
import { shortPropertyName } from "@/lib/property-name";
import { InlineEdit } from "@/pages/property-detail";
import { ShiftPicker } from "@/components/shift-picker";
import {
  formatUsd,
  BILLING_FREQUENCIES,
  OCCUPANT_LANGUAGES,
  OCCUPANT_GENDERS,
  OCCUPANT_TITLES,
  type BillingFrequency,
  type OccupantLanguage,
  type OccupantGender,
  type OccupantTitle,
} from "@/data/mockData";

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
  const { occupants, properties, beds, customers, isLoading, updateOccupant } = useData();

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
            <DeductionBadge
              weeklyAmount={
                (occupant as { deduction?: { weeklyAmount?: number; source?: string } }).deduction?.weeklyAmount ??
                lastWeek?.weeklyAmount ??
                (occupant as { chargePerBed?: number }).chargePerBed ??
                null
              }
              zenopleStatus={(occupant as { zenopleStatus?: string }).zenopleStatus}
              source={(occupant as { deduction?: { source?: string } }).deduction?.source}
            />
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

      <Card className="mt-6" data-testid="card-occupant-profile">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <IdCard className="h-4 w-4" />
            Profile
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Hover any field for the pen icon to edit it.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            <Field label="Full name">
              <InlineEdit
                value={occupant.name}
                placeholder="—"
                onSave={(v) => updateOccupant(occupant.id, { name: v })}
                testId="edit-occupant-name"
              />
            </Field>
            <Field label="Employee ID">
              <InlineEdit
                value={occupant.employeeId ?? ""}
                placeholder="—"
                onSave={(v) => updateOccupant(occupant.id, { employeeId: v })}
                testId="edit-occupant-employee-id"
              />
            </Field>
            <Field label="Company">
              <InlineEdit
                value={occupant.company ?? ""}
                placeholder="—"
                onSave={(v) => updateOccupant(occupant.id, { company: v })}
                testId="edit-occupant-company"
              />
            </Field>
            <Field label="Email">
              <InlineEdit
                value={occupant.email ?? ""}
                placeholder="—"
                onSave={(v) => updateOccupant(occupant.id, { email: v })}
                testId="edit-occupant-email"
              />
            </Field>
            <Field label="Phone">
              <InlineEdit
                value={occupant.phone ?? ""}
                placeholder="—"
                onSave={(v) => updateOccupant(occupant.id, { phone: v })}
                testId="edit-occupant-phone"
              />
            </Field>
            <Field label="Shift">
              <ShiftPicker
                value={occupant.shift ?? null}
                onChange={(v) => updateOccupant(occupant.id, { shift: v })}
                customerId={property?.customerId ?? null}
                testId="edit-occupant-shift"
                triggerClassName="h-7 text-xs w-40"
              />
            </Field>
            <Field label="Move-in date">
              <InlineEdit
                value={occupant.moveInDate ?? ""}
                placeholder="—"
                onSave={(v) => updateOccupant(occupant.id, { moveInDate: v })}
                testId="edit-occupant-move-in"
              />
            </Field>
            <Field label="Move-out (projected)">
              <InlineEdit
                value={occupant.moveOutDate ?? ""}
                placeholder="—"
                onSave={(v) =>
                  updateOccupant(occupant.id, {
                    moveOutDate: v.trim() === "" ? null : v,
                  })
                }
                testId="edit-occupant-move-out"
              />
            </Field>
            <Field label="Charge / bed">
              <InlineEdit
                value={occupant.chargePerBed}
                type="number"
                prefix="$"
                onSave={(v) =>
                  updateOccupant(occupant.id, { chargePerBed: parseFloat(v) || 0 })
                }
                testId="edit-occupant-charge"
              />
            </Field>
            <Field label="Billing frequency">
              <Select
                value={occupant.billingFrequency ?? "Monthly"}
                onValueChange={(v) =>
                  updateOccupant(occupant.id, { billingFrequency: v as BillingFrequency })
                }
              >
                <SelectTrigger
                  className="h-7 text-xs w-40"
                  data-testid="edit-occupant-billing"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_FREQUENCIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Language">
              <Select
                value={occupant.language ?? "__unset"}
                onValueChange={(v) =>
                  updateOccupant(occupant.id, {
                    language: v === "__unset" ? null : (v as OccupantLanguage),
                  })
                }
              >
                <SelectTrigger
                  className="h-7 text-xs w-40"
                  data-testid="edit-occupant-language"
                >
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset">—</SelectItem>
                  {OCCUPANT_LANGUAGES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Gender">
              <Select
                value={occupant.gender ?? "__unset"}
                onValueChange={(v) =>
                  updateOccupant(occupant.id, {
                    gender: v === "__unset" ? null : (v as OccupantGender),
                  })
                }
              >
                <SelectTrigger
                  className="h-7 text-xs w-40"
                  data-testid="edit-occupant-gender"
                >
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset">—</SelectItem>
                  {OCCUPANT_GENDERS.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Title">
              <Select
                value={occupant.title ?? "__unset"}
                onValueChange={(v) =>
                  updateOccupant(occupant.id, {
                    title: v === "__unset" ? null : (v as OccupantTitle),
                  })
                }
              >
                <SelectTrigger
                  className="h-7 text-xs w-40"
                  data-testid="edit-occupant-title"
                >
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset">—</SelectItem>
                  {OCCUPANT_TITLES.map((tt) => (
                    <SelectItem key={tt} value={tt}>
                      {tt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select
                value={occupant.status}
                onValueChange={(v) =>
                  updateOccupant(occupant.id, { status: v as "Active" | "Former" })
                }
              >
                <SelectTrigger
                  className="h-7 text-xs w-40"
                  data-testid="edit-occupant-status"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Former">Former</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="min-h-[28px] flex items-center">{children}</div>
    </div>
  );
}
