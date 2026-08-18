import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Fingerprint, KeyRound, Network } from "lucide-react";
import { getDb, sshKeys } from "@origin/db";
import { addSshKeyAction } from "@/app/actions";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "SSH keys" };
export default async function SshKeysPage() {
  const user = await requireUser();
  const keys = await getDb().select().from(sshKeys).where(eq(sshKeys.userId, user.id)).orderBy(desc(sshKeys.createdAt));
  return <main className="settings-page shell-narrow"><nav className="settings-nav"><Link href="/settings/tokens">Tokens</Link><Link className="active" href="/settings/ssh">SSH keys</Link><Link href="/settings/runners">Runners</Link><Link href="/settings/workspace">Workspace</Link></nav><div className="flow-heading"><div className="flow-icon"><Network/></div><p className="eyebrow-simple">DEVELOPER SETTINGS</p><h1>SSH keys</h1><p>Clone and push without entering an HTTPS token. Origin identifies the key, then checks repository access for every command.</p></div><section className="panel settings-section"><div><h2>Add a public key</h2><p>Ed25519 is recommended. Private keys never leave your machine.</p></div><form action={addSshKeyAction} className="form-stack"><label>Title<input name="title" required placeholder="MacBook Pro"/></label><label>Public key<textarea name="publicKey" required rows={4} placeholder="ssh-ed25519 AAAA…"/></label><button className="button button-primary"><KeyRound size={16}/> Add SSH key</button></form></section><section className="panel settings-section"><div><h2>Active keys</h2><p>Fingerprints make keys recognizable without exposing private material.</p></div><div className="token-list">{keys.map((key) => <div key={key.id}><Fingerprint size={17}/><span><b>{key.title}</b><small>{key.fingerprint} · {key.lastUsedAt ? `used ${key.lastUsedAt.toLocaleDateString()}` : "never used"}</small></span></div>)}</div></section></main>;
}
