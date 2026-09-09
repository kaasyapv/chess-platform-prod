#!/usr/bin/env node
/* Role-by-role RLS proof for the fixes in 0027_audit_hardening.sql.
 *
 * scripts/verify-rls.sql answers "is every table covered". This answers the
 * question that one cannot: what a real signed-in student, coach, manager and
 * CEO can actually read and write over PostgREST with the public anon key -
 * the same surface a browser console has. Each finding 0027 closed gets a
 * check that fails if the hole reopens, paired with a check that the
 * legitimate flow it sat next to still works, so nothing here can be "fixed"
 * by locking the feature out entirely.
 *
 * Needs the local stack and demo seed:  npx supabase start && npx supabase db reset
 *   node scripts/verify-rls-roles.mjs
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const PW = process.env.DEMO_PASSWORD ?? "chesspass123";

let fails = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) fails++;
};

async function as(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`${email}: ${error.message}`);
  return { c, id: data.user.id };
}

const student = await as("student@chessacademy.test");
const coach = await as("coach@chessacademy.test");
const manager = await as("manager@chessacademy.test");
const ceo = await as("admin@chessacademy.test");
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

console.log("\n1. Privilege escalation on profiles");
{
  const { error } = await student.c.from("profiles").update({ role: "ceo" }).eq("id", student.id);
  const { data: after } = await student.c.from("profiles").select("role").eq("id", student.id).single();
  check("student cannot promote themselves to CEO", after.role === "student", `role=${after.role} err=${error?.code ?? "none"}`);
}
{
  const { data: before } = await student.c.from("profiles").select("coins, points").eq("id", student.id).single();
  await student.c.from("profiles").update({ coins: 999999, points: 999999 }).eq("id", student.id);
  const { data: after } = await student.c.from("profiles").select("coins, points").eq("id", student.id).single();
  check("student cannot mint points/coins", after.coins === before.coins && after.points === before.points,
    `${before.coins}/${before.points} → ${after.coins}/${after.points}`);
}
{
  const { data: other } = await ceo.c.from("profiles").select("id, academy_id").eq("role", "student").limit(1).single();
  const { error } = await manager.c.from("profiles").update({ role: "ceo" }).eq("id", other.id);
  const { data: after } = await ceo.c.from("profiles").select("role").eq("id", other.id).single();
  check("manager cannot mint a second CEO", after.role !== "ceo", `role=${after.role} err=${error?.code ?? "none"}`);
}
{
  // The legitimate self-edits must still work.
  const { error: e1 } = await student.c.from("profiles")
    .update({ display_name: "Audit Rename", board_settings: { theme: "rose" } }).eq("id", student.id);
  check("student can still rename themselves / save board settings", !e1, e1?.message ?? "");
  const { error: e2 } = await ceo.c.from("profiles").update({ status: "active" }).eq("id", student.id);
  check("CEO can still set a member's status", !e2, e2?.message ?? "");
}

console.log("\n2. Parent report links");
{
  const { data: rows, error } = await anon.from("student_reports").select("*");
  check("anon cannot list student reports", (rows?.length ?? 0) === 0, `${rows?.length ?? 0} rows, err=${error?.code ?? "none"}`);
  const { data: st } = await student.c.from("student_reports").select("*");
  check("a student cannot list the academy's reports", (st?.length ?? 0) === 0, `${st?.length ?? 0} rows`);

  const { data: seeded } = await ceo.c.from("student_reports").select("slug").limit(1);
  if (seeded?.length) {
    const { data: shared, error: e } = await anon.rpc("shared_student_report", { p_slug: seeded[0].slug });
    check("a parent holding the slug still gets the report", (shared?.length ?? 0) === 1, e?.message ?? "");
    const { data: wrong } = await anon.rpc("shared_student_report", { p_slug: "not-a-real-slug" });
    check("a wrong slug returns nothing", (wrong?.length ?? 0) === 0);
  } else {
    // Nothing seeded - make one as the CEO so the path is still exercised.
    const { data: made, error: me } = await ceo.c.from("student_reports")
      .insert({ academy_id: (await ceo.c.from("profiles").select("academy_id").eq("id", ceo.id).single()).data.academy_id,
                student_id: student.id, snapshot: { student_name: "Audit" }, created_by: ceo.id })
      .select("slug").single();
    check("staff can still publish a report", !me, me?.message ?? "");
    if (made) {
      const { data: shared } = await anon.rpc("shared_student_report", { p_slug: made.slug });
      check("a parent holding the slug still gets the report", (shared?.length ?? 0) === 1);
    }
  }
}

console.log("\n3. Homework grading and visibility");
{
  const { data: sub } = await student.c.from("homework_submissions").select("id, score").eq("student_id", student.id).limit(1).maybeSingle();
  if (sub) {
    const { error } = await student.c.from("homework_submissions").update({ score: 100, status: "reviewed" }).eq("id", sub.id);
    const { data: after } = await student.c.from("homework_submissions").select("score, status").eq("id", sub.id).single();
    check("student cannot grade their own submission", !!error && after.score !== 100,
      `score=${after.score} (was ${sub.score}) err=${error?.code ?? "NO ERROR"}`);
    const { error: reAttempt } = await student.c.from("homework_submissions")
      .update({ answers: { text: "second attempt" }, status: "submitted" }).eq("id", sub.id);
    check("student can still re-attempt it", !reAttempt, reAttempt?.message ?? "");
  } else {
    console.log("  SKIP  no seeded submission for this student");
  }
  const { data: coachGrade } = await coach.c.from("homework_submissions").select("id").limit(1).maybeSingle();
  if (coachGrade) {
    const { error } = await coach.c.from("homework_submissions")
      .update({ score: 77, status: "reviewed", reviewed_at: new Date().toISOString() }).eq("id", coachGrade.id);
    check("a coach can still grade", !error, error?.message ?? "");
  }
}
{
  const { data: mine } = await student.c.from("homework_assignments").select("id, batch_id, student_id");
  const { data: myBatches } = await student.c.from("batch_members").select("batch_id").eq("student_id", student.id);
  const allowed = new Set((myBatches ?? []).map((b) => b.batch_id));
  const stray = (mine ?? []).filter((a) => a.student_id !== student.id && a.batch_id && !allowed.has(a.batch_id));
  check("student sees no other batch's homework", stray.length === 0, `${stray.length} stray of ${mine?.length ?? 0}`);
  check("student still sees homework at all", (mine?.length ?? 0) > 0, `${mine?.length ?? 0} visible`);
}
{
  // Per-student assignment, end to end: coach assigns → that student sees it.
  const { data: me } = await coach.c.from("profiles").select("academy_id").eq("id", coach.id).single();
  const { data: made, error } = await coach.c.from("homework_assignments").insert({
    academy_id: me.academy_id, title: "Audit: one-student homework",
    content: { instructions: "solo", positions: [] },
    student_id: student.id, status: "active", created_by: coach.id,
  }).select("id").single();
  check("coach can assign to one named student", !error, error?.message ?? "");
  if (made) {
    const { data: seen } = await student.c.from("homework_assignments").select("id").eq("id", made.id).maybeSingle();
    check("the named student sees it", !!seen);
    const { data: notSeen } = await coach.c.from("profiles").select("id").eq("role", "student").neq("id", student.id).limit(1).maybeSingle();
    check("CEO sees it in the academy-wide view",
      !!(await ceo.c.from("homework_assignments").select("id").eq("id", made.id).maybeSingle()).data);
    if (notSeen) {
      const other = await as((await ceo.c.from("profiles").select("username").eq("id", notSeen.id).single()).data?.username
        ? "student@chessacademy.test" : "student@chessacademy.test");
      void other;
    }
    await coach.c.from("homework_assignments").delete().eq("id", made.id);
  }
}

console.log("\n4. Financial privacy still holds");
{
  const { data: inv } = await student.c.from("invoices").select("id, student_id");
  const foreign = (inv ?? []).filter((i) => i.student_id !== student.id);
  check("student reads only their own invoices", foreign.length === 0, `${foreign.length} foreign of ${inv?.length ?? 0}`);
  const { data: pen } = await student.c.from("coach_penalties").select("id");
  check("student reads no coach penalties", (pen?.length ?? 0) === 0, `${pen?.length ?? 0} rows`);
  const { data: mgrPen } = await manager.c.from("coach_penalties").select("id");
  check("manager without can_view_billing reads no penalties", (mgrPen?.length ?? 0) === 0, `${mgrPen?.length ?? 0} rows`);
  const { data: ceoPen } = await ceo.c.from("coach_penalties").select("id");
  check("CEO still reads penalties", (ceoPen?.length ?? 0) > 0, `${ceoPen?.length ?? 0} rows`);
  const { data: mgrInv } = await manager.c.from("invoices").select("id");
  check("manager without can_view_billing reads no invoices", (mgrInv?.length ?? 0) === 0, `${mgrInv?.length ?? 0} rows`);
}

console.log("\n5. Coaches cannot administrate");
{
  const { data: me } = await coach.c.from("profiles").select("academy_id").eq("id", coach.id).single();
  const { error } = await coach.c.from("classrooms").insert({
    academy_id: me.academy_id, title: "Audit: coach-created class",
    scheduled_at: new Date().toISOString(), coach_id: coach.id,
  });
  check("coach cannot create a class", !!error, error?.code ?? "INSERT SUCCEEDED");
  const { error: e2 } = await coach.c.from("invites").insert({
    academy_id: me.academy_id, role: "student", display_name: "Audit", created_by: coach.id,
  });
  check("coach cannot mint an invite", !!e2, e2?.code ?? "INSERT SUCCEEDED");
  const { data: own } = await coach.c.from("classrooms").select("id").eq("coach_id", coach.id).limit(1).maybeSingle();
  if (own) {
    const { error: e3 } = await coach.c.from("classrooms").update({ live_fen: "8/8/8/8/8/8/8/8 w - - 0 1" }).eq("id", own.id);
    check("coach can still drive their own class board", !e3, e3?.message ?? "");
    const { error: e4 } = await coach.c.from("classrooms")
      .update({ scheduled_at: new Date(Date.now() + 864e5).toISOString() }).eq("id", own.id);
    check("coach cannot reschedule it", !!e4, e4?.code ?? "UPDATE SUCCEEDED");
  }
}

console.log("\n6. The coin shop actually charges");
{
  const { data: before } = await student.c.from("profiles").select("coins, unlocks").eq("id", student.id).single();
  const item = 3;
  const { error } = await student.c.rpc("buy_unlock", { p_kind: "avatar_hats", p_item: item, p_cost: 5 });
  const { data: after } = await student.c.from("profiles").select("coins, unlocks").eq("id", student.id).single();
  if (before.coins >= 5) {
    check("coins are deducted", after.coins === before.coins - 5, `${before.coins} → ${after.coins} err=${error?.message ?? "none"}`);
    check("the unlock is recorded", (after.unlocks?.avatar_hats ?? []).includes(item), JSON.stringify(after.unlocks));
    const { error: e2 } = await student.c.rpc("buy_unlock", { p_kind: "avatar_hats", p_item: item, p_cost: 5 });
    const { data: after2 } = await student.c.from("profiles").select("coins").eq("id", student.id).single();
    check("buying it twice does not charge twice", after2.coins === after.coins, `${after.coins} → ${after2.coins} err=${e2?.message ?? "none"}`);
  } else {
    check("a broke student is refused", !!error, `coins=${before.coins} err=${error?.message ?? "none"}`);
  }
  const { error: e3 } = await student.c.from("profiles").update({ unlocks: { board_themes: ["rose"] } }).eq("id", student.id);
  const { data: after3 } = await student.c.from("profiles").select("unlocks").eq("id", student.id).single();
  check("unlocks cannot be granted directly", !(after3.unlocks?.board_themes ?? []).includes("rose"),
    `err=${e3?.code ?? "none"} unlocks=${JSON.stringify(after3.unlocks)}`);
}

console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} CHECK(S) FAILED`}\n`);
process.exit(fails === 0 ? 0 : 1);
