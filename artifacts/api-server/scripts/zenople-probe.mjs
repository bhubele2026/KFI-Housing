// One-off discovery probe for the Zenople Client API.
// Authenticates via OAuth2 client-credentials, then samples every data action,
// reporting ONLY metadata (status, record count, field names) — never PII values.
// Run: node artifacts/api-server/scripts/zenople-probe.mjs

const ID = process.env.ZENOPLE_CLIENT_ID;
const SECRET = process.env.ZENOPLE_CLIENT_SECRET;
const BASE = process.env.ZENOPLE_BASE_URL || "https://kfistaffingapi.zenople.com";
const TOKEN_PATH = process.env.ZENOPLE_TOKEN_PATH || "/connect/token";
const DATA_PATH = process.env.ZENOPLE_DATA_PATH || "/api/common/data";

const ACTIONS = [
  "PersonData", "EmployeeData", "CustomerData", "LeadData", "TargetData",
  "NewCustomerData", "AssignmentData", "JobData", "TransactionData", "PayrollData",
  "InvoiceData", "OfficeData", "CompanyData", "TaskData", "CommentData",
  "OrganizationUserTypeData", "JobUserTypeData", "AssignmentUserTypeData",
  "OfficeUserTypeData", "PersonUserTypeData", "TransactionUserTypeData",
  "TransactionItemData", "TransactionItemDateData", "TimeclockPunchData",
  "PersonInterviewData", "ApplicantData", "JobPortalData", "SMSData",
  "InvoicePaymentData", "PersonEEOData", "PayrollTaxData", "DeductionData",
  "ContributionData", "AccrualData",
];

// Some actions need entityList; default to "All" where the docs require it.
const ENTITY_LIST_ACTIONS = new Set(["TaskData", "CommentData"]);

function fmtUtc(d) {
  return d.toISOString().replace("T", " ").replace("Z", "0000");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: ID,
    client_secret: SECRET,
  });
  const res = await fetch(BASE + TOKEN_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, token: json.access_token, expiresIn: json.expires_in, scope: json.scope };
}

async function probe(action, token, days) {
  const now = new Date();
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const filters = {
    uTCStartDateTime: fmtUtc(start),
    uTCEndDateTime: fmtUtc(now),
    includeData: "Current",
  };
  if (ENTITY_LIST_ACTIONS.has(action)) filters.entityList = "All";

  const res = await fetch(BASE + DATA_PATH, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, filters }),
  });

  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }

  if (!res.ok) {
    return { action, status: res.status, count: null, fields: [], note: text.slice(0, 140) };
  }
  const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.data) ? parsed.data : null);
  if (!arr) {
    return { action, status: res.status, count: null, fields: [], note: "non-array response: " + text.slice(0, 120) };
  }
  const fields = arr.length > 0 && arr[0] && typeof arr[0] === "object" ? Object.keys(arr[0]) : [];
  return { action, status: res.status, count: arr.length, fields, bytes: text.length };
}

async function main() {
  if (!ID || !SECRET) {
    console.error("Missing ZENOPLE_CLIENT_ID / ZENOPLE_CLIENT_SECRET");
    process.exit(1);
  }
  console.log("Base:", BASE);
  const t = await getToken();
  console.log(`Token: status=${t.status} ok=${Boolean(t.token)} expiresIn=${t.expiresIn} scope=${t.scope}`);
  if (!t.token) { console.error("No token — aborting."); process.exit(1); }

  // Discovery window: 90 days, to surface schema where data exists.
  const DAYS = 90;
  console.log(`\nProbing ${ACTIONS.length} actions over the last ${DAYS} days (metadata only)\n`);

  const results = [];
  for (const action of ACTIONS) {
    try {
      const r = await probe(action, t.token, DAYS);
      results.push(r);
      const head = `${r.action.padEnd(26)} status=${r.status}`;
      if (r.count === null) {
        console.log(`${head}  ERROR  ${r.note || ""}`);
      } else {
        console.log(`${head}  records=${String(r.count).padStart(6)}  fields=${r.fields.length}  ~${r.bytes}b`);
      }
    } catch (e) {
      results.push({ action, status: "EXC", count: null, fields: [], note: e.message });
      console.log(`${action.padEnd(26)} EXCEPTION  ${e.message}`);
    }
    await sleep(400); // stay well under 60/min
  }

  console.log("\n\n===== FIELD SCHEMAS (only where records were returned) =====");
  for (const r of results) {
    if (r.count > 0) {
      console.log(`\n## ${r.action} (${r.count} records)\n` + r.fields.join(", "));
    }
  }

  const ok = results.filter((r) => r.status === 200).length;
  const withData = results.filter((r) => r.count > 0).length;
  const forbidden = results.filter((r) => r.status === 403).length;
  console.log(`\n\n===== SUMMARY =====\naccessible(200): ${ok}/${ACTIONS.length} | withRecentData: ${withData} | forbidden(403): ${forbidden}`);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
