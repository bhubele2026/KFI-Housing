import { Link } from "wouter";
import { AlertCircle, Home, ChevronLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Friendly 404 surface used by both the catch-all router fallback
 * (`/not-found`) and by record-detail pages whose id no longer
 * resolves — e.g. visiting `/leases/abc123` after the lease was
 * deleted in another tab.
 *
 * Why a shared component instead of duplicating the markup:
 *   - Operators land here from saved bookmarks and from the
 *     "redirect to last route on login" flow, so the recovery path
 *     (a primary "Back to dashboard" button) needs to look the same
 *     everywhere — otherwise a stale lease URL feels like a bug
 *     while the bare `/not-found` feels like a router error.
 *   - The record-detail callers also want a *secondary* link back
 *     to the relevant list page (Leases, Properties, Customers).
 *     That's optional — the generic catch-all just shows the
 *     primary dashboard button.
 *
 * The `testId` prop preserves the data-testid each caller already
 * uses so existing assertions (e.g. `customer-detail-not-found`,
 * `button-back-to-leases`) keep working without churn.
 */
export function NotFoundScreen({
  title,
  description,
  secondary,
  testId,
  icon: Icon = AlertCircle,
}: {
  title: string;
  description: string;
  secondary?: { label: string; href: string; testId?: string };
  testId?: string;
  icon?: LucideIcon;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="w-full flex items-center justify-center py-16 px-4"
      data-testid={testId}
    >
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 pb-6 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-amber-50 flex items-center justify-center">
            <Icon className="h-6 w-6 text-amber-500" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
            <Link href="/dashboard">
              <Button data-testid="button-not-found-dashboard" className="gap-1.5">
                <Home className="h-4 w-4" />
                {t("notFound.backToDashboard")}
              </Button>
            </Link>
            {secondary && (
              <Link href={secondary.href}>
                <Button
                  variant="outline"
                  data-testid={secondary.testId}
                  className="gap-1.5"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {secondary.label}
                </Button>
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
