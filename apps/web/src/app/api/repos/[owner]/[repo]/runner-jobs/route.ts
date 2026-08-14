import { and, eq } from "drizzle-orm";
import { getDb, organizationMembers, organizations, repositories, runnerJobs } from "@origin/db";
import { getAccessTokenUser } from "@/lib/auth";

export async function POST(request: Request, context: { params: Promise<{ owner: string; repo: string }> }) {
  const user = await getAccessTokenUser(request);
  if (!user) return Response.json({ error: "A valid Origin access token is required" }, { status: 401 });
  const { owner, repo } = await context.params;
  const [row] = await getDb().select({ id: repositories.id }).from(repositories).innerJoin(organizations, eq(organizations.id, repositories.organizationId)).innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id)).where(and(eq(organizations.slug, owner), eq(repositories.slug, repo), eq(organizationMembers.userId, user.id))).limit(1);
  if (!row) return Response.json({ error: "Repository not found" }, { status: 404 });
  const body = await request.json() as { name?: string; labels?: string[]; payload?: Record<string, unknown> };
  if (!body.name) return Response.json({ error: "Job name is required" }, { status: 400 });
  const [job] = await getDb().insert(runnerJobs).values({ repositoryId: row.id, name: body.name.slice(0, 120), labels: body.labels ?? [], payload: body.payload ?? {} }).returning();
  return Response.json(job, { status: 201 });
}
