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
  const [errored, setErrored] = useState(false);
  const domain = domainForCustomer(name);
  const showImg = domain && !errored;

  if (showImg) {
    return (
      <img
        src={`https://logo.clearbit.com/${domain}?size=${size * 2}`}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setErrored(true)}
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
