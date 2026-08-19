import { and, eq } from "drizzle-orm";
import { auditEvents, getDb, organizationMembers, users } from "@northstar/db";
import { authenticateScim, scimError, scimUser } from "@/lib/scim";

async function loadMember(organizationId: string, userId: string) {
  const [member] = await getDb()
    .select({ id: users.id, username: users.username, email: users.email, name: users.name, createdAt: users.createdAt })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
    .limit(1);
  return member ?? null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(request);
  if (!auth) return scimError(401, "A valid SCIM bearer token is required");
  const { id } = await context.params;
  const member = await loadMember(auth.organization.id, id);
  if (!member) return scimError(404, "User is not a member of this workspace");
  return Response.json(scimUser(member));
}

async function deactivate(organizationId: string, userId: string) {
  await getDb().delete(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)));
  await getDb().insert(auditEvents).values({ organizationId, actorName: "scim", action: "scim.user_deprovisioned", target: userId });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(request);
  if (!auth) return scimError(401, "A valid SCIM bearer token is required");
  const { id } = await context.params;
  const member = await loadMember(auth.organization.id, id);
  if (!member) return scimError(404, "User is not a member of this workspace");
  const body = await request.json().catch(() => null) as { Operations?: Array<{ op?: string; path?: string; value?: unknown }> } | null;
  const deactivated = body?.Operations?.some((operation) => {
    const value = operation.value as { active?: boolean } | boolean | string | undefined;
    const active = typeof value === "object" && value !== null ? value.active : value;
    return operation.op?.toLowerCase() === "replace" && (operation.path === "active" || operation.path === undefined) && (active === false || active === "False" || active === "false");
  });
  if (deactivated) {
    await deactivate(auth.organization.id, id);
    return Response.json(scimUser(member, false));
  }
  return Response.json(scimUser(member));
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(request);
  if (!auth) return scimError(401, "A valid SCIM bearer token is required");
  const { id } = await context.params;
  const member = await loadMember(auth.organization.id, id);
  if (!member) return scimError(404, "User is not a member of this workspace");
  await deactivate(auth.organization.id, id);
  return new Response(null, { status: 204 });
}
