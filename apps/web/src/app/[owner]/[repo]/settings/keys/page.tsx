import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { Fingerprint, KeyRound, LockKeyhole } from "lucide-react";
import { deployKeys, getDb } from "@origin/db";
import { addDeployKeyAction } from "@/app/actions";
import { RepoShell } from "@/components/repo-shell";
import { getRepositoryForMember } from "@/lib/data";

export const metadata = { title: "Deploy keys" };
export default async function DeployKeysPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const row = await getRepositoryForMember(owner, repo);
  if (!row) notFound();
  const keys = await getDb().select().from(deployKeys).where(eq(deployKeys.repositoryId, row.repository.id)).orderBy(desc(deployKeys.createdAt));
  return <RepoShell organization={row.organization} repository={row.repository} active="settings"><nav className="subnav"><Link href={`/${owner}/${repo}/settings/hooks`}>Webhooks</Link><Link className="active" href={`/${owner}/${repo}/settings/keys`}>Deploy keys</Link><Link href={`/${owner}/${repo}/settings/policies`}>Policy gates</Link><Link href={`/${owner}/${repo}/settings/incidents`}>Incidents</Link></nav><div className="section-heading"><div><p className="eyebrow-simple">REPOSITORY MACHINES</p><h1>Deploy keys</h1><p>Give one machine access to this repository only. Read access is the default.</p></div></div><section className="panel settings-section"><div><h2>Add deploy key</h2><p>Enable write access only when the deployment system must push Git refs.</p></div><form action={addDeployKeyAction} className="form-stack"><input type="hidden" name="repositoryId" value={row.repository.id}/><label>Title<input name="title" required placeholder="Production deploy"/></label><label>Public key<textarea name="publicKey" required rows={4} placeholder="ssh-ed25519 AAAA…"/></label><label className="check-label"><input type="checkbox" name="canWrite" value="true"/> Allow Git push</label><button className="button button-primary"><KeyRound size={16}/> Add deploy key</button></form></section><section className="panel settings-section"><div><h2>Repository keys</h2><p>Every key is fingerprinted and scoped to this repository.</p></div><div className="token-list">{keys.map((key) => <div key={key.id}>{key.canWrite ? <LockKeyhole size={17}/> : <Fingerprint size={17}/>}<span><b>{key.title}</b><small>{key.fingerprint} · {key.canWrite ? "read/write" : "read only"} · {key.lastUsedAt ? `used ${key.lastUsedAt.toLocaleDateString()}` : "never used"}</small></span></div>)}</div></section></RepoShell>;
}
