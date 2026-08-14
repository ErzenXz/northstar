import { notFound } from "next/navigation";
import { CircleDot, MessageSquare, Plus } from "lucide-react";
import { createIssueAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { RepoShell } from "@/components/repo-shell";
import { getRepository, getRepositoryIssues } from "@/lib/data";

export const metadata = { title: "Issues" };

export default async function IssuesPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const row = await getRepository(owner, repo);
  if (!row) notFound();
  const items = await getRepositoryIssues(row.repository.id);
  return <RepoShell organization={row.organization} repository={row.repository} active="issues"><div className="section-heading"><div><p className="eyebrow-simple">WORK TO BE DONE</p><h1>Issues</h1><p>Problems, ideas, and outcomes that can be assigned to humans or agents.</p></div><details className="popover-form"><summary className="button button-primary"><Plus size={16} /> New issue</summary><form action={createIssueAction} className="panel"><input type="hidden" name="repositoryId" value={row.repository.id} /><label>What needs to change?<input name="title" required minLength={3} placeholder="Clear outcome, not a vague task" /></label><label>Context and acceptance<textarea name="body" rows={6} placeholder="What is happening, what should happen, and how we will know it works." /></label><button className="button button-primary">Create issue</button></form></details></div><div className="filter-bar"><button className="active"><CircleDot size={15} /> Open</button><button>Closed</button><span>{items.filter((item) => item.status === "open").length} open · {items.filter((item) => item.status !== "open").length} closed</span></div>{items.length ? <section className="work-list panel">{items.map((issue) => <article key={issue.id}><CircleDot className={issue.status === "open" ? "status-open" : "status-closed"} /><div><h2>{issue.title}</h2><p>#{issue.number} opened by {issue.authorName} · updated {issue.updatedAt.toLocaleDateString()}</p><div>{issue.labels.map((label) => <span className="label" key={label}>{label}</span>)}</div></div><span className="comment-count"><MessageSquare size={15} /> 0</span></article>)}</section> : <EmptyState icon={<CircleDot />} title="No issues yet" detail="Turn a product problem or idea into a clear outcome for a person or agent." />}</RepoShell>;
}
