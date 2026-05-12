// 13-week pay-week deductions mini-chart for the per-property Finance
// tab (Task #597). Shows weekly recovered (bars) overlaid against the
// property's weekly-equivalent rent (line) so an operator can spot at
// a glance whether the deductions cover the property's rent.
//
// `monthlyRent` is divided by 52/12 to get a weekly equivalent, and
// leases flagged `customerResponsibleForRent` or with a non-monthly
// rateType are excluded — same exclusion rules as the Finance tabs.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useListPayrollDeductions } from "@workspace/api-client-react";
import { formatUsd, type Lease } from "@/data/mockData";
import { useData } from "@/context/data-store";
import {
  mostRecentSaturday,
  parsePayWeekDate,
  trailingPayWeeks,
} from "@/lib/finance-pay-weeks";

type PayrollDeductionRow = {
  payWeekEndDate: string;
  weeklyAmount: number;
  propertyId: string;
};

type Props = {
  propertyId: string;
};

const WEEK_COUNT = 13;
const WEEKS_PER_MONTH = 52 / 12;

function isMonthlyRentLease(l: Lease): boolean {
  if (l.customerResponsibleForRent) return false;
  if ((l.rateType ?? "monthly") !== "monthly") return false;
  return true;
}

// Calendar-month rent for `propertyId` covering the Saturday week's
// month. Includes any lease active for at least one day in the month.
function monthlyRentForPropertyOnDate(
  leases: readonly Lease[],
  propertyId: string,
  saturdayYmd: string,
): number {
  const d = parsePayWeekDate(saturdayYmd);
  if (!d) return 0;
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = `${ym}-01`;
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const monthEnd = `${ym}-${String(lastDay).padStart(2, "0")}`;
  let total = 0;
  for (const l of leases) {
    if (l.propertyId !== propertyId) continue;
    if (!isMonthlyRentLease(l)) continue;
    if (!l.startDate) continue;
    const effectiveEnd =
      l.endDate && l.endDate.length > 0 ? l.endDate : "9999-12-31";
    if (l.startDate <= monthEnd && effectiveEnd >= monthStart) {
      total += l.monthlyRent || 0;
    }
  }
  return total;
}

export function PropertyFinanceMiniChart({ propertyId }: Props) {
  const { t } = useTranslation();
  const { data } = useListPayrollDeductions();
  const { leases } = useData();
  const deductions: PayrollDeductionRow[] = useMemo(
    () => (data as PayrollDeductionRow[] | undefined) ?? [],
    [data],
  );

  const series = useMemo(() => {
    const propertyRows = deductions.filter((d) => d.propertyId === propertyId);
    let anchor = mostRecentSaturday();
    if (propertyRows.length > 0) {
      const latest = propertyRows
        .map((r) => r.payWeekEndDate)
        .sort()
        .at(-1);
      if (latest) anchor = latest;
    }
    const weeks = trailingPayWeeks(WEEK_COUNT, anchor);
    const sums = new Map<string, number>();
    for (const r of propertyRows) {
      sums.set(
        r.payWeekEndDate,
        (sums.get(r.payWeekEndDate) ?? 0) + r.weeklyAmount,
      );
    }
    return weeks.map((w) => {
      const d = parsePayWeekDate(w);
      const monthlyRent = monthlyRentForPropertyOnDate(leases, propertyId, w);
      const weeklyRent = Math.round((monthlyRent / WEEKS_PER_MONTH) * 100) / 100;
      return {
        week: w,
        label: d
          ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
          : w,
        recovered: Math.round((sums.get(w) ?? 0) * 100) / 100,
        rent: weeklyRent,
      };
    });
  }, [deductions, propertyId, leases]);

  const hasAnyData = series.some((s) => s.recovered > 0 || s.rent > 0);

  return (
    <Card data-testid="card-property-finance-mini-chart">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {t("pages.propertyDetail.payrollDeductionsLast13")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasAnyData ? (
          <p className="text-sm text-muted-foreground">
            {t("pages.propertyDetail.payrollDeductionsEmpty")}
          </p>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer>
              <ComposedChart
                data={series}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => `$${Math.round(v)}`}
                  width={56}
                />
                <Tooltip
                  formatter={(v: number) => formatUsd(Number(v))}
                  labelFormatter={(_label, payload) => {
                    const item = payload?.[0]?.payload as
                      | { week: string }
                      | undefined;
                    return item?.week ?? "";
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="recovered"
                  name={t("pages.propertyDetail.miniChartRecovered")}
                  fill="hsl(var(--primary))"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="rent"
                  name={t("pages.propertyDetail.miniChartRentWeekly")}
                  stroke="hsl(var(--destructive))"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
