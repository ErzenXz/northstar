import { NextResponse, type NextRequest } from "next/server";

const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "install", "docs", "status", "mail", "assets"]);

/**
 * Hosted-tenant subdomain routing. With NORTHSTAR_TENANT_DOMAIN=example.dev,
 * acme.example.dev/aurora serves the acme workspace's aurora repository.
 * The apex domain and reserved subdomains behave normally, and the community
 * edition (no tenant domain configured) is untouched.
 */
export function middleware(request: NextRequest) {
  const tenantDomain = process.env.NORTHSTAR_TENANT_DOMAIN;
  if (!tenantDomain) return NextResponse.next();
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
  if (!host || host === tenantDomain || !host.endsWith(`.${tenantDomain}`)) return NextResponse.next();
  const workspace = host.slice(0, -(tenantDomain.length + 1));
  if (!workspace || workspace.includes(".") || RESERVED_SUBDOMAINS.has(workspace)) return NextResponse.next();
  const url = request.nextUrl.clone();
  if (url.pathname === "/") {
    // A workspace has no standalone landing page yet; hand off to the apex.
    url.hostname = tenantDomain;
    return NextResponse.redirect(url);
  }
  if (url.pathname === `/${workspace}` || url.pathname.startsWith(`/${workspace}/`)) return NextResponse.next();
  url.pathname = `/${workspace}${url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/|api/|favicon.ico|sign-in|sign-up|sso/|settings/|ops|import|new).*)"],
};
