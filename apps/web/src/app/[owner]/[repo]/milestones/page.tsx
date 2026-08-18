import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CircleCheck, CircleDot, Flag, Hash, Plus } from "lucide-react";
import { createMilestoneAction, updateMilestoneAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { Popover } from "@/components/popover";
import { RepoShell } from "@/components/repo-shell";
import { getRepository, getRepositoryMilestones } from "@/lib/data";

export const metadata = { title: "Milestones" };

const dateFormat: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

export default async function MilestonesPage({ params, searchParams }: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ state?: string }>;
}) {
  const [{ owner, repo }, { state }] = await Promise.all([params, searchParams]);
  const row = await getRepository(owner, repo);
  if (!row) notFound();
  const all = await getRepositoryMilestones(row.repository.id);
  const showClosed = state === "closed";
  const open = all.filter((milestone) => milestone.status === "open");
  const closed = all.filter((milestone) => milestone.status !== "open");
  const items = showClosed ? closed : open;
  const base = `/${owner}/${repo}`;
  return <RepoShell organization={row.organization} repository={row.repository} active="issues">
    <div className="section-heading">
      <div>
        <p className="eyebrow-simple">DELIVERY TARGETS</p>
        <h1>Milestones</h1>
        <p>Group issues into outcomes with a due date, and watch the work burn down.</p>
      </div>
      <div className="action-cluster">
        <Link className="button" href={`${base}/issues`}><CircleDot size={16} /> Issues</Link>
        <Popover primary summary={<><Plus size={16} /> New milestone</>}>
          <form action={createMilestoneAction} className="panel">
            <input type="hidden" name="repositoryId" value={row.repository.id} />
            <label>Title<input name="title" required minLength={2} placeholder="Alpha 3 — verified agent work" /></label>
            <label>Outcome<textarea name="description" rows={3} placeholder="What is true about the product when this milestone closes?" /></label>
            <label>Due date <span>Optional</span><input name="dueAt" type="date" /></label>
            <button className="button button-primary">Create milestone</button>
          </form>
        </Popover>
      </div>
    </div>
    <div className="filter-bar">
      <Link className={showClosed ? "filter-link" : "filter-link active"} href={`${base}/milestones`}><CircleDot size={15} /> Open <b>{open.length}</b></Link>
      <Link className={showClosed ? "filter-link active" : "filter-link"} href={`${base}/milestones?state=closed`}><CircleCheck size={15} /> Closed <b>{closed.length}</b></Link>
      <span>{open.length} open · {closed.length} closed</span>
    </div>
    {items.length ? <section className="milestone-list">
      {items.map((milestone) => {
        const total = milestone.openIssues + milestone.closedIssues;
        const percent = total ? Math.round((milestone.closedIssues / total) * 100) : 0;
        const overdue = milestone.overdue;
        return <article className="panel milestone-card" key={milestone.id}>
          <div className="milestone-main">
            <div className="milestone-title">
              <h2>{milestone.title}</h2>
              <span className={`status-chip ${milestone.status === "open" ? "" : "closed"}`}>{milestone.status}</span>
            </div>
            {milestone.description && <p>{milestone.description}</p>}
            <div className="milestone-meta">
              <span><Hash /> milestone {milestone.number}</span>
              <span className={overdue ? "overdue" : ""}><CalendarClock /> {milestone.dueAt ? `${overdue ? "was due" : "due"} ${milestone.dueAt.toLocaleDateString("en-US", dateFormat)}` : "no due date"}</span>
              {milestone.status !== "open" && milestone.closedAt && <span><CircleCheck /> closed {milestone.closedAt.toLocaleDateString("en-US", dateFormat)}</span>}
            </div>
          </div>
          <div className="milestone-progress">
            <div className="milestone-percent"><strong>{percent}%</strong><span>complete</span></div>
            <div className="milestone-meter"><i style={{ width: `${percent}%` }} /></div>
            <p>{milestone.openIssues} open · {milestone.closedIssues} closed</p>
            <div className="milestone-actions">
              <Link className="button button-quiet" href={`${base}/issues?milestone=${milestone.number}`}>View issues</Link>
              <form action={updateMilestoneAction}>
                <input type="hidden" name="repositoryId" value={row.repository.id} />
                <input type="hidden" name="milestoneId" value={milestone.id} />
                <input type="hidden" name="intent" value={milestone.status === "open" ? "close" : "reopen"} />
                <button className="button">{milestone.status === "open" ? "Close" : "Reopen"}</button>
              </form>
            </div>
          </div>
        </article>;
      })}
    </section> : <EmptyState icon={<Flag />} title={showClosed ? "No closed milestones" : "No open milestones"} detail={showClosed ? "Milestones you close will keep their burn-down history here." : "Create a milestone to group issues into a shippable outcome with a due date."} />}
  </RepoShell>;
}
