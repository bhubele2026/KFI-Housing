/**
 * Display formatting for person names.
 *
 * Zenople PayrollData returns names in ALL CAPS ("ANGEL G GONGORA"). We
 * show them as proper Title Case ("Angel G Gongora") everywhere a name is
 * rendered. Names that already contain lowercase letters are left untouched
 * — they've either been entered/corrected by hand or came from a source
 * that's already cased correctly (so we never mangle "DeLallo", "O'Brien",
 * "McGuire", etc. that a human typed).
 */

function capWord(word: string): string {
  if (!word) return word;
  // A lone letter is a middle initial — keep it uppercase, no period added.
  if (word.length === 1) return word.toUpperCase();
  // Cap each apostrophe-separated chunk (O'Brien, D'Angelo).
  if (word.includes("'")) {
    return word
      .split("'")
      .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
      .join("'");
  }
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function titleCaseName(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  // Already has lowercase → assume it's intentionally cased; leave it.
  if (/[a-z]/.test(s)) return s;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((tok) => tok.split("-").map(capWord).join("-"))
    .join(" ");
}
