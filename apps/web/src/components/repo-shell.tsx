import Link from "next/link";
import { BookOpen, Bot, BrainCircuit, CircleDot, Code2, GitBranch, GitPullRequest, Package, Radio, Settings } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { getDb, organizationMembers, type Organization, type Repository } from "@origin/db";
import { getCurrentUser } from "@/lib/auth";

const tabs = [
  { key: "code", label: "Code", icon: Code2, suffix: "" },
  { key: "issues", label: "Issues", icon: CircleDot, suffix: "/issues" },
  { key: "pulls", label: "Changes", icon: GitPullRequest, suffix: "/pulls" },
  { key: "releases", label: "Releases", icon: Package, suffix: "/releases" },
  { key: "wiki", label: "Wiki", icon: BookOpen, suffix: "/wiki" },
  { key: "brain", label: "Brain", icon: BrainCircuit, suffix: "/brain" },
  { key: "agents", label: "Agents", icon: Bot, suffix: "/agents" },
  { key: "settings", label: "Settings", icon: Settings, suffix: "/settings/hooks" },
] as const;

export async function RepoShell({ organization, repository, active, children }: {
  organization: Organization;
  repository: Repository;
  active: typeof tabs[number]["key"];
  children: React.ReactNode;
}) {
  const base = `/${organization.slug}/${repository.slug}`;
  const user = await getCurrentUser();
  const [membership] = user ? await getDb().select({ userId: organizationMembers.userId }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, organization.id), eq(organizationMembers.userId, user.id))).limit(1) : [];
  return (
    <main className="repo-page">
      <div className="repo-frame">
        <aside className="repo-side">
          <Link className="repo-side-identity" href={base}>
            <span className="repo-glyph"><GitBranch size={16} /></span>
            <span><b>{repository.name}</b><small>{organization.slug} · {repository.visibility}</small></span>
          </Link>
          <nav aria-label="Repository navigation">
            {tabs.filter((tab) => tab.key !== "settings" || membership).map((tab) => {
              const Icon = tab.icon;
              return <Link key={tab.key} href={`${base}${tab.suffix}`} className={active === tab.key ? "active" : ""}><Icon />{tab.label}</Link>;
            })}
          </nav>
          <div className="repo-side-foot"><Radio /> Repository pulse <b>LIVE</b></div>
        </aside>
        <div className="repo-body">
          <header className="repo-topbar">
            <div className="repo-path"><Link href="/">{organization.slug}</Link><span>/</span><strong>{repository.name}</strong><em>{repository.visibility}</em></div>
            <p>{repository.description || "A new repository, ready for its first commit."}</p>
          </header>
          <div className="repo-content">{children}</div>
        </div>
      </div>
    </main>
  );
}
