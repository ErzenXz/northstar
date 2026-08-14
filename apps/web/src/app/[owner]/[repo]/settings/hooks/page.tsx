import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { Activity, Check, Webhook, X } from "lucide-react";
import { getDb, webhookDeliveries, webhooks } from "@origin/db";
import { createWebhookAction } from "@/app/actions";
import { RepoShell } from "@/components/repo-shell";
import { getRepositoryForMember } from "@/lib/data";

export const metadata = { title: "Webhooks" };
export default async function HooksPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const row = await getRepositoryForMember(owner, repo);
  if (!row) notFound();
  const hooks = await getDb().select().from(webhooks).where(eq(webhooks.repositoryId, row.repository.id)).orderBy(desc(webhooks.createdAt));
  const deliveries = hooks.length ? await getDb().select().from(webhookDeliveries).where(inArray(webhookDeliveries.webhookId, hooks.map((hook) => hook.id))).orderBy(desc(webhookDeliveries.createdAt)).limit(20) : [];
  return <RepoShell organization={row.organization} repository={row.repository} active="settings"><nav className="subnav"><Link className="active" href={`/${owner}/${repo}/settings/hooks`}>Webhooks</Link><Link href={`/${owner}/${repo}/settings/keys`}>Deploy keys</Link></nav><div className="section-heading"><div><p className="eyebrow-simple">OUTBOUND EVENTS</p><h1>Webhooks</h1><p>Signed deliveries notify systems outside Origin without giving them repository credentials.</p></div></div><section className="panel settings-section"><div><h2>Add a webhook</h2><p>Targets resolving to local or private networks are rejected by the delivery worker.</p></div><form action={createWebhookAction} className="form-stack"><input type="hidden" name="repositoryId" value={row.repository.id}/><label>Payload URL<input type="url" name="url" required placeholder="https://ci.example.com/origin"/></label><label>Signing secret<input name="secret" placeholder="Generated when blank"/></label><fieldset className="event-choices"><legend>Events</legend>{["push","issues","issue_comment","pull_request","pull_request_comment","pull_request_review","status"].map((event) => <label className="check-label" key={event}><input type="checkbox" name="events" value={event} defaultChecked={event === "push"}/>{event.replaceAll("_", " ")}</label>)}</fieldset><button className="button button-primary"><Webhook size={16}/> Add webhook</button></form></section><section className="hook-grid">{hooks.map((hook) => <article className="panel hook-card" key={hook.id}><Webhook/><div><b>{hook.url}</b><p>{hook.events.join(" · ")}</p><small>{hook.lastDeliveryAt ? `Last delivery ${hook.lastDeliveryAt.toLocaleString()}` : "Waiting for first event"}</small></div><span className={hook.active ? "active" : "inactive"}>{hook.active ? "active" : "paused"}</span></article>)}</section>{deliveries.length > 0 && <section className="panel delivery-list"><h2><Activity/> Recent deliveries</h2>{deliveries.map((delivery) => <div key={delivery.id}>{delivery.status === "delivered" ? <Check className="status-open"/> : delivery.status === "failed" ? <X className="status-closed"/> : <Activity/>}<span><b>{delivery.event}</b><small>{delivery.createdAt.toLocaleString()} · {delivery.responseCode ?? delivery.status}</small></span></div>)}</section>}</RepoShell>;
}
