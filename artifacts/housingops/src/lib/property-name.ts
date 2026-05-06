export type FormattedPropertyName = {
  primary: string;
  secondary: string | null;
};

const TRAILING_PAREN = /^(.*?)\s*\(([^()]+)\)\s*$/;
const EM_DASH = /\s*[—–-]\s+/;

function toTitleCase(value: string): string {
  if (!value) return value;
  if (!/[A-Z]/.test(value)) return value;
  if (value !== value.toUpperCase()) return value;
  return value
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part)) return part;
      const letters = part.replace(/[^A-Za-z]/g, "");
      if (letters.length > 0 && letters.length <= 4 && letters === letters.toUpperCase()) {
        return part;
      }
      const lower = part.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

export type FormatPropertyNameOptions = {
  /**
   * When provided, and the leading segment of `name` matches this customer
   * (case-insensitive, trimmed), the customer prefix is stripped: the
   * formatted secondary is promoted to the primary and no secondary is
   * returned. Used by surfaces that already display the customer in an
   * adjacent column so the property cell doesn't redundantly repeat it.
   */
  customerName?: string | null;
};

export function formatPropertyName(
  name: string | null | undefined,
  options: FormatPropertyNameOptions = {},
): FormattedPropertyName {
  const raw = (name ?? "").trim();
  if (!raw) return { primary: "", secondary: null };

  let formatted: FormattedPropertyName;
  const parenMatch = raw.match(TRAILING_PAREN);
  if (parenMatch) {
    formatted = {
      primary: parenMatch[1].trim(),
      secondary: parenMatch[2].trim(),
    };
  } else {
    const dashIdx = raw.search(EM_DASH);
    if (dashIdx > 0) {
      const primary = raw.slice(0, dashIdx).trim();
      const secondary = raw.slice(dashIdx).replace(EM_DASH, "").trim();
      formatted = {
        primary,
        secondary: toTitleCase(secondary),
      };
    } else {
      formatted = { primary: raw, secondary: null };
    }
  }

  const customer = (options.customerName ?? "").trim();
  if (
    customer &&
    formatted.secondary &&
    formatted.primary.toLowerCase() === customer.toLowerCase()
  ) {
    return { primary: formatted.secondary, secondary: null };
  }

  return formatted;
}

export function shortPropertyName(name: string | null | undefined): string {
  const formatted = formatPropertyName(name);
  if (!formatted.secondary) return formatted.primary;
  return `${formatted.primary} • ${formatted.secondary}`;
}
