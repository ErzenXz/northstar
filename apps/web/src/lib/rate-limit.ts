import "server-only";
import { headers } from "next/headers";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export async function clientAddress() {
  const headerStore = await headers();
  return headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || headerStore.get("x-real-ip") || "local";
}

/**
 * In-process fixed-window limiter for the community edition. Origin Cloud
 * replaces this seam with a shared limiter in front of every region.
 */
export async function enforceRateLimit(action: string, limit: number, windowMs: number) {
  const key = `${action}:${await clientAddress()}`;
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [entryKey, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(entryKey);
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) throw new Error("Too many attempts. Wait a minute and try again.");
}
