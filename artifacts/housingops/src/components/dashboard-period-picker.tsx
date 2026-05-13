import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Calendar, CalendarDays, Lock } from "lucide-react";
import {
  addMonths,
  addWeeks,
  currentMonthKey,
  formatMonthLabel,
  formatPayWeekLabel,
  mostRecentSaturday,
} from "@/lib/period-slicing";

export type PeriodMode = "week" | "month";

export interface PeriodSelection {
  mode: PeriodMode;
  /** Saturday YMD when mode === "week", YYYY-MM when mode === "month". */
  key: string;
}

export function currentPeriod(mode: PeriodMode): PeriodSelection {
  return {
    mode,
    key: mode === "week" ? mostRecentSaturday() : currentMonthKey(),
  };
}

interface Props {
  value: PeriodSelection;
  onChange: (next: PeriodSelection) => void;
  /** Show a "Closed" pill (only meaningful when viewing a closed month). */
  isClosed?: boolean;
}

export function DashboardPeriodPicker({ value, onChange, isClosed }: Props) {
  const isCurrent =
    value.mode === "week"
      ? value.key === mostRecentSaturday()
      : value.key === currentMonthKey();

  const label =
    value.mode === "week"
      ? formatPayWeekLabel(value.key)
      : formatMonthLabel(value.key);

  const goPrev = () => {
    onChange({
      mode: value.mode,
      key:
        value.mode === "week"
          ? addWeeks(value.key, -1)
          : addMonths(value.key, -1),
    });
  };
  const goNext = () => {
    if (isCurrent) return;
    onChange({
      mode: value.mode,
      key:
        value.mode === "week"
          ? addWeeks(value.key, 1)
          : addMonths(value.key, 1),
    });
  };
  const setMode = (mode: PeriodMode) => {
    onChange(currentPeriod(mode));
  };

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="dashboard-period-picker">
      <div className="inline-flex rounded-md border bg-card p-0.5">
        <Button
          type="button"
          size="sm"
          variant={value.mode === "week" ? "default" : "ghost"}
          className="h-7 px-3 text-xs"
          onClick={() => setMode("week")}
          data-testid="period-mode-week"
        >
          <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
          Week
        </Button>
        <Button
          type="button"
          size="sm"
          variant={value.mode === "month" ? "default" : "ghost"}
          className="h-7 px-3 text-xs"
          onClick={() => setMode("month")}
          data-testid="period-mode-month"
        >
          <Calendar className="h-3.5 w-3.5 mr-1.5" />
          Month
        </Button>
      </div>
      <div className="inline-flex items-center gap-1 rounded-md border bg-card px-1 py-0.5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={goPrev}
          aria-label="Previous period"
          data-testid="period-prev"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs font-medium px-2 min-w-[160px] text-center" data-testid="period-label">
          {label}
        </span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={goNext}
          disabled={isCurrent}
          aria-label="Next period"
          data-testid="period-next"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      {isCurrent ? (
        <Badge variant="outline" className="text-xs" data-testid="period-current-badge">
          {value.mode === "week" ? "This week" : "This month"} · live
        </Badge>
      ) : isClosed ? (
        <Badge variant="secondary" className="text-xs" data-testid="period-closed-badge">
          <Lock className="h-3 w-3 mr-1" /> Closed
        </Badge>
      ) : null}
    </div>
  );
}
