// One-off validation/backfill runner for the Zenople housing-deduction
// sync. Exercises the exact client + seeder the HTTP route uses, against
// the dev DB. Usage: tsx scripts/zenople-sync.ts [weeks]
import { fetchHousingDeductionsByWeek } from "../src/lib/zenople-client";
import { seedHousingDeductions } from "../src/lib/seed-housing-deductions";
import { mostRecentSaturday, trailingPayWeeks } from "../src/lib/pay-week";
import { logger } from "../src/lib/logger";

async function main() {
  const weeks = Number(process.env.SYNC_WEEKS) || 52;
  const untilSat = mostRecentSaturday();
  const span = trailingPayWeeks(weeks, untilSat);
  const sinceSat = span[0] ?? untilSat;
  console.log(`Syncing weeks=${weeks} range ${sinceSat}..${untilSat}`);

  const buckets = await fetchHousingDeductionsByWeek(sinceSat, untilSat);
  console.log(`Fetched ${buckets.length} pay-weeks from Zenople`);

  let snapshots = 0;
  let total = 0;
  const unmatched = new Set<string>();
  for (const b of buckets) {
    const r = await seedHousingDeductions({
      logger,
      rows: b.rows,
      payWeekEndDate: b.payWeekEndDate,
    });
    snapshots += r.snapshotsWritten;
    total += r.snapshotsTotalAmount;
    for (const u of r.unmatched) unmatched.add(u.personId);
    console.log(
      `  ${b.payWeekEndDate}: rows=${b.rows.length} matched=${r.matched} snapshots=${r.snapshotsWritten} $${r.snapshotsTotalAmount}`,
    );
  }
  console.log(
    `DONE weeks=${buckets.length} snapshots=${snapshots} total=$${Math.round(total * 100) / 100} distinctUnmatched=${unmatched.size}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
