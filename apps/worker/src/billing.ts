import { usagePeriod } from "@origin/core";
import { getDb, organizationSettings, usageRecords } from "@origin/db";
import { and, eq, sql } from "drizzle-orm";

export async function ensureOrganizationSettings(organizationId: string) {
  await getDb().insert(organizationSettings).values({ organizationId }).onConflictDoNothing();
  const [settings] = await getDb().select().from(organizationSettings).where(eq(organizationSettings.organizationId, organizationId)).limit(1);
  if (!settings) throw new Error("Organization settings are unavailable");
  return settings;
}

export async function aiTokensSpent(organizationId: string, period = usagePeriod()) {
  const [row] = await getDb()
    .select({ total: sql<string>`coalesce(sum(${usageRecords.amount}), 0)` })
    .from(usageRecords)
    .where(and(eq(usageRecords.organizationId, organizationId), eq(usageRecords.period, period), eq(usageRecords.kind, "ai_tokens")));
  return Number(row?.total ?? 0);
}

export async function assertAiBudget(organizationId: string) {
  const settings = await ensureOrganizationSettings(organizationId);
  if (!settings.aiTokenBudget) return settings;
  const spent = await aiTokensSpent(organizationId);
  if (spent >= settings.aiTokenBudget) {
    throw new Error(`The monthly model budget of ${settings.aiTokenBudget.toLocaleString()} tokens is exhausted (${spent.toLocaleString()} used). Raise the budget in workspace billing settings.`);
  }
  return settings;
}

export async function chargeAiUsage(organizationId: string, totalTokens: number, source: string) {
  if (!totalTokens) return;
  await getDb().insert(usageRecords).values({
    organizationId,
    kind: "ai_tokens",
    amount: totalTokens,
    period: usagePeriod(),
    metadata: { source },
  });
}
