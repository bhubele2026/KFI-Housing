import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, digestRecipientsTable } from "@workspace/db";
import {
  ListDigestRecipientsResponse,
  CreateDigestRecipientBody,
  DeleteDigestRecipientParams,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

router.get("/digest-recipients", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(digestRecipientsTable)
    .orderBy(digestRecipientsTable.email);
  res.json(ListDigestRecipientsResponse.parse(rows));
});

router.post("/digest-recipients", async (req, res): Promise<void> => {
  const body = CreateDigestRecipientBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const email = body.data.email.trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }
  const existing = await db
    .select({ id: digestRecipientsTable.id })
    .from(digestRecipientsTable)
    .where(eq(digestRecipientsTable.email, email))
    .limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "This email is already subscribed" });
    return;
  }
  const [row] = await db
    .insert(digestRecipientsTable)
    .values({ id: randomUUID(), email })
    .returning();
  res.status(201).json(row);
});

router.delete("/digest-recipients/:id", async (req, res): Promise<void> => {
  const params = DeleteDigestRecipientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db
    .delete(digestRecipientsTable)
    .where(eq(digestRecipientsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
