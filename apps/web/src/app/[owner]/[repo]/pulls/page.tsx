import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, GitBranch, GitMerge, GitPullRequest, Plus, ShieldCheck } from "lucide-react";
import { createBranchAction, createPullRequestAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { RepoShell } from "@/components/repo-shell";
import { getRepository, getRepositoryPulls } from "@/lib/data";
import { repositoryRoot } from "@/lib/repository";
import { listBranches } from "@origin/git";

export const metadata = { title: "Changes" };

export default async function PullsPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const row = await getRepository(owner, repo);
  if (!row) notFound();
  const [items, branches] = await Promise.all([getRepositoryPulls(row.repository.id), listBranches(repositoryRoot, row.repository.storageKey).catch(() => [])]);
  return <RepoShell organization={row.organization} repository={row.repository} active="pulls">
    <div className="section-heading"><div><p className="eyebrow-simple">MERGE DECISIONS</p><h1>Changes</h1><p>Branches become decisions through diff, conversation, checks, and explicit approval.</p></div><div className="action-cluster"><details className="popover-form"><summary className="button"><GitBranch size={16} /> New branch</summary><form action={createBranchAction} className="panel"><input type="hidden" name="repositoryId" value={row.repository.id}/><label>Branch name<input name="branch" required placeholder="feature/offline-sync" /></label><label>Start from<select name="from">{branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label><button className="button button-primary">Create branch</button></form></details><details className="popover-form"><summary className="button button-primary"><Plus size={16} /> Propose change</summary><form action={createPullRequestAction} className="panel"><input type="hidden" name="repositoryId" value={row.repository.id}/><label>Title<input name="title" required minLength={3}/></label><div className="form-row"><label>From<select name="headBranch">{branches.filter((branch) => branch !== row.repository.defaultBranch).map((branch) => <option key={branch}>{branch}</option>)}</select></label><label>Into<select name="baseBranch" defaultValue={row.repository.defaultBranch}>{branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label></div><label>Decision context<textarea name="body" rows={4}/></label><label className="check-label"><input type="checkbox" name="draft" value="true"/> Keep as draft</label><button className="button button-primary">Open change request</button></form></details></div></div>
    <div className="decision-principle panel"><ShieldCheck size={18}/><div><b>The merge decision is the product.</b><span>Origin requires approval, blocks requested changes, respects every reported status, and performs the Git merge itself.</span></div></div>
    <div className="filter-bar"><button className="active"><GitPullRequest size={15} /> Open</button><button><GitMerge size={15} /> Merged</button><span>{items.length} recorded changes</span></div>
    {items.length ? <section className="change-list">{items.map((pull) => <Link href={`/${owner}/${repo}/pulls/${pull.number}`} className="panel" key={pull.id}><div className={`change-state ${pull.status}`}><GitPullRequest /></div><div className="change-copy"><h2>{pull.title}</h2><p>#{pull.number} by {pull.authorName} · {pull.headBranch} <ArrowRight size={13} /> {pull.baseBranch}</p><div className="change-metrics"><span className="additions">+{pull.additions}</span><span className="deletions">−{pull.deletions}</span><span>{pull.changedFiles} files</span>{pull.draft && <span>draft</span>}</div></div><span className={`status-chip ${pull.status}`}>{pull.status}</span></Link>)}</section> : <EmptyState icon={<GitPullRequest />} title="No changes proposed" detail={branches.length > 1 ? "Compare a branch with the default branch and open the first merge decision." : "Create a branch, push a commit, then propose the first change."} />}
  </RepoShell>;
}
