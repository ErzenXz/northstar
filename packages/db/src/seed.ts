import "dotenv/config";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { hash } from "argon2";
import { eq } from "drizzle-orm";
import { mirrorRepository, repositoryExists } from "@origin/git";
import { activityEvents, closeDb, getDb, jobs, organizationMembers, organizations, repositories, users } from "./index";

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

console.log(`Seed ready: ${email} / ${password}`);
await closeDb();
