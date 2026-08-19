"use client";

import { useActionState } from "react";
import { Check, Cpu } from "lucide-react";
import { createRunnerAction, type RunnerActionState } from "@/app/actions";

const initialState: RunnerActionState = {};
export function RunnerForm({ organizations }: { organizations: Array<{ id: string; slug: string }> }) {
  const [state, action, pending] = useActionState(createRunnerAction, initialState);
  return <div>{state.token && <div className="new-token"><Check/><div><b>Runner credential created</b><code>{state.token}</code><p>Copy it now. Northstar stores only its hash.</p></div></div>}<form action={action} className="form-stack"><label>Workspace<select name="organizationId">{organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.slug}</option>)}</select></label><label>Runner name<input name="name" required placeholder="build-room-01"/></label><label>Labels<input name="labels" placeholder="linux, arm64, docker"/></label><button className="button button-primary" disabled={pending}><Cpu size={16}/>{pending ? "Creating…" : "Create runner credential"}</button>{state.error && <p className="form-error">{state.error}</p>}</form></div>;
}
