import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { accessTokens, getDb, sessions, users } from "@northstar/db";

const SESSION_COOKIE = "northstar_session";
const SESSION_DAYS = 30;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await getDb().insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await getDb().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [user] = await getDb()
    .select({ id: users.id, name: users.name, username: users.username, email: users.email, avatarUrl: users.avatarUrl, admin: users.admin })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return user ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!user.admin) redirect("/");
  return user;
}

export async function getAccessTokenUser(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token.startsWith("nst_")) return null;
  const tokenHash = hashToken(token);
  const [row] = await getDb().select({ tokenId: accessTokens.id, expiresAt: accessTokens.expiresAt, id: users.id, name: users.name, username: users.username, email: users.email }).from(accessTokens).innerJoin(users, eq(users.id, accessTokens.userId)).where(eq(accessTokens.tokenHash, tokenHash)).limit(1);
  if (!row || (row.expiresAt && row.expiresAt < new Date())) return null;
  await getDb().update(accessTokens).set({ lastUsedAt: new Date() }).where(eq(accessTokens.id, row.tokenId));
  return row;
}
