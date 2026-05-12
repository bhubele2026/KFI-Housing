/**
 * Pure parser for the `Housing_Lease_MASTER` workbook (task #288).
 *
 * Walks the rows of Sheet1, treating bare single-cell rows whose value
 * matches a US-state name as section headers, and folds each subsequent
 * row into a normalized `MasterRow` describing one client / lease /
 * property triple.
 *
 * The parser is intentionally side-effect-free: it never touches the
 * database. The downstream importer (`import-master-leases.ts`) consumes
 * the parser output and performs the upserts.
 */

const STATE_HEADERS: Record<string, string> = {
  wisconsin: "WI",
  minnesota: "MN",
  missouri: "MO",
  oklahoma: "OK",
  arkansas: "AR",
  pennsylvania: "PA",
  iowa: "IA",
  "north carolina": "NC",
};

/** Per-row property the parser extracts from a (possibly multi-line) address cell. */
export interface ParsedAddress {
  /** Free-form street line(s), with embedded "Apt #" / "Unit #" stripped to `units`. */
  street: string;
  city: string;
  /** Two-letter US state code (e.g. "WI", "MN"). */
  state: string;
  zip: string;
  /** Comma-joined unit numbers picked out of the address cell. */
  units: string;
  /** First Google Maps deep link found in the cell (`https://maps.app.goo.gl/...`), else "". */
  mapUrl: string;
}

/** A single normalized row from the master spreadsheet. */
export interface MasterRow {
  /** Trimmed customer / client name (e.g. "Adient", "Schreiber Foods - EAST"). */
  customerName: string;
  /** US state inferred from the most recent section header above this row. */
  state: string;
  /** Primary housing address (column F). */
  primary: ParsedAddress | null;
  /** Optional secondary address from the columns 21–22 ("Supplier / Apartment complex" + address). */
  secondary: {
    complexName: string;
    address: ParsedAddress;
  } | null;
  /** Numeric weekly cost when the source cell parsed cleanly, else null. */
  weeklyCost: number | null;
  /** Original raw `Housing Cost/Wk for Associates` cell. */
  weeklyCostRaw: string;
  /** "Housing Vendor for Lease" column (D). */
  vendor: string;
  /** "Housing Complex (Hotel/Apartment) Name" column (E). */
  complexName: string;
  /** Furnished? column (G). */
  furnished: string;
  /** Appliances Included? column (H). */
  appliancesIncluded: string;
  /** Comma-joined unit numbers from column I, falling back to those embedded in the address. */
  units: string;
  /** Lease Dates (Start/End) column (K). */
  leaseDates: string;
  /** Notice Period - Utilities column (L). */
  noticePeriodUtilities: string;
  /** Notice Period - Lease column (M). */
  noticePeriodLease: string;
  /** Lease Terms column (N). */
  leaseTerms: string;
  /** Early Termination Clause Terms column (O). */
  earlyTerminationTerms: string;
  /**
   * Reasons the row could not be cleanly imported. When non-empty, the
   * resulting lease is marked `needsReview` and the raw text is preserved
   * in the lease notes.
   */
  reviewReasons: string[];
  /**
   * Additional buildings folded onto the same property when the source
   * spreadsheet uses the literal "***Different address***" marker on a
   * continuation row (Task #570). The marker tells the importer that
   * the address is a SEPARATE building under the previous property
   * rather than a brand-new property — used by Schuette Metals
   * (1331/1341 S 8th Ave) and similar multi-building setups.
   */
  newBuildings?: { complexName: string; address: ParsedAddress }[];
  /** 1-based row number from the spreadsheet for traceability. */
  sourceRow: number;
}

/**
 * Sentinel marker (case-insensitive, asterisks normalized) the spreadsheet
 * uses in column A of a continuation row to flag "this address is a new
 * BUILDING under the previous property" rather than a new property. Kept
 * here so tests can assert against the same constant.
 */
export const DIFFERENT_ADDRESS_MARKER = "***different address***";

/**
 * Splits a multi-line `Housing Address` cell (column F or column V) into
 * street / city / state / zip + extracts unit numbers and any embedded
 * Google Maps URL. The format is loose — operators paste addresses freely
 * — so we use a small set of pragmatic heuristics rather than a strict
 * grammar.
 *
 * Returns `null` when the cell holds nothing recognizable as an address
 * (e.g. "TBD", "n/a", or just a city like "Bettendorf, IA - 52722" alone
 * is still considered an address — only fully-empty / placeholder text
 * yields `null`).
 */
export function parseAddressCell(raw: string): ParsedAddress | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /^(tbd|n\/a)$/i.test(trimmed)) return null;

  // Pull out the first Google Maps URL and remove it from the lines.
  let mapUrl = "";
  const urlMatch = trimmed.match(
    /https?:\/\/(?:maps\.app\.goo\.gl|www\.google\.com\/maps|maps\.google\.com)\/\S+/,
  );
  if (urlMatch) mapUrl = urlMatch[0];
  const cleanedNoUrl = trimmed.replace(urlMatch?.[0] ?? "", "");

  // Normalise newlines and stray multi-spaces; split into non-empty lines.
  const lines = cleanedNoUrl
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return mapUrl
      ? { street: "", city: "", state: "", zip: "", units: "", mapUrl }
      : null;
  }

  // Identify the "city, state zip" line by regex. Some rows put it on the
  // same physical line as the street ("1331 South 8th Ave Apt 200 Wausau,
  // WI 54401"), so we also match anywhere in the joined text.
  // The space between state and zip is loose: some rows use a comma,
  // some a dash, some nothing at all ("WI53965"). Permit any of those.
  const cityStateZipRe =
    /([A-Za-z][A-Za-z .'-]+?)\s*,\s*([A-Z]{2})[\s,\-]*(\d{5}(?:-\d{4})?)/;

  let city = "";
  let state = "";
  let zip = "";
  let cityIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(cityStateZipRe);
    if (m) {
      city = m[1].trim();
      state = m[2];
      zip = m[3];
      cityIdx = i;
      break;
    }
  }

  // Whatever wasn't the city/state/zip line forms the street — but if the
  // city line had a street prefix in front of it we keep that prefix.
  // Lines AFTER the city/state/zip line that are pure number-lists (e.g.
  // "509, 510, 512, 811, 812") become unit numbers.
  const trailingUnits = new Set<string>();
  let streetParts: string[] = [];
  if (cityIdx === -1) {
    streetParts = lines;
  } else {
    streetParts = lines.slice(0, cityIdx);
    const tailOfCityLine = lines[cityIdx]
      .replace(cityStateZipRe, "")
      .replace(/[,\s]+$/, "")
      .trim();
    if (tailOfCityLine && cityIdx === 0) {
      // The city line WAS the only line; use the prefix as the street.
      streetParts.push(tailOfCityLine);
    }
    for (const tail of lines.slice(cityIdx + 1)) {
      if (/^\d{1,5}(?:\s*,\s*\d{1,5})*$/.test(tail)) {
        for (const u of tail.split(/\s*,\s*/)) {
          if (u) trailingUnits.add(u);
        }
      }
    }
  }

  let street = streetParts.join(" ").trim();

  // Pull out unit / apartment numbers embedded in the street, e.g.:
  //   "600 W Hickory St. Apt.___"
  //   "1331 South 8th Ave Apt 200"
  //   "1850 W Pine St. #_____"
  // We collect the numeric tokens after `Apt`/`Unit`/`#` (ignoring blanks
  // like `___` or `xxx`) and strip the suffix from the street so the
  // street column doesn't end with `Apt 200`.
  const units = new Set<string>(trailingUnits);
  // Trailing "509, 510, 512, 811, 812"-style unit lists tacked onto the
  // last street line (Milwaukee Valve, Independent Stave) — capture
  // numbers separated by commas at the very end.
  const tailNumberList = street.match(/(?:[,\s])((?:\d{1,5})(?:\s*,\s*\d{1,5})+)\s*$/);
  if (tailNumberList) {
    for (const u of tailNumberList[1].split(/\s*,\s*/)) {
      if (u) units.add(u);
    }
    street = street.slice(0, tailNumberList.index).trim().replace(/[,#]+$/, "").trim();
  }
  street = street.replace(
    /\b(?:Apt\.?|Unit|Suite|Ste\.?|#)\s*([A-Za-z0-9_-]+)/gi,
    (_m, captured: string) => {
      if (/^[_x]+$/i.test(captured)) return ""; // placeholder like ___ / xxx
      units.add(captured);
      return "";
    },
  );
  street = street.replace(/\s+/g, " ").replace(/[,\s#]+$/, "").trim();

  return {
    street,
    city,
    state,
    zip,
    units: [...units].join(", "),
    mapUrl,
  };
}

/**
 * Pulls a numeric weekly cost from the messy "Housing Cost/Wk" cell.
 * Returns the numeric value when the cell reads cleanly as a single
 * dollar amount (e.g. `"$130 "`, `"175"`, `"$103.43"`), and `null`
 * for everything else (`"TBD"`, `"n/a"`, `"$75 or 85"`, `"$69.23???"`,
 * `"$150.50 ($80 fringe…)"`, the long Greystone description). The
 * caller should preserve the raw cell text in lease notes whenever
 * the result is `null` so an operator can clean it up.
 */
export function parseWeeklyCost(raw: string): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Reject obvious placeholders and ambiguity signals.
  if (/^(tbd|n\/a|none)$/i.test(trimmed)) return null;
  if (/\?\?/.test(trimmed)) return null;
  if (/\bor\b/i.test(trimmed)) return null;
  if (/fringe/i.test(trimmed)) return null;
  if (/[a-z]{3,}/i.test(trimmed)) {
    // Long descriptive cells (e.g. Greystone) — too ambiguous.
    return null;
  }
  const m = trimmed.match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v <= 0) return null;
  // Reject if the cell contains MORE than one numeric token (range, list).
  const numericTokens = trimmed.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numericTokens.length > 1) return null;
  return v;
}

/**
 * Normalizes a customer name for fuzzy comparison: lowercase, collapse
 * whitespace, and strip a trailing " - <City>, <STATE>" qualifier so
 * "Trienda - Portage, WI" and "Trienda" collapse to the same key.
 */
export function normalizeCustomerName(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/\s+/g, " ");
  // Strip a trailing ` - <City>, <STATE>` or ` - <City> <STATE>` suffix.
  return trimmed.replace(/\s*-\s*[a-z .'-]+,?\s*[a-z]{2}\s*$/i, "").trim();
}

/**
 * Normalizes a street address for dedupe: uppercase, expand common
 * suffix abbreviations, strip punctuation, collapse whitespace, and
 * fold "Apt N"/"Unit N"/"#N" into "#N" so "600 W Hickory St. Apt 200"
 * and "600 W HICKORY STREET #200" match.
 */
export function normalizeAddress(raw: string): string {
  if (!raw) return "";
  let s = raw.toUpperCase();
  s = s.replace(/\./g, " ").replace(/,/g, " ").replace(/\s+/g, " ").trim();
  // Fold unit prefixes
  s = s.replace(/\b(APT|UNIT|SUITE|STE)\b\s*/g, "#");
  // Expand common street suffixes.
  const expansions: Array<[RegExp, string]> = [
    [/\bST\b/g, "STREET"],
    [/\bAVE\b/g, "AVENUE"],
    [/\bRD\b/g, "ROAD"],
    [/\bDR\b/g, "DRIVE"],
    [/\bBLVD\b/g, "BOULEVARD"],
    [/\bPKWY\b/g, "PARKWAY"],
    [/\bCT\b/g, "COURT"],
    [/\bLN\b/g, "LANE"],
    [/\bN\b/g, "NORTH"],
    [/\bS\b/g, "SOUTH"],
    [/\bE\b/g, "EAST"],
    [/\bW\b/g, "WEST"],
  ];
  for (const [re, rep] of expansions) s = s.replace(re, rep);
  return s.replace(/\s+/g, " ").trim();
}

/** Levenshtein distance — used by the fuzzy customer-name matcher. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let cur = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const next = Math.min(cur + 1, prev[j] + 1, prev[j - 1] + cost);
      prev[j - 1] = cur;
      cur = next;
    }
    prev[b.length] = cur;
  }
  return prev[b.length];
}

/**
 * Treats a row whose only non-empty cell is a recognized state name as
 * a section header. Returns the two-letter code or `null`.
 */
export function recognizeStateHeader(row: string[]): string | null {
  const firstCell = (row[0] ?? "").trim();
  if (!firstCell) return null;
  const code = STATE_HEADERS[firstCell.toLowerCase()];
  if (!code) return null;
  // Must be the only non-empty cell to qualify as a section header —
  // otherwise it could be a customer name that just happens to read
  // like a state.
  for (let i = 1; i < row.length; i++) {
    if ((row[i] ?? "").trim().length > 0) return null;
  }
  return code;
}

/**
 * Walks the raw `header + body` rows of the spreadsheet and produces
 * one `MasterRow` per non-header row. Continuation rows (no client
 * name + a non-empty address) are folded back onto the most recent
 * client as a secondary property.
 */
export function parseMasterRows(rows: string[][]): MasterRow[] {
  // Skip the header row (the first row).
  const out: MasterRow[] = [];
  let currentState = "";
  let last: MasterRow | null = null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const stateCode = recognizeStateHeader(row);
    if (stateCode) {
      currentState = stateCode;
      last = null;
      continue;
    }

    const customerCell = (row[0] ?? "").trim();
    const addressCell = (row[5] ?? "").trim();
    const secondaryComplexCell = (row[20] ?? "").trim();
    const secondaryAddressCell = (row[21] ?? "").trim();

    // Continuation row: no customer name OR the explicit
    // "***Different address***" marker, plus an address payload.
    // The marker (Task #570) means "this address is another BUILDING
    // under the previous property"; without the marker we keep the
    // legacy behavior of folding the address into the previous
    // customer as a *secondary property*.
    const isDifferentAddressMarker =
      customerCell.replace(/\s+/g, " ").toLowerCase() === DIFFERENT_ADDRESS_MARKER;
    if (
      (isDifferentAddressMarker || !customerCell) &&
      (addressCell || (row[4] ?? "").trim())
    ) {
      if (!last) continue;
      const complexName = (row[4] ?? "").trim();
      const parsed = parseAddressCell(addressCell);
      if (parsed) {
        if (isDifferentAddressMarker) {
          // Tack onto the last row as an additional building rather
          // than as a secondary property. The downstream importer is
          // responsible for materializing one Building row per entry.
          (last.newBuildings ??= []).push({ complexName, address: parsed });
        } else if (!last.secondary) {
          // Prefer overwriting `secondary` if empty; otherwise drop
          // into `last.primary` only when the previous primary was empty.
          last.secondary = {
            complexName,
            address: parsed,
          };
        }
      }
      continue;
    }

    if (!customerCell) continue;

    const weeklyCostRaw = (row[1] ?? "").trim();
    const weeklyCost = parseWeeklyCost(weeklyCostRaw);
    const unitsCell = (row[8] ?? "").trim().replace(/\s+/g, " ");
    const primary = parseAddressCell(addressCell);
    let units = unitsCell;
    if (!units && primary) units = primary.units;

    const reviewReasons: string[] = [];
    if (weeklyCost === null && weeklyCostRaw && !/^(tbd|n\/a)$/i.test(weeklyCostRaw)) {
      reviewReasons.push(`weekly cost not numeric: "${weeklyCostRaw}"`);
    } else if (!weeklyCostRaw || /^(tbd|n\/a)$/i.test(weeklyCostRaw)) {
      reviewReasons.push("weekly cost missing");
    }
    if (!primary) reviewReasons.push("address missing");

    let secondary: MasterRow["secondary"] = null;
    if (secondaryAddressCell || secondaryComplexCell) {
      const sec = parseAddressCell(secondaryAddressCell);
      if (sec) {
        secondary = { complexName: secondaryComplexCell, address: sec };
      }
    }

    const record: MasterRow = {
      customerName: customerCell,
      state: currentState,
      primary,
      secondary,
      weeklyCost,
      weeklyCostRaw,
      vendor: (row[3] ?? "").trim(),
      complexName: (row[4] ?? "").trim(),
      furnished: (row[6] ?? "").trim(),
      appliancesIncluded: (row[7] ?? "").trim(),
      units,
      leaseDates: (row[10] ?? "").trim(),
      noticePeriodUtilities: (row[11] ?? "").trim(),
      noticePeriodLease: (row[12] ?? "").trim(),
      leaseTerms: (row[13] ?? "").trim(),
      earlyTerminationTerms: (row[14] ?? "").trim(),
      reviewReasons,
      sourceRow: i + 1,
    };
    out.push(record);
    last = record;
  }

  return out;
}
