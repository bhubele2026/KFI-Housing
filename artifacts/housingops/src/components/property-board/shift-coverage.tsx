import { useMemo } from "react";
import type { Occupant } from "@/data/mockData";

/** Bucket a free-form shift label into 1st / 2nd / 3rd / Other for the strip. */
function bucket(shift: string): "1st" | "2nd" | "3rd" | "Other" {
  const s = shift.toLowerCase();
  if (/1st|first|day|am\b/.test(s)) return "1st";
  if (/2nd|second|swing|pm\b|afternoon/.test(s)) return "2nd";
  if (/3rd|third|night|overnight|graveyard/.test(s)) return "3rd";
  return "Other";
}

/**
 * Shift-coverage strip — how many placed associates work each shift at this
 * property, the way a manager scans their tab to see who covers nights.
 * Reads occupant.shift (+ the new occupant.shiftTime cast-safe) — never
 * fabricated.
 */
export function ShiftCoverage({ occupants }: { occupants: Occupant[] }) {
  const { counts, withTimes, total } = useMemo(() => {
    const c: Record<string, number> = { "1st": 0, "2nd": 0, "3rd": 0, Other: 0 };
    const times = new Map<string, string>();
    let t = 0;
    for (const o of occupants) {
      if (o.status !== "Active" || !o.bedId) continue;
      const shift = (o.shift ?? "").trim();
      if (!shift) {
        c.Other += 1;
        t += 1;
        continue;
      }
      c[bucket(shift)] += 1;
      t += 1;
      const time = ((o as { shiftTime?: string }).shiftTime ?? "").trim();
      if (time && !times.has(bucket(shift))) times.set(bucket(shift), time);
    }
    return { counts: c, withTimes: times, total: t };
  }, [occupants]);

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">No placed associates to show shifts for.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {(["1st", "2nd", "3rd", "Other"] as const).map((k) =>
        counts[k] > 0 ? (
          <div
            key={k}
            className="flex min-w-[5rem] flex-col rounded-md border border-line bg-surface px-3 py-1.5"
          >
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {k} shift
            </span>
            <span className="text-lg font-bold tabular-nums text-ink">{counts[k]}</span>
            {withTimes.get(k) && (
              <span className="text-[11px] tabular-nums text-muted-foreground">{withTimes.get(k)}</span>
            )}
          </div>
        ) : null,
      )}
    </div>
  );
}
