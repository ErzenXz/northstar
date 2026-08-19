import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb, runners } from "@northstar/db";

async function runnerFor(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer nsr_")) return null;
  const hash = createHash("sha256").update(authorization.slice(7).trim()).digest("hex");
  const [runner] = await getDb().select().from(runners).where(eq(runners.tokenHash, hash)).limit(1);
  return runner ?? null;
}

export async function POST(request: Request) {
  const runner = await runnerFor(request);
  if (!runner) return Response.json({ error: "Runner authentication failed" }, { status: 401 });
  const job = await getDb().transaction(async (tx) => {
    const rows = await tx.execute<Record<string, unknown>>(sql`
      WITH candidate AS (
        SELECT rj.id FROM runner_jobs rj
        JOIN repositories r ON r.id = rj.repository_id
        WHERE rj.status = 'queued'
          AND r.organization_id = ${runner.organizationId}
          AND (rj.labels = '[]'::jsonb OR rj.labels <@ ${JSON.stringify(runner.labels)}::jsonb)
        ORDER BY rj.created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE runner_jobs SET status = 'running', runner_id = ${runner.id}, started_at = now(), updated_at = now()
      WHERE id IN (SELECT id FROM candidate)
      RETURNING id, repository_id, name, labels, payload, created_at
    `);
    return rows[0] ?? null;
  });
  await getDb().update(runners).set({ status: job ? "busy" : "online", lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(runners.id, runner.id));
  return job ? Response.json({ job }) : new Response(null, { status: 204 });
}
