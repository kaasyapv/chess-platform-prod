/* Admin "Login as student" — secure server-minted impersonation.
 *
 * Design: final_boss_implement/deep_dive_micro_features/MICRO_INTERACTIONS_AND_INTEGRATIONS.md §4.1
 *
 * Same shape as /api/admin/reset-password: the target is read under the
 * CALLER'S RLS (profiles SELECT is academy-scoped) so this can never reach
 * across academies, the role checks are in this handler (not left to RLS), and
 * both ends are written to audit_log.
 *
 *   1. requireProfile() → caller is ceo | manager
 *   2. target must be a `student` in the caller's academy
 *   3. audit_log { action: 'impersonate.start', actor, target }
 *   4. supabase.auth.admin.generateLink({ type: 'magiclink', email }) — a
 *      single-use, short-TTL link (GoTrue default ~1h; the client banner
 *      enforces a 15-min working window and a prominent Exit)
 *   5. return the one-time URL → the client opens it in a NEW TAB, so the
 *      admin's own session in the first tab is untouched
 *
 * Never: put the student's long-lived token in a URL, reuse the admin cookie,
 * or skip the audit row. Scoped to `student` targets only — staff cannot be
 * impersonated here.
 *
 * ponytail: the JWT `act` claim + RLS-level destructive-op blocking from the
 * spec need a custom GoTrue access-token hook; v1's safety is the hard gate +
 * audit trail + the always-visible banner + the 15-min client window.
 */

import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rateLimitGuard } from "@/lib/rate-limit-guard";

export async function POST(req: Request) {
  const profile = await requireProfile();

  if (profile.role !== "ceo" && profile.role !== "manager") {
    return NextResponse.json({ error: "Only a CEO or manager can view as a student" }, { status: 403 });
  }

  const limited = rateLimitGuard(`impersonate:${profile.id}`, 10, 60_000,
    "Too many impersonation requests - wait a minute");
  if (limited) return limited;

  let body: { studentId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const studentId = String(body.studentId ?? "").trim();
  if (!studentId) return NextResponse.json({ error: "studentId is required" }, { status: 400 });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Impersonation needs SUPABASE_SERVICE_ROLE_KEY - see .env.example" }, { status: 503 });
  }

  // Read the target under the CALLER's RLS - academy-scoped, no cross-tenant reach.
  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, display_name, role, academy_id")
    .eq("id", studentId)
    .maybeSingle();

  if (!target || target.academy_id !== profile.academy_id) {
    return NextResponse.json({ error: "Student not found in your academy" }, { status: 404 });
  }
  if (target.role !== "student") {
    return NextResponse.json({ error: "Only students can be viewed as" }, { status: 400 });
  }

  const admin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authUser, error: getErr } = await admin.auth.admin.getUserById(studentId);
  if (getErr || !authUser?.user?.email) {
    return NextResponse.json({ error: "That student has no email on file to sign in with" }, { status: 422 });
  }

  const origin = new URL(req.url).origin;
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: authUser.user.email,
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (linkErr || !link?.properties?.action_link) {
    return NextResponse.json({ error: `Could not create the sign-in link: ${linkErr?.message ?? "unknown"}` }, { status: 502 });
  }

  await admin.from("audit_log").insert({
    academy_id: profile.academy_id,
    actor_id: profile.id,
    table_name: "auth.users",
    action: "impersonate.start",
    row_id: studentId,
    detail: { target_name: target.display_name, actor_name: profile.display_name },
  });

  return NextResponse.json({
    ok: true,
    url: link.properties.action_link,
    student: { id: target.id, name: target.display_name },
    by: profile.display_name,
  });
}
