import "server-only";
import { and, desc, eq } from "drizzle-orm";
import {
  activityEvents,
  agentRuns,
  getDb,
  issueAssignees,
  issueComments,
  issueLabels,
  issues,
  labels,
  milestones,
  organizationMembers,
  organizations,
  pullRequestComments,
  pullRequestReviews,
  pullRequests,
  releaseAssets,
  releases,
  repositories,
  repositoryMemories,
  users,
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

export async function getRepositoryForMember(owner: string, repository: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const [row] = await getDb()
    .select({ repository: repositories, organization: organizations })
    .from(repositories)
    .innerJoin(organizations, eq(organizations.id, repositories.organizationId))
    .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
    .where(and(eq(organizations.slug, owner), eq(repositories.slug, repository), eq(organizationMembers.userId, user.id)))
    .limit(1);
  return row ?? null;
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

export async function getIssueDetail(repositoryId: string, number: number) {
  const [issue] = await getDb().select().from(issues).where(and(eq(issues.repositoryId, repositoryId), eq(issues.number, number))).limit(1);
  if (!issue) return null;
  const [comments, selectedLabels, assignees, availableLabels, availableMilestones, members] = await Promise.all([
    getDb().select().from(issueComments).where(eq(issueComments.issueId, issue.id)).orderBy(issueComments.createdAt),
    getDb().select({ id: labels.id, name: labels.name, color: labels.color }).from(issueLabels).innerJoin(labels, eq(labels.id, issueLabels.labelId)).where(eq(issueLabels.issueId, issue.id)),
    getDb().select({ id: users.id, username: users.username, name: users.name }).from(issueAssignees).innerJoin(users, eq(users.id, issueAssignees.userId)).where(eq(issueAssignees.issueId, issue.id)),
    getDb().select().from(labels).where(eq(labels.repositoryId, repositoryId)).orderBy(labels.name),
    getDb().select().from(milestones).where(eq(milestones.repositoryId, repositoryId)).orderBy(milestones.number),
    getDb().select({ id: users.id, username: users.username, name: users.name }).from(organizationMembers).innerJoin(repositories, eq(repositories.organizationId, organizationMembers.organizationId)).innerJoin(users, eq(users.id, organizationMembers.userId)).where(eq(repositories.id, repositoryId)),
  ]);
  return { issue, comments, selectedLabels, assignees, availableLabels, availableMilestones, members };
}

export async function getPullRequestDetail(repositoryId: string, number: number) {
  const [pull] = await getDb().select().from(pullRequests).where(and(eq(pullRequests.repositoryId, repositoryId), eq(pullRequests.number, number))).limit(1);
  if (!pull) return null;
  const [comments, reviews] = await Promise.all([
    getDb().select().from(pullRequestComments).where(eq(pullRequestComments.pullRequestId, pull.id)).orderBy(pullRequestComments.createdAt),
    getDb().select().from(pullRequestReviews).where(eq(pullRequestReviews.pullRequestId, pull.id)).orderBy(desc(pullRequestReviews.submittedAt)),
  ]);
  return { pull, comments, reviews };
}

export async function getRepositoryReleases(repositoryId: string) {
  const releaseRows = await getDb().select().from(releases).where(eq(releases.repositoryId, repositoryId)).orderBy(desc(releases.publishedAt));
  const assets = await getDb().select().from(releaseAssets);
  return releaseRows.map((release) => ({ ...release, assets: assets.filter((asset) => asset.releaseId === release.id) }));
}
