import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { repositoryStorageKey } from "@origin/core";

const exec = promisify(execFile);
const MAX_TEXT_FILE_BYTES = 1_000_000;

export type TreeEntry = { name: string; path: string; type: "blob" | "tree"; size: number | null };
export type CommitSummary = { hash: string; shortHash: string; author: string; email: string; date: string; subject: string };

export function resolveRepositoryPath(root: string, storageKey: string): string {
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, storageKey);
  if (!candidate.startsWith(`${absoluteRoot}${sep}`)) throw new Error("Repository path escapes storage root");
  return candidate;
}

async function git(args: string[], options: { cwd?: string; maxBuffer?: number; env?: Record<string, string | undefined> } = {}) {
  return exec("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

export async function createBareRepository(root: string, owner: string, repository: string, defaultBranch = "main") {
  const storageKey = repositoryStorageKey(owner, repository);
  const path = resolveRepositoryPath(root, storageKey);
  await mkdir(dirname(path), { recursive: true });
  await git(["init", "--bare", `--initial-branch=${defaultBranch}`, path]);
  await git(["-C", path, "config", "http.receivepack", "true"]);
  return { storageKey, path };
}

export async function mirrorRepository(sourceUrl: string, root: string, storageKey: string, authorizationToken?: string) {
  const destination = resolveRepositoryPath(root, storageKey);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "origin-import-"));
  const temporaryRepository = join(temporaryRoot, "repository.git");
  try {
    const authEnv = authorizationToken ? {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Bearer ${authorizationToken}`,
    } : undefined;
    await git(["clone", "--mirror", "--", sourceUrl, temporaryRepository], {
      maxBuffer: 25 * 1024 * 1024,
      env: authEnv,
    });
    await git(["-C", temporaryRepository, "config", "http.receivepack", "true"]);
    await mkdir(dirname(destination), { recursive: true });
    await rm(destination, { recursive: true, force: true });
    await rename(temporaryRepository, destination);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return destination;
}

export async function repositoryExists(root: string, storageKey: string) {
  try {
    const result = await stat(resolveRepositoryPath(root, storageKey));
    return result.isDirectory();
  } catch {
    return false;
  }
}

export async function listBranches(root: string, storageKey: string) {
  const path = resolveRepositoryPath(root, storageKey);
  const { stdout } = await git(["-C", path, "for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  return stdout.trim().split("\n").filter(Boolean);
}

export async function getDefaultBranch(root: string, storageKey: string) {
  const path = resolveRepositoryPath(root, storageKey);
  const { stdout } = await git(["-C", path, "symbolic-ref", "--short", "HEAD"]);
  return stdout.trim().replace(/^refs\/heads\//, "");
}

export async function listTree(root: string, storageKey: string, reference: string, directory = ""): Promise<TreeEntry[]> {
  const path = resolveRepositoryPath(root, storageKey);
  const treeish = directory ? `${reference}:${directory}` : reference;
  const { stdout } = await git(["-C", path, "ls-tree", "-l", "-z", treeish]);
  return stdout.split("\0").filter(Boolean).map((line) => {
    const match = line.match(/^[0-9]+\s+(blob|tree)\s+[a-f0-9]+\s+(-|\d+)\t(.+)$/);
    if (!match) throw new Error(`Unexpected git tree entry: ${line}`);
    const [, type, rawSize, name] = match;
    const entryName = name!;
    return {
      name: entryName,
      path: directory ? `${directory}/${entryName}` : entryName,
      type: type as "blob" | "tree",
      size: rawSize === "-" ? null : Number(rawSize),
    };
  }).sort((a, b) => Number(b.type === "tree") - Number(a.type === "tree") || a.name.localeCompare(b.name));
}

export async function readTextFile(root: string, storageKey: string, reference: string, filePath: string) {
  const path = resolveRepositoryPath(root, storageKey);
  const { stdout: sizeText } = await git(["-C", path, "cat-file", "-s", `${reference}:${filePath}`]);
  const size = Number(sizeText.trim());
  if (!Number.isFinite(size) || size > MAX_TEXT_FILE_BYTES) throw new Error("File is too large to display");
  const { stdout } = await git(["-C", path, "show", `${reference}:${filePath}`], { maxBuffer: MAX_TEXT_FILE_BYTES + 1024 });
  if (stdout.includes("\0")) throw new Error("Binary files cannot be displayed as text");
  return stdout;
}

export async function readReadme(root: string, storageKey: string, reference: string) {
  const entries = await listTree(root, storageKey, reference);
  const readme = entries.find((entry) => entry.type === "blob" && /^readme(?:\.[a-z0-9]+)?$/i.test(entry.name));
  return readme ? { name: readme.name, content: await readTextFile(root, storageKey, reference, readme.path) } : null;
}

export async function listCommits(root: string, storageKey: string, reference: string, limit = 20): Promise<CommitSummary[]> {
  const path = resolveRepositoryPath(root, storageKey);
  const format = "%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e";
  const { stdout } = await git(["-C", path, "log", `--max-count=${Math.min(Math.max(limit, 1), 100)}`, `--format=${format}`, reference]);
  return stdout.split("\x1e").map((record) => record.trim()).filter(Boolean).map((record) => {
    const [hash, shortHash, author, email, date, subject] = record.split("\x1f");
    return { hash: hash!, shortHash: shortHash!, author: author!, email: email!, date: date!, subject: subject! };
  });
}
