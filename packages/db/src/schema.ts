import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  avatarUrl: text("avatar_url"),
  ...timestamps,
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  avatarUrl: text("avatar_url"),
  ...timestamps,
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("organization_member_unique").on(table.organizationId, table.userId),
    index("organization_members_user_idx").on(table.userId),
  ],
);

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    storageKey: text("storage_key").notNull().unique(),
    defaultBranch: text("default_branch").notNull().default("main"),
    visibility: text("visibility").notNull().default("private"),
    sourceProvider: text("source_provider"),
    sourceUrl: text("source_url"),
    language: text("language"),
    topics: jsonb("topics").$type<string[]>().notNull().default([]),
    archived: boolean("archived").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("repository_org_slug_unique").on(table.organizationId, table.slug),
    index("repositories_org_idx").on(table.organizationId),
  ],
);

export const issues = pgTable(
  "issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    status: text("status").notNull().default("open"),
    authorName: text("author_name").notNull(),
    authorAvatarUrl: text("author_avatar_url"),
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("issue_repo_number_unique").on(table.repositoryId, table.number),
    index("issues_repo_status_idx").on(table.repositoryId, table.status),
  ],
);

export const pullRequests = pgTable(
  "pull_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    status: text("status").notNull().default("open"),
    authorName: text("author_name").notNull(),
    headBranch: text("head_branch").notNull(),
    baseBranch: text("base_branch").notNull(),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    changedFiles: integer("changed_files").notNull().default(0),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pull_request_repo_number_unique").on(table.repositoryId, table.number),
    index("pull_requests_repo_status_idx").on(table.repositoryId, table.status),
  ],
);

export const repositoryMemories = pgTable(
  "repository_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    sourcePath: text("source_path"),
    confidence: integer("confidence").notNull().default(80),
    ...timestamps,
  },
  (table) => [index("repository_memories_repo_kind_idx").on(table.repositoryId, table.kind)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    objective: text("objective").notNull(),
    status: text("status").notNull().default("queued"),
    branch: text("branch"),
    model: text("model"),
    plan: jsonb("plan").$type<Array<{ step: string; status: string }>>().notNull().default([]),
    summary: text("summary"),
    evidence: jsonb("evidence").$type<Array<{ label: string; value: string }>>().notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("agent_runs_repo_status_idx").on(table.repositoryId, table.status)],
);

export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    actorName: text("actor_name").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("activity_events_repo_created_idx").on(table.repositoryId, table.createdAt)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    status: text("status").notNull().default("queued"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("jobs_claim_idx").on(table.status, table.runAfter)],
);

export const accessTokens = pgTable(
  "access_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("access_tokens_user_idx").on(table.userId)],
);

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Repository = typeof repositories.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type PullRequest = typeof pullRequests.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type ActivityEvent = typeof activityEvents.$inferSelect;
