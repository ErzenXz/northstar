import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { updatePolicyGatesAction } from "@/app/actions";
import { RepoShell } from "@/components/repo-shell";
import { getRepositoryForMember, getRepositoryPolicyGates } from "@/lib/data";

export const metadata = { title: "Policy gates" };

export default async function PoliciesPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const row = await getRepositoryForMember(owner, repo);
  if (!row) notFound();
  const gates = await getRepositoryPolicyGates(row.repository.id);
  return <RepoShell organization={row.organization} repository={row.repository} active="settings">
    <nav className="subnav"><Link href={`/${owner}/${repo}/settings/hooks`}>Webhooks</Link><Link href={`/${owner}/${repo}/settings/keys`}>Deploy keys</Link><Link className="active" href={`/${owner}/${repo}/settings/policies`}>Policy gates</Link><Link href={`/${owner}/${repo}/settings/incidents`}>Incidents</Link></nav>
    <div className="section-heading"><div><h1>Policy gates</h1><p>Every agent execution in this repository runs against these gates. Human approval before execution and before merge can never be disabled.</p></div></div>
    <section className="panel settings-section">
      <div><h2>Execution policy</h2><p>Applied inside the disposable sandbox and by the independent review agent before a change can be merged.</p></div>
      <form action={updatePolicyGatesAction} className="form-stack">
        <input type="hidden" name="repositoryId" value={row.repository.id} />
        <label className="check-label"><input type="checkbox" checked disabled /> Require human approval before execution and merge <span>Always on</span></label>
        <label className="check-label"><input type="checkbox" name="requireAgentReview" defaultChecked={gates?.requireAgentReview ?? true} /> Require the independent review agent to pass</label>
        <label className="check-label"><input type="checkbox" name="requirePassingChecks" defaultChecked={gates?.requirePassingChecks ?? true} /> Require reported commit statuses to pass</label>
        <label className="check-label"><input type="checkbox" name="runTests" defaultChecked={gates?.runTests ?? true} /> Run the repository test command in the sandbox</label>
        <label className="check-label"><input type="checkbox" name="allowNetwork" defaultChecked={gates?.allowNetwork ?? false} /> Allow sandbox network access <span>Off by default; the isolation level is recorded as evidence</span></label>
        <label>Maximum changed files per agent change<input type="number" name="maxChangedFiles" min={1} max={500} defaultValue={gates?.maxChangedFiles ?? 25} /></label>
        <label>Blocked write paths <span>One prefix per line; agents can never write here</span><textarea name="blockedPaths" rows={4} defaultValue={(gates?.blockedPaths ?? [".git/", ".northstar/policies"]).join("\n")} /></label>
        <button className="button button-primary"><ShieldCheck size={16} /> Save policy gates</button>
      </form>
    </section>
  </RepoShell>;
}
