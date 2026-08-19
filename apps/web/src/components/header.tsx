import Link from "next/link";
import { Activity, CirclePlus, CloudDownload, LogOut, Settings, SlidersHorizontal } from "lucide-react";
import { getEdition } from "@northstar/core";
import { getCurrentUser } from "@/lib/auth";
import { signOutAction } from "@/app/actions";
import { Logo } from "./logo";

export async function Header() {
  const user = await getCurrentUser();
  return (
    <header className="site-header">
      <div className="header-inner">
        <Logo />
        <nav className="header-actions" aria-label="Primary navigation">
          {user ? (
            <>
              <Link href="/import" className="header-link"><CloudDownload size={15} /> Import</Link>
              <Link href="/new" className="button button-small button-primary"><CirclePlus size={15} /> New repository</Link>
              <details className="user-menu">
                <summary aria-label="Account menu"><span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span></summary>
                <div className="menu-panel" role="menu">
                  <div className="menu-user"><b>{user.name}</b><span>{user.email}</span></div>
                  <Link href="/settings/tokens" role="menuitem"><Settings size={14} /> Personal settings</Link>
                  <Link href="/settings/workspace" role="menuitem"><SlidersHorizontal size={14} /> Workspace settings</Link>
                  {user.admin && <Link href="/ops" role="menuitem"><Activity size={14} /> Operations console</Link>}
                  <div className="menu-divider" />
                  <form action={signOutAction}><button role="menuitem"><LogOut size={14} /> Sign out</button></form>
                  <div className="menu-foot">Northstar · {getEdition()} edition</div>
                </div>
              </details>
            </>
          ) : (
            <>
              <a href="https://github.com" className="header-link">Source</a>
              <Link href="/sign-in" className="header-link">Sign in</Link>
              <Link href="/sign-up" className="button button-small button-primary">Create your forge</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
