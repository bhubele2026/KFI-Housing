import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Landmark, Info } from "lucide-react";

/**
 * Bank connection (Plaid) settings.
 *
 * Connecting the operating bank account via Plaid lets utility / vendor
 * payments flow in automatically so they can be matched and tagged to the
 * property they belong to (rather than hand-entering each one).
 *
 * NOTE: the Plaid integration is not wired up yet — there is no backend
 * link-token / item-exchange endpoint and no Plaid API keys configured.
 * This is the UI entry point only; the Connect button stays disabled with
 * a clear "not configured" notice until the keys + backend are in place.
 * Do not fake a connected state here.
 */
export function PlaidSettings() {
  // Becomes true once a real link-token endpoint + PLAID_* keys exist.
  const configured = false;

  return (
    <Card data-testid="card-plaid-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="h-5 w-5 text-muted-foreground" />
          Bank connection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Connect the operating bank account through{" "}
          <span className="font-medium text-foreground">Plaid</span> to pull in
          utility and vendor payments automatically, then tag each one to the
          property it belongs to — no more hand-entering bills.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!configured} data-testid="button-connect-plaid">
            <Landmark className="h-4 w-4 mr-2" />
            Connect bank with Plaid
          </Button>
          {!configured && (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
              data-testid="notice-plaid-not-configured"
            >
              <Info className="h-3.5 w-3.5" />
              Not configured yet — Plaid API keys required
            </span>
          )}
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">To turn this on we'll need:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>A Plaid account + API keys (client ID, secret, environment).</li>
            <li>A backend link-token / public-token exchange endpoint.</li>
            <li>Transaction sync + a rule to match payees to properties.</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
