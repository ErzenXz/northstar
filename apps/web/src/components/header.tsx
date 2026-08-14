import Link from "next/link";
import { CirclePlus, CloudDownload, LogOut, Settings } from "lucide-react";
import { getEdition } from "@origin/core";
import { getCurrentUser } from "@/lib/auth";
import { signOutAction } from "@/app/actions";
import { Logo } from "./logo";

export async function Header() {
  const user = await getCurrentUser();
  return (
    <header className="site-header">
      <div className="header-inner">
        <Logo />
        <div className="edition-pill"><span />{getEdition()} edition</div>
        <nav className="header-actions" aria-label="Primary navigation">
          {user ? (
            <>
              <Link href="/import" className="header-link"><CloudDownload size={16} /> Import</Link>
              <Link href="/new" className="button button-small"><CirclePlus size={16} /> New repository</Link>
              <Link href="/settings/tokens" className="icon-button" aria-label="Settings"><Settings size={18} /></Link>
              <form action={signOutAction}><button className="icon-button" aria-label="Sign out"><LogOut size={18} /></button></form>
              <Link href="/" className="avatar" title={user.name}>{user.name.slice(0, 2).toUpperCase()}</Link>
            </>
          ) : (
            <>
              <a href="https://github.com" className="header-link">Source</a>
              <Link href="/sign-in" className="header-link">Sign in</Link>
              <Link href="/sign-up" className="button button-small">Create your forge</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
