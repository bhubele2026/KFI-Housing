// Build: each employee's housing deduction, per pay period.
// Prints aggregates + a small sample (Name + period + amount). No SSN/DOB/address.
// Run: node artifacts/api-server/scripts/zenople-housing-by-period.mjs

const ID = process.env.ZENOPLE_CLIENT_ID;
const SECRET = process.env.ZENOPLE_CLIENT_SECRET;
const BASE = process.env.ZENOPLE_BASE_URL || "https://kfistaffingapi.zenople.com";

const HOUSING_CODES = new Set(["Housing", "RetroHousing", "Housing Benefit Offset Supplemental", "Retro Housing Benefits Offset Supplemental"]);

function fmtUtc(d) { return d.toISOString().replace("T", " ").replace("Z", "0000"); }
function shortDate(s) { return s ? String(s).slice(0, 10) : "(none)"; }

async function getToken() {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: ID, client_secret: SECRET });
  const res = await fetch(BASE + "/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  return (await res.json()).access_token;
}

async function fetchAction(token, action, days) {
  const now = new Date();
  const start = new Date(now.getTime() - days * 86400000);
  const res = await fetch(BASE + "/api/common/data", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, filters: { uTCStartDateTime: fmtUtc(start), uTCEndDateTime: fmtUtc(now), includeData: "Current" } }),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return null; }
}

async function main() {
  const token = await getToken();
  const DAYS = 120;
  const ded = await fetchAction(token, "DeductionData", DAYS);
  if (!Array.isArray(ded)) { console.log("No deduction array"); return; }

  const housing = ded.filter((r) => HOUSING_CODES.has(r.TransactionCode));
  const core = ded.filter((r) => r.TransactionCode === "Housing");
  console.log(`Deduction rows: ${ded.length} | housing-related: ${housing.length} | core "Housing": ${core.length}`);

  // What do the period fields look like?
  const checkDates = [...new Set(core.map((r) => shortDate(r.CheckDate)))].sort();
  const acctPeriods = [...new Set(core.map((r) => r.AccountingPeriod))].sort();
  console.log(`\nDistinct CheckDates (core Housing): ${checkDates.length}`);
  console.log("  sample:", checkDates.slice(-12).join(", "));
  console.log(`Distinct AccountingPeriods: ${acctPeriods.length}`);
  console.log("  sample:", acctPeriods.slice(-8).join(", "));

  // Aggregate: employee x pay period (CheckDate) -> summed housing deduction.
  const map = new Map();
  for (const r of housing) {
    const period = shortDate(r.CheckDate);
    const key = r.PersonId + "::" + period;
    const cur = map.get(key) || { personId: r.PersonId, name: r.Name, period, amount: 0, lines: 0 };
    cur.amount += Number(r.Deduction || 0);
    cur.lines++;
    map.set(key, cur);
  }
  const agg = [...map.values()];
  const employees = new Set(agg.map((a) => a.personId)).size;
  console.log(`\nEmployee x pay-period rows: ${agg.length} | distinct employees with housing deductions: ${employees}`);

  // Sample for the most recent pay period.
  const latest = checkDates[checkDates.length - 1];
  const latestRows = agg.filter((a) => a.period === latest).sort((a, b) => b.amount - a.amount);
  console.log(`\n=== Sample: housing deduction per employee for pay period ${latest} (top 15 of ${latestRows.length}) ===`);
  for (const r of latestRows.slice(0, 15)) {
    console.log(`  ${r.name.padEnd(28)}  $${r.amount.toFixed(2).padStart(10)}  (${r.lines} line${r.lines > 1 ? "s" : ""})`);
  }
  const periodTotal = latestRows.reduce((s, r) => s + r.amount, 0);
  console.log(`  ...period total: $${periodTotal.toFixed(2)} across ${latestRows.length} employees`);
}

main().catch((e) => console.error("FATAL", e));
