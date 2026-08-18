"use client";

import { useEffect, useRef } from "react";

export function Popover({ summary, primary, children }: {
  summary: React.ReactNode;
  primary?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const close = () => { details.open = false; };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && details.open) close(); };
    details.addEventListener("submit", close);
    document.addEventListener("keydown", onKey);
    return () => { details.removeEventListener("submit", close); document.removeEventListener("keydown", onKey); };
  }, []);
  return <details className="popover-form" ref={ref}>
    <summary className={primary ? "button button-primary" : "button"}>{summary}</summary>
    {children}
  </details>;
}
