import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, organizationMembers, organizations, runners } from "@origin/db";
import { getAccessTokenUser } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await getAccessTokenUser(request);
  if (!user) return Response.json({ error: "A valid Origin access token is required" }, { status: 401 });
  const body = await request.json() as { organization?: string; name?: string; labels?: string[]; version?: string };
  if (!body.organization || !body.name) return Response.json({ error: "Organization and runner name are required" }, { status: 400 });
  const [organization] = await getDb().select({ id: organizations.id }).from(organizations).innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id)).where(and(eq(organizations.slug, body.organization), eq(organizationMembers.userId, user.id))).limit(1);
  if (!organization) return Response.json({ error: "Organization not found" }, { status: 404 });
  const token = `orr_${randomBytes(32).toString("base64url")}`;
  const [runner] = await getDb().insert(runners).values({ organizationId: organization.id, name: body.name.slice(0, 120), labels: body.labels ?? [], version: body.version, tokenHash: createHash("sha256").update(token).digest("hex") }).returning();
  return Response.json({ id: runner!.id, token, pollUrl: "/api/runners/jobs/claim" }, { status: 201 });
}
