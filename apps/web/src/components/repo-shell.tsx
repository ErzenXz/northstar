import Link from "next/link";
import { Bot, BrainCircuit, CircleDot, Code2, GitPullRequest, Radio } from "lucide-react";
import type { Organization, Repository } from "@origin/db";

const tabs = [
  { key: "code", label: "Code", icon: Code2, suffix: "" },
  { key: "issues", label: "Issues", icon: CircleDot, suffix: "/issues" },
  { key: "pulls", label: "Changes", icon: GitPullRequest, suffix: "/pulls" },
  { key: "brain", label: "Brain", icon: BrainCircuit, suffix: "/brain" },
  { key: "agents", label: "Agents", icon: Bot, suffix: "/agents" },
] as const;

export function RepoShell({ organization, repository, active, children }: {
  organization: Organization;
  repository: Repository;
  active: typeof tabs[number]["key"];
  children: React.ReactNode;
}) {
  const base = `/${organization.slug}/${repository.slug}`;
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
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return <Link key={tab.key} href={`${base}${tab.suffix}`} className={active === tab.key ? "active" : ""}><Icon size={17} />{tab.label}</Link>;
        })}
      </nav>
      <div className="shell repo-content">{children}</div>
    </main>
  );
}
