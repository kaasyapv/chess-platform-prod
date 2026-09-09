import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "ceo" | "manager" | "coach" | "student";

export type Profile = {
  id: string;
  academy_id: string;
  role: Role;
  display_name: string;
  username: string | null;
  status: string;
  tags: string[];
  board_settings: Record<string, unknown>;
  points: number;
  coins: number;
  avatar: string | null;
  /** Seeded with a temporary password - gated to /account/change-password
   *  until they set their own. */
  must_change_password: boolean;
  /** Cosmetics bought with coins. Numbers are INDICES into the part lists in
   *  lib/avatar-parts.ts, which is why those lists are append-only. */
  unlocks: { avatar_extras?: number[]; avatar_hats?: number[]; board_themes?: string[] };
};

export const STAFF_ROLES: Role[] = ["ceo", "manager", "coach"];

/** Server-side gate for role-scoped dashboard routes.
 *  Redirects to /login when unauthenticated, or to the caller's own
 *  dashboard when the URL role/academy doesn't match their profile. */
export async function requireProfile(role?: string, academyId?: string): Promise<Profile> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  /* Named columns, not `*`. This row is handed to client components as `me`,
   * so every column it carries is serialised into the page the browser
   * receives - and `select("*")` was shipping `invite_code` along with it,
   * a field nothing renders and nobody should be reading out of the RSC
   * payload. The list below is exactly the Profile type. */
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, academy_id, role, display_name, username, status, tags, board_settings, points, coins, avatar, unlocks, coach_id, must_change_password")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/onboarding");
  const p = profile as Profile;
  if (p.must_change_password) redirect("/account/change-password");
  if ((role && p.role !== role) || (academyId && p.academy_id !== academyId)) {
    redirect(dashboardPath(p));
  }
  return p;
}

export function dashboardPath(p: Pick<Profile, "role" | "academy_id">, feature = "classrooms") {
  return `/${p.role}/dashboard/${p.academy_id}/${feature}`;
}
