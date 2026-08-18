import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, Check, CircleAlert, CircleDashed, FileDiff, FlaskConical, GitPullRequest, History, Play, ShieldCheck, Sparkles, Undo2 } from "lucide-react";
import { approveAgentRunAction, createAgentRunAction, rollbackAgentRunAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { RepoShell } from "@/components/repo-shell";
import { getRepository, getRepositoryIncidents, getRepositoryRuns } from "@/lib/data";

export const metadata = { title: "Agents" };

const statusCopy: Record<string, string> = {
  queued: "Queued for planning",
  planning: "Reading the repository",
  ready: "Plan ready — awaiting your approval",
  approved: "Approved — sandbox starting",
  executing: "Executing in a disposable sandbox",
  reviewing: "Independent review agent is judging the patch",
  executed: "Change published with evidence — human merge decision remains",
  blocked: "Blocked by the independent review agent",
  failed: "Execution failed",
  rolled_back: "Merged change was rolled back",
};

const artifactIcon = (kind: string) => kind === "patch" ? <FileDiff size={13} /> : kind === "test" ? <FlaskConical size={13} /> : kind === "review" ? <ShieldCheck size={13} /> : <History size={13} />;

export default async function AgentsPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const row = await getRepository(owner, repo);
  if (!row) notFound();
  const [runs, incidentRows] = await Promise.all([getRepositoryRuns(row.repository.id), getRepositoryIncidents(row.repository.id)]);
  const openIncidents = incidentRows.filter((incident) => incident.status === "open");
  const base = `/${owner}/${repo}`;
  return <RepoShell organization={row.organization} repository={row.repository} active="agents">
    <div className="agent-hero panel">
      <div>
        <p className="eyebrow-simple">OBJECTIVE → SANDBOX → EVIDENCE → HUMAN MERGE</p>
        <h1>Give the repository a job.</h1>
        <p>Origin plans first. Execution runs in a disposable, network-controlled sandbox, publishes to an agent branch with patch and test evidence, passes an independent review agent, and still ends at a human merge decision.</p>
        <form action={createAgentRunAction}>
          <input type="hidden" name="repositoryId" value={row.repository.id} />
          <textarea name="objective" required minLength={10} rows={3} placeholder="Describe the outcome. Example: Add offline project sync and prove it survives an app restart." />
          <div><span><ShieldCheck size={15} /> Planning is safe and read-only</span><button className="button button-primary">Plan objective <Sparkles size={16} /></button></div>
        </form>
      </div>
      <div className="agent-orbit" aria-hidden="true"><span><Bot /></span><i /><i /><i /><b>HUMAN<br />DECISION</b></div>
    </div>
    {openIncidents.length > 0 && <div className="incident-banner panel">
      <CircleAlert size={17} />
      <div><b>{openIncidents.length} open incident{openIncidents.length > 1 ? "s" : ""}</b><span>{openIncidents[0]!.title}{openIncidents.length > 1 ? " and more." : "."} Review and resolve in <Link href={`${base}/settings/incidents`}>the incident trail</Link>.</span></div>
    </div>}
    <div className="section-heading compact"><div><p className="eyebrow-simple">RUN HISTORY</p><h2>Objectives</h2></div><span>{runs.length} runs</span></div>
    {runs.length ? <section className="runs-list">
      {runs.map((run) => <article className="panel run-card" key={run.id}>
        <div className={`run-status ${run.status}`}>{run.status === "executed" ? <Check /> : run.status === "blocked" || run.status === "failed" ? <CircleAlert /> : <CircleDashed />}</div>
        <div className="run-main">
          <div className="run-title"><h3>{run.objective}</h3><span>{run.status.replace("_", " ")}</span></div>
          <p className="run-state-line">{statusCopy[run.status] ?? run.status}</p>
          {run.summary && <p>{run.summary}</p>}
          {run.error && <p className="run-error">{run.error}</p>}
          {run.plan.length > 0 && <ol>{run.plan.map((step, index) => <li key={`${step.step}-${index}`}><span>{index + 1}</span>{step.step}<small>{step.status}</small></li>)}</ol>}
          {run.review && <div className={`run-review ${run.review.verdict}`}><ShieldCheck size={14} /><div><b>Independent review: {run.review.verdict === "approve" ? "passed" : "blocked"}</b><span>{run.review.summary}</span>{run.review.concerns.length > 0 && <ul>{run.review.concerns.map((concern) => <li key={concern}>{concern}</li>)}</ul>}</div></div>}
          {run.artifacts.length > 0 && <details className="evidence-drawer">
            <summary>{run.artifacts.length} evidence artifact{run.artifacts.length > 1 ? "s" : ""}</summary>
            <div>{run.artifacts.map((artifact) => <details className="evidence-item" key={artifact.id}>
              <summary>{artifactIcon(artifact.kind)} <b>{artifact.title}</b><em>{artifact.kind}</em></summary>
              <pre>{artifact.content || "No content recorded."}</pre>
            </details>)}</div>
          </details>}
          <div className="run-meta">
            <span>{run.model || "model pending"}</span>
            <span>{run.createdAt.toLocaleString()}</span>
            {run.branch && <span>{run.branch}</span>}
            {run.evidence.length > 0 && <span>{run.evidence.length} grounded paths</span>}
          </div>
          <div className="run-actions">
            {run.status === "ready" && <form action={approveAgentRunAction}>
              <input type="hidden" name="repositoryId" value={row.repository.id} />
              <input type="hidden" name="runId" value={run.id} />
              <button className="button button-primary"><Play size={14} /> Approve &amp; execute in sandbox</button>
            </form>}
            {run.pullRequestNumber && <Link className="button" href={`${base}/pulls/${run.pullRequestNumber}`}><GitPullRequest size={14} /> Change #{run.pullRequestNumber}</Link>}
            {run.status === "executed" && run.pullRequestNumber && <form action={rollbackAgentRunAction}>
              <input type="hidden" name="repositoryId" value={row.repository.id} />
              <input type="hidden" name="runId" value={run.id} />
              <button className="button button-danger"><Undo2 size={14} /> Roll back if merged</button>
            </form>}
          </div>
        </div>
      </article>)}
    </section> : <EmptyState icon={<Play />} title="No agent objectives yet" detail="Describe a useful outcome above. Origin will inspect this repository and prepare a reviewable plan before anything executes." />}
  </RepoShell>;
}
