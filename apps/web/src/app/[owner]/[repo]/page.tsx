import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, BrainCircuit, ChevronRight, CircleDot, File, FileCode2, Folder, GitBranch, GitCommitHorizontal, GitPullRequest, Radio, Sparkles } from "lucide-react";
import { listCommits, listTree, readReadme, repositoryExists } from "@origin/git";
import { RepoShell } from "@/components/repo-shell";
import { CloneBox } from "@/components/clone-box";
import { getRepository, getRepositoryOverview } from "@/lib/data";
import { gitCloneUrl, repositoryRoot } from "@/lib/repository";

export default async function RepositoryPage({ params, searchParams }: { params: Promise<{ owner: string; repo: string }>; searchParams: Promise<{ import?: string }> }) {
  const { owner, repo } = await params;
  const query = await searchParams;
  const row = await getRepository(owner, repo);
  if (!row) notFound();
  const { repository, organization } = row;
  const exists = await repositoryExists(repositoryRoot, repository.storageKey);
  let tree: Awaited<ReturnType<typeof listTree>> = [];
  let commits: Awaited<ReturnType<typeof listCommits>> = [];
  let readme: Awaited<ReturnType<typeof readReadme>> = null;
  if (exists) {
    try {
      [tree, commits, readme] = await Promise.all([
        listTree(repositoryRoot, repository.storageKey, repository.defaultBranch),
        listCommits(repositoryRoot, repository.storageKey, repository.defaultBranch, 8),
        readReadme(repositoryRoot, repository.storageKey, repository.defaultBranch),
      ]);
    } catch { /* An empty repository has no branch to inspect yet. */ }
  }
  const overview = await getRepositoryOverview(repository.id);
  const base = `/${organization.slug}/${repository.slug}`;
  return <RepoShell organization={organization} repository={repository} active="code">
    {query.import === "queued" && <div className="status-banner"><span className="spinner" /> <div><b>Migration queued</b><p>The worker is mirroring Git history, issues, and changes. This page fills in automatically when the job completes.</p></div></div>}
    <div className="repo-toolbar"><div className="branch-select"><GitBranch size={16} /><b>{repository.defaultBranch}</b><ChevronRight size={14} /></div><CloneBox url={gitCloneUrl(owner, repo)} /></div>
    {tree.length ? <div className="repo-main-grid"><div className="repo-primary">
      <section className="file-browser panel"><div className="latest-commit"><span className="event-node human">{commits[0]?.author.slice(0, 2).toUpperCase() || "G"}</span><p><b>{commits[0]?.author || "Git"}</b> {commits[0]?.subject || "Repository initialized"}<small>{commits[0]?.shortHash} · {commits[0] ? new Date(commits[0].date).toLocaleDateString() : "now"}</small></p></div>{tree.map((entry) => <Link href={`${base}/tree/${entry.path}`} key={entry.path} className="file-row">{entry.type === "tree" ? <Folder size={17} /> : entry.name.match(/\.(ts|tsx|js|py|rs|go)$/) ? <FileCode2 size={17} /> : <File size={17} />}<b>{entry.name}</b><span>{entry.type === "tree" ? "directory" : entry.size ? `${Math.max(1, Math.round(entry.size / 1024))} KB` : "file"}</span><ChevronRight size={15} /></Link>)}</section>
      {readme && <section className="readme panel"><div className="readme-title"><FileCode2 size={17} /><b>{readme.name}</b></div><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{readme.content}</ReactMarkdown></div></section>}
    </div><aside className="repo-sidebar">
      <section className="side-card panel"><div className="side-title"><Radio size={16} /><b>Repository pulse</b><span>live</span></div><div className="mini-pulse"><i /><i /><i /><i /><i /><i /><i /><i /></div>{overview.events.length ? <div className="activity-list">{overview.events.slice(0, 5).map((event) => <div key={event.id}><span className={`event-dot ${event.actorType}`} /> <p><b>{event.actorName}</b>{event.title}<small>{event.createdAt.toLocaleString()}</small></p></div>)}</div> : <p className="muted side-copy">Human and agent work will appear on this shared timeline.</p>}</section>
      <section className="side-card panel"><div className="side-title"><BrainCircuit size={16} /><b>Repository brain</b></div><p className="side-copy">Architecture, conventions, risks, and decisions grounded in this source.</p><Link href={`${base}/brain`}>Open project memory <ChevronRight size={15} /></Link></section>
      <div className="side-stats"><Link href={`${base}/issues`}><CircleDot /><b>{overview.openIssues.length}</b><span>Open issues</span></Link><Link href={`${base}/pulls`}><GitPullRequest /><b>{overview.openPulls.length}</b><span>Open changes</span></Link><Link href={`${base}/agents`}><Bot /><b>{overview.runs.length}</b><span>Agent runs</span></Link></div>
    </aside></div> : <section className="empty-repository panel"><div className="empty-orbit"><GitCommitHorizontal /><i /><i /></div><p className="eyebrow-simple">EMPTY REPOSITORY</p><h2>Make the first commit.</h2><p>Origin is ready to receive source over Git. Create an access token, then push your existing project.</p><pre><code>{`git remote add origin ${gitCloneUrl(owner, repo)}\ngit branch -M ${repository.defaultBranch}\ngit push -u origin ${repository.defaultBranch}`}</code></pre><div><Link href="/settings/tokens" className="button button-primary">Create access token</Link><Link href="/import" className="button button-quiet"><Sparkles size={16} /> Import instead</Link></div></section>}
  </RepoShell>;
}
