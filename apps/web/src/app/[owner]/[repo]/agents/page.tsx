import { notFound } from "next/navigation";
import { Bot, Check, ChevronRight, CircleDashed, FileSearch, Play, ShieldCheck, Sparkles } from "lucide-react";
import { createAgentRunAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { RepoShell } from "@/components/repo-shell";
import { getRepository, getRepositoryRuns } from "@/lib/data";

export const metadata = { title: "Agents" };

export default async function AgentsPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const row = await getRepository(owner, repo);
  if (!row) notFound();
  const runs = await getRepositoryRuns(row.repository.id);
  return <RepoShell organization={row.organization} repository={row.repository} active="agents"><div className="agent-hero panel"><div><p className="eyebrow-simple">OBJECTIVE → EVIDENCE</p><h1>Give the repository a job.</h1><p>Origin starts with a grounded plan. Execution stays behind human approval and an isolated workspace boundary.</p><form action={createAgentRunAction}><input type="hidden" name="repositoryId" value={row.repository.id} /><textarea name="objective" required minLength={10} rows={3} placeholder="Describe the outcome. Example: Add offline project sync and prove it survives an app restart." /><div><span><ShieldCheck size={15} /> Planning is safe and read-only</span><button className="button button-primary">Plan objective <Sparkles size={16} /></button></div></form></div><div className="agent-orbit" aria-hidden="true"><span><Bot /></span><i /><i /><i /><b>HUMAN<br />DECISION</b></div></div><div className="section-heading compact"><div><p className="eyebrow-simple">RUN HISTORY</p><h2>Objectives</h2></div><span>{runs.length} runs</span></div>{runs.length ? <section className="runs-list">{runs.map((run) => <article className="panel run-card" key={run.id}><div className={`run-status ${run.status}`}>{run.status === "ready" ? <Check /> : run.status === "failed" ? <FileSearch /> : <CircleDashed />}</div><div className="run-main"><div className="run-title"><h3>{run.objective}</h3><span>{run.status}</span></div><p>{run.summary || "Origin is inspecting the repository and preparing a bounded plan."}</p>{run.plan.length > 0 && <ol>{run.plan.map((step, index) => <li key={`${step.step}-${index}`}><span>{index + 1}</span>{step.step}<small>{step.status}</small></li>)}</ol>}<div className="run-meta"><span>{run.model || "model pending"}</span><span>{run.createdAt.toLocaleString()}</span>{run.evidence.length > 0 && <span>{run.evidence.length} grounded paths</span>}</div></div>{run.status === "ready" && <button className="icon-button" title="Execution sandbox is the next alpha milestone" aria-label="Review plan"><ChevronRight /></button>}</article>)}</section> : <EmptyState icon={<Play />} title="No agent objectives yet" detail="Describe a useful outcome above. Origin will inspect this repository and prepare a reviewable plan." />}</RepoShell>;
}
