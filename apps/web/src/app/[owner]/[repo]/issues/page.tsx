import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, CircleDot, Flag, MessageSquare, Plus, Tag, X } from "lucide-react";
import { eq } from "drizzle-orm";
import { getDb, labels } from "@northstar/db";
import { createIssueAction, createLabelAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { Popover } from "@/components/popover";
import { RepoShell } from "@/components/repo-shell";
import { getRepository, getRepositoryIssues, getRepositoryMilestones } from "@/lib/data";

export const metadata = { title: "Issues" };

export default async function IssuesPage({ params, searchParams }: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ state?: string; milestone?: string }>;
}) {
  const [{ owner, repo }, { state, milestone }] = await Promise.all([params, searchParams]);
  const row = await getRepository(owner, repo);
  if (!row) notFound();
  const [items, repoLabels, repoMilestones] = await Promise.all([
    getRepositoryIssues(row.repository.id),
    getDb().select().from(labels).where(eq(labels.repositoryId, row.repository.id)),
    getRepositoryMilestones(row.repository.id),
  ]);
  const base = `/${owner}/${repo}`;
  const showClosed = state === "closed";
  const activeMilestone = milestone ? repoMilestones.find((item) => String(item.number) === milestone) : undefined;
  const milestoneTitles = new Map(repoMilestones.map((item) => [item.id, item.title]));
  const scoped = activeMilestone ? items.filter((issue) => issue.milestoneId === activeMilestone.id) : items;
  const openCount = scoped.filter((issue) => issue.status === "open").length;
  const closedCount = scoped.length - openCount;
  const visible = scoped.filter((issue) => (issue.status === "open") !== showClosed);
  const openHref = activeMilestone ? `${base}/issues?milestone=${activeMilestone.number}` : `${base}/issues`;
  const closedHref = activeMilestone ? `${base}/issues?state=closed&milestone=${activeMilestone.number}` : `${base}/issues?state=closed`;
  return <RepoShell organization={row.organization} repository={row.repository} active="issues">
    <div className="section-heading">
      <div>
        
        <h1>Issues</h1>
        <p>Problems, ideas, and outcomes with their full working conversation.</p>
      </div>
      <div className="action-cluster">
        <Popover summary={<><Tag size={16} /> Labels</>}>
          <form action={createLabelAction} className="panel">
            <input type="hidden" name="repositoryId" value={row.repository.id} />
            <label>Name<input name="name" required /></label>
            <label>Color<input name="color" defaultValue="4f76ff" pattern="[0-9a-fA-F]{6}" /></label>
            <label>Description<input name="description" /></label>
            <button className="button button-primary">Create label</button>
            <small>{repoLabels.length} native labels</small>
          </form>
        </Popover>
        <Link className="button" href={`${base}/milestones`}><Flag size={16} /> Milestones{repoMilestones.length > 0 && <b className="count-pill">{repoMilestones.length}</b>}</Link>
        <Popover primary summary={<><Plus size={16} /> New issue</>}>
          <form action={createIssueAction} className="panel">
            <input type="hidden" name="repositoryId" value={row.repository.id} />
            <label>What needs to change?<input name="title" required minLength={3} placeholder="Clear outcome, not a vague task" /></label>
            <label>Context and acceptance<textarea name="body" rows={6} placeholder="What is happening, what should happen, and how will we know it works?" /></label>
            <button className="button button-primary">Create issue</button>
          </form>
        </Popover>
      </div>
    </div>
    <div className="filter-bar">
      <Link className={showClosed ? "filter-link" : "filter-link active"} href={openHref}><CircleDot size={15} /> Open <b>{openCount}</b></Link>
      <Link className={showClosed ? "filter-link active" : "filter-link"} href={closedHref}><CircleCheck size={15} /> Closed <b>{closedCount}</b></Link>
      {activeMilestone && <Link className="filter-chip" href={`${base}/issues${showClosed ? "?state=closed" : ""}`} title="Clear milestone filter"><Flag size={12} /> {activeMilestone.title} <X size={12} /></Link>}
      <span>{openCount} open · {closedCount} closed</span>
    </div>
    {visible.length ? <section className="work-list panel">
      {visible.map((issue) => <Link href={`${base}/issues/${issue.number}`} key={issue.id}>
        {issue.status === "open" ? <CircleDot className="status-open" /> : <CircleCheck className="status-closed" />}
        <div>
          <h2>{issue.title}</h2>
          <p>#{issue.number} opened by {issue.authorName} · updated {issue.updatedAt.toLocaleDateString()}{issue.milestoneId && milestoneTitles.has(issue.milestoneId) && <span className="issue-milestone"><Flag size={11} /> {milestoneTitles.get(issue.milestoneId)}</span>}</p>
          <div>{issue.labels.map((label) => <span className="label" key={label}>{label}</span>)}</div>
        </div>
        <span className="comment-count"><MessageSquare size={15} /></span>
      </Link>)}
    </section> : <EmptyState icon={showClosed ? <CircleCheck /> : <CircleDot />} title={showClosed ? "No closed issues here" : activeMilestone ? "Nothing open in this milestone" : "No issues yet"} detail={showClosed ? "Issues you close keep their full conversation and land here." : "Turn a product problem or idea into a clear outcome for a person or agent."} />}
  </RepoShell>;
}
