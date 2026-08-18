import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, organizationSettings, organizations, type User } from "@origin/db";

export async function authenticateScim(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer scim_")) return null;
  const tokenHash = createHash("sha256").update(authorization.slice(7).trim()).digest("hex");
  const [row] = await getDb()
    .select({ organization: organizations, settings: organizationSettings })
    .from(organizationSettings)
    .innerJoin(organizations, eq(organizations.id, organizationSettings.organizationId))
    .where(eq(organizationSettings.scimTokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

export function scimUser(user: Pick<User, "id" | "username" | "email" | "name" | "createdAt">, active = true) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: user.id,
    userName: user.email,
    displayName: user.name,
    emails: [{ value: user.email, primary: true }],
    active,
    meta: { resourceType: "User", created: user.createdAt.toISOString() },
  };
}

export function scimError(status: number, detail: string) {
  return Response.json({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: String(status), detail }, { status });
}
