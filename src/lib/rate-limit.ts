/** Fixed-window in-memory rate limiter for API routes.
 *  ponytail: per-instance memory - resets on deploy, not shared across
 *  serverless instances. Good enough to stop runaway loops and abuse from a
 *  single origin; swap for Upstash/Redis if the app outgrows one region
 *  (enterprise_system_architecture.md §4.3).
 *
 *  This module stays free of `next/*` imports so `node --test` can load it
 *  directly - the NextResponse helper lives in `rate-limit-guard.ts`. */

const hits = new Map<string, { count: number; resetAt: number }>();

export type RateLimitResult = { ok: boolean; remaining: number; resetAt: number; limit: number };

/** Check (and consume) one unit for `key`. Key by user id, or by source IP for
 *  anon / webhook routes. */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || now >= cur.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    // opportunistic cleanup so the map can't grow unbounded
    if (hits.size > 10_000) for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs, limit };
  }
  cur.count++;
  return { ok: cur.count <= limit, remaining: Math.max(0, limit - cur.count), resetAt: cur.resetAt, limit };
}

/** The `X-RateLimit-*` + `Retry-After` header set a 429 owes its callers. */
export function rateLimitHeaders(rl: RateLimitResult): Record<string, string> {
  return {
    "Retry-After": String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))),
    "X-RateLimit-Limit": String(rl.limit),
    "X-RateLimit-Remaining": String(rl.remaining),
    "X-RateLimit-Reset": String(Math.floor(rl.resetAt / 1000)),
  };
}

/** From a client (browser fetch): how long a 429 asked us to wait. */
export function retryAfterMs(res: Response): number {
  const h = res.headers.get("Retry-After");
  const s = h ? parseInt(h, 10) : NaN;
  return Number.isFinite(s) ? s * 1000 : 0;
}
