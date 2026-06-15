/**
 * Best-effort domain map for KFI staffing customers, used to fetch a brand
 * logo via Clearbit's logo CDN (https://logo.clearbit.com/<domain>). When a
 * customer isn't mapped (or the logo 404s) the <CustomerLogo> component falls
 * back to a colored initials badge, so something clean always renders.
 *
 * Matching is by case-insensitive "does the customer name start with / contain
 * this key", so "Adient", "Adient Bridgewater", "Adient - Versailles" all map.
 */
export const CUSTOMER_DOMAINS: { match: string; domain: string }[] = [
  { match: "adient", domain: "adient.com" },
  { match: "heatron", domain: "heatron.com" },
  { match: "roskam", domain: "roskambaking.com" },
  { match: "wb manufact", domain: "wbmfg.com" },
  { match: "greystone", domain: "greystonemfg.com" },
  { match: "milwaukee valve", domain: "milwaukeevalve.com" },
  { match: "schuette", domain: "schuettemetals.com" },
  { match: "schutte", domain: "schuettemetals.com" },
  { match: "international wire", domain: "iwg.com" },
  { match: "delallo", domain: "delallo.com" },
  { match: "burnett dairy", domain: "burnettdairy.com" },
  { match: "burnett", domain: "burnettdairy.com" },
  { match: "cady cheese", domain: "cadycheese.com" },
  { match: "bell lumber", domain: "blpinc.com" },
  { match: "bell timber", domain: "blpinc.com" },
  { match: "independent stave", domain: "independentstavecompany.com" },
  { match: "orgill", domain: "orgill.com" },
  { match: "landscape structures", domain: "playlsi.com" },
  { match: "schreiber", domain: "schreiberfoods.com" },
  { match: "cardinal", domain: "cardinalcg.com" },
  { match: "amesbury", domain: "amesburytruth.com" },
  { match: "alamco", domain: "alamcowood.com" },
  { match: "shuster", domain: "shustersbc.com" },
  { match: "penda", domain: "pendacorp.com" },
  { match: "trienda", domain: "trienda.com" },
  { match: "fontaine", domain: "fontainetrailer.com" },
];

export function domainForCustomer(name: string): string | null {
  const n = (name || "").toLowerCase();
  for (const { match, domain } of CUSTOMER_DOMAINS) {
    if (n.includes(match)) return domain;
  }
  return null;
}

export function initialsFor(name: string): string {
  const words = (name || "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** Deterministic pleasant background for the initials fallback. */
export function colorFor(name: string): string {
  const palette = ["#1e3a8a", "#0f766e", "#9333ea", "#b45309", "#be123c", "#0369a1", "#4d7c0f", "#7c3aed"];
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length]!;
}
