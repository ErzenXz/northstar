import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb, organizationMembers, releaseAssets, releases, repositories } from "@origin/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const [row] = await getDb().select({ asset: releaseAssets, repository: repositories }).from(releaseAssets).innerJoin(releases, eq(releases.id, releaseAssets.releaseId)).innerJoin(repositories, eq(repositories.id, releases.repositoryId)).where(eq(releaseAssets.id, id)).limit(1);
  if (!row?.asset.storagePath) return Response.json({ error: "Asset not found" }, { status: 404 });
  if (row.repository.visibility !== "public") {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Asset not found" }, { status: 404 });
    const [membership] = await getDb().select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, row.repository.organizationId), eq(organizationMembers.userId, user.id))).limit(1);
    if (!membership) return Response.json({ error: "Asset not found" }, { status: 404 });
  }
  try {
    const data = await readFile(row.asset.storagePath);
    return new Response(Uint8Array.from(data), { headers: { "Content-Type": row.asset.contentType ?? "application/octet-stream", "Content-Disposition": `attachment; filename="${basename(row.asset.name).replace(/["\\]/g, "_")}"`, "Content-Length": String(data.length) } });
  } catch { return Response.json({ error: "Stored asset is unavailable" }, { status: 404 }); }
}
