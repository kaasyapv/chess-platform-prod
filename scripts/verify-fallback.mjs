#!/usr/bin/env node
/* Failure → fallback → n8n proof (spec §14, §15).
 *
 * Stands up a throwaway HTTP listener that plays the part of the n8n webhook,
 * points the app at it, then drives real failure reports through
 * /api/failures/classroom and checks what n8n actually received - including
 * that a burst of signals from a dying classroom collapses into ONE message
 * instead of spamming the same parent.
 *
 * Needs the dev server running with N8N_FALLBACK_WEBHOOK_URL pointed here:
 *   N8N_FALLBACK_WEBHOOK_URL=http://127.0.0.1:5599/hook npm run dev
 *   node scripts/verify-fallback.mjs
 */

import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const SUPA = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const PORT = 5599;

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };

const received = [];
const hook = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ headers: req.headers, body: JSON.parse(body || "{}") });
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
});

async function main() {
  await new Promise((r) => hook.listen(PORT, r));
  console.log(`\nFake n8n listening on :${PORT}`);
  console.log(`App: ${APP}\n`);

  // Sign in as the coach through the app so we get real session cookies.
  const sb = createClient(SUPA, ANON);
  const { data: auth, error } = await sb.auth.signInWithPassword({
    email: "coach@chessacademy.test", password: "chesspass123",
  });
  if (error) throw new Error(`login: ${error.message}`);

  const uid = auth.user.id;
  const { data: room } = await sb.from("classrooms")
    .select("id, title, meeting_url").eq("coach_id", uid).eq("status", "live").limit(1).maybeSingle();
  if (!room) throw new Error("no live class for the demo coach");

  /* The route reads the session from cookies, so the harness has to store it
   * exactly the way @supabase/ssr does: cookie name from supabase-js's default
   * storage key (`sb-${hostname.split(".")[0]}-auth-token`), value the whole
   * session JSON base64url-encoded behind a `base64-` prefix. Getting either
   * half wrong just redirects to /login, which is what the first run did. */
  const ref = new URL(SUPA).hostname.split(".")[0];
  const b64url = Buffer.from(JSON.stringify(auth.session)).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const cookie = `sb-${ref}-auth-token=base64-${b64url}`;

  const report = (kind, detail) =>
    fetch(`${APP}/api/failures/classroom`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ classroomId: room.id, kind, detail }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  // Make sure the class has a fallback link to send (managers set this in the UI).
  if (!room.meeting_url) {
    const admin = createClient(SUPA, ANON);
    await admin.auth.signInWithPassword({ email: "admin@chessacademy.test", password: "chesspass123" });
    await admin.from("classrooms")
      .update({ meeting_url: "https://meet.google.com/verify-fallback" }).eq("id", room.id);
    console.log("Set a fallback link on the class for the test.\n");
  }

  console.log(`Reporting a failure on "${room.title}":`);
  const first = await report("webrtc_failure", "verify-fallback: video never established");
  check("failure accepted", first.status === 200, `→ ${first.status} ${JSON.stringify(first.body)}`);
  check("dispatch reported as sent", first.body?.status === "sent", `→ ${first.body?.status} (${first.body?.dispatch})`);

  await new Promise((r) => setTimeout(r, 300));
  check("n8n actually received a call", received.length === 1, `→ ${received.length} calls`);

  const payload = received[0]?.body;
  if (payload) {
    check("payload carries the class/session details", Boolean(payload.classroom?.id && payload.classroom?.title));
    check("payload carries the fallback link", typeof payload.fallbackUrl === "string" && payload.fallbackUrl.length > 0,
      `→ ${payload.fallbackUrl}`);
    check("payload identifies the failure kind", payload.kind === "webrtc_failure", `→ ${payload.kind}`);
    check("payload has no parent phone numbers in it", !JSON.stringify(payload).match(/\+\d{10,}/),
      "contact resolution belongs to n8n/CRM, not this endpoint");
  }

  console.log("\nA dying class reports from every browser at once:");
  const burst = await Promise.all([
    report("webrtc_failure", "burst 1"), report("webrtc_failure", "burst 2"),
    report("webrtc_failure", "burst 3"), report("webrtc_failure", "burst 4"),
  ]);
  await new Promise((r) => setTimeout(r, 400));
  check("all burst reports were accepted", burst.every((b) => b.status === 200));
  check("every one of them was suppressed as duplicate",
    burst.every((b) => b.body?.status === "duplicate"),
    `→ ${burst.map((b) => b.body?.status).join(",")}`);
  check("n8n was NOT called again (parent not spammed)", received.length === 1, `→ ${received.length} total calls`);

  console.log("\nA different failure kind is a different situation:");
  const other = await report("service_failure", "verify-fallback: different kind");
  await new Promise((r) => setTimeout(r, 300));
  check("distinct kind dispatches on its own", other.body?.status === "sent" && received.length === 2,
    `→ ${other.body?.status}, ${received.length} calls`);

  // Everything is written down, whether delivered or suppressed.
  const admin2 = createClient(SUPA, ANON);
  await admin2.auth.signInWithPassword({ email: "admin@chessacademy.test", password: "chesspass123" });
  const { data: log } = await admin2.from("failure_events")
    .select("dispatch_status").eq("classroom_id", room.id)
    .gte("created_at", new Date(Date.now() - 120_000).toISOString());
  const sent = log?.filter((l) => l.dispatch_status === "sent").length ?? 0;
  const dup = log?.filter((l) => l.dispatch_status === "duplicate").length ?? 0;
  console.log(`\n  log: ${sent} sent, ${dup} suppressed, ${log?.length} total`);
  check("suppressed signals are still logged (visible, just not delivered)", dup >= 4 && sent === 2);

  hook.close();
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} - ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERROR:", e.message); hook.close(); process.exit(1); });
