import { and, desc, eq } from "drizzle-orm";
import { commitStatuses, getDb, jobs, organizationMembers, organizations, repositories } from "@origin/db";
import { getAccessTokenUser } from "@/lib/auth";
import { getRepository } from "@/lib/data";

export async function GET(_request: Request, context: { params: Promise<{ owner: string; repo: string; sha: string }> }) {
  const { owner, repo, sha } = await context.params;
  const row = await getRepository(owner, repo);
  if (!row) return Response.json({ error: "Repository not found" }, { status: 404 });
  const records = await getDb().select().from(commitStatuses).where(and(eq(commitStatuses.repositoryId, row.repository.id), eq(commitStatuses.sha, sha))).orderBy(desc(commitStatuses.createdAt));
  const latest = new Map<string, typeof records[number]>();
  for (const record of records) if (!latest.has(record.context)) latest.set(record.context, record);
  return Response.json({ sha, statuses: [...latest.values()] });
}

export async function POST(request: Request, context: { params: Promise<{ owner: string; repo: string; sha: string }> }) {
  const user = await getAccessTokenUser(request);
  if (!user) return Response.json({ error: "A valid Origin access token is required" }, { status: 401 });
  const { owner, repo, sha } = await context.params;
  if (!/^[a-f0-9]{7,64}$/i.test(sha)) return Response.json({ error: "Commit SHA is invalid" }, { status: 400 });
  const [row] = await getDb().select({ repository: repositories, organization: organizations }).from(repositories).innerJoin(organizations, eq(organizations.id, repositories.organizationId)).innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id)).where(and(eq(organizations.slug, owner), eq(repositories.slug, repo), eq(organizationMembers.userId, user.id))).limit(1);
  if (!row) return Response.json({ error: "Repository not found" }, { status: 404 });
  const body = await request.json() as { context?: string; state?: string; description?: string; targetUrl?: string };
  if (!body.context || !new Set(["pending", "success", "failure", "error"]).has(body.state ?? "")) return Response.json({ error: "Context and a valid state are required" }, { status: 400 });
  const [status] = await getDb().insert(commitStatuses).values({ repositoryId: row.repository.id, sha, context: body.context.slice(0, 100), state: body.state!, description: (body.description ?? "").slice(0, 255), targetUrl: body.targetUrl?.slice(0, 2000), creatorName: user.username }).returning();
  await getDb().insert(jobs).values({ type: "deliver-webhook-event", payload: { repositoryId: row.repository.id, event: "status", payload: { sha, context: status!.context, state: status!.state } } });
  return Response.json(status, { status: 201 });
}
