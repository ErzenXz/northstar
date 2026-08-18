import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { Check, CircleAlert, CircleDot, FileDiff, GitMerge, MessageSquare, ShieldCheck, X } from "lucide-react";
import { commitStatuses, getDb } from "@origin/db";
import { compareBranches } from "@origin/git";
import { commentOnPullRequestAction, mergePullRequestAction, reviewPullRequestAction } from "@/app/actions";
import { RepoShell } from "@/components/repo-shell";
import { getPullRequestDetail, getRepository } from "@/lib/data";
import { repositoryRoot } from "@/lib/repository";

export default async function PullRequestPage({ params }: { params: Promise<{ owner: string; repo: string; number: string }> }) {
  const { owner, repo, number } = await params;
  const row = await getRepository(owner, repo);
  if (!row) notFound();
  const detail = await getPullRequestDetail(row.repository.id, Number(number));
  if (!detail) notFound();
  const comparison = await compareBranches(repositoryRoot, row.repository.storageKey, detail.pull.baseBranch, detail.pull.headBranch).catch(() => null);
  const sha = comparison?.headSha ?? detail.pull.headSha;
  const records = sha ? await getDb().select().from(commitStatuses).where(and(eq(commitStatuses.repositoryId, row.repository.id), eq(commitStatuses.sha, sha))).orderBy(desc(commitStatuses.createdAt)) : [];
  const latestStatuses = new Map<string, typeof records[number]>();
  for (const status of records) if (!latestStatuses.has(status.context)) latestStatuses.set(status.context, status);
  const reviewerStates = new Map<string, string>();
  for (const review of detail.reviews) if (review.commitSha === sha && !reviewerStates.has(review.reviewerName)) reviewerStates.set(review.reviewerName, review.state);
  const approved = [...reviewerStates.values()].includes("approved");
  const changesRequested = [...reviewerStates.values()].includes("changes_requested");
  const checksPass = [...latestStatuses.values()].every((status) => status.state === "success");
  const ready = detail.pull.status === "open" && approved && !changesRequested && checksPass;

  return <RepoShell organization={row.organization} repository={row.repository} active="pulls">
    <header className="decision-header"><div><h1>{detail.pull.title}</h1><p>{detail.pull.authorName} wants to merge <code>{detail.pull.headBranch}</code> into <code>{detail.pull.baseBranch}</code></p></div><span className={`status-chip ${detail.pull.status}`}>{detail.pull.status}</span></header>
    <div className="decision-layout"><div className="decision-main">
      <section className="decision-body panel"><h2>Decision context</h2><p>{detail.pull.body || "No context was provided."}</p></section>
      <section className="diff-section"><div className="section-heading compact"><div><h2>{comparison ? `${comparison.files.length} changed files` : "Diff unavailable"}</h2></div>{comparison && <div className="change-metrics"><span className="additions">+{comparison.additions}</span><span className="deletions">−{comparison.deletions}</span></div>}</div>
        {comparison?.files.map((file) => <article className="diff-file panel" key={file.path}><header><FileDiff size={16}/><b>{file.path}</b><span className="additions">+{file.additions}</span><span className="deletions">−{file.deletions}</span></header><pre>{file.patch.split("\n").map((line, index) => <code className={line.startsWith("+") && !line.startsWith("+++") ? "diff-add" : line.startsWith("-") && !line.startsWith("---") ? "diff-remove" : line.startsWith("@@") ? "diff-hunk" : ""} key={index}>{line || " "}</code>)}</pre><details className="inline-comment"><summary><MessageSquare size={14}/> Comment on this file</summary><form action={commentOnPullRequestAction}><input type="hidden" name="repositoryId" value={row.repository.id}/><input type="hidden" name="pullRequestId" value={detail.pull.id}/><input type="hidden" name="path" value={file.path}/><textarea name="body" required rows={3} placeholder="What should the author understand or change?"/><button className="button button-primary">Post file comment</button></form></details></article>)}
      </section>
      <section className="conversation"><div className="section-heading compact"><div><h2>{detail.comments.length + detail.reviews.length} decisions and comments</h2></div></div>{[...detail.comments, ...detail.reviews].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((item) => <article className="timeline-comment panel" key={item.id}><div className="avatar tiny">{"authorName" in item ? item.authorName.slice(0,2).toUpperCase() : item.reviewerName.slice(0,2).toUpperCase()}</div><div><header><b>{"authorName" in item ? item.authorName : item.reviewerName}</b><span>{item.createdAt.toLocaleString()}</span>{"state" in item && <em className={`review-state ${item.state}`}>{item.state.replace("_", " ")}{item.commitSha !== sha ? " · earlier commit" : ""}</em>}</header><p>{item.body || ("state" in item ? `Marked this change ${item.state.replace("_", " ")}.` : "")}</p>{"path" in item && item.path && <code>{item.path}{item.line ? `:${item.line}` : ""}</code>}</div></article>)}<form action={commentOnPullRequestAction} className="panel comment-form"><input type="hidden" name="repositoryId" value={row.repository.id}/><input type="hidden" name="pullRequestId" value={detail.pull.id}/><textarea name="body" required rows={4} placeholder="Add context, ask a question, or record a decision…"/><button className="button button-primary">Comment</button></form></section>
    </div><aside className="decision-rail">
      <section className={`merge-gate panel ${ready ? "ready" : "blocked"}`}><h2>{detail.pull.status === "merged" ? <><GitMerge size={16}/> Merged</> : ready ? <><Check size={16}/> Ready to merge</> : <><CircleAlert size={16}/> Decision incomplete</>}</h2><p>{detail.pull.status === "merged" ? `Commit ${detail.pull.mergeCommitSha?.slice(0, 12)}` : ready ? "Approval and reported checks are complete." : "Complete every gate below before Origin will update the base branch."}</p>{detail.pull.status === "open" && <form action={mergePullRequestAction}><input type="hidden" name="repositoryId" value={row.repository.id}/><input type="hidden" name="pullRequestId" value={detail.pull.id}/><button className="button button-primary button-wide" disabled={!ready}><GitMerge size={16}/> Merge change</button></form>}</section>
      <section className="gate-list panel"><h3>Merge gates</h3><div className={approved ? "pass" : "wait"}>{approved ? <Check/> : <CircleDot/>}<span><b>Approval</b><small>{approved ? "Recorded" : "One approval required"}</small></span></div><div className={!changesRequested ? "pass" : "fail"}>{!changesRequested ? <Check/> : <X/>}<span><b>Requested changes</b><small>{changesRequested ? "Must be resolved" : "None active"}</small></span></div><div className={checksPass ? "pass" : "fail"}>{checksPass ? <Check/> : <X/>}<span><b>Commit statuses</b><small>{latestStatuses.size ? `${latestStatuses.size} reported` : "No checks reported"}</small></span></div></section>
      <section className="panel review-box"><h3>Record your decision</h3><form action={reviewPullRequestAction}><input type="hidden" name="repositoryId" value={row.repository.id}/><input type="hidden" name="pullRequestId" value={detail.pull.id}/><textarea name="body" rows={3} placeholder="Optional review note"/><div className="review-actions"><button name="state" value="approved" className="button approve"><ShieldCheck size={15}/> Approve</button><button name="state" value="changes_requested" className="button request"><CircleAlert size={15}/> Request changes</button></div></form></section>
      {[...latestStatuses.values()].length > 0 && <section className="panel status-list"><h3>Reported checks</h3>{[...latestStatuses.values()].map((status) => <div key={status.context} className={status.state}><CircleDot/><span><b>{status.context}</b><small>{status.description || status.state}</small></span></div>)}</section>}
    </aside></div>
  </RepoShell>;
}
