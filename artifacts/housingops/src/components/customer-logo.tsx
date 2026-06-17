import { useState } from "react";
import { cn } from "@/lib/utils";
import { domainForCustomer, initialsFor, colorFor } from "@/lib/customer-logos";

/**
 * Customer brand logo. Tries the company's logo via Clearbit's logo CDN
 * (by mapped domain); on miss/error falls back to a colored initials badge so
 * a clean mark always renders. No binary assets to manage.
 */
export function CustomerLogo({
  name,
  size = 28,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  // Source ladder: Clearbit brand logo -> Google favicon -> colored
  // initials. Clearbit gives clean corporate logos but is flaky (often
  // 404s → most companies fell straight to initials). The favicon service
  // backfills a real mark for the rest. Its failure mode is a generic blurry
  // globe (served at ~16px when a domain has no favicon, and it never 404s),
  // so on load we REJECT anything that small and drop to initials — a sharp
  // monogram, never a globe.
  const [stage, setStage] = useState(0);
  const domain = domainForCustomer(name);
  const src =
    domain && stage === 0
      ? `https://logo.clearbit.com/${domain}?size=${size * 2}`
      : domain && stage === 1
        ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
        : null;

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setStage((s) => s + 1)}
        onLoad={(e) => {
          // Reject Google's generic globe (returned ~16px when a domain has
          // no real favicon) — fall through to the initials monogram.
          if (stage === 1 && e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth < 24) {
            setStage((s) => s + 1);
          }
        }}
        className={cn("shrink-0 rounded-md object-contain bg-white p-0.5 ring-1 ring-border", className)}
        style={{ width: size, height: size }}
        data-testid="customer-logo"
      />
    );
  }

  return (
    <span
      aria-label={name}
      data-testid="customer-logo"
      className={cn("inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white", className)}
      style={{ width: size, height: size, backgroundColor: colorFor(name), fontSize: size * 0.4 }}
    >
      {initialsFor(name)}
    </span>
  );
}
