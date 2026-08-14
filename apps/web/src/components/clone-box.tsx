"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CloneBox({ url, sshUrl }: { url: string; sshUrl?: string }) {
  const [copied, setCopied] = useState(false);
  const [protocol, setProtocol] = useState<"https" | "ssh">("https");
  const activeUrl = protocol === "ssh" && sshUrl ? sshUrl : url;
  return <div className="clone-control"><div className="clone-protocol"><button className={protocol === "https" ? "active" : ""} onClick={() => setProtocol("https")} type="button">HTTPS</button>{sshUrl && <button className={protocol === "ssh" ? "active" : ""} onClick={() => setProtocol("ssh")} type="button">SSH</button>}</div><div className="clone-box"><code>{activeUrl}</code><button type="button" onClick={async () => { await navigator.clipboard.writeText(activeUrl); setCopied(true); setTimeout(() => setCopied(false), 1600); }} aria-label="Copy clone URL">{copied ? <Check size={16} /> : <Copy size={16} />}</button></div></div>;
}
