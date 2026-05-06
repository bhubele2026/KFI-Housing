import { eq } from "drizzle-orm";
import { db, occupantsTable } from "@workspace/db";
import { logger as defaultLogger } from "./logger";
import type { Logger } from "pino";

export interface HousingDeductionRow {
  customer: string;
  name: string;
  personId: string;
  weekly: number;
}

export interface SeedHousingDeductionsResult {
  totalRows: number;
  matched: number;
  updated: number;
  alreadyCorrect: number;
  unmatched: Array<Pick<HousingDeductionRow, "customer" | "name" | "personId">>;
}

export interface SeedHousingDeductionsDeps {
  db: typeof db;
  logger: Pick<Logger, "info" | "warn">;
  rows: HousingDeductionRow[];
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

/**
 * Apply weekly housing deductions from the payroll export to existing
 * occupants. Matches first by `employeeId == personId`, then falls back
 * to a case-insensitive `(name, company)` exact match. Updates set
 * `chargePerBed = weekly` and `billingFrequency = "Weekly"`. Never
 * inserts new occupants — unmatched rows are reported only.
 *
 * Idempotent: re-running yields the same result and only writes to rows
 * whose values would change (`alreadyCorrect` covers the no-op path).
 */
export async function seedHousingDeductions(
  deps: Partial<SeedHousingDeductionsDeps> = {},
): Promise<SeedHousingDeductionsResult> {
  const database = deps.db ?? db;
  const log = deps.logger ?? defaultLogger;
  const rows = deps.rows ?? HOUSING_DEDUCTION_ROWS;

  // Pull the entire occupants table once. The volume is small (hundreds),
  // and pre-loading lets us do both lookups (by employeeId, by
  // name+company) without round-trips per row.
  const allOccupants = await database
    .select({
      id: occupantsTable.id,
      name: occupantsTable.name,
      company: occupantsTable.company,
      employeeId: occupantsTable.employeeId,
      chargePerBed: occupantsTable.chargePerBed,
      billingFrequency: occupantsTable.billingFrequency,
    })
    .from(occupantsTable);

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
  const unmatched: SeedHousingDeductionsResult["unmatched"] = [];

  for (const row of rows) {
    const target =
      byEmployeeId.get(row.personId.trim()) ??
      byNameCompany.get(nameCompanyKey(row.name, row.customer)) ??
      byNameOnly.get(nameKey(row.name)) ??
      null;

    if (!target) {
      unmatched.push({
        customer: row.customer,
        name: row.name,
        personId: row.personId,
      });
      continue;
    }

    matched++;
    const isCorrect =
      target.billingFrequency === "Weekly" &&
      Math.abs((target.chargePerBed ?? 0) - row.weekly) < 1e-6;

    if (isCorrect) {
      alreadyCorrect++;
      continue;
    }

    await database
      .update(occupantsTable)
      .set({ chargePerBed: row.weekly, billingFrequency: "Weekly" })
      .where(eq(occupantsTable.id, target.id));
    updated++;
  }

  const result: SeedHousingDeductionsResult = {
    totalRows: rows.length,
    matched,
    updated,
    alreadyCorrect,
    unmatched,
  };

  log.info(
    {
      totalRows: result.totalRows,
      matched: result.matched,
      updated: result.updated,
      alreadyCorrect: result.alreadyCorrect,
      unmatched: result.unmatched.length,
    },
    "Seeded weekly housing deductions from payroll file",
  );
  if (result.unmatched.length > 0) {
    log.warn(
      { unmatched: result.unmatched },
      "Some payroll rows did not match an existing occupant — they were NOT inserted; reconcile by name + Person Id",
    );
  }

  return result;
}
