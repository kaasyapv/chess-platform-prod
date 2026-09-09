#!/usr/bin/env node
/* Load test: 50-60 simultaneous classes, ~200 concurrent connections (spec §16).
 *
 * WHAT THIS GENUINELY EXERCISES
 *   - Real Supabase Realtime websocket connections, one per simulated
 *     participant, all held open at once.
 *   - Real board broadcasts through those channels, with delivery measured at
 *     the receiving end (not just "we called send()").
 *   - Real postgres_changes fan-out to a Live Ops watcher subscribed exactly
 *     the way the wall subscribes.
 *   - Real database writes (live_fen updates) under that concurrency.
 *
 * WHAT THIS DOES NOT DO - and does not claim to
 *   - No real WebRTC media. Audio/video needs actual browsers with cameras;
 *     200 of those is not reproducible from a CLI on one laptop. The signaling
 *     path (presence + SDP/ICE over Realtime) is what's loaded here, which is
 *     the part that shares infrastructure with everything else. Media quality
 *     at scale has to be measured with real clients.
 *   - No browser rendering. Live Ops DOM cost under 58 cards is not measured.
 *
 *   node scripts/load-test.mjs [--classes 58] [--per-class 3]
 */

import { createClient } from "@supabase/supabase-js";

const SUPA = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? Number(process.argv[i + 1]) : d;
};
const CLASSES = arg("classes", 58);
const PER_CLASS = arg("per-class", 3);   // coach + 2 students
const ROUNDS = arg("rounds", 5);         // board moves per class
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => arr.length ? arr.sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0;

async function main() {
  const started = Date.now();
  console.log(`\nLoad test - ${CLASSES} classes x ${PER_CLASS} participants = ${CLASSES * PER_CLASS} realtime connections`);
  console.log(`Target: ${SUPA}\n`);

  const admin = createClient(SUPA, SERVICE, { auth: { persistSession: false } });
  const { data: rooms, error } = await admin
    .from("classrooms").select("id, academy_id").eq("status", "live").limit(CLASSES);
  if (error) throw new Error(error.message);
  if (!rooms?.length) throw new Error("no live classes - run the seed factory first");
  const academy = rooms[0].academy_id;
  console.log(`Using ${rooms.length} live classes.\n`);

  // ── Connect everyone ──────────────────────────────────────────────────────
  console.log("Opening connections…");
  const t0 = Date.now();
  const clients = [];
  const subscribeTimes = [];
  let subscribeFailures = 0;

  /* Connect in batches rather than firing every socket at once.
   *
   * Opening 200 websockets in a single Promise.all wedges the run: Realtime
   * rejects the burst (ConnectionRateLimitReached) and the client library sits
   * retrying, so nothing finishes. Real participants trickle in over seconds
   * anyway - a whole academy does not join on the same tick - so batching is
   * both what makes the test complete and the more faithful arrival pattern. */
  const tasks = rooms.flatMap((room) =>
    Array.from({ length: PER_CLASS }, (_, i) => ({ room, i })));

  const BATCH = Number(process.env.LOAD_BATCH ?? 25);
  const BATCH_DELAY = Number(process.env.LOAD_BATCH_DELAY ?? 250);
  for (let b = 0; b < tasks.length; b += BATCH) {
    await Promise.all(tasks.slice(b, b + BATCH).map(async ({ room, i }) => {
      const sb = createClient(SUPA, ANON, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 20 } },
      });
      const received = [];
      const ch = sb.channel(`class:${room.id}`, {
        config: { broadcast: { self: false }, presence: { key: `load-${room.id}-${i}` } },
      });
      ch.on("broadcast", { event: "board" }, ({ payload }) => {
        received.push(Date.now() - payload.sentAt);
      });
      const s0 = Date.now();
      const ok = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 20000);
        ch.subscribe((status) => {
          if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(true); }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timer); resolve(false); }
        });
      });
      if (ok) { subscribeTimes.push(Date.now() - s0); await ch.track({ role: i === 0 ? "coach" : "student" }); }
      else subscribeFailures++;
      clients.push({ sb, ch, room, received, isCoach: i === 0, ok });
    }));
    if (b + BATCH < tasks.length) await sleep(BATCH_DELAY);
  }

  const connected = clients.filter((c) => c.ok).length;
  console.log(`  connected: ${connected}/${clients.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  subscribe latency: p50 ${pct(subscribeTimes, 0.5)}ms · p95 ${pct(subscribeTimes, 0.95)}ms · max ${Math.max(...subscribeTimes, 0)}ms`);
  if (subscribeFailures) console.log(`  ⚠ ${subscribeFailures} failed to subscribe`);

  /* A Live Ops wall watching every class at once.
   *
   * Signed in as a real manager, not with the service key: Realtime authorises
   * postgres_changes against the subscriber's JWT, and a service-role token
   * isn't the thing a browser ever holds - subscribing with it silently
   * delivered zero events, which would have made this look like the fan-out
   * failed when it was the test that was wrong. */
  const wall = createClient(SUPA, ANON, { auth: { persistSession: false } });
  const { error: wallAuth } = await wall.auth.signInWithPassword({
    email: "manager@chessacademy.test", password: "chesspass123",
  });
  if (wallAuth) throw new Error(`wall login: ${wallAuth.message}`);
  const wallEvents = [];
  const wallCh = wall.channel("load-live-ops")
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "classrooms", filter: `academy_id=eq.${academy}` },
      (p) => wallEvents.push({ id: p.new?.id, at: Date.now() }));
  // Timeout, because an un-timed await here is how the 200-connection run
  // wedged: all 200 participants connected fine, then the wall's SUBSCRIBED
  // never arrived and the script waited on it forever, which looked like
  // "200 connections don't work" when the connections were already up.
  const wallOk = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 30000);
    wallCh.subscribe((s) => {
      if (s === "SUBSCRIBED") { clearTimeout(timer); resolve(true); }
      if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") { clearTimeout(timer); resolve(false); }
    });
  });
  console.log(wallOk
    ? "  Live Ops wall subscribed (1 channel for all classes)\n"
    : "  ⚠ Live Ops wall did NOT subscribe - fan-out numbers below are not meaningful\n");

  // ── Traffic ───────────────────────────────────────────────────────────────
  console.log(`Broadcasting ${ROUNDS} board moves per class…`);
  const coaches = clients.filter((c) => c.isCoach && c.ok);
  const dbLatencies = [];
  const memBefore = process.memoryUsage().heapUsed;
  const tSend = Date.now();
  let sends = 0, dbErrors = 0, firstDbError = null;

  for (let round = 0; round < ROUNDS; round++) {
    await Promise.all(coaches.map(async (c) => {
      const fen = `position-r${round}-${c.room.id.slice(0, 8)}`;
      c.ch.send({ type: "broadcast", event: "board", payload: { fen, sentAt: Date.now() } });
      sends++;
      // Same debounced persistence the classroom does, so the DB sees the
      // write load a real wall of classes would generate.
      const w0 = Date.now();
      const { error: e } = await admin.from("classrooms")
        .update({ live_fen: fen, live_updated_at: new Date().toISOString() }).eq("id", c.room.id);
      if (e) { dbErrors++; if (!firstDbError) firstDbError = `${e.code ?? ''} ${e.message}`; } else dbLatencies.push(Date.now() - w0);
    }));
    await sleep(400);
  }
  await sleep(2500); // let the tail arrive

  const elapsed = (Date.now() - tSend) / 1000;
  const allLatencies = clients.flatMap((c) => c.received);
  const expectedPerClass = ROUNDS * (PER_CLASS - 1); // coach's own sends aren't echoed back
  const expectedTotal = coaches.length * expectedPerClass;

  console.log(`\n── Results ──────────────────────────────────────────────`);
  console.log(`Realtime connections held : ${connected}`);
  console.log(`Broadcasts sent           : ${sends} over ${elapsed.toFixed(1)}s (${(sends / elapsed).toFixed(1)}/s)`);
  console.log(`Broadcast deliveries      : ${allLatencies.length}/${expectedTotal} (${((allLatencies.length / expectedTotal) * 100).toFixed(1)}%)`);
  console.log(`Broadcast latency         : p50 ${pct(allLatencies, 0.5)}ms · p95 ${pct(allLatencies, 0.95)}ms · max ${Math.max(...allLatencies, 0)}ms`);
  console.log(`DB writes                 : ${dbLatencies.length} ok, ${dbErrors} failed${firstDbError ? ` - first error: ${firstDbError}` : ""}`);
  console.log(`DB write latency          : p50 ${pct(dbLatencies, 0.5)}ms · p95 ${pct(dbLatencies, 0.95)}ms · max ${Math.max(...dbLatencies, 0)}ms`);
  console.log(`Live Ops events received  : ${wallEvents.length} (one wall channel, ${coaches.length * ROUNDS} row updates)`);
  console.log(`Client heap growth        : ${((process.memoryUsage().heapUsed - memBefore) / 1e6).toFixed(1)} MB`);

  const deliveryRate = allLatencies.length / Math.max(1, expectedTotal);
  const verdict = connected >= clients.length * 0.95 && deliveryRate >= 0.95 && dbErrors === 0;
  console.log(`\nVerdict: ${verdict ? "PASS" : "REVIEW"} - ${connected} connections, ${(deliveryRate * 100).toFixed(1)}% delivery, ${dbErrors} db errors`);
  console.log(`(WebRTC media NOT exercised - signaling/realtime/db only. See header.)`);
  console.log(`Total runtime: ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

  await Promise.all(clients.map((c) => c.sb.removeAllChannels().catch(() => {})));
  await wall.removeAllChannels().catch(() => {});
  process.exit(verdict ? 0 : 1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
