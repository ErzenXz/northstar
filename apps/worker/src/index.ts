import "dotenv/config";
import { resolve } from "node:path";
import { Octokit } from "@octokit/rest";
import { buildRepositoryBrain, planRepositoryObjective } from "@origin/ai";
import { decryptSecret, requiredEnv } from "@origin/core";
import {
  activityEvents,
  agentRuns,
  closeDb,
  getDb,
  issues,
  jobs,
  pullRequests,
  repositories,
  repositoryMemories,
} from "@origin/db";
import { getDefaultBranch, listTree, mirrorRepository, readReadme, readTextFile } from "@origin/git";
import { eq, sql } from "drizzle-orm";

type ClaimedJob = { id: string; type: string; payload: Record<string, unknown>; attempts: number };
const repositoryRoot = resolve(process.env.ORIGIN_REPOSITORY_ROOT ?? "../../data/repositories");
let stopping = false;

async function claimJob(): Promise<ClaimedJob | null> {
  return getDb().transaction(async (tx) => {
    const result = await tx.execute<ClaimedJob>(sql`
      WITH candidate AS (
        SELECT id FROM jobs
        WHERE status = 'queued' AND run_after <= now()
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE jobs
      SET status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
      WHERE id IN (SELECT id FROM candidate)
      RETURNING id, type, payload, attempts
    `);
    return result[0] ?? null;
  });
}

function parseGitHubUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Only HTTPS GitHub repository URLs are accepted by this importer");
  }
  const [owner, rawRepository, ...extra] = url.pathname.split("/").filter(Boolean);
  if (!owner || !rawRepository || extra.length) throw new Error("Use a repository URL such as https://github.com/acme/project");
  const repository = rawRepository.replace(/\.git$/, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("GitHub repository path is invalid");
  return { owner, repository, cloneUrl: `https://github.com/${owner}/${repository}.git` };
}

async function importGitHub(job: ClaimedJob) {
  const repositoryId = String(job.payload.repositoryId);
  const sourceUrl = String(job.payload.sourceUrl);
  const encryptedToken = typeof job.payload.token === "string" ? job.payload.token : null;
  const token = encryptedToken ? await decryptSecret(encryptedToken, requiredEnv("ORIGIN_ENCRYPTION_KEY")) : undefined;
  const source = parseGitHubUrl(sourceUrl);
  const [repository] = await getDb().select().from(repositories).where(eq(repositories.id, repositoryId)).limit(1);
  if (!repository) throw new Error("Import target repository no longer exists");

  const octokit = new Octokit({ auth: token });
  console.log(`Import ${job.id}: mirroring Git objects`);
  await mirrorRepository(source.cloneUrl, repositoryRoot, repository.storageKey, token);
  console.log(`Import ${job.id}: Git mirror complete`);
  const defaultBranch = await getDefaultBranch(repositoryRoot, repository.storageKey);
  await getDb().update(repositories).set({
    defaultBranch,
    sourceProvider: "github",
    sourceUrl: `https://github.com/${source.owner}/${source.repository}`,
    updatedAt: new Date(),
  }).where(eq(repositories.id, repositoryId));

  const warnings: string[] = [];
  let issueCount = 0;
  let pullRequestCount = 0;
  try {
    console.log(`Import ${job.id}: reading repository metadata`);
    const metadata = await octokit.repos.get({ owner: source.owner, repo: source.repository });
    await getDb().update(repositories).set({
      description: metadata.data.description,
      defaultBranch: metadata.data.default_branch,
      visibility: metadata.data.private ? "private" : "public",
      language: metadata.data.language,
      topics: metadata.data.topics ?? [],
      sourceUrl: metadata.data.html_url,
      updatedAt: new Date(),
    }).where(eq(repositories.id, repositoryId));
  } catch {
    warnings.push("GitHub repository metadata was rate-limited");
  }

  try {
    console.log(`Import ${job.id}: moving issue records`);
    const importedIssues = await octokit.paginate(octokit.issues.listForRepo, {
      owner: source.owner,
      repo: source.repository,
      state: "all",
      per_page: 100,
    });
    for (const issue of importedIssues.filter((item) => !item.pull_request)) {
      await getDb().insert(issues).values({
        repositoryId,
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        status: issue.state,
        authorName: issue.user?.login ?? "unknown",
        authorAvatarUrl: issue.user?.avatar_url,
        labels: issue.labels.map((label) => typeof label === "string" ? label : label.name ?? "").filter(Boolean),
        externalId: String(issue.id),
        externalUrl: issue.html_url,
        createdAt: new Date(issue.created_at),
        updatedAt: new Date(issue.updated_at),
        closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
      }).onConflictDoNothing();
      issueCount += 1;
    }
  } catch {
    warnings.push("GitHub issues were rate-limited; retry with a token to move them");
  }

  try {
    console.log(`Import ${job.id}: moving pull-request records`);
    const importedPulls = await octokit.paginate(octokit.pulls.list, {
      owner: source.owner,
      repo: source.repository,
      state: "all",
      per_page: 100,
    });
    for (const pull of importedPulls) {
      await getDb().insert(pullRequests).values({
        repositoryId,
        number: pull.number,
        title: pull.title,
        body: pull.body ?? "",
        status: pull.merged_at ? "merged" : pull.state,
        authorName: pull.user?.login ?? "unknown",
        headBranch: pull.head.ref,
        baseBranch: pull.base.ref,
        externalId: String(pull.id),
        externalUrl: pull.html_url,
        createdAt: new Date(pull.created_at),
        updatedAt: new Date(pull.updated_at),
        mergedAt: pull.merged_at ? new Date(pull.merged_at) : null,
      }).onConflictDoNothing();
      pullRequestCount += 1;
    }
  } catch {
    warnings.push("GitHub pull requests were rate-limited; retry with a token to move them");
  }

  await getDb().insert(activityEvents).values({
    repositoryId,
    actorType: "system",
    actorName: "GitHub importer",
    type: "repository.imported",
    title: `Imported ${source.owner}/${source.repository}`,
    detail: warnings.length
      ? `Git history moved. ${warnings.join(". ")}.`
      : `${issueCount} issues and ${pullRequestCount} pull requests moved with the Git history.`,
    metadata: { warnings },
  });
  await getDb().insert(jobs).values({ type: "analyze-repository", payload: { repositoryId } });
  console.log(`Import ${job.id}: completed with ${warnings.length} warning(s)`);
  return { repositoryId, issues: issueCount, pullRequests: pullRequestCount, warnings };
}

async function analyzeRepository(job: ClaimedJob) {
  const repositoryId = String(job.payload.repositoryId);
  const [repository] = await getDb().select().from(repositories).where(eq(repositories.id, repositoryId)).limit(1);
  if (!repository) throw new Error("Repository no longer exists");
  const tree = await listTree(repositoryRoot, repository.storageKey, repository.defaultBranch);
  const readme = await readReadme(repositoryRoot, repository.storageKey, repository.defaultBranch);
  const contextNames = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "docker-compose.yml", "compose.yaml", "AGENTS.md", "CONTRIBUTING.md"];
  const files: Array<{ path: string; content: string }> = [];
  for (const entry of tree.filter((item) => item.type === "blob" && contextNames.includes(item.name)).slice(0, 8)) {
    files.push({ path: entry.path, content: await readTextFile(repositoryRoot, repository.storageKey, repository.defaultBranch, entry.path) });
  }
  const brain = await buildRepositoryBrain({ repositoryName: repository.name, readme: readme?.content, files });
  await getDb().delete(repositoryMemories).where(eq(repositoryMemories.repositoryId, repositoryId));
  await getDb().insert(repositoryMemories).values([
    { repositoryId, kind: "purpose", title: "What this repository does", content: brain.purpose, confidence: 90 },
    ...brain.architecture.map((memory) => ({ repositoryId, kind: "architecture", title: memory.title, content: memory.detail, sourcePath: memory.sourcePath, confidence: 85 })),
    ...brain.conventions.map((memory) => ({ repositoryId, kind: "convention", title: memory.title, content: memory.detail, sourcePath: memory.sourcePath, confidence: 80 })),
    ...brain.risks.map((memory) => ({ repositoryId, kind: "risk", title: memory.title, content: memory.detail, sourcePath: memory.sourcePath, confidence: 70 })),
  ]);
  await getDb().insert(activityEvents).values({
    repositoryId,
    actorType: "agent",
    actorName: "Repository cartographer",
    type: "brain.updated",
    title: "Mapped the repository",
    detail: `${brain.architecture.length} architecture notes and ${brain.risks.length} risks are now part of project memory.`,
  });
  return { memories: 1 + brain.architecture.length + brain.conventions.length + brain.risks.length };
}

async function planAgentRun(job: ClaimedJob) {
  const runId = String(job.payload.runId);
  const [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  if (!run) throw new Error("Agent run no longer exists");
  const [repository] = await getDb().select().from(repositories).where(eq(repositories.id, run.repositoryId)).limit(1);
  if (!repository) throw new Error("Repository no longer exists");
  await getDb().update(agentRuns).set({ status: "planning", startedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, runId));
  const tree = await listTree(repositoryRoot, repository.storageKey, repository.defaultBranch);
  const readme = await readReadme(repositoryRoot, repository.storageKey, repository.defaultBranch);
  const plan = await planRepositoryObjective({
    objective: run.objective,
    repositoryName: repository.name,
    readme: readme?.content,
    tree: tree.map((entry) => entry.path),
  });
  await getDb().update(agentRuns).set({
    status: "ready",
    plan: plan.steps.map((item) => ({ step: item.step, status: "pending" })),
    summary: `${plan.summary}\n\nRisk: ${plan.risk}. Acceptance: ${plan.acceptanceCriteria.join(" · ")}`,
    evidence: plan.likelyFiles.map((path) => ({ label: "Likely path", value: path })),
    model: process.env.AI_MODEL ?? "openai/gpt-5.6-terra",
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(agentRuns.id, runId));
  await getDb().insert(activityEvents).values({
    repositoryId: repository.id,
    actorType: "agent",
    actorName: "Origin planner",
    type: "agent.plan_ready",
    title: `Planned: ${run.objective}`,
    detail: `${plan.steps.length} verified steps are ready for approval.`,
  });
  return { runId, steps: plan.steps.length };
}

async function perform(job: ClaimedJob) {
  if (job.type === "import-github") return importGitHub(job);
  if (job.type === "analyze-repository") return analyzeRepository(job);
  if (job.type === "plan-agent-run") return planAgentRun(job);
  throw new Error(`Unsupported job type: ${job.type}`);
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(Bearer|token|password)[^\s]*/gi, "$1 [redacted]").slice(0, 4_000);
}

async function loop() {
  console.log("Origin worker is ready.");
  while (!stopping) {
    const job = await claimJob();
    if (!job) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, Number(process.env.WORKER_POLL_MS ?? 1200)));
      continue;
    }
    try {
      const result = await perform(job);
      const payload = job.type === "import-github"
        ? Object.fromEntries(Object.entries(job.payload).filter(([key]) => key !== "token"))
        : job.payload;
      await getDb().update(jobs).set({ status: "completed", payload, result, completedAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, job.id));
    } catch (error) {
      const retry = job.attempts < 3;
      const payload = !retry && job.type === "import-github"
        ? Object.fromEntries(Object.entries(job.payload).filter(([key]) => key !== "token"))
        : job.payload;
      await getDb().update(jobs).set({
        status: retry ? "queued" : "failed",
        payload,
        error: safeError(error),
        runAfter: new Date(Date.now() + job.attempts * 10_000),
        updatedAt: new Date(),
      }).where(eq(jobs.id, job.id));
      console.error(`Job ${job.id} failed: ${safeError(error)}`);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { stopping = true; });
}

await loop();
await closeDb();
