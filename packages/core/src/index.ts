export const product = {
  name: "Origin",
  description: "The open software forge for humans and agents.",
  repository: "https://github.com/origin-dev/origin",
} as const;

export type OriginEdition = "community" | "cloud";

export function getEdition(value = process.env.ORIGIN_EDITION): OriginEdition {
  return value === "cloud" ? "cloud" : "community";
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);
}

export function assertSlug(value: string, label = "Slug"): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value)) {
    throw new Error(`${label} must contain only lowercase letters, numbers, and single hyphens.`);
  }
  return value;
}

export function repositoryStorageKey(owner: string, repository: string): string {
  return `${assertSlug(owner, "Owner")}/${assertSlug(repository, "Repository")}.git`;
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function absoluteUrl(path: string, base = process.env.ORIGIN_BASE_URL ?? "http://localhost:3000"): string {
  return new URL(path, base).toString();
}

export async function encryptSecret(value: string, secret: string): Promise<string> {
  const { createCipheriv, createHash, randomBytes } = await import("node:crypto");
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export async function decryptSecret(value: string, secret: string): Promise<string> {
  const { createDecipheriv, createHash } = await import("node:crypto");
  const [ivPart, tagPart, encryptedPart] = value.split(".");
  if (!ivPart || !tagPart || !encryptedPart) throw new Error("Invalid encrypted value");
  const key = createHash("sha256").update(secret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
