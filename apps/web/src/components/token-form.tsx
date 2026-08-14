"use client";

import { useActionState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { createAccessTokenAction, type TokenActionState } from "@/app/actions";

const initialState: TokenActionState = {};

export function TokenForm() {
  const [state, action, pending] = useActionState(createAccessTokenAction, initialState);
  if (state.token) {
    return <div className="new-token"><Check /><div><b>Token created. Copy it now.</b><code>{state.token}</code><p>Origin stores only its hash, so this value cannot be shown again.</p></div><button type="button" className="icon-button" onClick={() => navigator.clipboard.writeText(state.token!)} aria-label="Copy token"><Copy size={18} /></button></div>;
  }
  return <form action={action} className="token-form"><div className="input-with-icon"><KeyRound size={17} /><input name="name" placeholder="Laptop, CI, or deployment" required /></div><button className="button button-primary" disabled={pending}>{pending ? "Creating…" : "Create token"}</button>{state.error && <p className="form-error">{state.error}</p>}</form>;
}
