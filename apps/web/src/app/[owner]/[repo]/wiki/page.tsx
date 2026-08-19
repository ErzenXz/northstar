import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { BookOpen, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getDb, wikiImports } from "@northstar/db";
import { listTree, readTextFile } from "@northstar/git";
import { EmptyState } from "@/components/empty-state";
import { RepoShell } from "@/components/repo-shell";
import { getRepository } from "@/lib/data";
import { repositoryRoot } from "@/lib/repository";

export const metadata = { title: "Wiki" };

export default async function WikiPage({ params, searchParams }: { params: Promise<{ owner: string; repo: string }>; searchParams: Promise<{ page?: string }> }) {
  const { owner, repo } = await params;
  const row = await getRepository(owner, repo);
  if (!row) notFound();
  const [wiki] = await getDb().select().from(wikiImports).where(eq(wikiImports.repositoryId, row.repository.id)).limit(1);
  if (!wiki) return <RepoShell organization={row.organization} repository={row.repository} active="wiki"><EmptyState icon={<BookOpen/>} title="No wiki imported" detail="When a GitHub repository has a wiki, Northstar mirrors its complete Git history during import."/></RepoShell>;
  const branch = await import("@northstar/git").then(({ getDefaultBranch }) => getDefaultBranch(repositoryRoot, wiki.storageKey));
  const entries = (await listTree(repositoryRoot, wiki.storageKey, branch)).filter((entry) => entry.type === "blob" && /\.md$/i.test(entry.name));
  const requested = (await searchParams).page;
  const selected = entries.find((entry) => entry.path === requested) ?? entries.find((entry) => /^home\.md$/i.test(entry.name)) ?? entries[0];
  const content = selected ? await readTextFile(repositoryRoot, wiki.storageKey, branch, selected.path) : "";
  return <RepoShell organization={row.organization} repository={row.repository} active="wiki"><div className="wiki-layout"><aside className="panel"><h2><BookOpen/> Wiki pages</h2>{entries.map((entry) => <a className={entry.path === selected?.path ? "active" : ""} href={`?page=${encodeURIComponent(entry.path)}`} key={entry.path}><FileText size={14}/>{entry.name.replace(/\.md$/i, "").replace(/-/g, " ")}</a>)}</aside><article className="panel wiki-page markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></article></div></RepoShell>;
}
