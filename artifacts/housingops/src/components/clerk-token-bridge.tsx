import { useEffect } from "react";
import { useAuth } from "@clerk/react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

/**
 * Render-less child of <ClerkProvider> that wires the Clerk session
 * JWT into the shared API client's bearer-token getter so every
 * `/api/*` request automatically carries the user's identity.
 *
 * Lives as a separate component (instead of a top-level effect) so
 * `useAuth` resolves under Clerk's context provider.
 */
export function ClerkTokenBridge() {
  const { getToken, isLoaded } = useAuth();
  useEffect(() => {
    if (!isLoaded) return;
    setAuthTokenGetter(async () => {
      try {
        return (await getToken()) ?? null;
      } catch {
        return null;
      }
    });
    return () => {
      setAuthTokenGetter(null);
    };
  }, [getToken, isLoaded]);
  return null;
}
