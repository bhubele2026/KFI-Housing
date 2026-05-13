import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const appUsersTable = pgTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => ({
    clerkUserIdIdx: uniqueIndex("app_users_clerk_user_id_unique").on(t.clerkUserId),
    emailIdx: uniqueIndex("app_users_email_unique").on(t.email),
  }),
);

export const appInvitesTable = pgTable(
  "app_invites",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    role: text("role").notNull().default("member"),
    invitedByUserId: text("invited_by_user_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("app_invites_email_unique").on(t.email),
  }),
);

export type AppUserRow = typeof appUsersTable.$inferSelect;
export type InsertAppUserRow = typeof appUsersTable.$inferInsert;
export type AppInviteRow = typeof appInvitesTable.$inferSelect;
export type InsertAppInviteRow = typeof appInvitesTable.$inferInsert;
