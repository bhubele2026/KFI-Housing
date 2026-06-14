// Focused probe: what deduction types exist, and which look like "housing".
// Reports aggregates only (codes, counts, totals) — no SSN/PII rows printed.
// Run: node artifacts/api-server/scripts/zenople-deductions.mjs

const ID = process.env.ZENOPLE_CLIENT_ID;
const SECRET = process.env.ZENOPLE_CLIENT_SECRET;
const BASE = process.env.ZENOPLE_BASE_URL || "https://kfistaffingapi.zenople.com";

function fmtUtc(d) { return d.toISOString().replace("T", " ").replace("Z", "0000"); }

async function getToken() {
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: ID, client_secret: SECRET });
  const res = await fetch(BASE + "/connect/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const j = await res.json();
  return j.access_token;
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
  let p; try { p = JSON.parse(text); } catch { p = null; }
  const arr = Array.isArray(p) ? p : null;
  return { ok: res.ok, arr, raw: text.slice(0, 200) };
}

async function main() {
  const token = await getToken();
  const DAYS = 120;
  const { ok, arr, raw } = await fetchAction(token, "DeductionData", DAYS);
  if (!arr) { console.log("DeductionData not array:", ok, raw); return; }
  console.log(`DeductionData rows (last ${DAYS}d): ${arr.length}`);

  // Distinct deduction "types" by the descriptive fields.
  const combo = new Map();
  for (const r of arr) {
    const key = [r.Category, r.TransactionType, r.TransactionCode, r.Description].join(" | ");
    const cur = combo.get(key) || { count: 0, total: 0 };
    cur.count++;
    cur.total += Number(r.Deduction || 0);
    combo.set(key, cur);
  }
  console.log("\n=== Distinct deduction types: Category | TransactionType | TransactionCode | Description ===");
  const rows = [...combo.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [k, v] of rows) {
    console.log(`  ${String(v.count).padStart(5)}x  total=${v.total.toFixed(2).padStart(12)}   ${k}`);
  }

  // Highlight anything that looks housing-related.
  console.log("\n=== Housing-looking deductions (match rent/housing/lodging/apt) ===");
  const re = /(hous|rent|lodg|apart|apt|dorm|motel|hotel|room)/i;
  const housing = rows.filter(([k]) => re.test(k));
  if (!housing.length) console.log("  (no obvious text match — review the full list above)");
  for (const [k, v] of housing) console.log(`  ${String(v.count).padStart(5)}x  total=${v.total.toFixed(2)}   ${k}`);

  // Show the date/period fields available on a deduction row (keys only).
  console.log("\n=== Period-related fields present on a row ===");
  const sample = arr[0] || {};
  console.log("  keys:", Object.keys(sample).filter(k => /date|period|ppe|check|post|accru|account/i.test(k)).join(", "));
}

main().catch((e) => console.error("FATAL", e));
