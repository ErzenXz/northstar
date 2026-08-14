"use server";

import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "argon2";
import { and, eq, max } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { encryptSecret, repositoryStorageKey, requiredEnv, slugify } from "@origin/core";
import {
  accessTokens,
  agentRuns,
  getDb,
  issues,
  jobs,
  organizationMembers,
  organizations,
  repositories,
  users,
} from "@origin/db";
import { createBareRepository } from "@origin/git";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { repositoryRoot } from "@/lib/repository";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function signUpAction(formData: FormData) {
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
  const identity = value(formData, "identity").toLowerCase();
  const password = value(formData, "password");
  const [user] = await getDb().select().from(users).where(identity.includes("@") ? eq(users.email, identity) : eq(users.username, identity)).limit(1);
  if (!user || !(await verify(user.passwordHash, password))) fail("/sign-in", "Email, username, or password is incorrect.");
  await createSession(user.id);
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
  revalidatePath(`/${row.organization.slug}/${row.repository.slug}/issues`);
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
