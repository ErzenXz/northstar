import "server-only";
import { join } from "node:path";

export const repositoryRoot = process.env.NORTHSTAR_REPOSITORY_ROOT ?? join(process.cwd(), "..", "..", "data", "repositories");

export function gitCloneUrl(owner: string, repository: string) {
  const base = process.env.NORTHSTAR_GIT_URL ?? "http://localhost:4000";
  return `${base.replace(/\/$/, "")}/${owner}/${repository}.git`;
}

export function sshCloneUrl(owner: string, repository: string) {
  const base = process.env.NORTHSTAR_SSH_URL ?? "ssh://git@localhost:2222";
  return `${base.replace(/\/$/, "")}/${owner}/${repository}.git`;
}
