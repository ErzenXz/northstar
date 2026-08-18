import { and, desc, eq } from "drizzle-orm";
import { auditEvents, getDb, organizationMembers, organizations } from "@origin/db";
import { getCurrentUser } from "@/lib/auth";

function csvField(value: string) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to export the audit trail", { status: 401 });
  const { slug } = await context.params;
  const [organization] = await getDb().select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (!organization) return new Response("Workspace not found", { status: 404 });
  const [membership] = await getDb().select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, organization.id), eq(organizationMembers.userId, user.id))).limit(1);
  if (membership?.role !== "owner") return new Response("Only workspace owners can export the audit trail", { status: 403 });
  const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.organizationId, organization.id)).orderBy(desc(auditEvents.createdAt)).limit(10_000);
  const lines = [
    "timestamp,actor,action,target,ip,metadata",
    ...rows.map((row) => [row.createdAt.toISOString(), row.actorName, row.action, row.target, row.ip ?? "", JSON.stringify(row.metadata)].map(csvField).join(",")),
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
