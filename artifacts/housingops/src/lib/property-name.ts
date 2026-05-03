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

export function formatPropertyName(name: string | null | undefined): FormattedPropertyName {
  const raw = (name ?? "").trim();
  if (!raw) return { primary: "", secondary: null };

  const parenMatch = raw.match(TRAILING_PAREN);
  if (parenMatch) {
    return {
      primary: parenMatch[1].trim(),
      secondary: parenMatch[2].trim(),
    };
  }

  const dashIdx = raw.search(EM_DASH);
  if (dashIdx > 0) {
    const primary = raw.slice(0, dashIdx).trim();
    const secondary = raw.slice(dashIdx).replace(EM_DASH, "").trim();
    return {
      primary,
      secondary: toTitleCase(secondary),
    };
  }

  return { primary: raw, secondary: null };
}

export function shortPropertyName(name: string | null | undefined): string {
  const formatted = formatPropertyName(name);
  if (!formatted.secondary) return formatted.primary;
  return `${formatted.primary} • ${formatted.secondary}`;
}
