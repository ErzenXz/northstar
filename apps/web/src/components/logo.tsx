import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="logo" aria-label="Northstar home">
      <span className="logo-mark" aria-hidden="true"><i /><i /><i /></span>
      {!compact && <span>NORTHSTAR</span>}
    </Link>
  );
}
