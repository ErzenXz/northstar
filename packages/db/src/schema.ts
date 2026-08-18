import {
  bigint,
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
  admin: boolean("admin").notNull().default(false),
  ssoSubject: text("sso_subject"),
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
    milestoneId: uuid("milestone_id"),
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

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("open"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("milestone_repo_number_unique").on(table.repositoryId, table.number)],
);

export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("4f76ff"),
    description: text("description").notNull().default(""),
    ...timestamps,
  },
  (table) => [uniqueIndex("label_repo_name_unique").on(table.repositoryId, table.name)],
);

export const issueComments = pgTable(
  "issue_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    authorAvatarUrl: text("author_avatar_url"),
    body: text("body").notNull(),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    ...timestamps,
  },
  (table) => [
    index("issue_comments_issue_created_idx").on(table.issueId, table.createdAt),
    uniqueIndex("issue_comment_external_unique").on(table.issueId, table.externalId),
  ],
);

export const issueAssignees = pgTable(
  "issue_assignees",
  {
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("issue_assignee_unique").on(table.issueId, table.userId)],
);

export const issueLabels = pgTable(
  "issue_labels",
  {
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    labelId: uuid("label_id").notNull().references(() => labels.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("issue_label_unique").on(table.issueId, table.labelId)],
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
    headSha: text("head_sha"),
    baseSha: text("base_sha"),
    mergeCommitSha: text("merge_commit_sha"),
    draft: boolean("draft").notNull().default(false),
    additions: integer("additions").notNull().default(0),
    deletions: integer("deletions").notNull().default(0),
    changedFiles: integer("changed_files").notNull().default(0),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("pull_request_repo_number_unique").on(table.repositoryId, table.number),
    index("pull_requests_repo_status_idx").on(table.repositoryId, table.status),
  ],
);

export const pullRequestComments = pgTable(
  "pull_request_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pullRequestId: uuid("pull_request_id").notNull().references(() => pullRequests.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    path: text("path"),
    line: integer("line"),
    side: text("side"),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    ...timestamps,
  },
  (table) => [
    index("pull_comments_pull_created_idx").on(table.pullRequestId, table.createdAt),
    uniqueIndex("pull_comment_external_unique").on(table.pullRequestId, table.externalId),
  ],
);

export const pullRequestReviews = pgTable(
  "pull_request_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pullRequestId: uuid("pull_request_id").notNull().references(() => pullRequests.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    reviewerName: text("reviewer_name").notNull(),
    state: text("state").notNull(),
    body: text("body").notNull().default(""),
    commitSha: text("commit_sha"),
    externalId: text("external_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pull_reviews_pull_state_idx").on(table.pullRequestId, table.state),
    uniqueIndex("pull_review_external_unique").on(table.pullRequestId, table.externalId),
  ],
);

export const releases = pgTable(
  "releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    tagName: text("tag_name").notNull(),
    name: text("name").notNull(),
    body: text("body").notNull().default(""),
    authorName: text("author_name").notNull(),
    draft: boolean("draft").notNull().default(false),
    prerelease: boolean("prerelease").notNull().default(false),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("release_repo_tag_unique").on(table.repositoryId, table.tagName)],
);

export const releaseAssets = pgTable(
  "release_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    releaseId: uuid("release_id").notNull().references(() => releases.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contentType: text("content_type"),
    size: integer("size").notNull().default(0),
    downloadUrl: text("download_url"),
    storagePath: text("storage_path"),
    externalId: text("external_id"),
    downloadCount: integer("download_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("release_asset_unique").on(table.releaseId, table.name)],
);

export const wikiImports = pgTable("wiki_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  repositoryId: uuid("repository_id").notNull().unique().references(() => repositories.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull().unique(),
  sourceUrl: text("source_url").notNull(),
  status: text("status").notNull().default("ready"),
  ...timestamps,
});

export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secretEncrypted: text("secret_encrypted").notNull(),
    events: jsonb("events").$type<string[]>().notNull().default(["push"]),
    active: boolean("active").notNull().default(true),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("webhooks_repo_active_idx").on(table.repositoryId, table.active)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("queued"),
    responseCode: integer("response_code"),
    responseBody: text("response_body"),
    attempts: integer("attempts").notNull().default(0),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("webhook_deliveries_hook_created_idx").on(table.webhookId, table.createdAt)],
);

export const commitStatuses = pgTable(
  "commit_statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    sha: text("sha").notNull(),
    context: text("context").notNull(),
    state: text("state").notNull(),
    description: text("description").notNull().default(""),
    targetUrl: text("target_url"),
    creatorName: text("creator_name").notNull(),
    ...timestamps,
  },
  (table) => [index("commit_statuses_repo_sha_idx").on(table.repositoryId, table.sha, table.createdAt)],
);

export const runners = pgTable(
  "runners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("offline"),
    version: text("version"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("runners_org_status_idx").on(table.organizationId, table.status)],
);

export const runnerJobs = pgTable(
  "runner_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    runnerId: uuid("runner_id").references(() => runners.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("queued"),
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("runner_jobs_status_created_idx").on(table.status, table.createdAt)],
);

export const sshKeys = pgTable(
  "ssh_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    publicKey: text("public_key").notNull(),
    fingerprint: text("fingerprint").notNull().unique(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ssh_keys_user_idx").on(table.userId)],
);

export const deployKeys = pgTable(
  "deploy_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    publicKey: text("public_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    canWrite: boolean("can_write").notNull().default(false),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("deploy_key_repo_fingerprint_unique").on(table.repositoryId, table.fingerprint)],
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
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    headSha: text("head_sha"),
    baseSha: text("base_sha"),
    pullRequestNumber: integer("pull_request_number"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("agent_runs_repo_status_idx").on(table.repositoryId, table.status)],
);

export const evidenceArtifacts = pgTable(
  "evidence_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentRunId: uuid("agent_run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("evidence_artifacts_run_idx").on(table.agentRunId, table.createdAt)],
);

export const agentReviews = pgTable(
  "agent_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentRunId: uuid("agent_run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    reviewer: text("reviewer").notNull().default("origin-review-agent"),
    verdict: text("verdict").notNull(),
    summary: text("summary").notNull().default(""),
    concerns: jsonb("concerns").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agent_reviews_run_idx").on(table.agentRunId)],
);

export const policyGates = pgTable("policy_gates", {
  id: uuid("id").primaryKey().defaultRandom(),
  repositoryId: uuid("repository_id").notNull().unique().references(() => repositories.id, { onDelete: "cascade" }),
  requireHumanApproval: boolean("require_human_approval").notNull().default(true),
  requireAgentReview: boolean("require_agent_review").notNull().default(true),
  requirePassingChecks: boolean("require_passing_checks").notNull().default(true),
  allowNetwork: boolean("allow_network").notNull().default(false),
  runTests: boolean("run_tests").notNull().default(true),
  blockedPaths: jsonb("blocked_paths").$type<string[]>().notNull().default([".git/", ".origin/policies"]),
  maxChangedFiles: integer("max_changed_files").notNull().default(25),
  ...timestamps,
});

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    status: text("status").notNull().default("open"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("incidents_repo_status_idx").on(table.repositoryId, table.status)],
);

export const backups = pgTable(
  "backups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    checksum: text("checksum"),
    status: text("status").notNull().default("completed"),
    restoreTestedAt: timestamp("restore_tested_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("backups_repo_created_idx").on(table.repositoryId, table.createdAt)],
);

export const organizationSettings = pgTable("organization_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
  plan: text("plan").notNull().default("community"),
  billingEmail: text("billing_email"),
  region: text("region").notNull().default("us"),
  aiTokenBudget: integer("ai_token_budget").notNull().default(2_000_000),
  maxRepositories: integer("max_repositories").notNull().default(0),
  maxRepositorySizeMb: integer("max_repository_size_mb").notNull().default(2_048),
  scimTokenHash: text("scim_token_hash"),
  ssoEnabled: boolean("sso_enabled").notNull().default(false),
  ssoIssuer: text("sso_issuer"),
  ssoClientId: text("sso_client_id"),
  ssoClientSecretEncrypted: text("sso_client_secret_encrypted"),
  ...timestamps,
});

export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull().default(0),
    period: text("period").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("usage_records_org_period_idx").on(table.organizationId, table.period, table.kind)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull().default(""),
    ip: text("ip"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_events_org_created_idx").on(table.organizationId, table.createdAt)],
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
export type EvidenceArtifact = typeof evidenceArtifacts.$inferSelect;
export type AgentReview = typeof agentReviews.$inferSelect;
export type PolicyGate = typeof policyGates.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type Backup = typeof backups.$inferSelect;
export type OrganizationSettings = typeof organizationSettings.$inferSelect;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Repository = typeof repositories.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type PullRequest = typeof pullRequests.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type ActivityEvent = typeof activityEvents.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type Label = typeof labels.$inferSelect;
export type Release = typeof releases.$inferSelect;
