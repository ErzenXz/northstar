import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { signUpAction } from "@/app/actions";
import { Logo } from "@/components/logo";

export const metadata = { title: "Create your forge" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="auth-page">
      <section className="auth-card">
        <Logo />
        <h1>Create your forge</h1>
        <p className="auth-lede">Start open. Import later. Keep every exit available.</p>
        {error && <div className="form-error">{error}</div>}
        <form action={signUpAction} className="form-stack">
          <div className="form-row"><label>Full name<input name="name" autoComplete="name" required autoFocus placeholder="Ada Lovelace" /></label><label>Username<input name="username" autoComplete="username" required placeholder="ada" /></label></div>
          <label>Email<input name="email" type="email" autoComplete="email" required placeholder="ada@company.com" /></label>
          <label>Password<input name="password" type="password" autoComplete="new-password" minLength={10} required placeholder="At least 10 characters" /></label>
          <button className="button button-primary button-wide">Create account <ArrowRight size={17} /></button>
        </form>
        <p className="auth-switch">Already have a forge? <Link href="/sign-in">Sign in</Link></p>
      </section>
      <aside className="auth-aside sign-up-aside"><div><span>WHAT MOVES WITH YOU</span><ul><li>Every branch and commit</li><li>Issues and pull requests</li><li>Repository context and decisions</li><li>A clear trail of agent work</li></ul></div></aside>
    </main>
  );
}
