import { notFound } from "next/navigation";
import { ArrowRight, GitMerge, GitPullRequest, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { RepoShell } from "@/components/repo-shell";
import { getRepository, getRepositoryPulls } from "@/lib/data";

export const metadata = { title: "Changes" };

export default async function PullsPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const row = await getRepository(owner, repo);
  if (!row) notFound();
  const items = await getRepositoryPulls(row.repository.id);
  return <RepoShell organization={row.organization} repository={row.repository} active="pulls"><div className="section-heading"><div><p className="eyebrow-simple">MERGE DECISIONS</p><h1>Changes</h1><p>Every proposed change, with its product impact, risk, and verification evidence.</p></div><div className="evidence-key"><ShieldCheck size={17} /><span><b>Evidence-first review</b>Agent work never self-approves.</span></div></div><div className="filter-bar"><button className="active"><GitPullRequest size={15} /> Open</button><button><GitMerge size={15} /> Merged</button><span>{items.length} recorded changes</span></div>{items.length ? <section className="change-list">{items.map((pull) => <article className="panel" key={pull.id}><div className={`change-state ${pull.status}`}><GitPullRequest /></div><div className="change-copy"><h2>{pull.title}</h2><p>#{pull.number} by {pull.authorName} · {pull.headBranch} <ArrowRight size={13} /> {pull.baseBranch}</p><div className="change-metrics"><span className="additions">+{pull.additions}</span><span className="deletions">−{pull.deletions}</span><span>{pull.changedFiles} files</span></div></div><span className={`status-chip ${pull.status}`}>{pull.status}</span></article>)}</section> : <EmptyState icon={<GitPullRequest />} title="No changes proposed" detail="Imported pull requests and agent-authored change proposals will appear here." />}</RepoShell>;
}
