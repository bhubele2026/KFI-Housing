// 13-week pay-week deductions mini-chart for the per-property Finance
// tab (Task #597). Reads the same `/api/finance/weekly` endpoint the
// global Finance Weekly tab uses, scoped to a single property via the
// `propertyId` query param. Reading from one endpoint family means the
// per-property numbers always reconcile with the portfolio-wide totals.

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
import { useListFinanceWeekly } from "@workspace/api-client-react";
import { formatUsd } from "@/data/mockData";
import { parsePayWeekDate } from "@/lib/finance-pay-weeks";

type WeeklyRow = {
  payWeekEndDate: string;
  recovered: number;
  rentPaid: number;
  utilities: number;
  net: number;
};

type Props = {
  propertyId: string;
};

export function PropertyFinanceMiniChart({ propertyId }: Props) {
  const { t } = useTranslation();
  const { data } = useListFinanceWeekly({ weeks: 13, propertyId });
  const rows: WeeklyRow[] = useMemo(
    () => (data as WeeklyRow[] | undefined) ?? [],
    [data],
  );

  const series = useMemo(() => {
    return rows.map((r) => {
      const d = parsePayWeekDate(r.payWeekEndDate);
      return {
        week: r.payWeekEndDate,
        label: d
          ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
          : r.payWeekEndDate,
        recovered: r.recovered,
        rent: r.rentPaid,
      };
    });
  }, [rows]);

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
