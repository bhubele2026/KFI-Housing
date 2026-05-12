// 13-week pay-week deductions mini-chart for the per-property Finance
// tab (Task #597). Reads the same `/payroll-deductions` snapshot
// stream the global Finance Weekly / Monthly / By Customer tabs use,
// filters to the current property, and bins by Saturday end-date so
// missing weeks render as $0 (rather than collapsing the axis).
//
// Kept intentionally compact — this chart lives inside the property
// page's Finance tab card stack and doesn't need a Tooltip frame or
// custom legend; the value is the trend, not exact dollars per week.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useListPayrollDeductions } from "@workspace/api-client-react";
import { formatUsd } from "@/data/mockData";
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

export function PropertyFinanceMiniChart({ propertyId }: Props) {
  const { t } = useTranslation();
  const { data } = useListPayrollDeductions();
  const deductions: PayrollDeductionRow[] = useMemo(
    () => (data as PayrollDeductionRow[] | undefined) ?? [],
    [data],
  );

  const series = useMemo(() => {
    // Find the most-recent Saturday we actually have data for —
    // anchoring on `mostRecentSaturday()` blindly would make a
    // freshly-imported week show as the rightmost point with all
    // earlier weeks empty even if the operator hasn't imported the
    // very latest Saturday yet.
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
      return {
        week: w,
        // Short "May 9" axis label — weeks within the same year don't
        // need the year repeated, and the tooltip carries the full
        // date for disambiguation.
        label: d
          ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
          : w,
        amount: Math.round((sums.get(w) ?? 0) * 100) / 100,
      };
    });
  }, [deductions, propertyId]);

  const hasAnyData = series.some((s) => s.amount > 0);

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
          <div className="h-48 w-full">
            <ResponsiveContainer>
              <BarChart
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
                <Bar
                  dataKey="amount"
                  fill="hsl(var(--primary))"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
