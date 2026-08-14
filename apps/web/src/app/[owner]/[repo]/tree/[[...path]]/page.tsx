import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, File, FileCode2, Folder, GitBranch } from "lucide-react";
import { listTree, readTextFile } from "@origin/git";
import { RepoShell } from "@/components/repo-shell";
import { getRepository } from "@/lib/data";
import { repositoryRoot } from "@/lib/repository";

export default async function TreePage({ params }: { params: Promise<{ owner: string; repo: string; path?: string[] }> }) {
  const { owner, repo, path = [] } = await params;
  const row = await getRepository(owner, repo);
  if (!row) notFound();
  const currentPath = path.join("/");
  const base = `/${owner}/${repo}`;
  let entries: Awaited<ReturnType<typeof listTree>> | null = null;
  let content: string | null = null;
  try { entries = await listTree(repositoryRoot, row.repository.storageKey, row.repository.defaultBranch, currentPath); }
  catch { try { content = await readTextFile(repositoryRoot, row.repository.storageKey, row.repository.defaultBranch, currentPath); } catch { notFound(); } }
  return <RepoShell organization={row.organization} repository={row.repository} active="code"><div className="repo-toolbar"><div className="branch-select"><GitBranch size={16} /><b>{row.repository.defaultBranch}</b></div><div className="breadcrumbs"><Link href={base}>{repo}</Link>{path.map((segment, index) => <span key={`${segment}-${index}`}><ChevronRight size={14} /><Link href={`${base}/tree/${path.slice(0, index + 1).join("/")}`}>{segment}</Link></span>)}</div></div>{entries ? <section className="file-browser panel">{entries.map((entry) => <Link href={`${base}/tree/${entry.path}`} key={entry.path} className="file-row">{entry.type === "tree" ? <Folder size={17} /> : <File size={17} />}<b>{entry.name}</b><span>{entry.type === "tree" ? "directory" : entry.size ? `${Math.max(1, Math.round(entry.size / 1024))} KB` : "file"}</span><ChevronRight size={15} /></Link>)}</section> : <section className="code-view panel"><div className="code-heading"><FileCode2 size={17} /><b>{path.at(-1)}</b><span>{content!.split("\n").length} lines</span></div><pre>{content!.split("\n").map((line, index) => <code key={index}><span>{index + 1}</span>{line || " "}{"\n"}</code>)}</pre></section>}</RepoShell>;
}
