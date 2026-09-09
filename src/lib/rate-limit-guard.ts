import { NextResponse } from "next/server";
import { rateLimit, rateLimitHeaders } from "./rate-limit";

/** One-liner rate-limit for a route handler. Returns a 429 `NextResponse` with
 *  the `Retry-After` + `X-RateLimit-*` contract when the caller is over the
 *  limit, or `null` when the call is allowed:
 *
 *    const limited = rateLimitGuard(`snap:${user.id}`, 10, 60_000);
 *    if (limited) return limited;
 */
export function rateLimitGuard(
  key: string, limit: number, windowMs: number,
  message = "Rate limit exceeded - slow down",
): NextResponse | null {
  const rl = rateLimit(key, limit, windowMs);
  if (rl.ok) return null;
  return NextResponse.json({ error: message }, { status: 429, headers: rateLimitHeaders(rl) });
}
