import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CircleSlash, GitBranch, GitMerge, GitPullRequest, Plus } from "lucide-react";
import { createBranchAction, createPullRequestAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { Popover } from "@/components/popover";
import { RepoShell } from "@/components/repo-shell";
import { getRepository, getRepositoryPulls } from "@/lib/data";
import { repositoryRoot } from "@/lib/repository";
import { listBranches } from "@origin/git";

export const metadata = { title: "Changes" };

export default async function PullsPage({ params, searchParams }: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ state?: string }>;
}) {
  const [{ owner, repo }, { state }] = await Promise.all([params, searchParams]);
  const row = await getRepository(owner, repo);
  if (!row) notFound();
  const [items, branches] = await Promise.all([getRepositoryPulls(row.repository.id), listBranches(repositoryRoot, row.repository.storageKey).catch(() => [])]);
  const base = `/${owner}/${repo}`;
  const active = state === "merged" || state === "closed" ? state : "open";
  const count = (status: string) => items.filter((pull) => pull.status === status).length;
  const visible = items.filter((pull) => pull.status === active);
  return <RepoShell organization={row.organization} repository={row.repository} active="pulls">
    <div className="section-heading"><div><h1>Changes</h1><p>Branches become decisions through diff, conversation, checks, and explicit approval.</p></div><div className="action-cluster"><Popover summary={<><GitBranch size={16} /> New branch</>}><form action={createBranchAction} className="panel"><input type="hidden" name="repositoryId" value={row.repository.id}/><label>Branch name<input name="branch" required placeholder="feature/offline-sync" /></label><label>Start from<select name="from">{branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label><button className="button button-primary">Create branch</button></form></Popover><Popover primary summary={<><Plus size={16} /> Propose change</>}><form action={createPullRequestAction} className="panel"><input type="hidden" name="repositoryId" value={row.repository.id}/><label>Title<input name="title" required minLength={3}/></label><div className="form-row"><label>From<select name="headBranch">{branches.filter((branch) => branch !== row.repository.defaultBranch).map((branch) => <option key={branch}>{branch}</option>)}</select></label><label>Into<select name="baseBranch" defaultValue={row.repository.defaultBranch}>{branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label></div><label>Decision context<textarea name="body" rows={4}/></label><label className="check-label"><input type="checkbox" name="draft" value="true"/> Keep as draft</label><button className="button button-primary">Open change request</button></form></Popover></div></div>
    <div className="filter-bar">
      <Link className={active === "open" ? "filter-link active" : "filter-link"} href={`${base}/pulls`}><GitPullRequest size={15} /> Open <b>{count("open")}</b></Link>
      <Link className={active === "merged" ? "filter-link active" : "filter-link"} href={`${base}/pulls?state=merged`}><GitMerge size={15} /> Merged <b>{count("merged")}</b></Link>
      <Link className={active === "closed" ? "filter-link active" : "filter-link"} href={`${base}/pulls?state=closed`}><CircleSlash size={15} /> Closed <b>{count("closed")}</b></Link>
      <span>{items.length} recorded changes</span>
    </div>
    {visible.length ? <section className="change-list">{visible.map((pull) => <Link href={`${base}/pulls/${pull.number}`} className="panel" key={pull.id}><div className={`change-state ${pull.status}`}><GitPullRequest /></div><div className="change-copy"><h2>{pull.title}</h2><p>#{pull.number} by {pull.authorName} · {pull.headBranch} <ArrowRight size={13} /> {pull.baseBranch}</p><div className="change-metrics"><span className="additions">+{pull.additions}</span><span className="deletions">−{pull.deletions}</span><span>{pull.changedFiles} files</span>{pull.draft && <span>draft</span>}</div></div><span className={`status-chip ${pull.status}`}>{pull.status}</span></Link>)}</section> : <EmptyState icon={active === "merged" ? <GitMerge /> : <GitPullRequest />} title={active === "open" ? "No changes proposed" : `No ${active} changes`} detail={active === "open" ? (branches.length > 1 ? "Compare a branch with the default branch and open the first merge decision." : "Create a branch, push a commit, then propose the first change.") : `Changes that are ${active} will keep their full decision record here.`} />}
  </RepoShell>;
}
