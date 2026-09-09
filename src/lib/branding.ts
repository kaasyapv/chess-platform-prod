/** Per-tenant login branding. Fetched server-side only (the login page runs
 *  pre-auth, so it can't read `academies` under RLS) with the service role,
 *  narrowed to three non-sensitive columns. No service key configured →
 *  `getBranding` returns null and the login page shows the generic look. */

import { createClient } from "@supabase/supabase-js";

export type Branding = {
  name: string;
  logoUrl: string | null;
  primary: string | null; // validated hex in the DB (0038)
};

const NON_TENANT_LABELS = new Set(["www", "app", "api", "admin", "staging", "dev"]);

/** `panama.chessacademy.com` → `panama`. Apex, www/app, localhost, IPs and
 *  *.vercel.app previews return null (use `?slug=` there for testing). */
export function academySlugFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const name = host.split(":")[0].toLowerCase().trim();
  if (name === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(name)) return null;
  if (name.endsWith(".vercel.app")) return null;
  const labels = name.split(".");
  if (labels.length < 3) return null; // apex domain, no subdomain
  const sub = labels[0];
  return NON_TENANT_LABELS.has(sub) ? null : sub;
}

export async function getBranding(slug: string | null): Promise<Branding | null> {
  if (!slug) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await db
    .from("academies")
    .select("name, brand_name, logo_url, brand_primary")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return null;
  return {
    name: data.brand_name || data.name,
    logoUrl: data.logo_url ?? null,
    primary: data.brand_primary ?? null,
  };
}
