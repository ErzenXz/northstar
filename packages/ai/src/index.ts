import { Output, gateway, generateText } from "ai";
import { z } from "zod";

const planSchema = z.object({
  summary: z.string().min(1),
  risk: z.enum(["low", "medium", "high"]),
  acceptanceCriteria: z.array(z.string()).min(1).max(8),
  steps: z.array(z.object({
    step: z.string().min(1),
    reason: z.string().min(1),
    verification: z.string().min(1),
  })).min(1).max(10),
  likelyFiles: z.array(z.string()).max(20),
});

const brainSchema = z.object({
  purpose: z.string().min(1),
  architecture: z.array(z.object({ title: z.string(), detail: z.string(), sourcePath: z.string().nullable() })).max(12),
  conventions: z.array(z.object({ title: z.string(), detail: z.string(), sourcePath: z.string().nullable() })).max(12),
  risks: z.array(z.object({ title: z.string(), detail: z.string(), sourcePath: z.string().nullable() })).max(12),
  suggestedQuestions: z.array(z.string()).max(6),
});

const changeSchema = z.object({
  summary: z.string().min(1),
  commitMessage: z.string().min(1).max(120),
  files: z.array(z.object({
    path: z.string().min(1),
    action: z.enum(["write", "delete"]),
    content: z.string(),
    reason: z.string().min(1),
  })).min(1).max(12),
});

const reviewSchema = z.object({
  verdict: z.enum(["approve", "block"]),
  summary: z.string().min(1),
  concerns: z.array(z.string()).max(10),
});

export type ProjectPlan = z.infer<typeof planSchema>;
export type RepositoryBrain = z.infer<typeof brainSchema>;
export type ProposedChange = z.infer<typeof changeSchema>;
export type PatchReview = z.infer<typeof reviewSchema>;
export type AiUsage = { totalTokens: number };

function model() {
  return gateway(process.env.AI_MODEL ?? "openai/gpt-5.6-terra");
}

export function aiIsConfigured() {
  return Boolean(process.env.AI_GATEWAY_API_KEY);
}

export async function planRepositoryObjective(input: {
  objective: string;
  repositoryName: string;
  readme?: string | null;
  tree: string[];
}): Promise<{ plan: ProjectPlan; usage: AiUsage }> {
  if (!aiIsConfigured()) {
    return {
      plan: {
        summary: `Prepare and verify: ${input.objective}`,
        risk: "medium",
        acceptanceCriteria: ["The requested behavior is implemented", "Existing behavior remains covered", "Verification evidence is attached"],
        steps: [
          { step: "Inspect the affected paths", reason: "Build from the repository's actual structure.", verification: "Relevant files and dependencies are identified." },
          { step: "Implement the smallest complete change", reason: "Keep the review surface focused.", verification: "Acceptance criteria pass locally." },
          { step: "Review and prove the result", reason: "A change is not complete without evidence.", verification: "Tests, checks, and user-visible evidence are recorded." },
        ],
        likelyFiles: input.tree.slice(0, 8),
      },
      usage: { totalTokens: 0 },
    };
  }

  const { output, usage } = await generateText({
    model: model(),
    output: Output.object({ schema: planSchema }),
    system: "You are Northstar's repository planner. Produce a concise, evidence-oriented implementation plan. Never claim to have inspected files that are absent from the supplied context. Prefer user-observable acceptance criteria over internal implementation trivia.",
    prompt: [
      `Repository: ${input.repositoryName}`,
      `Objective: ${input.objective}`,
      `Top-level tree:\n${input.tree.join("\n")}`,
      input.readme ? `README excerpt:\n${input.readme.slice(0, 12_000)}` : "No README is available.",
    ].join("\n\n"),
  });
  return { plan: output, usage: { totalTokens: usage?.totalTokens ?? 0 } };
}

export async function implementObjectiveChange(input: {
  objective: string;
  repositoryName: string;
  plan: Array<{ step: string }>;
  acceptance: string;
  files: Array<{ path: string; content: string }>;
  tree: string[];
}): Promise<{ change: ProposedChange; usage: AiUsage }> {
  if (!aiIsConfigured()) {
    const slug = input.objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "objective";
    const record = [
      `# Objective record: ${input.objective}`,
      "",
      "Northstar executed this run without an AI provider key, so the sandbox recorded",
      "the approved objective and plan as a reviewable in-repository work order",
      "instead of generating code. Configure AI_GATEWAY_API_KEY for implemented changes.",
      "",
      "## Approved plan",
      ...input.plan.map((item, index) => `${index + 1}. ${item.step}`),
      "",
      "## Acceptance criteria",
      input.acceptance,
      "",
    ].join("\n");
    return {
      change: {
        summary: "Recorded the approved objective as an in-repository work order (deterministic no-key fallback).",
        commitMessage: `Record objective: ${input.objective.slice(0, 80)}`,
        files: [{ path: `.northstar/objectives/${slug}.md`, action: "write", content: record, reason: "Deterministic fallback keeps the approved objective auditable inside the repository." }],
      },
      usage: { totalTokens: 0 },
    };
  }

  const context = input.files.map((file) => `--- ${file.path} ---\n${file.content.slice(0, 12_000)}`).join("\n\n");
  const { output, usage } = await generateText({
    model: model(),
    output: Output.object({ schema: changeSchema }),
    system: "You implement one approved change inside an isolated Git workspace. Only write complete file contents for files you change or create. Never touch paths you were not shown or that the plan does not require. Keep the change minimal and production-quality, matching the repository's conventions.",
    prompt: [
      `Repository: ${input.repositoryName}`,
      `Objective: ${input.objective}`,
      `Approved plan:\n${input.plan.map((item, index) => `${index + 1}. ${item.step}`).join("\n")}`,
      `Acceptance criteria: ${input.acceptance}`,
      `Repository tree:\n${input.tree.slice(0, 400).join("\n")}`,
      `Relevant files:\n${context || "No file contents were supplied."}`,
    ].join("\n\n"),
  });
  return { change: output, usage: { totalTokens: usage?.totalTokens ?? 0 } };
}

export async function reviewAgentPatch(input: {
  objective: string;
  repositoryName: string;
  patch: string;
  changedFiles: Array<{ path: string; additions: number; deletions: number }>;
  blockedPaths: string[];
  maxChangedFiles: number;
}): Promise<{ review: PatchReview; usage: AiUsage }> {
  const violations: string[] = [];
  for (const file of input.changedFiles) {
    if (input.blockedPaths.some((blocked) => blocked && file.path.startsWith(blocked.replace(/^\/+/, "")))) {
      violations.push(`Touches policy-blocked path: ${file.path}`);
    }
  }
  if (input.changedFiles.length > input.maxChangedFiles) {
    violations.push(`Changes ${input.changedFiles.length} files; the policy limit is ${input.maxChangedFiles}`);
  }
  if (violations.length) {
    return { review: { verdict: "block", summary: "The patch violates this repository's policy gates.", concerns: violations }, usage: { totalTokens: 0 } };
  }
  if (!aiIsConfigured()) {
    return {
      review: {
        verdict: "approve",
        summary: "Deterministic policy review passed: the patch stays inside allowed paths and under the change-size limit. Configure AI_GATEWAY_API_KEY for semantic review.",
        concerns: [],
      },
      usage: { totalTokens: 0 },
    };
  }
  const { output, usage } = await generateText({
    model: model(),
    output: Output.object({ schema: reviewSchema }),
    system: "You are an independent review agent. You did not write this patch. Block anything that is destructive, off-objective, security-sensitive without justification, or that fabricates results. Approve focused patches that plausibly serve the objective. Be specific in concerns.",
    prompt: [
      `Repository: ${input.repositoryName}`,
      `Objective the patch claims to serve: ${input.objective}`,
      `Changed files:\n${input.changedFiles.map((file) => `${file.path} (+${file.additions} −${file.deletions})`).join("\n")}`,
      `Patch:\n${input.patch.slice(0, 60_000)}`,
    ].join("\n\n"),
  });
  return { review: output, usage: { totalTokens: usage?.totalTokens ?? 0 } };
}

export async function buildRepositoryBrain(input: {
  repositoryName: string;
  readme?: string | null;
  files: Array<{ path: string; content: string }>;
}): Promise<{ brain: RepositoryBrain; usage: AiUsage }> {
  if (!aiIsConfigured()) {
    return {
      brain: {
        purpose: input.readme?.split("\n").find((line) => line.trim() && !line.startsWith("#"))?.trim() ?? `${input.repositoryName} has not been analyzed yet. Add an AI Gateway key to build its living repository brain.`,
        architecture: input.files.slice(0, 5).map((file) => ({ title: file.path, detail: "Detected as a project-defining file.", sourcePath: file.path })),
        conventions: [{ title: "Evidence before merge", detail: "Attach tests and user-visible proof to every agent-authored change.", sourcePath: null }],
        risks: [{ title: "AI provider not configured", detail: "Northstar is showing a deterministic local summary. Configure AI_GATEWAY_API_KEY for semantic analysis.", sourcePath: null }],
        suggestedQuestions: ["Where does the application start?", "How is this project tested?", "Which areas carry the most change risk?"],
      },
      usage: { totalTokens: 0 },
    };
  }

  const context = input.files.map((file) => `--- ${file.path} ---\n${file.content.slice(0, 16_000)}`).join("\n\n");
  const { output, usage } = await generateText({
    model: model(),
    output: Output.object({ schema: brainSchema }),
    system: "You maintain the living memory of a software repository. Infer only from supplied files. Cite a sourcePath whenever a statement comes from a file. Explain architecture in clear product and engineering language. Surface uncertainty as a risk.",
    prompt: `Repository: ${input.repositoryName}\n\nREADME:\n${input.readme?.slice(0, 16_000) ?? "None"}\n\nProject files:\n${context}`,
  });
  return { brain: output, usage: { totalTokens: usage?.totalTokens ?? 0 } };
}
