export interface SchemaDriftNotification {
  webhookUrl: string;
  message: string;
}

export interface NotifySchemaDriftDeps {
  fetch: typeof fetch;
}

export function isSchemaDriftError(err: unknown): boolean {
  return err instanceof Error && /Schema is out of date/.test(err.message);
}

export function buildSchemaDriftPayload(message: string): { text: string } {
  const fix = "pnpm --filter @workspace/db run push";
  return {
    text:
      ":rotating_light: *HousingOps API failed to start: database schema is out of date*\n" +
      `> ${message}\n` +
      `*Fix:* run \`${fix}\` against the production database, then redeploy.`,
  };
}

export async function postSchemaDriftNotification(
  notification: SchemaDriftNotification,
  deps: NotifySchemaDriftDeps = { fetch: globalThis.fetch },
): Promise<void> {
  const payload = buildSchemaDriftPayload(notification.message);

  const response = await deps.fetch(notification.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `Schema drift webhook responded with HTTP ${response.status}`,
    );
  }
}
