#!/usr/bin/env node
/* Server-side permission proof (spec §6, §18).
 *
 * Logs in as a real coach and calls PostgREST directly with their JWT -
 * bypassing the UI entirely - to prove the restrictions are enforced by the
 * database, not by hidden buttons. Then proves the coach can still do the
 * things they need to actually teach.
 *
 *   node scripts/verify-permissions.mjs
 */

const URL_BASE = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const ACADEMY = "11111111-1111-1111-1111-111111111111";
let pass = 0, fail = 0;

function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

async function login(email, password = "chesspass123") {
  const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login failed for ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
}

const rest = (token) => async (path, init = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON, Authorization: `Bearer ${token}`,
      "content-type": "application/json", Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  let body = null;
  try { body = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body };
};

/** RLS denials surface either as 401/403 or as a 201 that wrote zero rows. */
function denied(res) {
  if (res.status === 401 || res.status === 403) return true;
  if (res.status >= 400) return true;
  return Array.isArray(res.body) && res.body.length === 0;
}

async function main() {
  console.log(`\nTarget: ${URL_BASE}\n`);

  const coachTok = await login("coach@chessacademy.test");
  const coach = rest(coachTok);
  const ceoTok = await login("admin@chessacademy.test");
  const ceo = rest(ceoTok);

  // Identity comes from the token's own subject - a bare profiles?limit=1
  // returns whichever row RLS lets through first, not necessarily the caller.
  const uid = JSON.parse(Buffer.from(coachTok.split(".")[1], "base64").toString()).sub;
  const me = (await coach(`profiles?select=id,role,display_name&id=eq.${uid}`)).body?.[0];
  if (me?.role !== "coach") throw new Error(`expected a coach, got ${me?.role} - check the seed`);
  console.log(`Coach identity: ${me.display_name} ${me.id} (${me.role})\n`);

  console.log("COACH MUST NOT (direct API, no UI involved):");

  const created = await coach("classrooms", {
    method: "POST",
    body: JSON.stringify({
      academy_id: ACADEMY, title: "HACK - coach-created class",
      coach_id: me.id, scheduled_at: new Date(Date.now() + 864e5).toISOString(),
      duration_minutes: 60,
    }),
  });
  check("create a class", denied(created), `→ got ${created.status} ${JSON.stringify(created.body)?.slice(0, 120)}`);

  const invited = await coach("invites", {
    method: "POST",
    body: JSON.stringify({ academy_id: ACADEMY, role: "student", display_name: "HACK student", created_by: me.id }),
  });
  check("add a student (mint invite)", denied(invited), `→ got ${invited.status}`);

  const batched = await coach("batches", {
    method: "POST",
    body: JSON.stringify({ academy_id: ACADEMY, name: "HACK batch" }),
  });
  check("create a batch", denied(batched), `→ got ${batched.status}`);

  // Reschedule attempt on a class they DO own - allowed row, forbidden column.
  const own = (await coach(`classrooms?select=id,scheduled_at,status&coach_id=eq.${me.id}&limit=1`)).body?.[0];
  if (own) {
    const resched = await coach(`classrooms?id=eq.${own.id}`, {
      method: "PATCH",
      body: JSON.stringify({ scheduled_at: new Date(Date.now() + 30 * 864e5).toISOString() }),
    });
    check("reschedule own class", denied(resched), `→ got ${resched.status}`);

    const reassign = await coach(`classrooms?id=eq.${own.id}`, {
      method: "PATCH", body: JSON.stringify({ coach_id: "22222222-2222-2222-2222-222222222222" }),
    });
    check("reassign own class to someone else", denied(reassign), `→ got ${reassign.status}`);
  } else {
    check("reschedule own class", false, "(no class assigned to this coach - seed issue)");
  }

  console.log("\nCOACH MUST STILL BE ABLE TO (teaching must not break):");

  const visible = await coach("classrooms?select=id,title,status&limit=5");
  check("view assigned classes", visible.status === 200 && Array.isArray(visible.body) && visible.body.length > 0,
    `→ ${visible.status}, ${visible.body?.length ?? 0} rows`);

  if (own) {
    const conduct = await coach(`classrooms?id=eq.${own.id}`, {
      method: "PATCH",
      body: JSON.stringify({ live_fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", notes: "verified" }),
    });
    check("conduct class (write live board state + notes)",
      conduct.status === 200 && Array.isArray(conduct.body) && conduct.body.length === 1,
      `→ ${conduct.status} ${JSON.stringify(conduct.body)?.slice(0, 120)}`);

    const start = await coach(`classrooms?id=eq.${own.id}`, {
      method: "PATCH", body: JSON.stringify({ status: "live", started_at: new Date().toISOString() }),
    });
    check("start/end own class (status transition)",
      start.status === 200 && start.body?.length === 1, `→ ${start.status}`);
    // put it back
    await coach(`classrooms?id=eq.${own.id}`, { method: "PATCH", body: JSON.stringify({ status: own.status }) });
  }

  const pgn = await coach("pgns", {
    method: "POST",
    body: JSON.stringify({ academy_id: ACADEMY, title: "verify-permissions probe", content: '[Event "t"]\n\n1. e4 e5 1-0', created_by: me.id }),
  });
  check("save to PGN library (teaching material)", pgn.status === 201 && pgn.body?.length === 1, `→ ${pgn.status}`);
  if (pgn.body?.[0]?.id) await coach(`pgns?id=eq.${pgn.body[0].id}`, { method: "DELETE" });

  console.log("\nADMIN CONTROL STILL WORKS:");
  const ceoCreate = await ceo("classrooms", {
    method: "POST",
    body: JSON.stringify({
      academy_id: ACADEMY, title: "verify-permissions CEO probe",
      coach_id: me.id, scheduled_at: new Date(Date.now() + 864e5).toISOString(), duration_minutes: 60,
    }),
  });
  check("CEO can create a class", ceoCreate.status === 201 && ceoCreate.body?.length === 1, `→ ${ceoCreate.status}`);
  if (ceoCreate.body?.[0]?.id) await ceo(`classrooms?id=eq.${ceoCreate.body[0].id}`, { method: "DELETE" });

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} - ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
