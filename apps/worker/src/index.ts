import "dotenv/config";
import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Octokit } from "@octokit/rest";
import { buildRepositoryBrain, planRepositoryObjective } from "@origin/ai";
import { decryptSecret, requiredEnv } from "@origin/core";
import {
  activityEvents,
  agentRuns,
  closeDb,
  getDb,
  issueComments,
  issueLabels,
  issues,
  jobs,
  labels,
  milestones,
  pullRequestComments,
  pullRequestReviews,
  pullRequests,
  releaseAssets,
  releases,
  repositories,
  repositoryMemories,
  webhookDeliveries,
  webhooks,
  wikiImports,
} from "@origin/db";
import { getDefaultBranch, listTree, mirrorRepository, readReadme, readTextFile } from "@origin/git";
import { and, eq, sql } from "drizzle-orm";
import { executeAgentRun, reviewAgentRun, rollbackAgentRun } from "./agents";
import { backupRepositories } from "./backups";
import { assertAiBudget, chargeAiUsage } from "./billing";

type ClaimedJob = { id: string; type: string; payload: Record<string, unknown>; attempts: number };
const repositoryRoot = resolve(process.env.ORIGIN_REPOSITORY_ROOT ?? "../../data/repositories");
const assetRoot = resolve(process.env.ORIGIN_ASSET_ROOT ?? "../../data/assets");
const sandboxRoot = resolve(process.env.ORIGIN_SANDBOX_ROOT ?? "../../data/sandboxes");
const backupRoot = resolve(process.env.ORIGIN_BACKUP_ROOT ?? "../../data/backups");
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
  let commentCount = 0;
  let releaseCount = 0;
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
      let milestoneId: string | null = null;
      if (issue.milestone) {
        const [milestone] = await getDb().insert(milestones).values({
          repositoryId,
          number: issue.milestone.number,
          title: issue.milestone.title,
          description: issue.milestone.description ?? "",
          status: issue.milestone.state,
          dueAt: issue.milestone.due_on ? new Date(issue.milestone.due_on) : null,
          closedAt: issue.milestone.closed_at ? new Date(issue.milestone.closed_at) : null,
        }).onConflictDoUpdate({ target: [milestones.repositoryId, milestones.number], set: { title: issue.milestone.title, description: issue.milestone.description ?? "", status: issue.milestone.state, dueAt: issue.milestone.due_on ? new Date(issue.milestone.due_on) : null, closedAt: issue.milestone.closed_at ? new Date(issue.milestone.closed_at) : null } }).returning();
        milestoneId = milestone!.id;
      }
      const legacyLabels = issue.labels.map((label) => typeof label === "string" ? label : label.name ?? "").filter(Boolean);
      const [localIssue] = await getDb().insert(issues).values({
        repositoryId,
        number: issue.number,
        title: issue.title,
        body: issue.body ?? "",
        status: issue.state,
        authorName: issue.user?.login ?? "unknown",
        authorAvatarUrl: issue.user?.avatar_url,
        labels: legacyLabels,
        milestoneId,
        externalId: String(issue.id),
        externalUrl: issue.html_url,
        createdAt: new Date(issue.created_at),
        updatedAt: new Date(issue.updated_at),
        closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
      }).onConflictDoUpdate({ target: [issues.repositoryId, issues.number], set: { title: issue.title, body: issue.body ?? "", status: issue.state, labels: legacyLabels, milestoneId, updatedAt: new Date(issue.updated_at), closedAt: issue.closed_at ? new Date(issue.closed_at) : null } }).returning();
      for (const rawLabel of issue.labels) {
        const name = typeof rawLabel === "string" ? rawLabel : rawLabel.name ?? "";
        if (!name) continue;
        const color = typeof rawLabel === "string" ? "6e7781" : rawLabel.color ?? "6e7781";
        const description = typeof rawLabel === "string" ? "" : rawLabel.description ?? "";
        const [localLabel] = await getDb().insert(labels).values({ repositoryId, name, color, description }).onConflictDoUpdate({ target: [labels.repositoryId, labels.name], set: { color, description } }).returning();
        await getDb().insert(issueLabels).values({ issueId: localIssue!.id, labelId: localLabel!.id }).onConflictDoNothing();
      }
      issueCount += 1;
    }

    const importedComments = await octokit.paginate(octokit.issues.listCommentsForRepo, { owner: source.owner, repo: source.repository, per_page: 100 });
    const localIssues = await getDb().select({ id: issues.id, number: issues.number }).from(issues).where(eq(issues.repositoryId, repositoryId));
    const issueIds = new Map(localIssues.map((item) => [item.number, item.id]));
    for (const comment of importedComments) {
      const number = Number(comment.issue_url.split("/").pop());
      const issueId = issueIds.get(number);
      if (!issueId) continue;
      await getDb().insert(issueComments).values({
        issueId,
        authorName: comment.user?.login ?? "unknown",
        authorAvatarUrl: comment.user?.avatar_url,
        body: comment.body ?? "",
        externalId: String(comment.id),
        externalUrl: comment.html_url,
        createdAt: new Date(comment.created_at),
        updatedAt: new Date(comment.updated_at),
      }).onConflictDoNothing();
      commentCount += 1;
    }
  } catch {
    warnings.push("GitHub issues or comments were rate-limited; retry with a token to move them");
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
      const [localPull] = await getDb().insert(pullRequests).values({
        repositoryId,
        number: pull.number,
        title: pull.title,
        body: pull.body ?? "",
        status: pull.merged_at ? "merged" : pull.state,
        authorName: pull.user?.login ?? "unknown",
        headBranch: pull.head.ref,
        baseBranch: pull.base.ref,
        headSha: pull.head.sha,
        baseSha: pull.base.sha,
        externalId: String(pull.id),
        externalUrl: pull.html_url,
        createdAt: new Date(pull.created_at),
        updatedAt: new Date(pull.updated_at),
        mergedAt: pull.merged_at ? new Date(pull.merged_at) : null,
      }).onConflictDoUpdate({ target: [pullRequests.repositoryId, pullRequests.number], set: { title: pull.title, body: pull.body ?? "", status: pull.merged_at ? "merged" : pull.state, updatedAt: new Date(pull.updated_at) } }).returning();
      const [reviewComments, reviews] = await Promise.all([
        octokit.paginate(octokit.pulls.listReviewComments, { owner: source.owner, repo: source.repository, pull_number: pull.number, per_page: 100 }),
        octokit.paginate(octokit.pulls.listReviews, { owner: source.owner, repo: source.repository, pull_number: pull.number, per_page: 100 }),
      ]);
      for (const comment of reviewComments) {
        await getDb().insert(pullRequestComments).values({ pullRequestId: localPull!.id, authorName: comment.user?.login ?? "unknown", body: comment.body, path: comment.path, line: comment.line ?? comment.original_line, side: comment.side?.toLowerCase(), externalId: String(comment.id), externalUrl: comment.html_url, createdAt: new Date(comment.created_at), updatedAt: new Date(comment.updated_at) }).onConflictDoNothing();
        commentCount += 1;
      }
      for (const review of reviews) {
        await getDb().insert(pullRequestReviews).values({ pullRequestId: localPull!.id, reviewerName: review.user?.login ?? "unknown", state: review.state.toLowerCase(), body: review.body ?? "", commitSha: review.commit_id, externalId: String(review.id), submittedAt: review.submitted_at ? new Date(review.submitted_at) : new Date() }).onConflictDoNothing();
      }
      pullRequestCount += 1;
    }
  } catch {
    warnings.push("GitHub pull requests were rate-limited; retry with a token to move them");
  }

  try {
    console.log(`Import ${job.id}: moving releases and assets`);
    const importedReleases = await octokit.paginate(octokit.repos.listReleases, { owner: source.owner, repo: source.repository, per_page: 100 });
    for (const release of importedReleases) {
      const [localRelease] = await getDb().insert(releases).values({
        repositoryId,
        tagName: release.tag_name,
        name: release.name || release.tag_name,
        body: release.body ?? "",
        authorName: release.author?.login ?? "unknown",
        draft: release.draft,
        prerelease: release.prerelease,
        externalId: String(release.id),
        externalUrl: release.html_url,
        publishedAt: release.published_at ? new Date(release.published_at) : null,
        createdAt: new Date(release.created_at),
        updatedAt: new Date(release.created_at),
      }).onConflictDoUpdate({ target: [releases.repositoryId, releases.tagName], set: { name: release.name || release.tag_name, body: release.body ?? "", draft: release.draft, prerelease: release.prerelease } }).returning();
      for (const asset of release.assets) {
        let storagePath: string | null = null;
        if (asset.size <= 100 * 1024 * 1024) {
          try {
            const safeName = basename(asset.name);
            const directory = resolve(assetRoot, repositoryId, release.tag_name.replace(/[^A-Za-z0-9._-]/g, "_"));
            await mkdir(directory, { recursive: true });
            const response = await fetch(asset.url, { headers: { Accept: "application/octet-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}), "User-Agent": "Origin-Importer" } });
            if (response.ok) {
              const data = Buffer.from(await response.arrayBuffer());
              if (data.length <= 100 * 1024 * 1024) {
                storagePath = resolve(directory, safeName);
                await writeFile(storagePath, data, { mode: 0o640 });
              }
            }
          } catch {
            warnings.push(`Asset ${asset.name} could not be copied`);
          }
        } else warnings.push(`Asset ${asset.name} exceeds the 100 MB import limit`);
        await getDb().insert(releaseAssets).values({ releaseId: localRelease!.id, name: asset.name, contentType: asset.content_type, size: asset.size, downloadUrl: asset.browser_download_url, storagePath, externalId: String(asset.id), downloadCount: asset.download_count, createdAt: new Date(asset.created_at) }).onConflictDoNothing();
      }
      releaseCount += 1;
    }
  } catch {
    warnings.push("GitHub releases or assets were rate-limited; retry with a token to move them");
  }

  try {
    console.log(`Import ${job.id}: mirroring wiki history`);
    const wikiStorageKey = repository.storageKey.replace(/\.git$/, ".wiki.git");
    const wikiSourceUrl = `https://github.com/${source.owner}/${source.repository}.wiki.git`;
    await mirrorRepository(wikiSourceUrl, repositoryRoot, wikiStorageKey, token);
    await getDb().insert(wikiImports).values({ repositoryId, storageKey: wikiStorageKey, sourceUrl: wikiSourceUrl }).onConflictDoUpdate({ target: wikiImports.repositoryId, set: { status: "ready", updatedAt: new Date() } });
  } catch {
    warnings.push("No GitHub wiki was available to move");
  }

  await getDb().insert(activityEvents).values({
    repositoryId,
    actorType: "system",
    actorName: "GitHub importer",
    type: "repository.imported",
    title: `Imported ${source.owner}/${source.repository}`,
    detail: warnings.length
      ? `Git history moved. ${warnings.join(". ")}.`
      : `${issueCount} issues, ${pullRequestCount} pull requests, ${commentCount} comments, and ${releaseCount} releases moved with the Git history.`,
    metadata: { warnings },
  });
  await getDb().insert(jobs).values({ type: "analyze-repository", payload: { repositoryId } });
  console.log(`Import ${job.id}: completed with ${warnings.length} warning(s)`);
  return { repositoryId, issues: issueCount, pullRequests: pullRequestCount, comments: commentCount, releases: releaseCount, warnings };
}

function isPrivateAddress(address: string) {
  const normalized = address.replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "0.0.0.0" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) return true;
  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false;
  return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) || (octets[0] === 192 && octets[1] === 168);
}

async function assertPublicWebhookUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) throw new Error("Webhook target is invalid");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Webhook targets may not resolve to private networks");
  return url;
}

async function deliverWebhookEvent(job: ClaimedJob) {
  const repositoryId = String(job.payload.repositoryId);
  const event = String(job.payload.event);
  const payload = (job.payload.payload ?? {}) as Record<string, unknown>;
  const hooks = await getDb().select().from(webhooks).where(and(eq(webhooks.repositoryId, repositoryId), eq(webhooks.active, true)));
  let delivered = 0;
  for (const hook of hooks.filter((item) => item.events.includes(event) || item.events.includes("*"))) {
    const [delivery] = await getDb().insert(webhookDeliveries).values({ webhookId: hook.id, event, payload }).returning();
    try {
      const url = await assertPublicWebhookUrl(hook.url);
      const body = JSON.stringify({ event, repositoryId, deliveryId: delivery!.id, ...payload });
      const secret = await decryptSecret(hook.secretEncrypted, requiredEnv("ORIGIN_ENCRYPTION_KEY"));
      const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
      const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/json", "User-Agent": "Origin-Hookshot/1", "X-Origin-Event": event, "X-Origin-Delivery": delivery!.id, "X-Origin-Signature-256": signature }, body });
      const responseBody = (await response.text()).slice(0, 2_000);
      await getDb().update(webhookDeliveries).set({ status: response.ok ? "delivered" : "failed", responseCode: response.status, responseBody, attempts: 1, deliveredAt: new Date(), updatedAt: new Date() }).where(eq(webhookDeliveries.id, delivery!.id));
      await getDb().update(webhooks).set({ lastDeliveryAt: new Date(), updatedAt: new Date() }).where(eq(webhooks.id, hook.id));
      if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
      delivered += 1;
    } catch (error) {
      await getDb().update(webhookDeliveries).set({ status: "failed", responseBody: safeError(error), attempts: 1, updatedAt: new Date() }).where(eq(webhookDeliveries.id, delivery!.id));
      await getDb().update(webhooks).set({ lastDeliveryAt: new Date(), updatedAt: new Date() }).where(eq(webhooks.id, hook.id));
    }
  }
  return { delivered, matched: hooks.length };
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
  await assertAiBudget(repository.organizationId);
  const { brain, usage } = await buildRepositoryBrain({ repositoryName: repository.name, readme: readme?.content, files });
  await chargeAiUsage(repository.organizationId, usage.totalTokens, "analyze-repository");
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
  await assertAiBudget(repository.organizationId);
  const { plan, usage } = await planRepositoryObjective({
    objective: run.objective,
    repositoryName: repository.name,
    readme: readme?.content,
    tree: tree.map((entry) => entry.path),
  });
  await chargeAiUsage(repository.organizationId, usage.totalTokens, "plan-agent-run");
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
  if (job.type === "deliver-webhook-event") return deliverWebhookEvent(job);
  if (job.type === "execute-agent-run") return executeAgentRun(job.payload, repositoryRoot, sandboxRoot);
  if (job.type === "review-agent-run") return reviewAgentRun(job.payload, repositoryRoot);
  if (job.type === "rollback-agent-run") return rollbackAgentRun(job.payload, repositoryRoot, sandboxRoot);
  if (job.type === "backup-repositories") return backupRepositories(job.payload, repositoryRoot, backupRoot);
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
