import { eq, like } from "drizzle-orm";
import { customersTable, propertiesTable, type db } from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface RepointFallbackArgs {
  tx: Tx;
  /** Property whose `customerId` may need to be repointed. */
  propertyId: string;
  /**
   * Customer the seed *believes* the property is attached to. Used only as
   * a fallback when the property row cannot be re-read from the DB; the
   * helper authoritatively reads the property's current `customerId` and
   * makes its decisions based on that to preserve operator-chosen
   * attachments.
   */
  currentCustomerId: string;
  /** SQL LIKE pattern matching the real downstream end-client name (e.g. `"Milwaukee Valve%"`). */
  endClientNamePattern: string;
  /** SQL LIKE pattern matching customer names treated as fallbacks (e.g. `"KFI Staffing%"`). */
  fallbackNamePattern: string;
  /** This seed's deterministic fallback customer id to consider for cleanup. */
  fallbackCustomerId: string;
}

export interface RepointFallbackResult {
  /** Customer id the property is attached to after repointing (may be unchanged). */
  customerId: string;
  /** True when the property was repointed from a fallback to the real end-client. */
  repointedToEndClient: boolean;
  /** True when the seed's deterministic fallback customer row was deleted because nothing references it. */
  fallbackCustomerDeleted: boolean;
  /** Resolved end-client id, or `null` when no real end-client exists yet. */
  endClientId: string | null;
}

/**
 * Shared "audit & repoint" helper for KFI Staffing per-property fallback
 * customers (Task #328). Mirrors the logic baked into
 * `seed-chateau-knoll.ts` (Task #312) so every KFI seed can:
 *
 *   1. Resolve the real downstream end-client (by `endClientNamePattern`).
 *   2. Repoint its property AWAY from any KFI Staffing fallback customer
 *      (matching `fallbackNamePattern`) to that end-client.
 *   3. Delete the seed's own deterministic fallback customer row when no
 *      properties still reference it.
 *
 * Operator-set customers (anything whose name does not match the
 * `fallbackNamePattern`) are preserved — we only ever repoint AWAY from a
 * fallback. Safe to call when there is no end-client yet: returns
 * `repointedToEndClient=false` and leaves the fallback in place.
 */
export async function repointFallbackToEndClient(
  args: RepointFallbackArgs,
): Promise<RepointFallbackResult> {
  const {
    tx,
    propertyId,
    currentCustomerId,
    endClientNamePattern,
    fallbackNamePattern,
    fallbackCustomerId,
  } = args;

  const endClientRows = await tx
    .select({ id: customersTable.id })
    .from(customersTable)
    .where(like(customersTable.name, endClientNamePattern))
    .limit(1);
  const endClientId =
    endClientRows.length > 0 ? (endClientRows[0]!.id as string) : null;

  // Authoritatively re-read the property's actual current customerId so
  // we don't clobber an operator-set customer with the seed's
  // best-guess `currentCustomerId` arg.
  const propertyRows = await tx
    .select({ customerId: propertiesTable.customerId })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  let customerId =
    propertyRows.length > 0
      ? (propertyRows[0]!.customerId as string)
      : currentCustomerId;
  let repointedToEndClient = false;

  if (endClientId !== null && customerId !== endClientId) {
    const currentRows = await tx
      .select({ name: customersTable.name })
      .from(customersTable)
      .where(eq(customersTable.id, customerId))
      .limit(1);
    const currentName =
      currentRows.length > 0 ? (currentRows[0]!.name as string) : "";
    if (currentName && matchesLikePattern(currentName, fallbackNamePattern)) {
      await tx
        .update(propertiesTable)
        .set({ customerId: endClientId })
        .where(eq(propertiesTable.id, propertyId));
      customerId = endClientId;
      repointedToEndClient = true;
    }
  }

  let fallbackCustomerDeleted = false;
  if (endClientId !== null) {
    const stillUsed = await tx
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(eq(propertiesTable.customerId, fallbackCustomerId))
      .limit(1);
    if (stillUsed.length === 0) {
      const deleted = await tx
        .delete(customersTable)
        .where(eq(customersTable.id, fallbackCustomerId))
        .returning({ id: customersTable.id });
      fallbackCustomerDeleted = deleted.length > 0;
    }
  }

  return {
    customerId,
    repointedToEndClient,
    fallbackCustomerDeleted,
    endClientId,
  };
}

function matchesLikePattern(value: string, pattern: string): boolean {
  const escaped = pattern
    .split("%")
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(value);
}
