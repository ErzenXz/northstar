import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { join, resolve } from "node:path";
import Fastify from "fastify";
import { and, eq } from "drizzle-orm";
import { accessTokens, activityEvents, getDb, organizationMembers, organizations, repositories, users } from "@origin/db";
import { resolveRepositoryPath } from "@origin/git";

const app = Fastify({ logger: true, bodyLimit: 250 * 1024 * 1024 });
const repositoryRoot = resolve(process.env.ORIGIN_REPOSITORY_ROOT ?? "../../data/repositories");
const gitHttpBackend = join(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(), "git-http-backend");

app.addContentTypeParser(/^application\/x-git-.*-request$/, { parseAs: "buffer" }, (_request, body, done) => done(null, body));

app.get("/health", async () => ({ status: "ok", service: "origin-git" }));

function bearerToken(authorization?: string) {
  if (!authorization) return null;
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  if (!authorization.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    return decoded.slice(decoded.indexOf(":") + 1) || null;
  } catch {
    return null;
  }
}

async function canAccess(organizationId: string, isPublic: boolean, authorization: string | undefined, write: boolean) {
  if (isPublic && !write) return { allowed: true, actorName: "Anonymous" };
  const token = bearerToken(authorization);
  if (!token) return { allowed: false, actorName: "Unknown" };
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [match] = await getDb()
    .select({ userId: accessTokens.userId, expiresAt: accessTokens.expiresAt, username: users.username })
    .from(accessTokens)
    .innerJoin(users, eq(users.id, accessTokens.userId))
    .where(eq(accessTokens.tokenHash, tokenHash))
    .limit(1);
  if (!match || (match.expiresAt && match.expiresAt < new Date())) return { allowed: false, actorName: "Unknown" };
  const [membership] = await getDb()
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, match.userId)))
    .limit(1);
  if (!membership) return { allowed: false, actorName: "Unknown" };
  await getDb().update(accessTokens).set({ lastUsedAt: new Date() }).where(eq(accessTokens.tokenHash, tokenHash));
  return { allowed: true, actorName: match.username };
}

app.all("/*", async (request, reply) => {
  const requestPath = new URL(request.url, "http://origin.local").pathname;
  const match = requestPath.match(/^\/([a-z0-9-]+)\/([a-z0-9-]+)\.git\/(.+)$/);
  if (!match) return reply.code(404).send({ error: "Repository route not found" });
  const [, ownerSlug, repositorySlug, gitPath] = match;

  const [repository] = await getDb()
    .select({
      id: repositories.id,
      organizationId: repositories.organizationId,
      visibility: repositories.visibility,
      storageKey: repositories.storageKey,
    })
    .from(repositories)
    .innerJoin(organizations, eq(organizations.id, repositories.organizationId))
    .where(and(eq(organizations.slug, ownerSlug!), eq(repositories.slug, repositorySlug!)))
    .limit(1);
  if (!repository) return reply.code(404).send({ error: "Repository not found" });

  const service = requestPath.endsWith("git-receive-pack") || String((request.query as Record<string, unknown> | undefined)?.service ?? "") === "git-receive-pack";
  const isReceiveOperation = request.method === "POST" && requestPath.endsWith("/git-receive-pack");
  const access = await canAccess(repository.organizationId, repository.visibility === "public", request.headers.authorization, service);
  if (!access.allowed) {
    reply.header("WWW-Authenticate", 'Basic realm="Origin Git"');
    return reply.code(401).send("Authentication required\n");
  }

  resolveRepositoryPath(repositoryRoot, repository.storageKey);
  reply.hijack();
  const child = spawn(gitHttpBackend, [], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: repositoryRoot,
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: `/${repository.storageKey}/${gitPath}`,
      QUERY_STRING: request.url.includes("?") ? request.url.split("?")[1] ?? "" : "",
      REQUEST_METHOD: request.method,
      CONTENT_TYPE: request.headers["content-type"] ?? "",
      CONTENT_LENGTH: request.headers["content-length"] ?? "0",
      REMOTE_USER: access.allowed ? access.actorName : "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let headersWritten = false;
  let pending = Buffer.alloc(0);
  child.stdout.on("data", (chunk: Buffer) => {
    if (headersWritten) {
      reply.raw.write(chunk);
      return;
    }
    pending = Buffer.concat([pending, chunk]);
    const separatorLength = pending.includes("\r\n\r\n") ? 4 : 2;
    const separator = separatorLength === 4 ? pending.indexOf("\r\n\r\n") : pending.indexOf("\n\n");
    if (separator < 0) return;
    const rawHeaders = pending.subarray(0, separator).toString("utf8").split(/\r?\n/);
    const headers: Record<string, string> = {};
    let status = 200;
    for (const line of rawHeaders) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const name = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      if (name.toLowerCase() === "status") status = Number(value.slice(0, 3)) || 200;
      else headers[name] = value;
    }
    reply.raw.writeHead(status, headers);
    headersWritten = true;
    const body = pending.subarray(separator + separatorLength);
    if (body.length) reply.raw.write(body);
    pending = Buffer.alloc(0);
  });

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8").slice(0, 8_000); });
  child.on("close", (code) => {
    if (!headersWritten) reply.raw.writeHead(code === 0 ? 200 : 500, { "Content-Type": "text/plain" });
    if (code !== 0 && !reply.raw.headersSent) reply.raw.write("Git transport failed\n");
    reply.raw.end();
    if (code !== 0) request.log.error({ code, stderr }, "git-http-backend failed");
    if (code === 0 && isReceiveOperation) {
      void Promise.all([
        getDb().update(repositories).set({ updatedAt: new Date() }).where(eq(repositories.id, repository.id)),
        getDb().insert(activityEvents).values({
          repositoryId: repository.id,
          actorType: "human",
          actorName: access.actorName,
          type: "repository.pushed",
          title: `Pushed to ${repositorySlug}`,
          detail: "Git refs were updated through smart HTTP.",
        }),
      ]).catch((error) => request.log.error(error, "unable to record Git push activity"));
    }
  });
  request.raw.on("aborted", () => child.kill("SIGTERM"));
  child.on("error", (error) => {
    request.log.error(error, "unable to start git-http-backend");
    if (!reply.raw.headersSent) reply.raw.writeHead(500, { "Content-Type": "text/plain" });
    reply.raw.end("Git transport unavailable\n");
  });

  const body = request.body;
  child.stdin.end(Buffer.isBuffer(body) ? body : undefined);
});

await app.listen({
  port: Number(process.env.GIT_PORT ?? 4000),
  host: process.env.GIT_HOST ?? "0.0.0.0",
});
