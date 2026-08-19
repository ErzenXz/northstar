import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, runnerJobs, runners } from "@northstar/db";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer nsr_")) return Response.json({ error: "Runner authentication failed" }, { status: 401 });
  const hash = createHash("sha256").update(authorization.slice(7).trim()).digest("hex");
  const [runner] = await getDb().select().from(runners).where(eq(runners.tokenHash, hash)).limit(1);
  if (!runner) return Response.json({ error: "Runner authentication failed" }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json() as { status?: string; result?: Record<string, unknown> };
  const status = body.status === "failed" ? "failed" : "completed";
  const [job] = await getDb().update(runnerJobs).set({ status, result: body.result ?? {}, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(runnerJobs.id, id), eq(runnerJobs.runnerId, runner.id), eq(runnerJobs.status, "running"))).returning();
  if (!job) return Response.json({ error: "Claimed job not found" }, { status: 404 });
  await getDb().update(runners).set({ status: "online", lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(runners.id, runner.id));
  return Response.json({ job });
}
