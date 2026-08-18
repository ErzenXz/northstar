"use server";

import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "argon2";
import { and, desc, eq, max } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertDataRegion, encryptSecret, repositoryStorageKey, requiredEnv, slugify } from "@origin/core";
import { clientAddress, enforceRateLimit } from "@/lib/rate-limit";
import {
  accessTokens,
  activityEvents,
  agentRuns,
  auditEvents,
  commitStatuses,
  deployKeys,
  getDb,
  incidents,
  issueAssignees,
  issueComments,
  issueLabels,
  issues,
  jobs,
  labels,
  milestones,
  organizationMembers,
  organizationSettings,
  organizations,
  policyGates,
  pullRequestComments,
  pullRequestReviews,
  pullRequests,
  repositories,
  runners,
  sshKeys,
  users,
  webhooks,
} from "@origin/db";
import { compareBranches, createBareRepository, createBranch, getRefSha, mergeBranches } from "@origin/git";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { repositoryRoot } from "@/lib/repository";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function sshFingerprint(publicKey: string) {
  const parts = publicKey.trim().split(/\s+/);
  if (parts.length < 2 || !/^ssh-(ed25519|rsa)$/.test(parts[0]!)) throw new Error("Use an OpenSSH ed25519 or RSA public key");
  const raw = Buffer.from(parts[1]!, "base64");
  if (raw.length < 32) throw new Error("SSH public key is invalid");
  return `SHA256:${createHash("sha256").update(raw).digest("base64").replace(/=+$/, "")}`;
}

async function queueRepositoryEvent(repositoryId: string, event: string, payload: Record<string, unknown>) {
  await getDb().insert(jobs).values({ type: "deliver-webhook-event", payload: { repositoryId, event, payload } });
}

async function recordAudit(organizationId: string, actorName: string, action: string, target = "", metadata: Record<string, unknown> = {}) {
  await getDb().insert(auditEvents).values({ organizationId, actorName, action, target, ip: await clientAddress(), metadata });
}

export async function signUpAction(formData: FormData) {
  await enforceRateLimit("sign-up", 10, 60_000).catch(() => fail("/sign-up", "Too many attempts. Wait a minute and try again."));
  const name = value(formData, "name");
  const email = value(formData, "email").toLowerCase();
  const username = slugify(value(formData, "username"));
  const password = value(formData, "password");
  if (name.length < 2) fail("/sign-up", "Enter your full name.");
  if (!/^\S+@\S+\.\S+$/.test(email)) fail("/sign-up", "Enter a valid email address.");
  if (username.length < 2) fail("/sign-up", "Choose a username with at least two characters.");
  if (password.length < 10) fail("/sign-up", "Use at least 10 characters for your password.");

  try {
    const passwordHash = await hash(password);
    const user = await getDb().transaction(async (tx) => {
      const [createdUser] = await tx.insert(users).values({ name, email, username, passwordHash }).returning();
      const [organization] = await tx.insert(organizations).values({ name: `${name}'s workspace`, slug: username }).returning();
      await tx.insert(organizationMembers).values({ organizationId: organization!.id, userId: createdUser!.id, role: "owner" });
      return createdUser!;
    });
    await createSession(user.id);
  } catch {
    fail("/sign-up", "That email or username is already in use.");
  }
  redirect("/");
}

export async function signInAction(formData: FormData) {
  await enforceRateLimit("sign-in", 20, 60_000).catch(() => fail("/sign-in", "Too many attempts. Wait a minute and try again."));
  const identity = value(formData, "identity").toLowerCase();
  const password = value(formData, "password");
  const [user] = await getDb().select().from(users).where(identity.includes("@") ? eq(users.email, identity) : eq(users.username, identity)).limit(1);
  if (!user || !(await verify(user.passwordHash, password))) fail("/sign-in", "Email, username, or password is incorrect.");
  await createSession(user.id);
  const [workspace] = await getDb().select({ organizationId: organizationMembers.organizationId }).from(organizationMembers).where(eq(organizationMembers.userId, user.id)).limit(1);
  if (workspace) await recordAudit(workspace.organizationId, user.username, "session.signed_in");
  redirect("/");
}

export async function signOutAction() {
  await destroySession();
  redirect("/");
}

async function requireOrganization(userId: string, organizationId: string) {
  const [membership] = await getDb().select().from(organizationMembers).where(and(
    eq(organizationMembers.userId, userId),
    eq(organizationMembers.organizationId, organizationId),
  )).limit(1);
  if (!membership) throw new Error("You do not have access to that workspace");
  const [organization] = await getDb().select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) throw new Error("Workspace not found");
  return organization;
}

async function requireRepositoryMember(userId: string, repositoryId: string) {
  const [row] = await getDb()
    .select({ repository: repositories, organization: organizations })
    .from(repositories)
    .innerJoin(organizations, eq(organizations.id, repositories.organizationId))
    .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
    .where(and(eq(repositories.id, repositoryId), eq(organizationMembers.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Repository not found or access denied");
  return row;
}

export async function createRepositoryAction(formData: FormData) {
  const user = await requireUser();
  const organizationId = value(formData, "organizationId");
  const organization = await requireOrganization(user.id, organizationId);
  const name = value(formData, "name");
  const repositorySlug = slugify(name);
  const description = value(formData, "description");
  const visibility = value(formData, "visibility") === "public" ? "public" : "private";
  if (!repositorySlug) fail("/new", "Give the repository a name.");
  const [settings] = await getDb().select().from(organizationSettings).where(eq(organizationSettings.organizationId, organizationId)).limit(1);
  if (settings?.maxRepositories) {
    const existing = await getDb().select({ id: repositories.id }).from(repositories).where(eq(repositories.organizationId, organizationId));
    if (existing.length >= settings.maxRepositories) fail("/new", `This workspace has reached its ${settings.maxRepositories}-repository quota.`);
  }
  const storageKey = repositoryStorageKey(organization.slug, repositorySlug);
  let repositoryId: string | undefined;
  try {
    const [repository] = await getDb().insert(repositories).values({
      organizationId,
      name,
      slug: repositorySlug,
      description,
      visibility,
      storageKey,
    }).returning();
    repositoryId = repository!.id;
    await createBareRepository(repositoryRoot, organization.slug, repositorySlug);
  } catch (error) {
    if (repositoryId) await getDb().delete(repositories).where(eq(repositories.id, repositoryId));
    fail("/new", error instanceof Error && error.message.includes("unique") ? "A repository with that name already exists." : "The repository could not be created.");
  }
  redirect(`/${organization.slug}/${repositorySlug}`);
}

export async function importGitHubAction(formData: FormData) {
  const user = await requireUser();
  const sourceUrl = value(formData, "sourceUrl");
  const token = value(formData, "token");
  const organizationId = value(formData, "organizationId");
  const organization = await requireOrganization(user.id, organizationId);
  let source: URL;
  try {
    source = new URL(sourceUrl);
  } catch {
    fail("/import", "Enter a valid GitHub repository URL.");
  }
  if (source.hostname.toLowerCase() !== "github.com" || source.protocol !== "https:") fail("/import", "The first importer supports HTTPS GitHub URLs only.");
  const parts = source.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) fail("/import", "Use a repository URL such as https://github.com/acme/project.");
  const repositorySlug = slugify(parts[1]!.replace(/\.git$/, ""));
  const name = parts[1]!.replace(/\.git$/, "");
  const storageKey = repositoryStorageKey(organization.slug, repositorySlug);
  let repository;
  try {
    [repository] = await getDb().insert(repositories).values({
      organizationId,
      name,
      slug: repositorySlug,
      storageKey,
      sourceProvider: "github",
      sourceUrl: sourceUrl,
      visibility: token ? "private" : "public",
    }).returning();
  } catch {
    fail("/import", "A repository with that name already exists in this workspace.");
  }
  const encryptedToken = token ? await encryptSecret(token, requiredEnv("ORIGIN_ENCRYPTION_KEY")) : undefined;
  await getDb().insert(jobs).values({
    type: "import-github",
    payload: { repositoryId: repository!.id, sourceUrl, token: encryptedToken },
  });
  redirect(`/${organization.slug}/${repositorySlug}?import=queued`);
}

export async function createIssueAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const title = value(formData, "title");
  const body = value(formData, "body");
  const row = await requireRepositoryMember(user.id, repositoryId);
  if (title.length < 3) throw new Error("Issue title is too short");
  const [current] = await getDb().select({ number: max(issues.number) }).from(issues).where(eq(issues.repositoryId, repositoryId));
  await getDb().insert(issues).values({ repositoryId, number: (current?.number ?? 0) + 1, title, body, authorName: user.username });
  await queueRepositoryEvent(repositoryId, "issues", { action: "opened", number: (current?.number ?? 0) + 1, title });
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/issues`);
}

export async function commentOnIssueAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const issueId = value(formData, "issueId");
  const body = value(formData, "body");
  const row = await requireRepositoryMember(user.id, repositoryId);
  if (body.length < 1) throw new Error("Write a comment before posting");
  const [issue] = await getDb().select().from(issues).where(and(eq(issues.id, issueId), eq(issues.repositoryId, repositoryId))).limit(1);
  if (!issue) throw new Error("Issue not found");
  await getDb().insert(issueComments).values({ issueId, authorId: user.id, authorName: user.username, body });
  await queueRepositoryEvent(repositoryId, "issue_comment", { action: "created", issue: issue.number, body, author: user.username });
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/issues/${issue.number}`);
}

export async function updateIssueAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const issueId = value(formData, "issueId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const [issue] = await getDb().select().from(issues).where(and(eq(issues.id, issueId), eq(issues.repositoryId, repositoryId))).limit(1);
  if (!issue) throw new Error("Issue not found");
  const status = value(formData, "status") === "closed" ? "closed" : "open";
  const milestoneId = value(formData, "milestoneId") || null;
  await getDb().update(issues).set({ status, milestoneId, closedAt: status === "closed" ? new Date() : null, updatedAt: new Date() }).where(eq(issues.id, issueId));
  await getDb().delete(issueAssignees).where(eq(issueAssignees.issueId, issueId));
  if (value(formData, "assigned") === "self") await getDb().insert(issueAssignees).values({ issueId, userId: user.id });
  await queueRepositoryEvent(repositoryId, "issues", { action: status, number: issue.number });
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/issues/${issue.number}`);
}

export async function createLabelAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const name = value(formData, "name");
  const color = value(formData, "color").replace(/^#/, "");
  if (name.length < 1 || !/^[0-9a-fA-F]{6}$/.test(color)) throw new Error("Label name and six-digit color are required");
  await getDb().insert(labels).values({ repositoryId, name, color: color.toLowerCase(), description: value(formData, "description") }).onConflictDoNothing();
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/issues`);
}

export async function createMilestoneAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const title = value(formData, "title");
  if (title.length < 2) throw new Error("Milestone title is too short");
  const due = value(formData, "dueAt");
  const [current] = await getDb().select({ number: max(milestones.number) }).from(milestones).where(eq(milestones.repositoryId, repositoryId));
  await getDb().insert(milestones).values({ repositoryId, number: (current?.number ?? 0) + 1, title, description: value(formData, "description"), dueAt: due ? new Date(`${due}T12:00:00Z`) : null });
  await queueRepositoryEvent(repositoryId, "milestone", { action: "created", number: (current?.number ?? 0) + 1, title });
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/milestones`);
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/issues`);
}

export async function updateMilestoneAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const milestoneId = value(formData, "milestoneId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const [milestone] = await getDb().select().from(milestones).where(and(eq(milestones.id, milestoneId), eq(milestones.repositoryId, repositoryId))).limit(1);
  if (!milestone) throw new Error("Milestone not found");
  const intent = value(formData, "intent");
  if (intent !== "close" && intent !== "reopen") throw new Error("Unsupported milestone update");
  const status = intent === "close" ? "closed" : "open";
  await getDb().update(milestones).set({ status, closedAt: status === "closed" ? new Date() : null, updatedAt: new Date() }).where(eq(milestones.id, milestone.id));
  await queueRepositoryEvent(repositoryId, "milestone", { action: status === "closed" ? "closed" : "reopened", number: milestone.number, title: milestone.title });
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/milestones`);
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/issues`);
}

export async function toggleIssueLabelAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const issueId = value(formData, "issueId");
  const labelId = value(formData, "labelId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const [existing] = await getDb().select().from(issueLabels).where(and(eq(issueLabels.issueId, issueId), eq(issueLabels.labelId, labelId))).limit(1);
  if (existing) await getDb().delete(issueLabels).where(and(eq(issueLabels.issueId, issueId), eq(issueLabels.labelId, labelId)));
  else await getDb().insert(issueLabels).values({ issueId, labelId });
  const [issue] = await getDb().select().from(issues).where(eq(issues.id, issueId)).limit(1);
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/issues/${issue?.number ?? ""}`);
}

export async function createBranchAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const branch = value(formData, "branch");
  const from = value(formData, "from") || row.repository.defaultBranch;
  await createBranch(repositoryRoot, row.repository.storageKey, branch, from);
  await getDb().insert(activityEvents).values({ repositoryId, actorType: "human", actorName: user.username, type: "branch.created", title: `Created ${branch}`, detail: `Branched from ${from}.` });
  redirect(`/${row.organization.slug}/${row.repository.slug}/pulls?branch=${encodeURIComponent(branch)}`);
}

export async function createPullRequestAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const headBranch = value(formData, "headBranch");
  const baseBranch = value(formData, "baseBranch") || row.repository.defaultBranch;
  if (headBranch === baseBranch) throw new Error("Choose two different branches");
  const comparison = await compareBranches(repositoryRoot, row.repository.storageKey, baseBranch, headBranch);
  const [current] = await getDb().select({ number: max(pullRequests.number) }).from(pullRequests).where(eq(pullRequests.repositoryId, repositoryId));
  const [pull] = await getDb().insert(pullRequests).values({
    repositoryId,
    number: (current?.number ?? 0) + 1,
    title: value(formData, "title"),
    body: value(formData, "body"),
    authorName: user.username,
    headBranch,
    baseBranch,
    headSha: comparison.headSha,
    baseSha: comparison.baseSha,
    additions: comparison.additions,
    deletions: comparison.deletions,
    changedFiles: comparison.files.length,
    draft: value(formData, "draft") === "true",
  }).returning();
  await queueRepositoryEvent(repositoryId, "pull_request", { action: "opened", number: pull!.number, headBranch, baseBranch });
  redirect(`/${row.organization.slug}/${row.repository.slug}/pulls/${pull!.number}`);
}

export async function commentOnPullRequestAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const pullRequestId = value(formData, "pullRequestId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const [pull] = await getDb().select().from(pullRequests).where(and(eq(pullRequests.id, pullRequestId), eq(pullRequests.repositoryId, repositoryId))).limit(1);
  if (!pull) throw new Error("Change request not found");
  const body = value(formData, "body");
  await getDb().insert(pullRequestComments).values({ pullRequestId, authorId: user.id, authorName: user.username, body, path: value(formData, "path") || null, line: Number(value(formData, "line")) || null, side: value(formData, "side") || null });
  await queueRepositoryEvent(repositoryId, "pull_request_comment", { action: "created", number: pull.number, body, path: value(formData, "path") || null });
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/pulls/${pull.number}`);
}

export async function reviewPullRequestAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const pullRequestId = value(formData, "pullRequestId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const [pull] = await getDb().select().from(pullRequests).where(and(eq(pullRequests.id, pullRequestId), eq(pullRequests.repositoryId, repositoryId))).limit(1);
  if (!pull) throw new Error("Change request not found");
  const state = value(formData, "state");
  if (!new Set(["approved", "changes_requested", "commented"]).has(state)) throw new Error("Review decision is invalid");
  const commitSha = await getRefSha(repositoryRoot, row.repository.storageKey, pull.headBranch);
  await getDb().insert(pullRequestReviews).values({ pullRequestId, reviewerId: user.id, reviewerName: user.username, state, body: value(formData, "body"), commitSha });
  await queueRepositoryEvent(repositoryId, "pull_request_review", { action: state, number: pull.number, reviewer: user.username });
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/pulls/${pull.number}`);
}

export async function mergePullRequestAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const pullRequestId = value(formData, "pullRequestId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const [pull] = await getDb().select().from(pullRequests).where(and(eq(pullRequests.id, pullRequestId), eq(pullRequests.repositoryId, repositoryId))).limit(1);
  if (!pull || pull.status !== "open") throw new Error("This change request is not open");
  const headSha = await getRefSha(repositoryRoot, row.repository.storageKey, pull.headBranch);
  const reviews = await getDb().select().from(pullRequestReviews).where(eq(pullRequestReviews.pullRequestId, pull.id)).orderBy(desc(pullRequestReviews.submittedAt));
  const latestByReviewer = new Map<string, string>();
  for (const review of reviews) if (review.commitSha === headSha && !latestByReviewer.has(review.reviewerName)) latestByReviewer.set(review.reviewerName, review.state);
  if (![...latestByReviewer.values()].includes("approved")) throw new Error("At least one approval is required before merge");
  if ([...latestByReviewer.values()].includes("changes_requested")) throw new Error("Resolve requested changes before merge");
  const statuses = await getDb().select().from(commitStatuses).where(and(eq(commitStatuses.repositoryId, repositoryId), eq(commitStatuses.sha, headSha))).orderBy(desc(commitStatuses.createdAt));
  const latestStatuses = new Map<string, string>();
  for (const status of statuses) if (!latestStatuses.has(status.context)) latestStatuses.set(status.context, status.state);
  if ([...latestStatuses.values()].some((state) => state !== "success")) throw new Error("All reported checks must pass before merge");
  const merged = await mergeBranches(repositoryRoot, row.repository.storageKey, pull.baseBranch, pull.headBranch, `Merge #${pull.number}: ${pull.title}`, { name: user.name, email: user.email });
  await getDb().update(pullRequests).set({ status: "merged", headSha, mergeCommitSha: merged.sha, mergedAt: new Date(), updatedAt: new Date() }).where(eq(pullRequests.id, pull.id));
  await getDb().insert(activityEvents).values({ repositoryId, actorType: "human", actorName: user.username, type: "pull_request.merged", title: `Merged #${pull.number}: ${pull.title}`, detail: `${pull.headBranch} → ${pull.baseBranch} using ${merged.strategy}.` });
  await queueRepositoryEvent(repositoryId, "pull_request", { action: "merged", number: pull.number, sha: merged.sha });
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/pulls/${pull.number}`);
}

export async function createWebhookAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const url = new URL(value(formData, "url"));
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("Webhook URL must use HTTP or HTTPS");
  const secret = value(formData, "secret") || randomBytes(24).toString("base64url");
  const events = formData.getAll("events").map(String).filter(Boolean);
  await getDb().insert(webhooks).values({ repositoryId, url: url.toString(), secretEncrypted: await encryptSecret(secret, requiredEnv("ORIGIN_ENCRYPTION_KEY")), events: events.length ? events : ["push"] });
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/settings/hooks`);
}

export async function addSshKeyAction(formData: FormData) {
  const user = await requireUser();
  const publicKey = value(formData, "publicKey");
  await getDb().insert(sshKeys).values({ userId: user.id, title: value(formData, "title"), publicKey, fingerprint: sshFingerprint(publicKey) });
  revalidatePath("/settings/ssh");
}

export async function addDeployKeyAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const publicKey = value(formData, "publicKey");
  await getDb().insert(deployKeys).values({ repositoryId, title: value(formData, "title"), publicKey, fingerprint: sshFingerprint(publicKey), canWrite: value(formData, "canWrite") === "true" });
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/settings/keys`);
}

export type RunnerActionState = { token?: string; error?: string };
export async function createRunnerAction(_state: RunnerActionState, formData: FormData): Promise<RunnerActionState> {
  const user = await requireUser();
  const organizationId = value(formData, "organizationId");
  await requireOrganization(user.id, organizationId);
  const name = value(formData, "name");
  if (name.length < 2) return { error: "Give the runner a recognizable name." };
  const token = `orr_${randomBytes(32).toString("base64url")}`;
  await getDb().insert(runners).values({ organizationId, name, tokenHash: createHash("sha256").update(token).digest("hex"), labels: value(formData, "labels").split(",").map((item) => item.trim()).filter(Boolean) });
  return { token };
}

export async function queueBrainRefreshAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  await getDb().insert(jobs).values({ type: "analyze-repository", payload: { repositoryId } });
  redirect(`/${row.organization.slug}/${row.repository.slug}/brain?refresh=queued`);
}

export async function createAgentRunAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const objective = value(formData, "objective");
  const row = await requireRepositoryMember(user.id, repositoryId);
  if (objective.length < 10) throw new Error("Describe the outcome in at least 10 characters");
  const [run] = await getDb().insert(agentRuns).values({ repositoryId, createdById: user.id, objective }).returning();
  await getDb().insert(jobs).values({ type: "plan-agent-run", payload: { runId: run!.id } });
  redirect(`/${row.organization.slug}/${row.repository.slug}/agents?run=${run!.id}`);
}

export type TokenActionState = { token?: string; error?: string };

export async function createAccessTokenAction(_state: TokenActionState, formData: FormData): Promise<TokenActionState> {
  const user = await requireUser();
  const name = value(formData, "name");
  if (name.length < 2) return { error: "Give the token a recognizable name." };
  const token = `org_${randomBytes(32).toString("base64url")}`;
  await getDb().insert(accessTokens).values({
    userId: user.id,
    name,
    prefix: token.slice(0, 12),
    tokenHash: createHash("sha256").update(token).digest("hex"),
  });
  revalidatePath("/settings/tokens");
  return { token };
}

export async function approveAgentRunAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const runId = value(formData, "runId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const [run] = await getDb().select().from(agentRuns).where(and(eq(agentRuns.id, runId), eq(agentRuns.repositoryId, repositoryId))).limit(1);
  if (!run) throw new Error("Agent run not found");
  if (run.status !== "ready") throw new Error("Only planned runs can be approved for execution");
  await getDb().update(agentRuns).set({ status: "approved", approvedById: user.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, runId));
  await getDb().insert(jobs).values({ type: "execute-agent-run", payload: { runId } });
  await getDb().insert(activityEvents).values({ repositoryId, actorType: "human", actorName: user.username, type: "agent.approved", title: `Approved execution: ${run.objective.slice(0, 80)}`, detail: "The sandbox will publish an agent/* branch for independent review." });
  await recordAudit(row.organization.id, user.username, "agent_run.approved", run.objective.slice(0, 120), { runId });
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/agents`);
}

export async function rollbackAgentRunAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const runId = value(formData, "runId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const [run] = await getDb().select().from(agentRuns).where(and(eq(agentRuns.id, runId), eq(agentRuns.repositoryId, repositoryId))).limit(1);
  if (!run) throw new Error("Agent run not found");
  await getDb().insert(jobs).values({ type: "rollback-agent-run", payload: { runId, actorName: user.username } });
  await recordAudit(row.organization.id, user.username, "agent_run.rollback_requested", run.objective.slice(0, 120), { runId });
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/agents`);
}

export async function updatePolicyGatesAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  const maxChangedFiles = Math.min(Math.max(Number(value(formData, "maxChangedFiles")) || 25, 1), 500);
  const blockedPaths = value(formData, "blockedPaths").split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 50);
  const settings = {
    requireHumanApproval: true,
    requireAgentReview: formData.get("requireAgentReview") === "on",
    requirePassingChecks: formData.get("requirePassingChecks") === "on",
    allowNetwork: formData.get("allowNetwork") === "on",
    runTests: formData.get("runTests") === "on",
    blockedPaths,
    maxChangedFiles,
    updatedAt: new Date(),
  };
  await getDb().insert(policyGates).values({ repositoryId, ...settings }).onConflictDoUpdate({ target: policyGates.repositoryId, set: settings });
  await recordAudit(row.organization.id, user.username, "policy_gates.updated", row.repository.slug, settings);
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/settings/policies`);
}

export async function resolveIncidentAction(formData: FormData) {
  const user = await requireUser();
  const repositoryId = value(formData, "repositoryId");
  const incidentId = value(formData, "incidentId");
  const row = await requireRepositoryMember(user.id, repositoryId);
  await getDb().update(incidents).set({ status: "resolved", resolvedBy: user.username, resolvedAt: new Date(), updatedAt: new Date() }).where(and(eq(incidents.id, incidentId), eq(incidents.repositoryId, repositoryId)));
  await recordAudit(row.organization.id, user.username, "incident.resolved", incidentId);
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/settings/incidents`);
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/agents`);
}

export async function updateWorkspaceSettingsAction(formData: FormData) {
  const user = await requireUser();
  const organizationId = value(formData, "organizationId");
  const organization = await requireOrganization(user.id, organizationId);
  const region = assertDataRegion(value(formData, "region") || "us");
  const plan = ["community", "team", "enterprise"].includes(value(formData, "plan")) ? value(formData, "plan") : "community";
  const settings = {
    plan,
    billingEmail: value(formData, "billingEmail") || null,
    region,
    aiTokenBudget: Math.max(Number(value(formData, "aiTokenBudget")) || 0, 0),
    maxRepositories: Math.max(Number(value(formData, "maxRepositories")) || 0, 0),
    maxRepositorySizeMb: Math.min(Math.max(Number(value(formData, "maxRepositorySizeMb")) || 2048, 64), 51_200),
    updatedAt: new Date(),
  };
  await getDb().insert(organizationSettings).values({ organizationId, ...settings }).onConflictDoUpdate({ target: organizationSettings.organizationId, set: settings });
  await recordAudit(organizationId, user.username, "workspace.settings_updated", organization.slug, { plan, region });
  revalidatePath("/settings/workspace");
}

export async function configureSsoAction(formData: FormData) {
  const user = await requireUser();
  const organizationId = value(formData, "organizationId");
  const organization = await requireOrganization(user.id, organizationId);
  const enabled = formData.get("ssoEnabled") === "on";
  const issuer = value(formData, "ssoIssuer");
  const clientId = value(formData, "ssoClientId");
  const clientSecret = value(formData, "ssoClientSecret");
  if (enabled) {
    const issuerUrl = new URL(issuer);
    if (issuerUrl.protocol !== "https:") throw new Error("The OIDC issuer must use HTTPS");
    if (!clientId) throw new Error("An OIDC client id is required");
  }
  const set = {
    ssoEnabled: enabled,
    ssoIssuer: issuer || null,
    ssoClientId: clientId || null,
    ...(clientSecret ? { ssoClientSecretEncrypted: await encryptSecret(clientSecret, requiredEnv("ORIGIN_ENCRYPTION_KEY")) } : {}),
    updatedAt: new Date(),
  };
  await getDb().insert(organizationSettings).values({ organizationId, ...set }).onConflictDoUpdate({ target: organizationSettings.organizationId, set });
  await recordAudit(organizationId, user.username, "sso.configured", organization.slug, { enabled, issuer });
  revalidatePath("/settings/workspace");
}

export type ScimTokenState = { token?: string; error?: string };

export async function generateScimTokenAction(_state: ScimTokenState, formData: FormData): Promise<ScimTokenState> {
  const user = await requireUser();
  const organizationId = value(formData, "organizationId");
  const organization = await requireOrganization(user.id, organizationId);
  const token = `scim_${randomBytes(32).toString("base64url")}`;
  const set = { scimTokenHash: createHash("sha256").update(token).digest("hex"), updatedAt: new Date() };
  await getDb().insert(organizationSettings).values({ organizationId, ...set }).onConflictDoUpdate({ target: organizationSettings.organizationId, set });
  await recordAudit(organizationId, user.username, "scim.token_rotated", organization.slug);
  revalidatePath("/settings/workspace");
  return { token };
}

export async function runBackupSweepAction() {
  const user = await requireUser();
  if (!user.admin) throw new Error("Only instance operators can run backup sweeps");
  await getDb().insert(jobs).values({ type: "backup-repositories", payload: { requestedBy: user.username } });
  revalidatePath("/ops");
}
