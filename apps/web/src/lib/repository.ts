import "server-only";
import { join } from "node:path";

export const repositoryRoot = process.env.ORIGIN_REPOSITORY_ROOT ?? join(process.cwd(), "..", "..", "data", "repositories");

export function gitCloneUrl(owner: string, repository: string) {
  const base = process.env.ORIGIN_GIT_URL ?? "http://localhost:4000";
  return `${base.replace(/\/$/, "")}/${owner}/${repository}.git`;
}
