import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { absoluteUrl, decryptSecret, requiredEnv, slugify } from "@northstar/core";
import { auditEvents, getDb, organizationMembers, organizationSettings, organizations, users } from "@northstar/db";
import { randomBytes } from "node:crypto";
import { hash } from "argon2";
import { createSession } from "@/lib/auth";

function decodeJwtPayload(token: string): Record<string, unknown> {
  const segments = token.split(".");
  if (segments.length !== 3) throw new Error("The identity token is malformed");
  return JSON.parse(Buffer.from(segments[1]!, "base64url").toString("utf8"));
}

function failure(message: string) {
  return NextResponse.redirect(absoluteUrl(`/sign-in?error=${encodeURIComponent(message)}`));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("northstar_oidc_state")?.value;
  const expectedNonce = cookieStore.get("northstar_oidc_nonce")?.value;
  const organizationId = cookieStore.get("northstar_oidc_org")?.value;
  for (const name of ["northstar_oidc_state", "northstar_oidc_nonce", "northstar_oidc_org"]) cookieStore.delete(name);
  if (!code || !state || !expectedState || state !== expectedState || !organizationId) return failure("The sign-on response could not be verified. Try again.");

  const [row] = await getDb()
    .select({ organization: organizations, settings: organizationSettings })
    .from(organizations)
    .innerJoin(organizationSettings, eq(organizationSettings.organizationId, organizations.id))
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!row?.settings.ssoEnabled || !row.settings.ssoIssuer || !row.settings.ssoClientId || !row.settings.ssoClientSecretEncrypted) {
    return failure("Single sign-on is not enabled for that workspace.");
  }

  const discovery = await fetch(new URL("/.well-known/openid-configuration", row.settings.ssoIssuer), { signal: AbortSignal.timeout(10_000) });
  if (!discovery.ok) return failure("The identity provider is unreachable.");
  const { token_endpoint: tokenEndpoint, issuer } = await discovery.json() as { token_endpoint: string; issuer?: string };
  const clientSecret = await decryptSecret(row.settings.ssoClientSecretEncrypted, requiredEnv("NORTHSTAR_ENCRYPTION_KEY"));
  const tokenResponse = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: absoluteUrl("/api/auth/oidc/callback"),
      client_id: row.settings.ssoClientId,
      client_secret: clientSecret,
    }),
  });
  if (!tokenResponse.ok) return failure("The identity provider rejected the sign-on.");
  const tokens = await tokenResponse.json() as { id_token?: string };
  if (!tokens.id_token) return failure("The identity provider returned no identity token.");

  // The token arrived directly from the issuer's token endpoint over TLS with
  // client authentication, so claim validation (not signature verification) is
  // the contract here, per OIDC Core 3.1.3.7 for confidential clients.
  const claims = decodeJwtPayload(tokens.id_token);
  const expectedIssuer = (issuer ?? row.settings.ssoIssuer).replace(/\/$/, "");
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (String(claims.iss).replace(/\/$/, "") !== expectedIssuer) return failure("The identity token issuer did not match.");
  if (!audience.includes(row.settings.ssoClientId)) return failure("The identity token audience did not match.");
  if (Number(claims.exp) * 1000 < Date.now()) return failure("The identity token is expired.");
  if (expectedNonce && claims.nonce !== expectedNonce) return failure("The identity token nonce did not match.");
  const email = String(claims.email ?? "").toLowerCase();
  const subject = `${expectedIssuer}#${String(claims.sub)}`;
  if (!email.includes("@")) return failure("The identity provider supplied no email address.");

  let [user] = await getDb().select().from(users).where(eq(users.ssoSubject, subject)).limit(1);
  if (!user) [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    const username = `${slugify(email.split("@")[0] ?? "member")}-${randomBytes(2).toString("hex")}`;
    const passwordHash = await hash(randomBytes(32).toString("base64url"));
    [user] = await getDb().insert(users).values({
      name: String(claims.name ?? email.split("@")[0]),
      email,
      username,
      passwordHash,
      ssoSubject: subject,
    }).returning();
  } else if (!user.ssoSubject) {
    await getDb().update(users).set({ ssoSubject: subject, updatedAt: new Date() }).where(eq(users.id, user.id));
  }
  const [membership] = await getDb().select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, user!.id))).limit(1);
  if (!membership) await getDb().insert(organizationMembers).values({ organizationId, userId: user!.id, role: "member" });
  await createSession(user!.id);
  await getDb().insert(auditEvents).values({ organizationId, actorName: user!.username, action: "session.sso_signed_in", target: email, metadata: { issuer: expectedIssuer } });
  return NextResponse.redirect(absoluteUrl("/"));
}
