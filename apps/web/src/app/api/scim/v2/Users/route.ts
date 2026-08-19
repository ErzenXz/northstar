import { randomBytes } from "node:crypto";
import { hash } from "argon2";
import { and, eq } from "drizzle-orm";
import { slugify } from "@northstar/core";
import { auditEvents, getDb, organizationMembers, users } from "@northstar/db";
import { authenticateScim, scimError, scimUser } from "@/lib/scim";

export async function GET(request: Request) {
  const context = await authenticateScim(request);
  if (!context) return scimError(401, "A valid SCIM bearer token is required");
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter");
  const members = await getDb()
    .select({ id: users.id, username: users.username, email: users.email, name: users.name, createdAt: users.createdAt })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(eq(organizationMembers.organizationId, context.organization.id));
  const emailMatch = filter?.match(/userName\s+eq\s+"([^"]+)"/i);
  const results = emailMatch ? members.filter((member) => member.email.toLowerCase() === emailMatch[1]!.toLowerCase()) : members;
  return Response.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: results.length,
    startIndex: 1,
    itemsPerPage: results.length,
    Resources: results.map((member) => scimUser(member)),
  });
}

export async function POST(request: Request) {
  const context = await authenticateScim(request);
  if (!context) return scimError(401, "A valid SCIM bearer token is required");
  const body = await request.json().catch(() => null) as { userName?: string; displayName?: string; name?: { formatted?: string }; emails?: Array<{ value?: string; primary?: boolean }> } | null;
  const email = (body?.emails?.find((entry) => entry.primary)?.value ?? body?.emails?.[0]?.value ?? body?.userName ?? "").toLowerCase();
  if (!email.includes("@")) return scimError(400, "userName must be an email address");
  let [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    const username = `${slugify(email.split("@")[0] ?? "member")}-${randomBytes(2).toString("hex")}`;
    const passwordHash = await hash(randomBytes(32).toString("base64url"));
    [user] = await getDb().insert(users).values({
      name: body?.displayName ?? body?.name?.formatted ?? email.split("@")[0]!,
      email,
      username,
      passwordHash,
    }).returning();
  }
  const [membership] = await getDb().select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, context.organization.id), eq(organizationMembers.userId, user!.id))).limit(1);
  if (!membership) await getDb().insert(organizationMembers).values({ organizationId: context.organization.id, userId: user!.id, role: "member" });
  await getDb().insert(auditEvents).values({ organizationId: context.organization.id, actorName: "scim", action: "scim.user_provisioned", target: email });
  return Response.json(scimUser(user!), { status: 201 });
}
