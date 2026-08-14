import "dotenv/config";
import { createHash, generateKeyPairSync, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import ssh2 from "ssh2";
import { activityEvents, deployKeys, getDb, jobs, organizationMembers, organizations, repositories, sshKeys, users } from "@origin/db";
import { resolveRepositoryPath } from "@origin/git";

const repositoryRoot = resolve(process.env.ORIGIN_REPOSITORY_ROOT ?? "../../data/repositories");
const hostKeyPath = resolve(process.env.ORIGIN_SSH_HOST_KEY ?? "../../data/ssh/host-key.pem");

type Actor = { type: "user"; userId: string; name: string; keyId: string } | { type: "deploy"; deployKeyId: string; name: string; keyId: string };
type AuthenticationMatch = { actor: Actor; publicKey: string };

async function hostKey() {
  try {
    const existing = await readFile(hostKeyPath);
    if (existing.includes("BEGIN RSA PRIVATE KEY")) return existing;
  } catch { /* create it below */ }
  await mkdir(dirname(hostKeyPath), { recursive: true });
  const pair = generateKeyPairSync("rsa", { modulusLength: 3072 });
  const pem = pair.privateKey.export({ type: "pkcs1", format: "pem" });
  await writeFile(hostKeyPath, pem, { mode: 0o600 });
  return Buffer.from(pem);
}

function keyMatches(stored: string, offered: Buffer) {
  const encoded = stored.trim().split(/\s+/)[1];
  if (!encoded) return false;
  const expected = Buffer.from(encoded, "base64");
  return expected.length === offered.length && timingSafeEqual(expected, offered);
}

function keyId(data: Buffer) {
  return `SHA256:${createHash("sha256").update(data).digest("base64").replace(/=+$/, "")}`;
}

async function authenticate(data: Buffer): Promise<AuthenticationMatch | null> {
  const [userRows, deployRows] = await Promise.all([
    getDb().select({ id: sshKeys.id, userId: sshKeys.userId, publicKey: sshKeys.publicKey, username: users.username }).from(sshKeys).innerJoin(users, eq(users.id, sshKeys.userId)),
    getDb().select({ id: deployKeys.id, publicKey: deployKeys.publicKey, title: deployKeys.title }).from(deployKeys),
  ]);
  const userKey = userRows.find((row) => keyMatches(row.publicKey, data));
  if (userKey) return { actor: { type: "user", userId: userKey.userId, name: userKey.username, keyId: userKey.id }, publicKey: userKey.publicKey };
  const deployKey = deployRows.find((row) => keyMatches(row.publicKey, data));
  if (deployKey) return { actor: { type: "deploy", deployKeyId: deployKey.id, name: deployKey.title, keyId: deployKey.id }, publicKey: deployKey.publicKey };
  return null;
}

const server = new ssh2.Server({ hostKeys: [await hostKey()], ident: "Origin-SSH_0.2" }, (client) => {
  let actor: Actor | null = null;
  client.on("error", (error) => {
    if (!error.message.includes("no matching host key format")) console.warn("SSH client connection ended with an error.", error);
  });
  client.on("authentication", (context) => {
    if (context.method !== "publickey" || !context.key?.data) {
      return context.reject(["publickey"]);
    }
    void authenticate(context.key.data).then((match) => {
      if (!match) {
        console.warn(`Rejected an unknown ${context.key.algo} SSH key.`);
        return context.reject(["publickey"]);
      }
      const parsed = ssh2.utils.parseKey(match.publicKey);
      if (parsed instanceof Error || Array.isArray(parsed) || parsed.type !== context.key.algo) {
        console.warn(`Rejected SSH key ${match.actor.keyId}: its stored algorithm does not match the offered key.`);
        return context.reject(["publickey"]);
      }
      if (context.signature && (!context.blob || parsed.verify(context.blob, context.signature, context.hashAlgo) !== true)) {
        console.warn(`Rejected SSH key ${match.actor.keyId}: signature verification failed.`);
        return context.reject(["publickey"]);
      }
      actor = match.actor;
      context.accept();
    }).catch(() => context.reject(["publickey"]));
  });
  client.on("ready", () => {
    client.on("session", (accept) => {
      const session = accept();
      session.once("exec", (acceptExec, reject, info) => {
        const match = info.command.match(/^git-(upload|receive)-pack '\/?([a-z0-9-]+)\/([a-z0-9-]+)\.git'$/);
        if (!match || !actor) {
          console.warn(`Rejected SSH command ${JSON.stringify(info.command)}: ${actor ? "unsupported command" : "no authenticated actor"}.`);
          return reject();
        }
        const [, operation, owner, repo] = match;
        void (async () => {
          const [row] = await getDb().select({ repository: repositories, organization: organizations }).from(repositories).innerJoin(organizations, eq(organizations.id, repositories.organizationId)).where(and(eq(organizations.slug, owner!), eq(repositories.slug, repo!))).limit(1);
          if (!row) return reject();
          const write = operation === "receive";
          let allowed = false;
          if (actor!.type === "user") {
            const [membership] = await getDb().select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, row.organization.id), eq(organizationMembers.userId, actor!.userId))).limit(1);
            allowed = Boolean(membership) || (!write && row.repository.visibility === "public");
          } else {
            const [key] = await getDb().select().from(deployKeys).where(and(eq(deployKeys.id, actor!.deployKeyId), eq(deployKeys.repositoryId, row.repository.id))).limit(1);
            allowed = Boolean(key && (!write || key.canWrite));
          }
          if (!allowed) return reject();
          const channel = acceptExec();
          const service = operation === "receive" ? "git-receive-pack" : "git-upload-pack";
          const child = spawn(service, [resolveRepositoryPath(repositoryRoot, row.repository.storageKey)], { stdio: ["pipe", "pipe", "pipe"] });
          channel.pipe(child.stdin);
          child.stdout.pipe(channel, { end: false });
          child.stderr.pipe(channel.stderr);
          child.on("close", (code) => {
            channel.exit(code ?? 1);
            channel.end();
            if (code === 0 && write) void Promise.all([
              getDb().insert(activityEvents).values({ repositoryId: row.repository.id, actorType: actor!.type === "user" ? "human" : "system", actorName: actor!.name, type: "repository.pushed", title: `Pushed to ${row.repository.slug}`, detail: "Git refs were updated through SSH." }),
              getDb().insert(jobs).values({ type: "deliver-webhook-event", payload: { repositoryId: row.repository.id, event: "push", payload: { actor: actor!.name, transport: "ssh" } } }),
            ]);
          });
          if (actor!.type === "user") await getDb().update(sshKeys).set({ lastUsedAt: new Date() }).where(eq(sshKeys.id, actor!.keyId));
          else await getDb().update(deployKeys).set({ lastUsedAt: new Date() }).where(eq(deployKeys.id, actor!.keyId));
        })().catch((error: unknown) => {
          console.error("SSH Git command failed before the transport started.", error);
          reject();
        });
      });
    });
  });
});

server.listen(Number(process.env.ORIGIN_SSH_PORT ?? 2222), process.env.ORIGIN_SSH_HOST ?? "0.0.0.0", () => {
  console.log(`Origin SSH is ready on port ${process.env.ORIGIN_SSH_PORT ?? 2222}.`);
});
