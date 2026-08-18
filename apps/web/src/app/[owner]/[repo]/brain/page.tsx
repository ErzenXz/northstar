import { notFound } from "next/navigation";
import { AlertTriangle, BrainCircuit, FileCode2, Network, RefreshCw, Scale, Sparkles } from "lucide-react";
import { queueBrainRefreshAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { RepoShell } from "@/components/repo-shell";
import { getRepository, getRepositoryBrain } from "@/lib/data";

export const metadata = { title: "Repository brain" };

const sections = {
  purpose: { title: "Purpose", icon: Sparkles },
  architecture: { title: "Architecture", icon: Network },
  convention: { title: "Working conventions", icon: Scale },
  risk: { title: "Known risks", icon: AlertTriangle },
} as const;

export default async function BrainPage({ params, searchParams }: { params: Promise<{ owner: string; repo: string }>; searchParams: Promise<{ refresh?: string }> }) {
  const { owner, repo } = await params;
  const row = await getRepository(owner, repo);
  if (!row) notFound();
  const memories = await getRepositoryBrain(row.repository.id);
  const { refresh } = await searchParams;
  return <RepoShell organization={row.organization} repository={row.repository} active="brain">{refresh === "queued" && <div className="status-banner"><span className="spinner" /><div><b>Repository analysis queued</b><p>The cartographer is reading project-defining files and will replace this memory map when ready.</p></div></div>}<div className="section-heading"><div><h1>Repository brain</h1><p>Grounded context agents and new teammates can use without guessing.</p></div><form action={queueBrainRefreshAction}><input type="hidden" name="repositoryId" value={row.repository.id} /><button className="button button-quiet"><RefreshCw size={16} /> Rebuild map</button></form></div>{memories.length ? <div className="brain-layout"><aside className="brain-index panel"><BrainCircuit /><h2>{row.repository.name} knows</h2><strong>{memories.length}</strong><span>grounded memories</span><div className="brain-meter"><i style={{ width: `${Math.min(100, memories.reduce((sum, item) => sum + item.confidence, 0) / memories.length)}%` }} /></div><small>Average confidence based on available source</small></aside><div className="brain-sections">{Object.entries(sections).map(([kind, config]) => { const entries = memories.filter((memory) => memory.kind === kind); if (!entries.length) return null; const Icon = config.icon; return <section className="panel memory-section" key={kind}><div className="memory-heading"><Icon /><h2>{config.title}</h2><span>{entries.length}</span></div>{entries.map((memory) => <article key={memory.id}><div><h3>{memory.title}</h3><p>{memory.content}</p>{memory.sourcePath && <span className="source-path"><FileCode2 size={13} />{memory.sourcePath}</span>}</div><small>{memory.confidence}%</small></article>)}</section>; })}</div></div> : <EmptyState icon={<BrainCircuit />} title="This repository has no memory yet" detail="Build a source-grounded map of its purpose, architecture, conventions, and risks." action={<form action={queueBrainRefreshAction}><input type="hidden" name="repositoryId" value={row.repository.id} /><button className="button button-primary">Build repository brain</button></form>} />}</RepoShell>;
}
