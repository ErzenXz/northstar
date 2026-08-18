import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, CircleAlert, ShieldAlert } from "lucide-react";
import { resolveIncidentAction } from "@/app/actions";
import { EmptyState } from "@/components/empty-state";
import { RepoShell } from "@/components/repo-shell";
import { getRepositoryForMember, getRepositoryIncidents } from "@/lib/data";

export const metadata = { title: "Incidents" };

export default async function IncidentsPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const row = await getRepositoryForMember(owner, repo);
  if (!row) notFound();
  const rows = await getRepositoryIncidents(row.repository.id);
  return <RepoShell organization={row.organization} repository={row.repository} active="settings">
    <nav className="subnav"><Link href={`/${owner}/${repo}/settings/hooks`}>Webhooks</Link><Link href={`/${owner}/${repo}/settings/keys`}>Deploy keys</Link><Link href={`/${owner}/${repo}/settings/policies`}>Policy gates</Link><Link className="active" href={`/${owner}/${repo}/settings/incidents`}>Incidents</Link></nav>
    <div className="section-heading"><div><p className="eyebrow-simple">ACCOUNTABILITY TRAIL</p><h1>Incidents</h1><p>Failed executions, review blocks, and rollbacks are recorded here until a person resolves them.</p></div></div>
    {rows.length ? <section className="incident-list">
      {rows.map((incident) => <article className={`panel incident-card ${incident.status}`} key={incident.id}>
        {incident.status === "open" ? <CircleAlert /> : <Check />}
        <div>
          <b>{incident.title}</b>
          <p>{incident.detail || "No further detail was recorded."}</p>
          <small>{incident.kind} · {incident.createdAt.toLocaleString()}{incident.resolvedBy ? ` · resolved by ${incident.resolvedBy}` : ""}</small>
        </div>
        {incident.status === "open" && <form action={resolveIncidentAction}>
          <input type="hidden" name="repositoryId" value={row.repository.id} />
          <input type="hidden" name="incidentId" value={incident.id} />
          <button className="button">Resolve</button>
        </form>}
      </article>)}
    </section> : <EmptyState icon={<ShieldAlert />} title="No incidents" detail="Agent failures, blocked reviews, and rollbacks will appear here with their full context." />}
  </RepoShell>;
}
