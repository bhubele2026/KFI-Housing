import { useEffect, useRef, useState } from "react";
import {
  useGetVersion,
  getGetVersionQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

// "A new version is available — Reload" prompt. The API serves a
// per-deploy build id at GET /version that changes whenever the server
// reboots (i.e. a Replit republish). We record the first id we see this
// session and, when a later poll returns a different id, surface a small
// non-intrusive banner inviting the user to reload onto the new build.
//
// Constraints:
//   * No automatic reload — the user may be mid-input.
//   * No re-nagging — once shown, the banner latches until the user
//     reloads, so a flaky poll can't make it flicker away.
//   * Dev no-ops: only polls in a production build.
const POLL_INTERVAL_MS = 90_000;

export function VersionUpdatePrompt() {
  const enabled = import.meta.env.PROD;
  const firstSeen = useRef<string | null>(null);
  const [outdated, setOutdated] = useState(false);

  const { data } = useGetVersion({
    query: {
      queryKey: getGetVersionQueryKey(),
      enabled,
      staleTime: 0,
      refetchInterval: POLL_INTERVAL_MS,
      refetchOnWindowFocus: true,
      refetchOnMount: "always",
      retry: false,
    },
  });

  useEffect(() => {
    const served = data?.version;
    if (!served) return;
    // Latch the first id we see; prompt once it ever differs.
    if (firstSeen.current === null) {
      firstSeen.current = served;
      return;
    }
    if (served !== firstSeen.current) setOutdated(true);
  }, [data?.version]);

  if (!outdated) return null;

  return (
    <div
      role="status"
      data-testid="version-update-banner"
      className="fixed inset-x-0 bottom-0 z-[100] flex justify-center px-4 pb-4"
    >
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-lg">
        <RefreshCw className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="text-sm text-foreground">A new version is available.</span>
        <Button
          size="sm"
          onClick={() => window.location.reload()}
          data-testid="version-update-reload"
        >
          Reload
        </Button>
      </div>
    </div>
  );
}
