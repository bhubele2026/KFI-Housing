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
  // Source ladder: Clearbit brand logo -> clean colored-initials monogram.
  // We deliberately do NOT use the Google favicon service: for domains
  // without a real favicon it returns a generic blurry globe (looks cheap),
  // and it never 404s so it never falls through. Clearbit 404s cleanly when
  // there's no logo, so a miss lands on a sharp initials mark instead.
  const [failed, setFailed] = useState(false);
  const domain = domainForCustomer(name);
  const src = domain && !failed ? `https://logo.clearbit.com/${domain}?size=${size * 2}` : null;

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
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
