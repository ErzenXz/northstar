"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CloneBox({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="clone-box"><code>{url}</code><button type="button" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); }} aria-label="Copy clone URL">{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>;
}
