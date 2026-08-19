import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { compareBranches, createBareRepository, mergeBranches, resolveRepositoryPath, validateBranchName } from "./index";

const exec = promisify(execFile);

describe("repository paths", () => {
  it("allows an owned bare repository", () => {
    expect(resolveRepositoryPath("/srv/origin", "team/app.git")).toBe("/srv/origin/team/app.git");
  });

  it("rejects traversal", () => {
    expect(() => resolveRepositoryPath("/srv/origin", "../../etc")).toThrow();
  });

  it("rejects option-like branch names", async () => {
    await expect(validateBranchName("--upload-pack=evil")).rejects.toThrow();
  });

  it("compares and merges native branches", async () => {
    const root = await mkdtemp(join(tmpdir(), "northstar-git-test-"));
    const work = join(root, "work");
    try {
      await createBareRepository(root, "team", "app");
      await mkdir(work);
      await exec("git", ["init", "--initial-branch=main"], { cwd: work });
      await exec("git", ["config", "user.name", "Test Builder"], { cwd: work });
      await exec("git", ["config", "user.email", "test@northstar.local"], { cwd: work });
      await writeFile(join(work, "README.md"), "# App\n");
      await exec("git", ["add", "."], { cwd: work });
      await exec("git", ["commit", "-m", "Start app"], { cwd: work });
      await exec("git", ["remote", "add", "origin", join(root, "team", "app.git")], { cwd: work });
      await exec("git", ["push", "origin", "main"], { cwd: work });
      await exec("git", ["checkout", "-b", "feature/review"], { cwd: work });
      await writeFile(join(work, "README.md"), "# App\n\nReady for review.\n");
      await exec("git", ["commit", "-am", "Add review context"], { cwd: work });
      await exec("git", ["push", "origin", "feature/review"], { cwd: work });
      const comparison = await compareBranches(root, "team/app.git", "main", "feature/review");
      expect(comparison.files[0]?.path).toBe("README.md");
      expect(comparison.additions).toBeGreaterThan(0);
      const merged = await mergeBranches(root, "team/app.git", "main", "feature/review", "Merge review", { name: "Northstar", email: "origin@local" });
      expect(merged.strategy).toBe("fast-forward");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
