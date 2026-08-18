import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { backups, getDb, jobs, repositories } from "@origin/db";
import { bundleRepository, verifyBundleRestore } from "@origin/git";
import { eq } from "drizzle-orm";
import { ensureOrganizationSettings } from "./billing";

export async function backupRepositories(payload: Record<string, unknown>, repositoryRoot: string, backupRoot: string) {
  const targetId = typeof payload.repositoryId === "string" ? payload.repositoryId : null;
  const rows = targetId
    ? await getDb().select().from(repositories).where(eq(repositories.id, targetId))
    : await getDb().select().from(repositories);
  let completed = 0;
  let failed = 0;
  for (const repository of rows) {
    const settings = await ensureOrganizationSettings(repository.organizationId);
    const bundlePath = resolve(backupRoot, settings.region, `${repository.storageKey.replace(/\.git$/, "")}.bundle`);
    try {
      const { sizeBytes } = await bundleRepository(repositoryRoot, repository.storageKey, bundlePath);
      const checksum = createHash("sha256").update(await readFile(bundlePath)).digest("hex");
      await verifyBundleRestore(bundlePath, resolve(backupRoot, ".restore-tests"));
      await getDb().insert(backups).values({
        repositoryId: repository.id,
        storagePath: bundlePath,
        sizeBytes,
        checksum,
        status: "restore_tested",
        restoreTestedAt: new Date(),
      });
      completed += 1;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await getDb().insert(backups).values({
        repositoryId: repository.id,
        storagePath: bundlePath,
        status: "failed",
        error: detail.slice(0, 2_000),
      });
      failed += 1;
    }
  }
  if (payload.recurring === true) {
    await getDb().insert(jobs).values({
      type: "backup-repositories",
      payload: { recurring: true },
      runAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  }
  return { completed, failed, repositories: rows.length };
}
