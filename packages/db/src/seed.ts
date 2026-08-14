import "dotenv/config";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { hash } from "argon2";
import { eq } from "drizzle-orm";
import { compareBranches, listBranches, mirrorRepository, repositoryExists, resolveRepositoryPath } from "@origin/git";
import { activityEvents, closeDb, commitStatuses, getDb, issueAssignees, issueComments, issueLabels, issues, jobs, labels, milestones, organizationMembers, organizations, pullRequestComments, pullRequestReviews, pullRequests, repositories, users } from "./index";

const exec = promisify(execFile);
const username = process.env.SEED_USERNAME ?? "origin-demo";
const email = process.env.SEED_EMAIL ?? "demo@origin.local";
const password = process.env.SEED_PASSWORD ?? "origin-demo-2026";
const repositoryRoot = resolve(process.env.ORIGIN_REPOSITORY_ROOT ?? "../../data/repositories");

let [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
if (!user) {
  [user] = await getDb().insert(users).values({
    name: "Origin Builder",
    username,
    email,
    passwordHash: await hash(password),
  }).returning();
}

let [organization] = await getDb().select().from(organizations).where(eq(organizations.slug, username)).limit(1);
if (!organization) {
  [organization] = await getDb().insert(organizations).values({
    name: "Origin Workshop",
    slug: username,
    description: "A local workspace seeded for the Origin product tour.",
  }).returning();
}
await getDb().insert(organizationMembers).values({ organizationId: organization!.id, userId: user!.id, role: "owner" }).onConflictDoNothing();

let [repository] = await getDb().select().from(repositories).where(eq(repositories.storageKey, `${username}/northstar.git`)).limit(1);
if (!repository) {
  [repository] = await getDb().insert(repositories).values({
    organizationId: organization!.id,
    name: "northstar",
    slug: "northstar",
    description: "A small seeded repository showing how humans and agents share context.",
    storageKey: `${username}/northstar.git`,
    visibility: "public",
    language: "TypeScript",
    topics: ["origin", "demo", "agents"],
  }).returning();
}

if (!(await repositoryExists(repositoryRoot, repository!.storageKey))) {
  const temporary = await mkdtemp(join(tmpdir(), "origin-seed-"));
  try {
    await mkdir(join(temporary, "src"), { recursive: true });
    await writeFile(join(temporary, "README.md"), `# Northstar\n\nA tiny project used to demonstrate Origin's source browser, repository memory, and evidence-first agent planning.\n\n## Principles\n\n- Humans decide what ships.\n- Agents attach evidence to their work.\n- Project knowledge lives beside the source.\n`);
    await writeFile(join(temporary, "package.json"), JSON.stringify({ name: "northstar", private: true, type: "module", scripts: { check: "tsc --noEmit" } }, null, 2));
    await writeFile(join(temporary, "src/index.ts"), `export function navigate(goal: string) {\n  return { goal, status: "charted" as const };\n}\n`);
    await exec("git", ["init", "--initial-branch=main"], { cwd: temporary });
    await exec("git", ["config", "user.name", "Origin Builder"], { cwd: temporary });
    await exec("git", ["config", "user.email", email], { cwd: temporary });
    await exec("git", ["add", "."], { cwd: temporary });
    await exec("git", ["commit", "-m", "Start Northstar on Origin"], { cwd: temporary });
    await mirrorRepository(temporary, repositoryRoot, repository!.storageKey);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  await getDb().insert(activityEvents).values({
    repositoryId: repository!.id,
    actorType: "human",
    actorName: "Origin Builder",
    type: "repository.seeded",
    title: "Created the first commit",
    detail: "Northstar is ready to explore.",
  });
  await getDb().insert(jobs).values({ type: "analyze-repository", payload: { repositoryId: repository!.id } });
}

const branches: string[] = await listBranches(repositoryRoot, repository!.storageKey).catch((): string[] => []);
if (!branches.includes("feature/decision-rail")) {
  const temporary = await mkdtemp(join(tmpdir(), "origin-alpha2-seed-"));
  try {
    await exec("git", ["clone", resolveRepositoryPath(repositoryRoot, repository!.storageKey), temporary]);
    await exec("git", ["config", "user.name", "Origin Builder"], { cwd: temporary });
    await exec("git", ["config", "user.email", email], { cwd: temporary });
    await exec("git", ["checkout", "-b", "feature/decision-rail"], { cwd: temporary });
    await mkdir(join(temporary, "docs"), { recursive: true });
    await writeFile(join(temporary, "docs", "merge-decision.md"), "# Merge decisions\n\nA change ships only after its conversation, approval, and reported checks agree.\n");
    await exec("git", ["add", "."], { cwd: temporary });
    await exec("git", ["commit", "-m", "Document the merge decision"], { cwd: temporary });
    await exec("git", ["push", "origin", "feature/decision-rail"], { cwd: temporary });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

const [productLabel] = await getDb().insert(labels).values({ repositoryId: repository!.id, name: "product", color: "2d63ff", description: "Changes visible to the people using Origin" }).onConflictDoUpdate({ target: [labels.repositoryId, labels.name], set: { color: "2d63ff" } }).returning();
const [alphaMilestone] = await getDb().insert(milestones).values({ repositoryId: repository!.id, number: 1, title: "Alpha 2", description: "Own the merge decision" }).onConflictDoUpdate({ target: [milestones.repositoryId, milestones.number], set: { title: "Alpha 2" } }).returning();
const [demoIssue] = await getDb().insert(issues).values({ repositoryId: repository!.id, number: 1, title: "Explain why a change is ready", body: "The merge surface should combine the diff, conversation, approvals, and checks.", authorName: username, milestoneId: alphaMilestone!.id }).onConflictDoUpdate({ target: [issues.repositoryId, issues.number], set: { milestoneId: alphaMilestone!.id } }).returning();
await getDb().insert(issueLabels).values({ issueId: demoIssue!.id, labelId: productLabel!.id }).onConflictDoNothing();
await getDb().insert(issueAssignees).values({ issueId: demoIssue!.id, userId: user!.id }).onConflictDoNothing();
const [existingComment] = await getDb().select().from(issueComments).where(eq(issueComments.issueId, demoIssue!.id)).limit(1);
if (!existingComment) await getDb().insert(issueComments).values({ issueId: demoIssue!.id, authorId: user!.id, authorName: username, body: "Acceptance: a reviewer can understand and merge the change from one screen." });

const comparison = await compareBranches(repositoryRoot, repository!.storageKey, "main", "feature/decision-rail");
const [demoPull] = await getDb().insert(pullRequests).values({ repositoryId: repository!.id, number: 1, title: "Make the merge decision visible", body: "Adds the written rule that Origin applies to every change.", authorName: username, headBranch: "feature/decision-rail", baseBranch: "main", headSha: comparison.headSha, baseSha: comparison.baseSha, additions: comparison.additions, deletions: comparison.deletions, changedFiles: comparison.files.length }).onConflictDoUpdate({ target: [pullRequests.repositoryId, pullRequests.number], set: { headSha: comparison.headSha, baseSha: comparison.baseSha, additions: comparison.additions, deletions: comparison.deletions, changedFiles: comparison.files.length } }).returning();
const [existingReview] = await getDb().select().from(pullRequestReviews).where(eq(pullRequestReviews.pullRequestId, demoPull!.id)).limit(1);
if (!existingReview) await getDb().insert(pullRequestReviews).values({ pullRequestId: demoPull!.id, reviewerId: user!.id, reviewerName: username, state: "approved", body: "The decision rule is clear and scoped.", commitSha: comparison.headSha });
else if (!existingReview.commitSha) await getDb().update(pullRequestReviews).set({ commitSha: comparison.headSha }).where(eq(pullRequestReviews.id, existingReview.id));
const [existingPullComment] = await getDb().select().from(pullRequestComments).where(eq(pullRequestComments.pullRequestId, demoPull!.id)).limit(1);
if (!existingPullComment) await getDb().insert(pullRequestComments).values({ pullRequestId: demoPull!.id, authorId: user!.id, authorName: username, body: "This wording matches the Alpha 2 acceptance rule.", path: "docs/merge-decision.md" });
const [existingStatus] = await getDb().select().from(commitStatuses).where(eq(commitStatuses.sha, comparison.headSha)).limit(1);
if (!existingStatus) await getDb().insert(commitStatuses).values({ repositoryId: repository!.id, sha: comparison.headSha, context: "origin/demo-check", state: "success", description: "Seeded verification passed", creatorName: username });

console.log(`Seed ready: ${email} / ${password}`);
await closeDb();
