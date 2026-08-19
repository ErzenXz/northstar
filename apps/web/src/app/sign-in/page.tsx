import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { signInAction } from "@/app/actions";
import { Logo } from "@/components/logo";

export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="auth-page">
      <section className="auth-card">
        <Logo />
        <h1>Sign in to Northstar</h1>
        <p className="auth-lede">Continue where your team and agents left off.</p>
        {error && <div className="form-error">{error}</div>}
        <form action={signInAction} className="form-stack">
          <label>Email or username<input name="identity" autoComplete="username" required autoFocus placeholder="you@company.com" /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required placeholder="Your password" /></label>
          <button className="button button-primary button-wide">Sign in <ArrowRight size={17} /></button>
        </form>
        <p className="auth-switch">New to Northstar? <Link href="/sign-up">Create your forge</Link></p>
      </section>
      <aside className="auth-aside"><div><span>OPEN BY DESIGN</span><blockquote>“The code, project memory, and agent history should belong to the people building the product.”</blockquote><p>Self-host the same core that powers Northstar Cloud.</p></div></aside>
    </main>
  );
}
