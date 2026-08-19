import Link from "next/link";
import { ArrowRight, Bot, BrainCircuit, Check, CloudDownload, Code2, GitBranch, GitPullRequest, Radio, ShieldCheck, Sparkles } from "lucide-react";
import { joinWaitlistAction } from "@/app/actions";
import { getCurrentUser } from "@/lib/auth";
import { getForgeActivity, getUserRepositories } from "@/lib/data";

function MarketingHome({ waitlistJoined }: { waitlistJoined: boolean }) {
  return (
    <main>
      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><span>Open source · AGPL-3.0</span><i /> Built for human + agent teams</div>
          <h1>Your codebase should<br /><em>understand the work.</em></h1>
          <p className="hero-lede">Northstar is a complete Git forge where repositories hold code, decisions, agents, and proof. Self-host it today, or join the waitlist for Northstar Cloud.</p>
          {waitlistJoined ? (
            <div className="waitlist-done"><Check size={16} /> <div><b>You&apos;re on the list.</b><span>We invite people in waves — you&apos;ll hear from us when your spot opens.</span></div></div>
          ) : (
            <form action={joinWaitlistAction} className="waitlist-form">
              <input type="email" name="email" required placeholder="you@company.com" aria-label="Email address" />
              <button className="button button-primary">Join the cloud waitlist <ArrowRight size={15} /></button>
            </form>
          )}
          <div className="hero-actions secondary">
            <Link href="/sign-up" className="button button-quiet">Start a self-hosted forge <ArrowRight size={15} /></Link>
            <a href="https://github.com/ErzenXz/northstar" className="button button-quiet"><CloudDownload size={15} /> One-command install</a>
          </div>
          <div className="hero-proof"><Check size={15} /> Clone and push with Git <Check size={15} /> Bring issues and changes <Check size={15} /> Use your own models</div>
        </div>
        <div className="pulse-card" aria-label="Example repository activity">
          <div className="pulse-top"><div><Radio size={15} /> REPOSITORY PULSE</div><span>LIVE</span></div>
          <div className="pulse-repo"><strong>acme / mobile</strong><small>main · 4 agents watching</small></div>
          <div className="pulse-line" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
          <div className="pulse-events">
            <div><span className="event-node human">EK</span><p><b>Erzen</b> opened “Offline project sync”<small>Objective · 9:41</small></p></div>
            <div><span className="event-node agent"><BrainCircuit size={16} /></span><p><b>Cartographer</b> mapped 6 affected paths<small>Repository memory · 9:42</small></p></div>
            <div><span className="event-node agent"><Bot size={16} /></span><p><b>Builder</b> prepared a verified change<small>Agent workspace · now</small></p></div>
          </div>
          <div className="pulse-result"><ShieldCheck size={18} /><div><b>Ready for a human decision</b><span>18 checks passed · preview attached · medium risk</span></div><ArrowRight size={17} /></div>
        </div>
      </section>

      <section className="thesis shell">
        <p>THE THESIS</p>
        <h2>GitHub records what happened.<br />Northstar understands <em>why.</em></h2>
        <div className="thesis-grid">
          <article><Code2 /><b>Own the source</b><span>Real bare Git repositories with familiar clone, fetch, and push workflows.</span></article>
          <article><BrainCircuit /><b>Keep project memory</b><span>Architecture, decisions, conventions, and risks stay alive beside the code.</span></article>
          <article><Bot /><b>Give agents objectives</b><span>Agents plan against the actual repository and return evidence, not confidence theater.</span></article>
          <article><GitPullRequest /><b>Review the outcome</b><span>See product impact, checks, screenshots, and risks before deciding to merge.</span></article>
        </div>
      </section>

      <section className="edition-section shell">
        <div><p className="section-kicker">ONE PRODUCT, TWO WAYS TO RUN IT</p><h2>Your forge.<br />Your boundary.</h2></div>
        <div className="edition-grid">
          <article><span>COMMUNITY</span><h3>Run it anywhere.</h3><p>The complete open core: Git, organizations, imports, issues, changes, repository memory, and agent workflows.</p><ul><li>AGPL-3.0 source</li><li>Docker deployment</li><li>Bring any compatible model</li><li>No hosted dependency</li></ul><a href="https://github.com">View source <ArrowRight size={15} /></a></article>
          <article className="cloud-card"><span>NORTHSTAR CLOUD</span><h3>We run the hard parts.</h3><p>The same forge with managed storage, isolated agent sandboxes, backups, scaling, support, and team controls.</p><ul><li>One-minute setup</li><li>Managed execution workers</li><li>Encrypted backups</li><li>Usage and policy controls</li></ul><Link href="/sign-up">Join the hosted alpha <ArrowRight size={15} /></Link></article>
        </div>
      </section>

      <section className="final-cta"><div className="shell"><Sparkles /><h2>Move the history.<br />Keep the future open.</h2><Link href="/sign-up" className="button button-light">Create your Northstar <ArrowRight size={17} /></Link></div></section>
    </main>
  );
}

async function Dashboard({ user }: { user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>> }) {
  const [rows, activity] = await Promise.all([getUserRepositories(user.id), getForgeActivity(user.id)]);
  return (
    <main className="dashboard shell">
      <div className="dashboard-heading"><div><h1>Overview</h1><p>Repositories, people, and agents across your forge.</p></div><Link href="/import" className="button"><CloudDownload size={15} /> Import a project</Link></div>
      <div className="dashboard-layout">
        <section className="panel repositories-panel">
          <div className="panel-heading"><div><h2>Repositories</h2><span>{rows.length}</span></div><Link href="/new">New repository <ArrowRight size={14} /></Link></div>
          {rows.length ? <div className="repo-list">{rows.map(({ repository, organization }) => (
            <Link href={`/${organization.slug}/${repository.slug}`} key={repository.id}>
              <div className="repo-glyph"><GitBranch size={16} /></div><div><b>{organization.slug} / {repository.name}</b><p>{repository.description || "No description yet"}</p><small>{repository.language || "Git"} · updated {repository.updatedAt.toLocaleDateString()}</small></div><span className="visibility">{repository.visibility}</span><ArrowRight size={15} />
            </Link>
          ))}</div> : <div className="dashboard-empty"><GitBranch /><h3>Your forge is ready</h3><p>Create a repository or move an existing GitHub project with its issues and pull requests.</p><div><Link href="/import" className="button button-primary">Import GitHub project</Link><Link href="/new" className="button button-quiet">Create empty repository</Link></div></div>}
        </section>
        <aside className="panel pulse-sidebar">
          <div className="panel-heading"><div><h2>Activity</h2><span>Across your forge</span></div><Radio size={15} /></div>
          {activity.length ? <div className="activity-list dashboard-activity">{activity.map(({ event, organizationSlug, repositorySlug }) => (
            <div key={event.id}><span className={`event-dot ${event.actorType}`} /> <p><b>{event.actorName}</b>{event.title}<small>{organizationSlug}/{repositorySlug} · {event.createdAt.toLocaleString()}</small></p></div>
          ))}</div> : <p className="pulse-empty">Repository activity will appear here as people and agents begin working.</p>}
        </aside>
      </div>
    </main>
  );
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ waitlist?: string; error?: string }> }) {
  const [user, query] = await Promise.all([getCurrentUser(), searchParams]);
  return user ? <Dashboard user={user} /> : <MarketingHome waitlistJoined={query.waitlist === "joined"} />;
}
