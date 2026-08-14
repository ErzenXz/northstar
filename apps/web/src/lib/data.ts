import "server-only";
import { and, desc, eq } from "drizzle-orm";
import {
  activityEvents,
  agentRuns,
  getDb,
  issues,
  organizationMembers,
  organizations,
  pullRequests,
  repositories,
  repositoryMemories,
} from "@origin/db";
import { getCurrentUser } from "./auth";

export async function getRepository(owner: string, repository: string) {
  const [row] = await getDb()
    .select({ repository: repositories, organization: organizations })
    .from(repositories)
    .innerJoin(organizations, eq(organizations.id, repositories.organizationId))
    .where(and(eq(organizations.slug, owner), eq(repositories.slug, repository)))
    .limit(1);
  if (!row) return null;
  if (row.repository.visibility === "public") return row;
  const user = await getCurrentUser();
  if (!user) return null;
  const [membership] = await getDb().select({ userId: organizationMembers.userId }).from(organizationMembers).where(and(
    eq(organizationMembers.organizationId, row.organization.id),
    eq(organizationMembers.userId, user.id),
  )).limit(1);
  return membership ? row : null;
}

export async function getUserOrganizations(userId: string) {
  return getDb()
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(organizations.name);
}

export async function getUserRepositories(userId: string) {
  return getDb()
    .select({ repository: repositories, organization: organizations })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .innerJoin(repositories, eq(repositories.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(desc(repositories.updatedAt));
}

export async function getRepositoryOverview(repositoryId: string) {
  const [events, openIssues, openPulls, runs] = await Promise.all([
    getDb().select().from(activityEvents).where(eq(activityEvents.repositoryId, repositoryId)).orderBy(desc(activityEvents.createdAt)).limit(12),
    getDb().select().from(issues).where(and(eq(issues.repositoryId, repositoryId), eq(issues.status, "open"))).orderBy(desc(issues.updatedAt)).limit(5),
    getDb().select().from(pullRequests).where(and(eq(pullRequests.repositoryId, repositoryId), eq(pullRequests.status, "open"))).orderBy(desc(pullRequests.updatedAt)).limit(5),
    getDb().select().from(agentRuns).where(eq(agentRuns.repositoryId, repositoryId)).orderBy(desc(agentRuns.createdAt)).limit(5),
  ]);
  return { events, openIssues, openPulls, runs };
}

export async function getRepositoryIssues(repositoryId: string) {
  return getDb().select().from(issues).where(eq(issues.repositoryId, repositoryId)).orderBy(desc(issues.updatedAt));
}

export async function getRepositoryPulls(repositoryId: string) {
  return getDb().select().from(pullRequests).where(eq(pullRequests.repositoryId, repositoryId)).orderBy(desc(pullRequests.updatedAt));
}

export async function getRepositoryBrain(repositoryId: string) {
  return getDb().select().from(repositoryMemories).where(eq(repositoryMemories.repositoryId, repositoryId)).orderBy(repositoryMemories.kind, repositoryMemories.title);
}

export async function getRepositoryRuns(repositoryId: string) {
  return getDb().select().from(agentRuns).where(eq(agentRuns.repositoryId, repositoryId)).orderBy(desc(agentRuns.createdAt));
}
