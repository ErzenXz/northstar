import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { KeyRound } from "lucide-react";
import { accessTokens, getDb } from "@origin/db";
import { requireUser } from "@/lib/auth";
import { TokenForm } from "@/components/token-form";

export const metadata = { title: "Access tokens" };

export default async function TokensPage() {
  const user = await requireUser();
  const tokens = await getDb().select().from(accessTokens).where(eq(accessTokens.userId, user.id)).orderBy(desc(accessTokens.createdAt));
  return <main className="settings-page shell-narrow"><nav className="settings-nav"><Link className="active" href="/settings/tokens">Tokens</Link><Link href="/settings/ssh">SSH keys</Link><Link href="/settings/runners">Runners</Link><Link href="/settings/workspace">Workspace</Link></nav><div className="flow-heading"><div className="flow-icon"><KeyRound /></div><h1>Git access tokens</h1><p>Use a token as the password when Git asks for credentials over HTTPS.</p></div><section className="panel settings-section"><div><h2>Create a token</h2><p>Give each machine or automation its own token so access can be rotated independently.</p></div><TokenForm /></section><section className="panel settings-section"><div><h2>Active tokens</h2><p>Only prefixes are shown after creation.</p></div>{tokens.length ? <div className="token-list">{tokens.map((token) => <div key={token.id}><KeyRound size={17} /><span><b>{token.name}</b><small>{token.prefix}… · created {token.createdAt.toLocaleDateString()}{token.lastUsedAt ? ` · used ${token.lastUsedAt.toLocaleDateString()}` : " · never used"}</small></span></div>)}</div> : <p className="muted">No access tokens yet.</p>}</section></main>;
}
