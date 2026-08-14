import Link from "next/link";
import { ArrowLeft, Check, CloudDownload, Github, LockKeyhole } from "lucide-react";
import { importGitHubAction } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { getUserOrganizations } from "@/lib/data";

export const metadata = { title: "Move a GitHub project" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const organizations = await getUserOrganizations(user.id);
  const { error } = await searchParams;
  return (
    <main className="flow-page shell-narrow">
      <Link href="/" className="back-link"><ArrowLeft size={16} /> Back to your forge</Link>
      <div className="flow-heading"><div className="flow-icon import-icon"><CloudDownload /></div><p className="eyebrow-simple">ONE-STEP MIGRATION</p><h1>Bring the whole project.</h1><p>Origin mirrors the complete Git history, then moves issues and pull-request records into your forge.</p></div>
      <div className="import-grid">
        <form action={importGitHubAction} className="flow-form panel">
          {error && <div className="form-error">{error}</div>}
          <label>GitHub repository URL<div className="input-with-icon"><Github size={18} /><input name="sourceUrl" type="url" required autoFocus placeholder="https://github.com/acme/northstar" /></div></label>
          <label>Move into<select name="organizationId">{organizations.map((org) => <option value={org.id} key={org.id}>{org.slug}</option>)}</select></label>
          <label>GitHub token <span>required for private repositories, recommended for complete public imports</span><div className="input-with-icon"><LockKeyhole size={17} /><input name="token" type="password" autoComplete="off" placeholder="github_pat_…" /></div><small className="field-help">Encrypted before it enters the import queue and never stored as a reusable connection. Without one, GitHub may rate-limit issue and change history.</small></label>
          <button className="button button-primary button-wide">Move this project <CloudDownload size={17} /></button>
        </form>
        <aside className="migration-list"><h2>What comes with you</h2><ul><li><Check />All commits and branches</li><li><Check />Tags and complete history</li><li><Check />Open and closed issues</li><li><Check />Pull-request records</li><li><Check />Labels and source links</li><li><Check />Automatic repository map</li></ul><p>The first alpha leaves GitHub comments and release assets linked at their original source. Native migration for those objects is the next importer milestone.</p></aside>
      </div>
    </main>
  );
}
