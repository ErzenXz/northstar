import Link from "next/link";
import { BookOpen, Bot, BrainCircuit, CircleDot, Code2, GitPullRequest, Package, Radio, Settings } from "lucide-react";
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
      <div className="repo-heading shell">
        <div>
          <div className="repo-path"><Link href="/">{organization.slug}</Link><span>/</span><strong>{repository.name}</strong><em>{repository.visibility}</em></div>
          <p>{repository.description || "A new repository, ready for its first commit."}</p>
        </div>
        <div className="repo-state"><Radio size={14} /> <span>Repository pulse</span><b>live</b></div>
      </div>
      <nav className="repo-tabs shell" aria-label="Repository navigation">
        {tabs.filter((tab) => tab.key !== "settings" || membership).map((tab) => {
          const Icon = tab.icon;
          return <Link key={tab.key} href={`${base}${tab.suffix}`} className={active === tab.key ? "active" : ""}><Icon size={17} />{tab.label}</Link>;
        })}
      </nav>
      <div className="shell repo-content">{children}</div>
    </main>
  );
}
