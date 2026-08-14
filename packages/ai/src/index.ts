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

export type ProjectPlan = z.infer<typeof planSchema>;
export type RepositoryBrain = z.infer<typeof brainSchema>;

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
}): Promise<ProjectPlan> {
  if (!aiIsConfigured()) {
    return {
      summary: `Prepare and verify: ${input.objective}`,
      risk: "medium",
      acceptanceCriteria: ["The requested behavior is implemented", "Existing behavior remains covered", "Verification evidence is attached"],
      steps: [
        { step: "Inspect the affected paths", reason: "Build from the repository's actual structure.", verification: "Relevant files and dependencies are identified." },
        { step: "Implement the smallest complete change", reason: "Keep the review surface focused.", verification: "Acceptance criteria pass locally." },
        { step: "Review and prove the result", reason: "A change is not complete without evidence.", verification: "Tests, checks, and user-visible evidence are recorded." },
      ],
      likelyFiles: input.tree.slice(0, 8),
    };
  }

  const { output } = await generateText({
    model: model(),
    output: Output.object({ schema: planSchema }),
    system: "You are Origin's repository planner. Produce a concise, evidence-oriented implementation plan. Never claim to have inspected files that are absent from the supplied context. Prefer user-observable acceptance criteria over internal implementation trivia.",
    prompt: [
      `Repository: ${input.repositoryName}`,
      `Objective: ${input.objective}`,
      `Top-level tree:\n${input.tree.join("\n")}`,
      input.readme ? `README excerpt:\n${input.readme.slice(0, 12_000)}` : "No README is available.",
    ].join("\n\n"),
  });
  return output;
}

export async function buildRepositoryBrain(input: {
  repositoryName: string;
  readme?: string | null;
  files: Array<{ path: string; content: string }>;
}): Promise<RepositoryBrain> {
  if (!aiIsConfigured()) {
    return {
      purpose: input.readme?.split("\n").find((line) => line.trim() && !line.startsWith("#"))?.trim() ?? `${input.repositoryName} has not been analyzed yet. Add an AI Gateway key to build its living repository brain.`,
      architecture: input.files.slice(0, 5).map((file) => ({ title: file.path, detail: "Detected as a project-defining file.", sourcePath: file.path })),
      conventions: [{ title: "Evidence before merge", detail: "Attach tests and user-visible proof to every agent-authored change.", sourcePath: null }],
      risks: [{ title: "AI provider not configured", detail: "Origin is showing a deterministic local summary. Configure AI_GATEWAY_API_KEY for semantic analysis.", sourcePath: null }],
      suggestedQuestions: ["Where does the application start?", "How is this project tested?", "Which areas carry the most change risk?"],
    };
  }

  const context = input.files.map((file) => `--- ${file.path} ---\n${file.content.slice(0, 16_000)}`).join("\n\n");
  const { output } = await generateText({
    model: model(),
    output: Output.object({ schema: brainSchema }),
    system: "You maintain the living memory of a software repository. Infer only from supplied files. Cite a sourcePath whenever a statement comes from a file. Explain architecture in clear product and engineering language. Surface uncertainty as a risk.",
    prompt: `Repository: ${input.repositoryName}\n\nREADME:\n${input.readme?.slice(0, 16_000) ?? "None"}\n\nProject files:\n${context}`,
  });
  return output;
}
