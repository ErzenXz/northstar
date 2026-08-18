"use client";

import { useActionState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { generateScimTokenAction, type ScimTokenState } from "@/app/actions";

export function ScimTokenForm({ organizationId, hasToken }: { organizationId: string; hasToken: boolean }) {
  const [state, formAction, pending] = useActionState<ScimTokenState, FormData>(generateScimTokenAction, {});
  return <form action={formAction} className="form-stack">
    <input type="hidden" name="organizationId" value={organizationId} />
    {state.token && <div className="new-token"><ShieldCheck /><div><b>SCIM bearer token — shown once</b><code>{state.token}</code><p>Store it in your identity provider now. Origin keeps only a one-way hash.</p></div></div>}
    {state.error && <p className="form-error">{state.error}</p>}
    <button className="button" disabled={pending}><KeyRound size={15} /> {hasToken || state.token ? "Rotate SCIM token" : "Generate SCIM token"}</button>
  </form>;
}
