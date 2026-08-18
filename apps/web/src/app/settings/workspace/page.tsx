import Link from "next/link";
import { redirect } from "next/navigation";
import { CreditCard, Download, Globe2, KeyRound, ShieldCheck } from "lucide-react";
import { usagePeriod } from "@origin/core";
import { configureSsoAction, updateWorkspaceSettingsAction } from "@/app/actions";
import { ScimTokenForm } from "@/components/scim-token-form";
import { requireUser } from "@/lib/auth";
import { getUserOrganizations, getWorkspaceSettings, getWorkspaceUsage } from "@/lib/data";

export const metadata = { title: "Workspace" };

export default async function WorkspaceSettingsPage() {
  const user = await requireUser();
  const organizations = await getUserOrganizations(user.id);
  const organization = organizations[0];
  if (!organization) redirect("/");
  const period = usagePeriod();
  const [settings, usage] = await Promise.all([getWorkspaceSettings(organization.id), getWorkspaceUsage(organization.id, period)]);
  const tokensUsed = usage["ai_tokens"] ?? 0;
  const budgetPercent = settings.aiTokenBudget ? Math.min(Math.round((tokensUsed / settings.aiTokenBudget) * 100), 100) : 0;
  return <main className="settings-page shell-narrow">
    <nav className="settings-nav"><Link href="/settings/tokens">Tokens</Link><Link href="/settings/ssh">SSH keys</Link><Link href="/settings/runners">Runners</Link><Link className="active" href="/settings/workspace">Workspace</Link></nav>
    <div className="flow-heading"><p className="eyebrow-simple">{organization.name.toUpperCase()}</p><h1>Workspace controls</h1><p>Billing plan, model budgets, data region, identity, and the audit trail for this workspace.</p></div>

    <section className="panel settings-section">
      <div><h2><CreditCard size={17} /> Billing &amp; budgets</h2><p>The community edition meters usage locally. Origin Cloud attaches invoicing to the same plan and budget records — capabilities are never removed from the open core.</p></div>
      <form action={updateWorkspaceSettingsAction} className="form-stack">
        <input type="hidden" name="organizationId" value={organization.id} />
        <div className="form-row">
          <label>Plan<select name="plan" defaultValue={settings.plan}><option value="community">Community (self-hosted)</option><option value="team">Team</option><option value="enterprise">Enterprise</option></select></label>
          <label>Billing email<input type="email" name="billingEmail" defaultValue={settings.billingEmail ?? ""} placeholder="finance@company.com" /></label>
        </div>
        <div className="form-row">
          <label>Monthly model budget (tokens) <span>0 removes the cap</span><input type="number" name="aiTokenBudget" min={0} defaultValue={settings.aiTokenBudget} /></label>
          <label>Data region <span>Applies to backup placement and export routing</span><select name="region" defaultValue={settings.region}><option value="us">United States</option><option value="eu">European Union</option></select></label>
        </div>
        <div className="form-row">
          <label>Repository quota <span>0 removes the cap</span><input type="number" name="maxRepositories" min={0} defaultValue={settings.maxRepositories} /></label>
          <label>Repository size limit (MB)<input type="number" name="maxRepositorySizeMb" min={64} max={51200} defaultValue={settings.maxRepositorySizeMb} /></label>
        </div>
        <div className="budget-meter">
          <div className="milestone-meter"><i style={{ width: `${budgetPercent}%` }} /></div>
          <small>{tokensUsed.toLocaleString()} model tokens used in {period}{settings.aiTokenBudget ? ` of ${settings.aiTokenBudget.toLocaleString()} budgeted (${budgetPercent}%)` : " · no budget cap"}</small>
        </div>
        <button className="button button-primary">Save workspace settings</button>
      </form>
    </section>

    <section className="panel settings-section">
      <div><h2><ShieldCheck size={17} /> Single sign-on</h2><p>OIDC authorization-code flow with just-in-time provisioning. Members signing in at <code>/sso/{organization.slug}</code> are verified against this issuer.</p></div>
      <form action={configureSsoAction} className="form-stack">
        <input type="hidden" name="organizationId" value={organization.id} />
        <label className="check-label"><input type="checkbox" name="ssoEnabled" defaultChecked={settings.ssoEnabled} /> Enable OIDC single sign-on</label>
        <label>Issuer URL<input type="url" name="ssoIssuer" defaultValue={settings.ssoIssuer ?? ""} placeholder="https://login.example.com" /></label>
        <div className="form-row">
          <label>Client ID<input name="ssoClientId" defaultValue={settings.ssoClientId ?? ""} /></label>
          <label>Client secret <span>{settings.ssoClientSecretEncrypted ? "Stored encrypted — leave blank to keep" : "Stored encrypted at rest"}</span><input type="password" name="ssoClientSecret" autoComplete="off" /></label>
        </div>
        <p className="field-help">Redirect URI for your identity provider: <code>{process.env.ORIGIN_BASE_URL ?? "http://localhost:3000"}/api/auth/oidc/callback</code></p>
        <button className="button button-primary">Save SSO configuration</button>
      </form>
    </section>

    <section className="panel settings-section">
      <div><h2><KeyRound size={17} /> SCIM provisioning</h2><p>Directory sync creates and deactivates members through <code>/api/scim/v2/Users</code> with this bearer token.</p></div>
      <ScimTokenForm organizationId={organization.id} hasToken={Boolean(settings.scimTokenHash)} />
    </section>

    <section className="panel settings-section">
      <div><h2><Globe2 size={17} /> Audit &amp; data controls</h2><p>Every security-relevant action in this workspace is recorded with actor, action, and source address.</p></div>
      <div className="form-stack">
        <a className="button" href={`/api/orgs/${organization.slug}/audit.csv`}><Download size={15} /> Export audit trail (CSV)</a>
        <p className="field-help">Backups for this workspace replicate to the <b>{settings.region.toUpperCase()}</b> region path. Instance operators run and verify restore tests from the operations console.</p>
      </div>
    </section>
  </main>;
}
