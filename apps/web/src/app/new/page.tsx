import Link from "next/link";
import { ArrowLeft, GitBranch, LockKeyhole, Radio } from "lucide-react";
import { createRepositoryAction } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { getUserOrganizations } from "@/lib/data";

export const metadata = { title: "New repository" };

export default async function NewRepositoryPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const organizations = await getUserOrganizations(user.id);
  const { error } = await searchParams;
  return (
    <main className="flow-page shell-narrow">
      <Link href="/" className="back-link"><ArrowLeft size={16} /> Back to your forge</Link>
      <div className="flow-heading"><div className="flow-icon"><GitBranch /></div><p className="eyebrow-simple">EMPTY REPOSITORY</p><h1>Start from source.</h1><p>Create a Git home for a new project. You can give its repository brain context after the first push.</p></div>
      {error && <div className="form-error">{error}</div>}
      <form action={createRepositoryAction} className="flow-form panel">
        <div className="form-row"><label>Workspace<select name="organizationId">{organizations.map((org) => <option value={org.id} key={org.id}>{org.slug}</option>)}</select></label><label>Repository name<input name="name" required placeholder="northstar" /></label></div>
        <label>Description <span>optional</span><input name="description" placeholder="What are you building?" /></label>
        <fieldset><legend>Visibility</legend><label className="choice-card"><input type="radio" name="visibility" value="private" defaultChecked /><LockKeyhole /><span><b>Private</b><small>Only members of this workspace can see it.</small></span></label><label className="choice-card"><input type="radio" name="visibility" value="public" /><Radio /><span><b>Public</b><small>Anyone can clone and inspect this repository.</small></span></label></fieldset>
        <div className="form-footer"><p>You’ll receive a clone URL and first-push instructions next.</p><button className="button button-primary">Create repository</button></div>
      </form>
    </main>
  );
}
