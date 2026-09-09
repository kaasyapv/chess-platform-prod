/* Admin-initiated password reset (user lifecycle).
 *
 * A CEO or manager resets a member's password from Academy -> People. The
 * member is handed a one-time temporary password and `must_change_password` is
 * set, so `requireProfile()` (src/lib/auth.ts) bounces them to
 * /account/change-password on the next page load until they pick a new one -
 * the old password is dead the moment this returns, whether or not their
 * current session is still open.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (setting another user's password is a GoTrue
 * admin operation, same as the billing settle + failure-report routes). No key
 * -> 503 with a pointer to .env.example; the rest of People keeps working.
 *
 * Tenant safety: the target is read under the caller's RLS (profiles SELECT is
 * academy-scoped), so this can never reach across academies. A manager may
 * reset students and coaches; only the CEO may reset another manager; the CEO
 * account itself is not resettable here (transfer ownership first).
 */

import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rateLimitGuard } from "@/lib/rate-limit-guard";
import { generateTempPassword, isStrongTempPassword } from "@/lib/temp-password";

export async function POST(req: Request) {
  const profile = await requireProfile();

  if (profile.role !== "ceo" && profile.role !== "manager") {
    return NextResponse.json(
      { error: "Only a CEO or manager can reset a member's password" },
      { status: 403 },
    );
  }

  const limited = rateLimitGuard(`reset-pw:${profile.id}`, 20, 60_000,
    "Too many password resets - wait a minute");
  if (limited) return limited;

  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const userId = String(body.userId ?? "").trim();
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Password reset needs SUPABASE_SERVICE_ROLE_KEY - see .env.example" },
      { status: 503 },
    );
  }

  // Read the target under the CALLER's RLS - academy-scoped, so no cross-tenant reach.
  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, display_name, role, academy_id")
    .eq("id", userId)
    .maybeSingle();

  if (!target || target.academy_id !== profile.academy_id) {
    return NextResponse.json({ error: "Member not found in your academy" }, { status: 404 });
  }
  if (target.id === profile.id) {
    return NextResponse.json(
      { error: "For your own account use Account -> Change password" },
      { status: 400 },
    );
  }
  if (target.role === "ceo") {
    return NextResponse.json(
      { error: "The CEO account can't be reset here - transfer ownership first" },
      { status: 400 },
    );
  }
  if (target.role === "manager" && profile.role !== "ceo") {
    return NextResponse.json(
      { error: "Only the CEO can reset a manager's password" },
      { status: 403 },
    );
  }

  const admin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let display = generateTempPassword();
  if (!isStrongTempPassword(display)) display = generateTempPassword(); // never hit; belt-and-braces
  const raw = display.replace(/-/g, ""); // the grouping is display-only

  const { error: pwErr } = await admin.auth.admin.updateUserById(userId, { password: raw });
  if (pwErr) {
    return NextResponse.json(
      { error: `Could not reset password: ${pwErr.message}` },
      { status: 502 },
    );
  }

  // Force a change on next login. This is the real lock - requireProfile()
  // redirects to /account/change-password until change-password-form.tsx
  // clears the flag, so an already-open session can't keep using the account.
  const { error: flagErr } = await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", userId);
  if (flagErr) console.error("reset-password: must_change_password flag:", flagErr.message);

  // Audit trail (ceo/manager-readable) + a heads-up for the member.
  await admin.from("audit_log").insert({
    academy_id: profile.academy_id,
    actor_id: profile.id,
    table_name: "auth.users",
    action: "reset_password",
    row_id: userId,
    detail: { target_name: target.display_name, target_role: target.role },
  });
  await admin.from("notifications").insert({
    academy_id: profile.academy_id,
    user_id: userId,
    title: "Your password was reset",
    body: "An administrator reset your password. Sign in with the temporary password you were given - you'll be asked to set a new one.",
    href: "/account/change-password",
  });

  return NextResponse.json({
    ok: true,
    tempPassword: display,
    member: { id: target.id, name: target.display_name },
  });
}
