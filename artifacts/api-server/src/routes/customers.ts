import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, customersTable, propertiesTable } from "@workspace/db";
import {
  ListCustomersResponse,
  CreateCustomerBody,
  UpdateCustomerParams,
  UpdateCustomerBody,
  UpdateCustomerResponse,
  DeleteCustomerParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/customers", async (_req, res): Promise<void> => {
  const rows = await db.select().from(customersTable).orderBy(customersTable.id);
  res.json(ListCustomersResponse.parse(rows));
});

router.post("/customers", async (req, res): Promise<void> => {
  const body = CreateCustomerBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db.insert(customersTable).values(body.data).returning();
  res.status(201).json(UpdateCustomerResponse.parse(row));
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  const params = UpdateCustomerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateCustomerBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(customersTable)
    .set(body.data)
    .where(eq(customersTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(UpdateCustomerResponse.parse(row));
});

router.delete("/customers/:id", async (req, res): Promise<void> => {
  const params = DeleteCustomerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const linked = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.customerId, params.data.id))
    .limit(1);
  if (linked.length > 0) {
    res
      .status(409)
      .json({ error: "Cannot delete a customer that still owns properties." });
    return;
  }
  await db.delete(customersTable).where(eq(customersTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
