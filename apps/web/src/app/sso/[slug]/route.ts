import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, organizationSettings, organizations } from "@northstar/db";
import { absoluteUrl } from "@northstar/core";

async function discover(issuer: string) {
  const response = await fetch(new URL("/.well-known/openid-configuration", issuer), { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("OIDC discovery failed");
  return response.json() as Promise<{ authorization_endpoint: string; token_endpoint: string }>;
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const [row] = await getDb()
    .select({ organization: organizations, settings: organizationSettings })
    .from(organizations)
    .innerJoin(organizationSettings, eq(organizationSettings.organizationId, organizations.id))
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (!row?.settings.ssoEnabled || !row.settings.ssoIssuer || !row.settings.ssoClientId) {
    return NextResponse.redirect(absoluteUrl("/sign-in?error=Single%20sign-on%20is%20not%20enabled%20for%20that%20workspace"));
  }
  const discovery = await discover(row.settings.ssoIssuer);
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const cookieStore = await cookies();
  const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" };
  cookieStore.set("northstar_oidc_state", state, cookieOptions);
  cookieStore.set("northstar_oidc_nonce", nonce, cookieOptions);
  cookieStore.set("northstar_oidc_org", row.organization.id, cookieOptions);
  const authorize = new URL(discovery.authorization_endpoint);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", row.settings.ssoClientId);
  authorize.searchParams.set("redirect_uri", absoluteUrl("/api/auth/oidc/callback"));
  authorize.searchParams.set("scope", "openid email profile");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  return NextResponse.redirect(authorize);
}
