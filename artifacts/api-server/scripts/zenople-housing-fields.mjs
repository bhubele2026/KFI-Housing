// Verify correctness-critical facts for a Zenople -> payroll_deductions sync.
// Prints SAFE fields only (no SSN/TIN/DOB/address).
// Run: node artifacts/api-server/scripts/zenople-housing-fields.mjs

const ID = process.env.ZENOPLE_CLIENT_ID;
const SECRET = process.env.ZENOPLE_CLIENT_SECRET;
const BASE = process.env.ZENOPLE_BASE_URL || "https://kfistaffingapi.zenople.com";
function fmtUtc(d) { return d.toISOString().replace("T", " ").replace("Z", "0000"); }

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
  const t = await res.text();
  try { return JSON.parse(t); } catch { return null; }
}

async function main() {
  const token = await getToken();
  const ded = await fetchAction(token, "DeductionData", 30);
  if (!Array.isArray(ded)) { console.log("no array"); return; }
  const housing = ded.filter((r) => r.TransactionCode === "Housing");
  console.log(`housing rows (30d): ${housing.length}`);

  // SAFE sample (no SSN/TIN).
  console.log("\n=== Sample housing rows (safe fields) ===");
  for (const r of housing.slice(0, 8)) {
    console.log(JSON.stringify({
      PersonId: r.PersonId, Name: r.Name,
      Adjustment: r.Adjustment, Deduction: r.Deduction,
      CheckDate: r.CheckDate, PostDate: r.PostDate, AccountingPeriod: r.AccountingPeriod,
      Office: r.Office, BackOffice: r.BackOffice, OrganizationId: r.OrganizationId,
      Agency: r.Agency, Reference: r.Reference, Description: r.Description,
    }));
  }

  // PersonId format
  const ids = housing.map((r) => String(r.PersonId));
  console.log("\nPersonId sample:", [...new Set(ids)].slice(0, 8).join(", "));
  console.log("PersonId all-numeric?", ids.every((x) => /^\d+$/.test(x)));

  // Is an employer/customer NAME present on the row anywhere?
  const sample = housing[0] || {};
  const nameish = Object.keys(sample).filter((k) => /org|custom|client|company|agency|office/i.test(k));
  console.log("\nOrg/customer-ish keys on a row:", nameish.join(", "));
  for (const k of nameish) console.log(`  ${k}:`, JSON.stringify(sample[k]));

  // Adjustment vs Deduction divergence (how often do they differ?)
  let differ = 0, adjZero = 0;
  for (const r of housing) {
    if (Number(r.Adjustment) !== Number(r.Deduction)) differ++;
    if (!Number(r.Adjustment)) adjZero++;
  }
  console.log(`\nAdjustment != Deduction on ${differ}/${housing.length} rows; Adjustment==0 on ${adjZero}`);

  // CheckDate vs PostDate vs AccountingPeriod — relationship to a Saturday pay-week
  const sampleDates = housing.slice(0, 10).map((r) => ({ Check: String(r.CheckDate).slice(0,10), Post: String(r.PostDate).slice(0,10), Acct: String(r.AccountingPeriod).slice(0,10) }));
  console.log("\nDate fields sample:");
  for (const d of sampleDates) console.log("  ", JSON.stringify(d));
  const dow = (s) => { const dt = new Date(s); return isNaN(dt) ? "?" : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dt.getUTCDay()]; };
  const checkDows = [...new Set(housing.map((r)=>dow(String(r.CheckDate).slice(0,10))))];
  const postDows = [...new Set(housing.map((r)=>dow(String(r.PostDate).slice(0,10))))];
  const acctDows = [...new Set(housing.map((r)=>dow(String(r.AccountingPeriod).slice(0,10))))];
  console.log("CheckDate weekdays:", checkDows.join(","), "| PostDate weekdays:", postDows.join(","), "| AccountingPeriod weekdays:", acctDows.join(","));
}
main().catch((e) => console.error("FATAL", e));
