import { pushSchemaIfNeeded, db, leasesTable, propertiesTable, roomNightLogsTable, schedulerStateTable, insuranceCertificatesTable, digestRecipientsTable, customersTable, bedsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "./app";
import { logger } from "./lib/logger";
import { postSchemaDriftNotification } from "./lib/notify-schema-drift";
import { isAutoSeedDisabled, seedIfEmpty } from "./lib/seed";
import { seedAdientIfMissing } from "./lib/seed-adient";
import { seedAttachedLeasesIfMissing } from "./lib/seed-attached-leases";
import { seedChateauKnollIfMissing } from "./lib/seed-chateau-knoll";
import { seedGreenockManorIfMissing } from "./lib/seed-greenock-manor";
import { seedKolbeWausauIfMissing } from "./lib/seed-kolbe-wausau";
import { seedPatriotBarabooIfMissing } from "./lib/seed-patriot-baraboo";
import { seedPendaNewPineryIfMissing } from "./lib/seed-penda-new-pinery";
import { seedHickoryHavenIfMissing } from "./lib/seed-hickory-haven";
import { seedParkPlaceIfMissing } from "./lib/seed-park-place";
import { seedParkPlaceLandscapeIfMissing } from "./lib/seed-park-place-landscape";
// Re-exported from `./lib/seed` so the boot-sequence integration point
// for post-master-import seeds (#295 and friends) lives next to the
// other seed entry points.
import { seedRidgeMotorInnIfMissing } from "./lib/seed";
import { backfillOccupantMoveInDates } from "./lib/backfill-occupant-move-in";
import { backfillOccupantPayrollIds } from "./lib/backfill-occupant-payroll-ids";
import { seedHousingDeductions } from "./lib/seed-housing-deductions";
import { importDefaultMasterLeasesIfMissing } from "./lib/import-master-leases";
import { seedPayrollOccupantsIfMissing } from "./lib/seed-payroll-occupants";
import { runProdSyncOnce } from "./lib/prod-sync";
import { zeroOccupantChargesOnce } from "./lib/zero-occupant-charges";
import { start } from "./start";

void start({
  pushSchemaIfNeeded,
  seedIfEmpty,
  isAutoSeedDisabled: () => isAutoSeedDisabled(),
  runProdSyncOnce: () => runProdSyncOnce(),
  runZeroOccupantChargesOnce: () => zeroOccupantChargesOnce(),
  backfillOccupantMoveInDates: async () => {
    await backfillOccupantMoveInDates();
  },
  seedAdientIfMissing: async () => {
    await seedAdientIfMissing();
  },
  importDefaultMasterLeasesIfMissing: async () => {
    await importDefaultMasterLeasesIfMissing();
  },
  seedPatriotBarabooIfMissing: async () => {
    await seedPatriotBarabooIfMissing();
  },
  backfillOccupantPayrollIds: async () => {
    await backfillOccupantPayrollIds();
  },
  seedHickoryHavenIfMissing: async () => {
    await seedHickoryHavenIfMissing();
  },
  seedGreenockManorIfMissing: async () => {
    await seedGreenockManorIfMissing();
  },
  seedParkPlaceIfMissing: async () => {
    await seedParkPlaceIfMissing();
  },
  seedParkPlaceLandscapeIfMissing: async () => {
    await seedParkPlaceLandscapeIfMissing();
  },
  seedKolbeWausauIfMissing: async () => {
    await seedKolbeWausauIfMissing();
  },
  seedPayrollOccupantsIfMissing: async () => {
    await seedPayrollOccupantsIfMissing();
  },
  seedHousingDeductions: async () => {
    await seedHousingDeductions();
  },
  seedAttachedLeasesIfMissing: async () => {
    await seedAttachedLeasesIfMissing();
  },
  seedChateauKnollIfMissing: async () => {
    await seedChateauKnollIfMissing();
  },
  seedRidgeMotorInnIfMissing: async () => {
    await seedRidgeMotorInnIfMissing();
  },
  seedPendaNewPineryIfMissing: async () => {
    await seedPendaNewPineryIfMissing();
  },
  listen: (port) =>
    new Promise<void>((resolve, reject) => {
      app.listen(port, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    }),
  notifySchemaDrift: ({ webhookUrl, message }) =>
    postSchemaDriftNotification({ webhookUrl, message }),
  loadLeasesForDigest: async () => {
    const rows = await db.select().from(leasesTable);
    return rows.map((r) => ({
      id: r.id,
      propertyId: r.propertyId,
      startDate: r.startDate,
      endDate: r.endDate,
      status: r.status,
      vendor: r.vendor,
      noticePeriodDays: r.noticePeriodDays,
    }));
  },
  loadPropertiesForDigest: async () => {
    const rows = await db.select().from(propertiesTable);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      defaultNoticePeriodDays: r.defaultNoticePeriodDays,
      customerId: r.customerId,
      sharedWithCustomerIds: r.sharedWithCustomerIds,
    }));
  },
  loadCustomersForDigest: async () => {
    const rows = await db.select().from(customersTable);
    return rows.map((r) => ({ id: r.id, name: r.name }));
  },
  loadBedsForDigest: async () => {
    const rows = await db.select().from(bedsTable);
    return rows.map((r) => ({ propertyId: r.propertyId, status: r.status }));
  },
  loadLeasesForReminder: async () => {
    const rows = await db.select().from(leasesTable);
    return rows.map((r) => ({
      id: r.id,
      propertyId: r.propertyId,
      startDate: r.startDate,
      endDate: r.endDate,
      status: r.status,
      monthlyRoomNightMin: r.monthlyRoomNightMin,
      vendor: r.vendor,
    }));
  },
  loadPropertiesForReminder: async () => {
    const rows = await db.select().from(propertiesTable);
    return rows.map((r) => ({ id: r.id, name: r.name }));
  },
  loadRoomNightLogsForReminder: async () => {
    const rows = await db.select().from(roomNightLogsTable);
    return rows.map((r) => ({ leaseId: r.leaseId, month: r.month }));
  },
  getReminderLastSentMonthKey: async () => {
    const rows = await db
      .select()
      .from(schedulerStateTable)
      .where(eq(schedulerStateTable.id, "room-night-reminder"));
    return rows[0]?.lastSentKey || null;
  },
  setReminderLastSentMonthKey: async (monthKey: string) => {
    await db
      .insert(schedulerStateTable)
      .values({ id: "room-night-reminder", lastSentKey: monthKey })
      .onConflictDoUpdate({
        target: schedulerStateTable.id,
        set: { lastSentKey: monthKey },
      });
  },
  loadCertsForInsuranceExpiry: async () => {
    const rows = await db.select().from(insuranceCertificatesTable);
    return rows.map((r) => ({
      id: r.id,
      propertyId: r.propertyId,
      carrier: r.carrier,
      policyNumber: r.policyNumber,
      coverageEnd: r.coverageEnd,
    }));
  },
  loadPropertiesForInsuranceExpiry: async () => {
    const rows = await db.select().from(propertiesTable);
    return rows.map((r) => ({ id: r.id, name: r.name }));
  },
  getInsuranceExpiryLastSentDayKey: async () => {
    const rows = await db
      .select()
      .from(schedulerStateTable)
      .where(eq(schedulerStateTable.id, "insurance-expiry-reminder"));
    return rows[0]?.lastSentKey || null;
  },
  setInsuranceExpiryLastSentDayKey: async (dayKey: string) => {
    await db
      .insert(schedulerStateTable)
      .values({ id: "insurance-expiry-reminder", lastSentKey: dayKey })
      .onConflictDoUpdate({
        target: schedulerStateTable.id,
        set: { lastSentKey: dayKey },
      });
  },
  loadDigestRecipientsFromDb: async () => {
    const rows = await db.select().from(digestRecipientsTable);
    return rows.map((r) => r.email);
  },
  digestFetch: globalThis.fetch,
  logger,
  env: process.env,
  exit: (code) => process.exit(code),
});
