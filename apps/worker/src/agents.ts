import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { implementObjectiveChange, reviewAgentPatch } from "@origin/ai";
import {
  activityEvents,
  agentReviews,
  agentRuns,
  commitStatuses,
  evidenceArtifacts,
  getDb,
  incidents,
  jobs,
  policyGates,
  pullRequests,
  repositories,
} from "@origin/db";
import {
  commitWorkspace,
  compareBranches,
  createWorkspace,
  listTree,
  pushWorkspaceBranch,
  workspaceDiff,
} from "@origin/git";
import { and, eq, max } from "drizzle-orm";
import { assertAiBudget, chargeAiUsage } from "./billing";
import { detectIsolation, runSandboxed } from "./sandbox";

const AGENT_ACTOR = { name: "Origin Agent", email: "agent@origin.local" };

export async function ensurePolicyGates(repositoryId: string) {
  await getDb().insert(policyGates).values({ repositoryId }).onConflictDoNothing();
  const [gates] = await getDb().select().from(policyGates).where(eq(policyGates.repositoryId, repositoryId)).limit(1);
  if (!gates) throw new Error("Policy gates are unavailable");
  return gates;
}

function safeWorkspacePath(workdir: string, relativePath: string, blockedPaths: string[]) {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0") || normalized.length > 500) throw new Error(`Proposed path is invalid: ${relativePath}`);
  const segments = normalized.split("/");
  if (segments.includes("..") || segments.includes(".git")) throw new Error(`Proposed path escapes the workspace: ${relativePath}`);
  for (const blocked of blockedPaths) {
    const prefix = blocked.replace(/^\/+/, "");
    if (prefix && normalized.startsWith(prefix)) throw new Error(`Policy gates block writes under ${blocked}`);
  }
  const absolute = resolve(workdir, normalized);
  if (absolute !== workdir && !absolute.startsWith(`${workdir}${sep}`)) throw new Error(`Proposed path escapes the workspace: ${relativePath}`);
  return absolute;
}

async function addEvidence(agentRunId: string, kind: string, title: string, content: string, metadata: Record<string, unknown> = {}) {
  await getDb().insert(evidenceArtifacts).values({ agentRunId, kind, title, content: content.slice(0, 200_000), metadata });
}

async function raiseIncident(repositoryId: string, agentRunId: string | null, kind: string, title: string, detail: string) {
  await getDb().insert(incidents).values({ repositoryId, agentRunId, kind, title, detail });
  await getDb().insert(activityEvents).values({
    repositoryId,
    actorType: "system",
    actorName: "Origin sentinel",
    type: "incident.opened",
    title,
    detail,
  });
}

export async function executeAgentRun(payload: Record<string, unknown>, repositoryRoot: string, sandboxRoot: string) {
  const runId = String(payload.runId);
  const [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  if (!run) throw new Error("Agent run no longer exists");
  if (run.status !== "approved") throw new Error(`Agent run is ${run.status}, not approved for execution`);
  const [repository] = await getDb().select().from(repositories).where(eq(repositories.id, run.repositoryId)).limit(1);
  if (!repository) throw new Error("Repository no longer exists");
  const gates = await ensurePolicyGates(repository.id);
  await getDb().update(agentRuns).set({ status: "executing", updatedAt: new Date() }).where(eq(agentRuns.id, runId));

  const workdir = await createWorkspace(repositoryRoot, repository.storageKey, repository.defaultBranch, sandboxRoot);
  try {
    await mkdir(resolve(workdir, ".tmp"), { recursive: true });
    const isolation = await detectIsolation(gates.allowNetwork);
    await addEvidence(runId, "sandbox", "Sandbox profile", [
      `Workspace: disposable clone of ${repository.defaultBranch}`,
      `Network policy: ${gates.allowNetwork ? "allowed by repository policy" : "denied"}`,
      `Isolation mechanism: ${isolation}`,
      "Write scope: workspace only; publishes to an agent/* branch, never the default branch",
    ].join("\n"), { isolation, allowNetwork: gates.allowNetwork });

    await assertAiBudget(repository.organizationId);
    const likelyPaths = run.evidence.filter((item) => item.label === "Likely path").map((item) => item.value).slice(0, 8);
    const files: Array<{ path: string; content: string }> = [];
    for (const path of likelyPaths) {
      try {
        const absolute = safeWorkspacePath(workdir, path, gates.blockedPaths);
        files.push({ path, content: (await readFile(absolute, "utf8")).slice(0, 12_000) });
      } catch {
        // Planned paths may not exist yet; the implementer sees the tree instead.
      }
    }
    const tree = await listTree(repositoryRoot, repository.storageKey, repository.defaultBranch).catch(() => []);
    const acceptance = run.summary?.split("Acceptance:")[1]?.trim() ?? "The objective is met and verifiable.";
    const { change, usage } = await implementObjectiveChange({
      objective: run.objective,
      repositoryName: repository.name,
      plan: run.plan,
      acceptance,
      files,
      tree: tree.map((entry) => entry.path),
    });
    await chargeAiUsage(repository.organizationId, usage.totalTokens, "execute-agent-run");

    for (const file of change.files) {
      const absolute = safeWorkspacePath(workdir, file.path, gates.blockedPaths);
      if (file.action === "delete") {
        await unlink(absolute).catch(() => undefined);
      } else {
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, file.content, "utf8");
      }
    }

    const diff = await workspaceDiff(workdir);
    if (!diff.files.length) throw new Error("The sandbox produced no change to publish");
    await addEvidence(runId, "patch", `Proposed patch (${diff.files.length} files)`, diff.patch, {
      files: diff.files,
      summary: change.summary,
    });

    if (gates.runTests) {
      let testCommand: string[] | null = null;
      try {
        const manifest = JSON.parse(await readFile(resolve(workdir, "package.json"), "utf8")) as { scripts?: Record<string, string> };
        if (manifest.scripts?.test) testCommand = ["npm", "test", "--silent"];
      } catch {
        // No Node manifest; other ecosystems can be wired through runner labels.
      }
      if (testCommand) {
        const result = await runSandboxed({ workdir, command: testCommand, allowNetwork: gates.allowNetwork, timeoutMs: 180_000 });
        await addEvidence(
          runId,
          "test",
          `Test command ${result.timedOut ? "timed out" : `exited ${result.exitCode}`}`,
          [`$ ${testCommand.join(" ")}`, result.stdout, result.stderr].filter(Boolean).join("\n"),
          { exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs, isolation: result.isolation },
        );
      } else {
        await addEvidence(runId, "test", "No test command detected", "The workspace has no package.json test script. Wire repository checks through commit statuses or a runner for deeper verification.");
      }
    }

    const branch = `agent/run-${runId.slice(0, 8)}`;
    const headSha = await commitWorkspace(workdir, change.commitMessage, AGENT_ACTOR);
    await pushWorkspaceBranch(workdir, branch);

    const comparison = await compareBranches(repositoryRoot, repository.storageKey, repository.defaultBranch, branch);
    const [current] = await getDb().select({ number: max(pullRequests.number) }).from(pullRequests).where(eq(pullRequests.repositoryId, repository.id));
    const pullNumber = (current?.number ?? 0) + 1;
    await getDb().insert(pullRequests).values({
      repositoryId: repository.id,
      number: pullNumber,
      title: change.commitMessage,
      body: `${change.summary}\n\nObjective: ${run.objective}\n\nThis change was produced in a disposable sandbox and carries evidence artifacts on agent run ${runId.slice(0, 8)}. Merge requires the independent review gate and a human approval.`,
      authorName: "origin-agent",
      headBranch: branch,
      baseBranch: repository.defaultBranch,
      headSha: comparison.headSha,
      baseSha: comparison.baseSha,
      additions: comparison.additions,
      deletions: comparison.deletions,
      changedFiles: comparison.files.length,
    });

    await getDb().update(agentRuns).set({
      status: "reviewing",
      branch,
      headSha,
      baseSha: comparison.baseSha,
      pullRequestNumber: pullNumber,
      updatedAt: new Date(),
    }).where(eq(agentRuns.id, runId));
    await getDb().insert(jobs).values({ type: "review-agent-run", payload: { runId } });
    await getDb().insert(activityEvents).values({
      repositoryId: repository.id,
      actorType: "agent",
      actorName: "Origin builder",
      type: "agent.executed",
      title: `Published change #${pullNumber} for review`,
      detail: `${diff.files.length} files changed on ${branch}. Independent review is queued.`,
    });
    return { runId, branch, pullNumber, files: diff.files.length };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await getDb().update(agentRuns).set({ status: "failed", error: detail.slice(0, 2_000), updatedAt: new Date() }).where(eq(agentRuns.id, runId));
    await raiseIncident(repository.id, runId, "agent.execution_failed", `Agent execution failed: ${run.objective.slice(0, 80)}`, detail.slice(0, 2_000));
    throw error;
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function reviewAgentRun(payload: Record<string, unknown>, repositoryRoot: string) {
  const runId = String(payload.runId);
  const [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  if (!run) throw new Error("Agent run no longer exists");
  if (run.status !== "reviewing" || !run.branch) throw new Error(`Agent run is ${run.status}, not awaiting review`);
  const [repository] = await getDb().select().from(repositories).where(eq(repositories.id, run.repositoryId)).limit(1);
  if (!repository) throw new Error("Repository no longer exists");
  const gates = await ensurePolicyGates(repository.id);

  const comparison = await compareBranches(repositoryRoot, repository.storageKey, repository.defaultBranch, run.branch);
  await assertAiBudget(repository.organizationId).catch(() => undefined);
  const { review, usage } = await reviewAgentPatch({
    objective: run.objective,
    repositoryName: repository.name,
    patch: comparison.files.map((file) => file.patch).join("\n"),
    changedFiles: comparison.files.map((file) => ({ path: file.path, additions: file.additions, deletions: file.deletions })),
    blockedPaths: gates.blockedPaths,
    maxChangedFiles: gates.maxChangedFiles,
  });
  await chargeAiUsage(repository.organizationId, usage.totalTokens, "review-agent-run");

  await getDb().insert(agentReviews).values({ agentRunId: runId, verdict: review.verdict, summary: review.summary, concerns: review.concerns });
  await addEvidence(runId, "review", `Independent review: ${review.verdict}`, [review.summary, ...review.concerns.map((concern) => `• ${concern}`)].join("\n"), { verdict: review.verdict });
  if (gates.requireAgentReview) {
    await getDb().insert(commitStatuses).values({
      repositoryId: repository.id,
      sha: comparison.headSha,
      context: "origin/review-agent",
      state: review.verdict === "approve" ? "success" : "failure",
      description: review.summary.slice(0, 130),
      creatorName: "origin-review-agent",
    });
  }

  if (review.verdict === "approve") {
    await getDb().update(agentRuns).set({ status: "executed", executedAt: new Date(), completedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, runId));
    await getDb().insert(activityEvents).values({
      repositoryId: repository.id,
      actorType: "agent",
      actorName: "Origin review agent",
      type: "agent.review_passed",
      title: `Independent review passed for change #${run.pullRequestNumber}`,
      detail: `${review.summary} A human approval is still required to merge.`,
    });
  } else {
    await getDb().update(agentRuns).set({ status: "blocked", error: review.summary.slice(0, 2_000), completedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, runId));
    await raiseIncident(repository.id, runId, "agent.review_blocked", `Review agent blocked change #${run.pullRequestNumber}`, [review.summary, ...review.concerns].join("\n").slice(0, 2_000));
  }
  return { runId, verdict: review.verdict };
}

export async function rollbackAgentRun(payload: Record<string, unknown>, repositoryRoot: string, sandboxRoot: string) {
  const runId = String(payload.runId);
  const actorName = String(payload.actorName ?? "origin");
  const [run] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  if (!run) throw new Error("Agent run no longer exists");
  const [repository] = await getDb().select().from(repositories).where(eq(repositories.id, run.repositoryId)).limit(1);
  if (!repository) throw new Error("Repository no longer exists");
  if (!run.pullRequestNumber) throw new Error("This run never published a change");
  const [pull] = await getDb().select().from(pullRequests).where(and(eq(pullRequests.repositoryId, repository.id), eq(pullRequests.number, run.pullRequestNumber))).limit(1);
  if (!pull?.mergeCommitSha) throw new Error("The change is not merged, so there is nothing to roll back");

  const { revertCommit } = await import("@origin/git");
  const revertSha = await revertCommit(repositoryRoot, repository.storageKey, pull.baseBranch, pull.mergeCommitSha, AGENT_ACTOR, sandboxRoot);
  await getDb().update(agentRuns).set({ status: "rolled_back", rolledBackAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, runId));
  await addEvidence(runId, "log", "Rollback executed", `Revert commit ${revertSha} restored ${pull.baseBranch} ahead of merge ${pull.mergeCommitSha}. Requested by ${actorName}.`);
  await raiseIncident(repository.id, runId, "agent.rolled_back", `Rolled back change #${pull.number}`, `Revert commit ${revertSha} on ${pull.baseBranch}, requested by ${actorName}.`);
  return { runId, revertSha };
}
