import { notFound } from "next/navigation";
import { Download, Package, Tag } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EmptyState } from "@/components/empty-state";
import { RepoShell } from "@/components/repo-shell";
import { getRepository, getRepositoryReleases } from "@/lib/data";

export const metadata = { title: "Releases" };

export default async function ReleasesPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const row = await getRepository(owner, repo);
  if (!row) notFound();
  const items = await getRepositoryReleases(row.repository.id);
  return <RepoShell organization={row.organization} repository={row.repository} active="releases"><div className="section-heading"><div><p className="eyebrow-simple">SHIPPED SOFTWARE</p><h1>Releases</h1><p>Release notes and copied assets remain available after migration.</p></div></div>{items.length ? <section className="release-list">{items.map((release) => <article className="panel release-card" key={release.id}><aside><Package/><b>{release.tagName}</b><span>{release.publishedAt?.toLocaleDateString() ?? "Draft"}</span>{release.prerelease && <em>prerelease</em>}</aside><div><h2>{release.name}</h2><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{release.body}</ReactMarkdown></div>{release.assets.length > 0 && <section className="release-assets"><h3>{release.assets.length} assets</h3>{release.assets.map((asset) => <a href={asset.storagePath ? `/api/assets/${asset.id}` : asset.downloadUrl ?? "#"} key={asset.id}><Download size={15}/><span><b>{asset.name}</b><small>{Math.max(1, Math.round(asset.size / 1024))} KB · {asset.storagePath ? "stored in Origin" : "source link"}</small></span></a>)}</section>}</div></article>)}</section> : <EmptyState icon={<Tag/>} title="No releases yet" detail="Imported GitHub releases and their assets will appear here."/>}</RepoShell>;
}
