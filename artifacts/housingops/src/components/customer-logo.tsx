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
  // initials. Clearbit's logo CDN has gotten flaky/deprecated (everything
  // was falling straight to initials), so on error we step down to the
  // keyless, reliable favicon service before giving up to initials.
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
