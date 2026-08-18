import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Cpu, Radio } from "lucide-react";
import { getDb, runners } from "@origin/db";
import { RunnerForm } from "@/components/runner-form";
import { requireUser } from "@/lib/auth";
import { getUserOrganizations } from "@/lib/data";

export const metadata = { title: "Runners" };
export default async function RunnersPage() {
  const user = await requireUser();
  const organizations = await getUserOrganizations(user.id);
  const items = organizations.length ? await getDb().select().from(runners).where(eq(runners.organizationId, organizations[0]!.id)).orderBy(desc(runners.createdAt)) : [];
  return <main className="settings-page shell-narrow"><nav className="settings-nav"><Link href="/settings/tokens">Tokens</Link><Link href="/settings/ssh">SSH keys</Link><Link className="active" href="/settings/runners">Runners</Link><Link href="/settings/workspace">Workspace</Link></nav><div className="flow-heading"><div className="flow-icon"><Cpu/></div><p className="eyebrow-simple">AUTOMATION SETTINGS</p><h1>Self-hosted runners</h1><p>Runners poll Origin’s narrow claim protocol, execute work in infrastructure you control, and report structured results.</p></div><section className="panel settings-section"><div><h2>Register a runner</h2><p>The credential is shown once. Use the HTTP protocol documented in the runner guide.</p></div><RunnerForm organizations={organizations}/></section><section className="panel settings-section"><div><h2>Runner fleet</h2><p>Last-seen state makes abandoned agents visible.</p></div><div className="token-list">{items.map((runner) => <div key={runner.id}><Radio size={17}/><span><b>{runner.name}</b><small>{runner.status} · {runner.labels.join(", ") || "no labels"} · {runner.lastSeenAt ? `seen ${runner.lastSeenAt.toLocaleString()}` : "never connected"}</small></span></div>)}</div></section></main>;
}
