import Link from "next/link";
import { ArrowLeft, Check, CloudDownload, Github, LockKeyhole } from "lucide-react";
import { importGitHubAction } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { getUserOrganizations } from "@/lib/data";

export const metadata = { title: "Import from GitHub" };

const includes = ["Commits, branches, and tags", "Open and closed issues", "Issue and review comments", "Pull-request records", "Releases and assets", "Labels and milestones", "The project wiki", "An automatic repository map"];

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const organizations = await getUserOrganizations(user.id);
  const { error } = await searchParams;
  return (
    <main className="flow-page">
      <Link href="/" className="back-link"><ArrowLeft size={15} /> Back</Link>
      <div className="flow-heading"><h1>Import from GitHub</h1><p>Origin mirrors the full Git history, then moves the project&apos;s issues, changes, releases, and wiki into your forge.</p></div>
      {error && <div className="form-error">{error}</div>}
      <form action={importGitHubAction} className="flow-form panel">
        <label>Repository URL<div className="input-with-icon"><Github size={16} /><input name="sourceUrl" type="url" required autoFocus placeholder="https://github.com/acme/northstar" /></div></label>
        <div className="form-row">
          <label>Import into<select name="organizationId">{organizations.map((org) => <option value={org.id} key={org.id}>{org.slug}</option>)}</select></label>
          <label>Access token <span>Needed for private repositories</span><div className="input-with-icon"><LockKeyhole size={15} /><input name="token" type="password" autoComplete="off" placeholder="github_pat_…" /></div></label>
        </div>
        <p className="field-help">The token is encrypted before it enters the import queue and never stored as a reusable connection. Without one, GitHub may rate-limit issue and change history on public repositories.</p>
        <div className="form-footer"><p>Imports run in the background — you can keep working.</p><button className="button button-primary"><CloudDownload size={15} /> Import repository</button></div>
      </form>
      <section className="include-list">
        <h2>What moves with the project</h2>
        <ul>{includes.map((item) => <li key={item}><Check size={13} /> {item}</li>)}</ul>
      </section>
    </main>
  );
}
