import { eq, sql } from "drizzle-orm";
import {
  customersTable,
  db,
  occupantsTable,
  payrollDeductionsTable,
  propertiesTable,
} from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import type { Logger } from "pino";
import { randomUUID } from "node:crypto";
import { normalizeOccupantRow } from "./db-row-normalizers";
import { isSaturdayDate } from "./pay-week";

export interface HousingDeductionRow {
  customer: string;
  name: string;
  personId: string;
  weekly: number;
}

/**
 * A close-but-not-exact match for an unplaced payroll row. Surfaced on
 * the dashboard as "Did you mean: <name> @ <propertyName>?" so the
 * operator can fix a payroll typo (e.g. "JANE A SMITH" vs the existing
 * "Jane Smith") in one click instead of creating a duplicate occupant.
 *
 * Same-employer candidates (occupants whose `company` matches the
 * payroll row's `customer`, case-insensitive) are preferred — a
 * similarly-named employee at a different employer is never silently
 * picked. As a fallback, when zero same-employer candidates clear the
 * threshold the seeder offers cross-employer candidates flagged with
 * `crossEmployer = true`. The dashboard renders those with a distinct
 * label so the operator knows confirming will also change the
 * occupant's employer (common when shared housing means an occupant
 * was originally created against the wrong customer — e.g. Penda vs
 * Trienda at the same property).
 */
export interface UnplacedPayrollSuggestion {
  occupantId: string;
  name: string;
  company: string;
  propertyName: string | null;
  score: number;
  crossEmployer: boolean;
}

export interface UnplacedPayrollUnmatchedRow {
  customer: string;
  name: string;
  personId: string;
  weekly: number;
  suggestions: UnplacedPayrollSuggestion[];
}

/**
 * A payroll row that the seeder *did* apply, but only via the
 * fragile name-only fallback (no employeeId, no name+company hit).
 * At an employer with two namesakes ("Jose Garcia" + "Jose Garcia")
 * the wrong occupant may have received the rate, so the dashboard
 * surfaces these in a "Confirm match" section. Operators can either
 * confirm the picked occupant (stamping employeeId so future runs
 * match strongly) or redirect the rate to a same-employer
 * alternative.
 */
export interface LowConfidencePayrollMatch {
  customer: string;
  name: string;
  personId: string;
  weekly: number;
  matched: UnplacedPayrollSuggestion;
  suggestions: UnplacedPayrollSuggestion[];
}

export interface SeedHousingDeductionsResult {
  totalRows: number;
  matched: number;
  updated: number;
  alreadyCorrect: number;
  // Snapshot rows written into `payroll_deductions` for the supplied
  // `payWeekEndDate` (one per matched occupant). Zero when no
  // `payWeekEndDate` was passed — the seeder boots happily without
  // creating snapshots so existing tests / startup paths are unaffected.
  snapshotsWritten: number;
  // Sum of `weeklyAmount` (USD) across the snapshot rows written for
  // `payWeekEndDate`. Used by the dashboard import-summary toast so
  // the operator sees "Imported X deductions … total $Y" without a
  // second round-trip. Zero when no snapshots were written.
  snapshotsTotalAmount: number;
  // Saturday end-date the snapshot rows were stamped with (echoed back
  // from the input). Null when no snapshots were written.
  payWeekEndDate: string | null;
  unmatched: UnplacedPayrollUnmatchedRow[];
  lowConfidenceMatches: LowConfidencePayrollMatch[];
  // Rows that matched an existing occupant whose chargeSource is
  // "manual_override" (a human edit replaced the payroll-set value).
  // The seeder skipped these by default; they're surfaced separately so
  // the operator can review and re-run with `reclaimOverridden: true`
  // if they want payroll to win again.
  skippedOverridden: number;
  // Per-path match counters so we can verify in the workflow log that
  // employeeId is the dominant matcher and the fragile name-only
  // fallback resolves at most a handful of rows. Sum equals `matched`.
  matchedByEmployeeId: number;
  matchedByNameCompany: number;
  matchedByNameOnly: number;
}

export interface SeedHousingDeductionsDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
  rows: HousingDeductionRow[];
  // When true, re-claim rows that a human had previously overridden
  // (chargeSource === "manual_override"): overwrite chargePerBed +
  // billingFrequency with the payroll values and flip chargeSource
  // back to "payroll". Defaults to false so the seeder is safe to run
  // on every boot without silently undoing manual corrections.
  reclaimOverridden: boolean;
  // When non-empty, only reclaim overrides for the listed occupant IDs
  // (Task #381). Requires `reclaimOverridden` to also be true. This
  // lets the dashboard offer a per-row "Re-claim from payroll" button
  // without forcibly overwriting every other override in the portfolio.
  reclaimOccupantIds?: string[];
  // Saturday YYYY-MM-DD end-date for the Mon→Sat pay-week represented
  // by the supplied `rows`. When provided, the seeder writes one
  // immutable snapshot row per matched occupant into the
  // `payroll_deductions` table — the source of truth for the new
  // weekly / monthly Finance tabs (Task #597). Re-importing the same
  // pay-week is safe and idempotent: rows are upserted on the
  // (occupantId, payWeekEndDate) composite unique index. Skipped when
  // null/undefined (boot path stays a no-op for snapshots).
  payWeekEndDate?: string | null;
}

// Source of truth: payroll export
// `attached_assets/EE_Housing_Deduciton_by_Customer_1778104819682.xlsx`.
// Columns used: Customer, Person, Person Id, Adjustment (= weekly).
// `Deduction` (actual taken on a given run) is intentionally ignored —
// it can include catch-up balances and is not the recurring rate.
export const HOUSING_DEDUCTION_ROWS: HousingDeductionRow[] = [
  { customer: "Adient", name: "ANDREW GRANVILLE", personId: "2004810", weekly: 25.0 },
  { customer: "Adient", name: "MARISA L LOERA", personId: "2005126", weekly: 175.0 },
  { customer: "Adient", name: "WILLIAM C MILLER", personId: "2005127", weekly: 175.0 },

  { customer: "Bell Timber, Inc.", name: "GERARD A DERBY", personId: "2004445", weekly: 150.5 },

  { customer: "Burnett Dairy - Grantsburg", name: "ALBERT GARCIA", personId: "2002150", weekly: 125.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "ANDRES AYALA", personId: "2002152", weekly: 125.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "ANTHONY G EVANS", personId: "2005128", weekly: 125.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "ARTHUR DE LA ROSA", personId: "2001866", weekly: 99.43 },
  { customer: "Burnett Dairy - Grantsburg", name: "BRANDON DIDONATO", personId: "2002818", weekly: 125.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "CHRISTIAN FRIAS", personId: "2004688", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "CODY S OGDEN", personId: "2004594", weekly: 116.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "COLBY PETERS", personId: "2004801", weekly: 116.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "CORY BANUELOS", personId: "2002162", weekly: 125.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "DEVIN M LAW", personId: "2004762", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "DEVIN R NEAL", personId: "2005042", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "ELIJAH DAVIS", personId: "2004737", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "ERIC D MOORE", personId: "2004687", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "FELIX ANDRES BAEZ CABALLERO", personId: "2003283", weekly: 125.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "FERNANDO D REYES", personId: "2004592", weekly: 116.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "FRANCISCO J PALMA", personId: "2003196", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "FRANK QUINONES", personId: "2004741", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "GABRIEL M VEGA", personId: "2004606", weekly: 116.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "ISIDRO GUERRERO", personId: "2005207", weekly: 99.43 },
  { customer: "Burnett Dairy - Grantsburg", name: "JAYDEN ROBERTSON", personId: "2004690", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "JOHNATHAN M REYNOLDS", personId: "2004593", weekly: 116.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "JORDAN A SANDERS", personId: "2004596", weekly: 116.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "JORDAN DOYLE", personId: "2004595", weekly: 116.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "JOSE GALLEGOS", personId: "2002374", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "JUAN SANCHEZ", personId: "2004735", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "LUIS ALBERTO HERNANDEZ", personId: "2004372", weekly: 99.43 },
  { customer: "Burnett Dairy - Grantsburg", name: "LUIS E CEBALLOS MARTINEZ", personId: "2003301", weekly: 125.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "MIGUEL MATA", personId: "2002151", weekly: 125.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "ORLANDO MORENO", personId: "2003075", weekly: 125.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "RAMON ALMEIDA RUIZ", personId: "2004067", weekly: 116.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "RICARDO MONDRAGON MERCADO", personId: "2002688", weekly: 125.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "RONALD GLEN HOLMES", personId: "2004740", weekly: 86.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "STEVEN N HOLLIDAY", personId: "2004803", weekly: 116.0 },
  { customer: "Burnett Dairy - Grantsburg", name: "WILLIE A MEDINA JR", personId: "2004792", weekly: 116.0 },

  { customer: "DeLallo Foods", name: "ABEL SMALL", personId: "2005009", weekly: 69.23 },
  { customer: "DeLallo Foods", name: "DAVIDSON ALCIDE", personId: "2005003", weekly: 69.23 },
  { customer: "DeLallo Foods", name: "DIRON C WEAVER", personId: "2005008", weekly: 69.23 },
  { customer: "DeLallo Foods", name: "DYLAN A FARMER", personId: "2005218", weekly: 59.34 },
  { customer: "DeLallo Foods", name: "JORDAN H BROWN", personId: "2005030", weekly: 69.23 },
  { customer: "DeLallo Foods", name: "WILLIE T TURNER", personId: "2005219", weekly: 59.34 },

  { customer: "Greystone Manufacturing", name: "BRANDON TILTON", personId: "2004819", weekly: 77.14 },
  { customer: "Greystone Manufacturing", name: "CHRISTOPHER AARON DELAROSA", personId: "2004818", weekly: 60.0 },
  { customer: "Greystone Manufacturing", name: "DEVIN F HOLLY", personId: "2004812", weekly: 77.14 },
  { customer: "Greystone Manufacturing", name: "GAGE COREY MOODY", personId: "2005141", weekly: 98.0 },
  { customer: "Greystone Manufacturing", name: "GIOVANNI OSHEA LYNN ALEXANDER", personId: "2005077", weekly: 98.0 },
  { customer: "Greystone Manufacturing", name: "JACOBY CHENEVERT", personId: "2005094", weekly: 98.0 },
  { customer: "Greystone Manufacturing", name: "JALEN L GORDON", personId: "2004807", weekly: 77.14 },
  { customer: "Greystone Manufacturing", name: "JAYLON MARQUAN CLARK", personId: "2005103", weekly: 98.0 },
  { customer: "Greystone Manufacturing", name: "MARQUIS JAMEL SANDERS", personId: "2005098", weekly: 49.0 },
  { customer: "Greystone Manufacturing", name: "RICHARD MICHAEL ANTHONY FULLER", personId: "2005136", weekly: 98.0 },
  { customer: "Greystone Manufacturing", name: "VICTOR ALFONSO VALENZUELA ESPINOZA", personId: "2005074", weekly: 126.0 },

  { customer: "International Wire Group, Inc", name: "WILBER R BARRIENTOS FLORES", personId: "2005056", weekly: 80.1 },

  { customer: "Landscape Structures", name: "ABEL A GUZMAN", personId: "2005096", weekly: 125.0 },
  { customer: "Landscape Structures", name: "ALFRED A BESERRA", personId: "2004710", weekly: 125.0 },
  { customer: "Landscape Structures", name: "DAVID DAVIS", personId: "2002373", weekly: 125.0 },
  { customer: "Landscape Structures", name: "EDUARDO CAMPOS", personId: "2000822", weekly: 105.0 },
  { customer: "Landscape Structures", name: "ERASMO GARZA", personId: "2002379", weekly: 125.0 },
  { customer: "Landscape Structures", name: "ETHAN DAVIS", personId: "2002636", weekly: 125.0 },
  { customer: "Landscape Structures", name: "EVARADO DELGADO", personId: "2004070", weekly: 125.0 },
  { customer: "Landscape Structures", name: "GABRIEL J WOMACK", personId: "2005111", weekly: 125.0 },
  { customer: "Landscape Structures", name: "GILBERT BUSTOS JR", personId: "2002861", weekly: 125.0 },
  { customer: "Landscape Structures", name: "JONATHAN REYNOSA", personId: "2002442", weekly: 125.0 },
  { customer: "Landscape Structures", name: "JORDAN TORRES", personId: "2002938", weekly: 125.0 },
  { customer: "Landscape Structures", name: "JOSE MOLINA", personId: "2002031", weekly: 125.0 },
  { customer: "Landscape Structures", name: "JULIO ORGONEZ", personId: "2002940", weekly: 125.0 },
  { customer: "Landscape Structures", name: "JUSTIN DEANGELIS", personId: "2005110", weekly: 125.0 },
  { customer: "Landscape Structures", name: "LUIS RODRIGUEZ RIVERA", personId: "2001894", weekly: 125.0 },
  { customer: "Landscape Structures", name: "MARCOS ANTONIO LARA", personId: "2002820", weekly: 125.0 },
  { customer: "Landscape Structures", name: "NICHOLAS R FRANKLIN", personId: "2004544", weekly: 125.0 },
  { customer: "Landscape Structures", name: "RAYMUNDO LEIJA", personId: "2002939", weekly: 125.0 },
  { customer: "Landscape Structures", name: "SEBASTIAN VILLARREAL", personId: "2005166", weekly: 107.14 },
  { customer: "Landscape Structures", name: "TYREK J PATTERSON", personId: "2004786", weekly: 125.0 },

  { customer: "Milwaukee Valve", name: "ABEIN FLORES", personId: "2002424", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "ALEXANDER A MARRERO", personId: "2002780", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "ALEXIS PEREZ", personId: "2002739", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "ANTONIO HERNANDEZ", personId: "2001265", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "CARLOS GALVEZ GARCIA", personId: "2001261", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "DORIAN KYLES", personId: "2004679", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "ELADIO RAMOS JR", personId: "2001255", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "GABRIEL ROMERO", personId: "2004677", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "ISMAEL MEZA CACERES", personId: "2001257", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "JACOB C FERGUSON", personId: "2004676", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "JACOB ZEPEDA", personId: "2001252", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "JONATHAN ARIOLA", personId: "2002201", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "JOSE CASTRO", personId: "2001690", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "LAWRENCE CORTEZ", personId: "2002187", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "MOICES BERNAL", personId: "2004681", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "PEDRO GARCIA", personId: "2002202", weekly: 130.0 },
  { customer: "Milwaukee Valve", name: "XAVIOR R ROBINSON", personId: "2004678", weekly: 130.0 },

  { customer: "Penda Corp", name: "ALFONZO D TUCKER", personId: "2004985", weekly: 175.0 },
  { customer: "Penda Corp", name: "BRANDON HUDSON", personId: "2004580", weekly: 175.0 },
  { customer: "Penda Corp", name: "DERWIN B WILLIAMS", personId: "2004579", weekly: 175.0 },
  { customer: "Penda Corp", name: "DULCE ASCENCIO", personId: "2001231", weekly: 175.0 },
  { customer: "Penda Corp", name: "EMORY L LEWIS", personId: "2004578", weekly: 175.0 },
  { customer: "Penda Corp", name: "ESDRAS N LOPEZ", personId: "2004980", weekly: 175.0 },
  { customer: "Penda Corp", name: "EVIAN D NAPIER", personId: "2004989", weekly: 175.0 },
  { customer: "Penda Corp", name: "JOHN T CLARK", personId: "2004954", weekly: 175.0 },
  { customer: "Penda Corp", name: "JUSTIN R HERNANDEZ", personId: "2004975", weekly: 175.0 },
  { customer: "Penda Corp", name: "ZABDI X RODRIGUEZ", personId: "2004956", weekly: 175.0 },

  { customer: "Schuette Metals", name: "COLE C HAYEK", personId: "2005106", weekly: 86.0 },
  { customer: "Schuette Metals", name: "ELIJAH PATTERSON", personId: "2005108", weekly: 86.0 },
  { customer: "Schuette Metals", name: "ERIN B MILLER", personId: "2005107", weekly: 86.0 },
  { customer: "Schuette Metals", name: "JOSHUA B ALLEN", personId: "2005112", weekly: 86.0 },
  { customer: "Schuette Metals", name: "JULIAN T LEWIS", personId: "2005109", weekly: 86.0 },

  { customer: "Shuster's Building Components", name: "ANDRES GALLEGOS", personId: "2005033", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "BENJAMIN ZACATZONTLE", personId: "2005217", weekly: 64.29 },
  { customer: "Shuster's Building Components", name: "CHRISTIAN M DECUIRE", personId: "2004767", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "CHRISTOPHER D HOPSON", personId: "2005093", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "CHRISTOPHER HILL", personId: "2004747", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "DERRICK L BLACK", personId: "2004750", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "HAROLD COVINGTON", personId: "2004797", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "JACOB MULLINAX", personId: "2005115", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "JAIME ALVARADO", personId: "2005089", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "JARED LEMERT", personId: "2004749", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "JOY DORAN", personId: "2003771", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "JUSTIN MARTINEZ", personId: "2002254", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "LUCAS J YOUNG", personId: "2005216", weekly: 64.29 },
  { customer: "Shuster's Building Components", name: "MANDRELL CORTEZ", personId: "2002420", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "MICHAEL J WILSON", personId: "2005215", weekly: 64.29 },
  { customer: "Shuster's Building Components", name: "RICHARD R RUSSELL", personId: "2005113", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "ROBERT BRADFORD", personId: "2004866", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "ROLANDO R AVITIA", personId: "2005213", weekly: 64.29 },
  { customer: "Shuster's Building Components", name: "SAM D HOUSTON", personId: "2004768", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "TIMOTHY MURPHY", personId: "2004795", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "TIMOTHY N ROUSE", personId: "2005114", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "TONY A PERRY", personId: "2005084", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "TYLER SMITH", personId: "2005083", weekly: 75.0 },
  { customer: "Shuster's Building Components", name: "XAVIER A ADDISON", personId: "2005214", weekly: 64.29 },

  { customer: "Trienda Holdings", name: "BUCKY LEE GONZALEZ", personId: "2004381", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "CEDRIC T LEE", personId: "2004528", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "CHRISTIAN HUNTER", personId: "2004618", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "CHRISTIAN L RICHARDSON", personId: "2004617", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "CHRISTOPHER C LAUDERDALE", personId: "2004541", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "ELIJAH M LEE", personId: "2004418", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "JASMIN ARCE", personId: "2004307", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "JORDAN T SMITH", personId: "2004574", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "JOSHUA L RITCH", personId: "2004624", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "LUIS ALBERTO RUIZ", personId: "2004589", weekly: 25.0 },
  { customer: "Trienda Holdings", name: "MICHAEL BRENNAN FELIX", personId: "2004822", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "RICKY ARGUELLES", personId: "2004352", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "TREY GRANT", personId: "2004572", weekly: 175.0 },
  { customer: "Trienda Holdings", name: "VICTORIA E BRANNON", personId: "2004428", weekly: 175.0 },

  { customer: "WB Manufacturing", name: "ANDREW J CASTANEDA", personId: "2004961", weekly: 103.42 },
  { customer: "WB Manufacturing", name: "DENNIS G JORDAN", personId: "2004960", weekly: 103.42 },
  { customer: "WB Manufacturing", name: "GILBERTO LARA", personId: "2004959", weekly: 103.42 },
  { customer: "WB Manufacturing", name: "ISAIAH H YOUNG", personId: "2005032", weekly: 107.0 },
  { customer: "WB Manufacturing", name: "JACOB M NOVAK", personId: "2005031", weekly: 107.0 },
  { customer: "WB Manufacturing", name: "JESUS O LIRA", personId: "2005037", weekly: 107.0 },
  { customer: "WB Manufacturing", name: "MARTIN L HUST", personId: "2005034", weekly: 107.0 },
  { customer: "WB Manufacturing", name: "STERLIN C ADAMS", personId: "2005036", weekly: 107.0 },
];

/** Lowercase, strip non-alpha, collapse whitespace. */
function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Significant tokens (drops single-letter middle initials). */
function significantTokens(raw: string): string[] {
  return normalizeName(raw)
    .split(" ")
    .filter((t) => t.length > 1);
}

/** Standard iterative Levenshtein edit distance. O(|a|·|b|). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/**
 * Name similarity in [0, 1]. Combines token-set Jaccard (catches
 * reorderings and dropped middle initials) with character-level
 * Levenshtein (catches typos within a token). Returns the max so
 * either signal is enough to surface a candidate.
 */
export function nameSimilarity(a: string, b: string): number {
  const an = normalizeName(a);
  const bn = normalizeName(b);
  if (an === "" || bn === "") return 0;
  const at = significantTokens(a);
  const bt = significantTokens(b);
  let jaccard = 0;
  if (at.length > 0 && bt.length > 0) {
    const setA = new Set(at);
    const setB = new Set(bt);
    let inter = 0;
    for (const t of setA) if (setB.has(t)) inter++;
    const uni = new Set([...at, ...bt]).size;
    jaccard = uni === 0 ? 0 : inter / uni;
  }
  const m = Math.max(an.length, bn.length);
  const lev = m === 0 ? 0 : 1 - levenshtein(an, bn) / m;
  return Math.max(jaccard, lev);
}

export interface SuggestionCandidate {
  id: string;
  name: string;
  company: string;
  propertyId: string | null;
}

/**
 * Pure scoring helper exported for unit tests. Returns up to `limit`
 * candidates scored by name similarity ≥ `threshold`, sorted descending.
 *
 * Default mode (`employerMode: "same"`) restricts candidates to those
 * whose `company` matches `customer` (case-insensitive) — the safe
 * path. `employerMode: "cross"` does the inverse: only candidates
 * whose `company` differs from `customer`, with each result flagged
 * `crossEmployer = true` so the dashboard can render them as
 * employer-change confirmations rather than typo fixes. The seeder
 * uses cross-employer as a fallback when the same-employer pass
 * returns nothing.
 */
export function rankSuggestions(
  payrollName: string,
  customer: string,
  candidates: SuggestionCandidate[],
  propertyNameById: Map<string, string>,
  options: { limit?: number; threshold?: number; employerMode?: "same" | "cross" } = {},
): UnplacedPayrollSuggestion[] {
  const limit = options.limit ?? 3;
  const threshold = options.threshold ?? 0.6;
  const employerMode = options.employerMode ?? "same";
  const customerKey = customer.trim().toLowerCase();
  const scored: UnplacedPayrollSuggestion[] = [];
  for (const c of candidates) {
    const sameEmployer = c.company.trim().toLowerCase() === customerKey;
    if (employerMode === "same" && !sameEmployer) continue;
    if (employerMode === "cross" && sameEmployer) continue;
    const score = nameSimilarity(payrollName, c.name);
    if (score < threshold) continue;
    scored.push({
      occupantId: c.id,
      name: c.name,
      company: c.company,
      propertyName: c.propertyId
        ? propertyNameById.get(c.propertyId) ?? null
        : null,
      score,
      crossEmployer: employerMode === "cross",
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Apply weekly housing deductions from the payroll export to existing
 * occupants. Matches first by `employeeId == personId`, then falls back
 * to a case-insensitive `(name, company)` exact match. Updates set
 * `chargePerBed = weekly` and `billingFrequency = "Weekly"`. Never
 * inserts new occupants — unmatched rows are reported only, with up to
 * 3 fuzzy-match suggestions (same employer, name similarity ≥ 0.6) so
 * the dashboard can offer "Did you mean: …" one-click fixes for typos.
 * When zero same-employer candidates clear the threshold, falls back
 * to up to 3 cross-employer candidates flagged with `crossEmployer`.
 *
 * Idempotent: re-running yields the same result and only writes to rows
 * whose values would change (`alreadyCorrect` covers the no-op path).
 *
 * Respects manual overrides (Task #330): if an occupant's `chargeSource`
 * is "manual_override", the seeder leaves the row alone and counts it
 * in `skippedOverridden`. Pass `reclaimOverridden: true` to forcibly
 * reset such rows back to the payroll value (and chargeSource
 * "payroll").
 */
export async function seedHousingDeductions(
  deps: Partial<SeedHousingDeductionsDeps> = {},
): Promise<SeedHousingDeductionsResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;
  const rows = deps.rows ?? HOUSING_DEDUCTION_ROWS;
  const reclaimOverridden = deps.reclaimOverridden ?? false;
  const reclaimOccupantIdSet = deps.reclaimOccupantIds?.length
    ? new Set(deps.reclaimOccupantIds)
    : null;
  const payWeekEndDate =
    typeof deps.payWeekEndDate === "string" && isSaturdayDate(deps.payWeekEndDate)
      ? deps.payWeekEndDate
      : null;
  if (deps.payWeekEndDate && !payWeekEndDate) {
    log.warn(
      { payWeekEndDate: deps.payWeekEndDate },
      "Ignoring payWeekEndDate that is not a YYYY-MM-DD Saturday — no snapshot rows will be written",
    );
  }
  // Track which occupants got matched so we can write one snapshot row
  // per matched occupant after the per-row apply loop. We use a Map so
  // a duplicated payroll row (same occupant twice) collapses to one
  // snapshot — the `(occupantId, payWeekEndDate)` unique index would
  // reject the second insert anyway.
  const matchedSnapshots = new Map<
    string,
    { occupantId: string; weekly: number; row: HousingDeductionRow; propertyId: string | null; customerId: string }
  >();

  // Pull the entire occupants table once. The volume is small (hundreds),
  // and pre-loading lets us do both lookups (by employeeId, by
  // name+company) without round-trips per row.
  const allOccupants = await database
    .select({
      id: occupantsTable.id,
      name: occupantsTable.name,
      company: occupantsTable.company,
      employeeId: occupantsTable.employeeId,
      propertyId: occupantsTable.propertyId,
      chargePerBed: occupantsTable.chargePerBed,
      billingFrequency: occupantsTable.billingFrequency,
      chargeSource: occupantsTable.chargeSource,
      chargeSourceCustomer: occupantsTable.chargeSourceCustomer,
      chargeSourcePersonId: occupantsTable.chargeSourcePersonId,
    })
    .from(occupantsTable);

  // Pull every property name once so we can label suggestions
  // ("Did you mean: Jane Smith @ Maple Court?") without an N+1 lookup
  // per unmatched row. Volume is small (tens) so a full scan is fine.
  const allProperties = await database
    .select({
      id: propertiesTable.id,
      name: propertiesTable.name,
      customerId: propertiesTable.customerId,
    })
    .from(propertiesTable);
  const propertyNameById = new Map<string, string>();
  const propertyCustomerById = new Map<string, string>();
  for (const p of allProperties) {
    propertyNameById.set(p.id, p.name);
    propertyCustomerById.set(p.id, p.customerId ?? "");
  }

  // Build a payroll-customer-name → customerId lookup so the snapshot
  // attributes deductions to the matched payroll customer rather than
  // the property's primary customer. This matters for shared-customer
  // properties (`sharedWithCustomerIds`) where one property houses
  // people from multiple customers — the By-Customer rollup needs to
  // credit the actual employer of the deduction. Lowercased + trimmed
  // for resilience to whitespace / case differences in the payroll
  // export.
  const allCustomers = await database
    .select({ id: customersTable.id, name: customersTable.name })
    .from(customersTable);
  const customerIdByName = new Map<string, string>();
  for (const c of allCustomers) {
    if (c.name) customerIdByName.set(c.name.trim().toLowerCase(), c.id);
  }
  const resolveCustomerId = (
    payrollCustomer: string,
    fallbackPropertyId: string | null,
  ): string => {
    const fromPayroll = customerIdByName.get(
      (payrollCustomer ?? "").trim().toLowerCase(),
    );
    if (fromPayroll) return fromPayroll;
    if (fallbackPropertyId) {
      return propertyCustomerById.get(fallbackPropertyId) ?? "";
    }
    return "";
  };
  const suggestionCandidates: SuggestionCandidate[] = allOccupants.map((o) => ({
    id: o.id,
    name: o.name,
    company: o.company,
    propertyId: o.propertyId,
  }));

  const byEmployeeId = new Map<string, (typeof allOccupants)[number]>();
  for (const o of allOccupants) {
    if (o.employeeId && o.employeeId.trim() !== "") {
      byEmployeeId.set(o.employeeId.trim(), o);
    }
  }
  const byNameCompany = new Map<string, (typeof allOccupants)[number]>();
  const nameCompanyKey = (name: string, company: string): string =>
    `${name.trim().toLowerCase()}|${company.trim().toLowerCase()}`;
  for (const o of allOccupants) {
    byNameCompany.set(nameCompanyKey(o.name, o.company), o);
  }

  // Last-resort fallback: case-insensitive name-only match, but only if
  // the name is unique across the occupants table. This rescues seed data
  // that doesn't yet have employeeId or company filled in. Ambiguous
  // names are dropped from this map so we never silently pick the wrong
  // occupant.
  const byNameOnly = new Map<string, (typeof allOccupants)[number] | null>();
  const nameKey = (name: string): string => name.trim().toLowerCase();
  for (const o of allOccupants) {
    const k = nameKey(o.name);
    if (byNameOnly.has(k)) {
      byNameOnly.set(k, null); // mark ambiguous
    } else {
      byNameOnly.set(k, o);
    }
  }

  let matched = 0;
  let updated = 0;
  let alreadyCorrect = 0;
  let skippedOverridden = 0;
  let matchedByEmployeeId = 0;
  let matchedByNameCompany = 0;
  let matchedByNameOnly = 0;
  const unmatched: SeedHousingDeductionsResult["unmatched"] = [];
  const lowConfidenceMatches: SeedHousingDeductionsResult["lowConfidenceMatches"] = [];

  for (const row of rows) {
    let target: (typeof allOccupants)[number] | null = null;
    let matchPath: "employeeId" | "nameCompany" | "nameOnly" | null = null;

    const byId = byEmployeeId.get(row.personId.trim());
    if (byId) {
      target = byId;
      matchPath = "employeeId";
    } else {
      const byNc = byNameCompany.get(nameCompanyKey(row.name, row.customer));
      if (byNc) {
        target = byNc;
        matchPath = "nameCompany";
      } else {
        const byN = byNameOnly.get(nameKey(row.name));
        if (byN) {
          target = byN;
          matchPath = "nameOnly";
        }
      }
    }

    if (!target) {
      // Prefer same-employer suggestions (typo / initial fixes). If
      // none clear the threshold, fall back to a cross-employer pass —
      // this catches occupants that were originally created against
      // the wrong customer (common when shared housing means a single
      // property serves two customers like Penda + Trienda).
      let suggestions = rankSuggestions(
        row.name,
        row.customer,
        suggestionCandidates,
        propertyNameById,
      );
      if (suggestions.length === 0) {
        suggestions = rankSuggestions(
          row.name,
          row.customer,
          suggestionCandidates,
          propertyNameById,
          { employerMode: "cross" },
        );
      }
      unmatched.push({
        customer: row.customer,
        name: row.name,
        personId: row.personId,
        weekly: row.weekly,
        suggestions,
      });
      continue;
    }

    // Skip rows whose target was manually overridden by an operator
    // (Task #330). The original payroll link is preserved on the row
    // (chargeSourceCustomer + chargeSourcePersonId) so accounting can
    // still trace the source — we just don't clobber the human's
    // chosen charge value. `reclaimOverridden: true` opts back in.
    const shouldReclaim =
      reclaimOverridden &&
      (!reclaimOccupantIdSet || reclaimOccupantIdSet.has(target.id));
    if (target.chargeSource === "manual_override" && !shouldReclaim) {
      skippedOverridden++;
      continue;
    }

    matched++;
    // When the name-only fallback is the only matcher we'd normally
    // surface the row in the Confirm-match tile so an operator can
    // verify which namesake to stamp. But if there are zero
    // same-employer alternative candidates there is literally no one
    // else this row could plausibly be — confirming would just stamp
    // the same occupant. Auto-confirm those by promoting them to a
    // full employeeId match (stamping employeeId on the occupant) so
    // (a) the operator's queue shrinks on its own and (b) future runs
    // match strongly via employeeId without revisiting the fallback.
    let autoConfirmedNameOnly = false;
    if (matchPath === "employeeId") matchedByEmployeeId++;
    else if (matchPath === "nameCompany") matchedByNameCompany++;
    else if (matchPath === "nameOnly") {
      // Score is forced to 1 because the payroll name and occupant
      // name are equal post-normalization (that's how nameOnly
      // matched in the first place); the risk isn't a typo, it's
      // namesake collision. Alternatives exclude the already-matched
      // occupant so the "Did you mean someone else?" buttons point at
      // distinct people.
      const alternatives = rankSuggestions(
        row.name,
        row.customer,
        suggestionCandidates,
        propertyNameById,
      ).filter((s) => s.occupantId !== target.id);
      if (alternatives.length === 0) {
        // No same-employer namesake exists — auto-confirm. Counts as
        // an employeeId match from the perspective of the per-path
        // counters since we're stamping employeeId below.
        autoConfirmedNameOnly = true;
        matchedByEmployeeId++;
      } else {
        matchedByNameOnly++;
        lowConfidenceMatches.push({
          customer: row.customer,
          name: row.name,
          personId: row.personId,
          weekly: row.weekly,
          matched: {
            occupantId: target.id,
            name: target.name,
            company: target.company,
            propertyName: target.propertyId
              ? propertyNameById.get(target.propertyId) ?? null
              : null,
            score: 1,
            // nameOnly doesn't constrain by employer at all — it
            // picks whichever occupant has the same normalized name.
            // Flag the mismatch so the dashboard can warn.
            crossEmployer:
              target.company.trim().toLowerCase() !== row.customer.trim().toLowerCase(),
          },
          suggestions: alternatives,
        });
      }
    }
    const willStampEmployeeId =
      autoConfirmedNameOnly &&
      (target.employeeId ?? "").trim() !== row.personId.trim();
    const isCorrect =
      !willStampEmployeeId &&
      target.billingFrequency === "Weekly" &&
      Math.abs((target.chargePerBed ?? 0) - row.weekly) < 1e-6 &&
      target.chargeSource === "payroll" &&
      target.chargeSourceCustomer === row.customer &&
      target.chargeSourcePersonId === row.personId;

    if (isCorrect) {
      alreadyCorrect++;
      continue;
    }

    await database
      .update(occupantsTable)
      // Defence-in-depth (Task #417): mirror the API write path by
      // running the patch through the boundary normalizer so any
      // future off-list billingFrequency / chargeSource value coming
      // out of the payroll importer is coerced to the canonical
      // contract before it lands in the DB.
      .set(
        normalizeOccupantRow({
          chargePerBed: row.weekly,
          billingFrequency: "Weekly",
          // Stamp provenance so the property page can render a "from
          // payroll" badge and the dashboard counter can tell auto-
          // reconciled occupants apart from manually-entered ones.
          chargeSource: "payroll",
          chargeSourceCustomer: row.customer,
          chargeSourcePersonId: row.personId,
          // Auto-confirmed name-only matches also get employeeId
          // stamped so the next run takes the strong match path.
          ...(autoConfirmedNameOnly ? { employeeId: row.personId } : {}),
        }),
      )
      .where(eq(occupantsTable.id, target.id));
    updated++;
    if (payWeekEndDate) {
      matchedSnapshots.set(target.id, {
        occupantId: target.id,
        weekly: row.weekly,
        row,
        propertyId: target.propertyId ?? null,
        customerId: resolveCustomerId(row.customer, target.propertyId),
      });
    }
  }

  // The `updated++` branch above only fires when the seeder actually
  // wrote to the occupants row. For a re-import of the same payroll
  // file, the bulk of matched rows hit `alreadyCorrect` and skip the
  // snapshot map. Re-walk the rows and stamp snapshots for every match
  // so the per-week record is complete regardless of whether the
  // occupant cache changed. Done as a second pass to keep the
  // already-correct fast path readable.
  if (payWeekEndDate) {
    for (const row of rows) {
      let target: (typeof allOccupants)[number] | null = null;
      const byId = byEmployeeId.get(row.personId.trim());
      if (byId) target = byId;
      else {
        const byNc = byNameCompany.get(nameCompanyKey(row.name, row.customer));
        if (byNc) target = byNc;
        else {
          const byN = byNameOnly.get(nameKey(row.name));
          if (byN) target = byN;
        }
      }
      if (!target) continue;
      // Snapshot every matched payroll row, even when the occupant is
      // in `manual_override` and reclaim is off (Task #597 v6
      // validator). The cache value on the occupant row may diverge
      // from the actual payroll deduction in that case, but the
      // `payroll_deductions` table is the source of truth for what
      // was actually deducted on this pay-week — leaving holes here
      // would cause Finance Weekly/Monthly/By-Customer to undercount
      // recovered amounts. The occupants-cache update above is still
      // gated on the override, only the snapshot write is universal.
      if (matchedSnapshots.has(target.id)) continue;
      matchedSnapshots.set(target.id, {
        occupantId: target.id,
        weekly: row.weekly,
        row,
        propertyId: target.propertyId ?? null,
        customerId: resolveCustomerId(row.customer, target.propertyId),
      });
    }
  }

  let snapshotsWritten = 0;
  let snapshotsTotalAmount = 0;
  if (payWeekEndDate && matchedSnapshots.size > 0) {
    // Idempotent upsert on (occupantId, payWeekEndDate). Re-importing
    // the same week overwrites the snapshot in place — same posture as
    // the occupants-cache update above.
    for (const snap of matchedSnapshots.values()) {
      await database
        .insert(payrollDeductionsTable)
        .values({
          id: randomUUID(),
          occupantId: snap.occupantId,
          customerId: snap.customerId,
          propertyId: snap.propertyId ?? "",
          payWeekEndDate,
          weeklyAmount: snap.weekly,
          personId: snap.row.personId,
          nameSnapshot: snap.row.name,
          customerSnapshot: snap.row.customer,
          source: "payroll_import",
        })
        .onConflictDoUpdate({
          target: [
            payrollDeductionsTable.occupantId,
            payrollDeductionsTable.payWeekEndDate,
          ],
          set: {
            weeklyAmount: snap.weekly,
            personId: snap.row.personId,
            nameSnapshot: snap.row.name,
            customerSnapshot: snap.row.customer,
            customerId: snap.customerId,
            propertyId: snap.propertyId ?? "",
            source: "payroll_import",
            importedAt: sql`now()`,
            createdAt: sql`now()`,
          },
        });
      snapshotsWritten++;
      snapshotsTotalAmount += snap.weekly;
    }
  }

  const result: SeedHousingDeductionsResult = {
    totalRows: rows.length,
    matched,
    updated,
    alreadyCorrect,
    snapshotsWritten,
    snapshotsTotalAmount: Math.round(snapshotsTotalAmount * 100) / 100,
    payWeekEndDate,
    unmatched,
    lowConfidenceMatches,
    skippedOverridden,
    matchedByEmployeeId,
    matchedByNameCompany,
    matchedByNameOnly,
  };

  log.info(
    {
      totalRows: result.totalRows,
      matched: result.matched,
      updated: result.updated,
      alreadyCorrect: result.alreadyCorrect,
      skippedOverridden: result.skippedOverridden,
      unmatched: result.unmatched.length,
      lowConfidenceMatches: result.lowConfidenceMatches.length,
      matchedByEmployeeId: result.matchedByEmployeeId,
      matchedByNameCompany: result.matchedByNameCompany,
      matchedByNameOnly: result.matchedByNameOnly,
      snapshotsWritten: result.snapshotsWritten,
      payWeekEndDate: result.payWeekEndDate,
    },
    "Seeded weekly housing deductions from payroll file",
  );
  if (result.unmatched.length > 0) {
    log.warn(
      { unmatched: result.unmatched },
      "Some payroll rows did not match an existing occupant — they were NOT inserted; reconcile by name + Person Id",
    );
  }
  if (result.lowConfidenceMatches.length > 0) {
    log.warn(
      { lowConfidenceMatches: result.lowConfidenceMatches },
      "Some payroll rows matched an occupant only via the name-only fallback — operator should confirm the correct namesake",
    );
  }

  return result;
}
