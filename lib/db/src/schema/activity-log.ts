import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

// Append-only audit log of who used the app and what they did.
//
// Written by the `auditLog` middleware on the api-server after `requireAuth`
// has resolved the acting user. User identity is denormalized (email/name
// snapshotted at write time) so the log stays readable even if the member is
// later removed from the team.
//
// To keep volume sane the middleware always records mutating requests
// (POST/PUT/PATCH/DELETE) but throttles read (GET) requests to at most one
// "viewed" entry per user per short window — enough to answer "has anyone
// used the app in the last few weeks?" without logging every poll.
export const activityLogTable = pgTable(
  "activity_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().default(""),
    userEmail: text("user_email").notNull().default(""),
    userName: text("user_name").notNull().default(""),
    method: text("method").notNull().default(""),
    path: text("path").notNull().default(""),
    action: text("action").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdAtIdx: index("activity_log_created_at_idx").on(t.createdAt),
    userCreatedIdx: index("activity_log_user_created_idx").on(
      t.userId,
      t.createdAt,
    ),
  }),
);

export type ActivityLogRow = typeof activityLogTable.$inferSelect;
export type InsertActivityLogRow = typeof activityLogTable.$inferInsert;
