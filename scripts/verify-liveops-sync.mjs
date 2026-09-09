#!/usr/bin/env node
/* Live Ops board-sync proof (spec §5).
 *
 * Subscribes exactly the way the Live Ops wall does - one postgres_changes
 * listener on classrooms - then writes live_fen as the coach and measures
 * whether the update actually arrives, and how fast. This is the difference
 * between "the code looks right" and "moves show up without refreshing".
 *
 *   node scripts/verify-liveops-sync.mjs
 */

import { createClient } from "@supabase/supabase-js";

const URL_BASE = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const ACADEMY = "11111111-1111-1111-1111-111111111111";

const MOVES = [
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
  "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
];

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\nTarget: ${URL_BASE}\n`);

  // Coach writes; manager watches. Two separate clients, like two browsers.
  const coach = createClient(URL_BASE, ANON);
  const { error: cErr } = await coach.auth.signInWithPassword({
    email: "coach@chessacademy.test", password: "chesspass123",
  });
  if (cErr) throw new Error(`coach login: ${cErr.message}`);

  const manager = createClient(URL_BASE, ANON);
  const { error: mErr } = await manager.auth.signInWithPassword({
    email: "manager@chessacademy.test", password: "chesspass123",
  });
  if (mErr) throw new Error(`manager login: ${mErr.message}`);

  const uid = (await coach.auth.getUser()).data.user.id;
  const { data: room } = await coach
    .from("classrooms").select("id, title, live_fen")
    .eq("coach_id", uid).eq("status", "live").limit(1).maybeSingle();
  if (!room) throw new Error("no live class assigned to the demo coach");
  console.log(`Watching: "${room.title}" (${room.id})\n`);

  // Exactly the Live Ops subscription: ONE channel, filtered to the academy.
  const received = [];
  let subscribed = false;
  const channel = manager
    .channel("live-ops-verify")
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "classrooms", filter: `academy_id=eq.${ACADEMY}` },
      (payload) => {
        if (payload.new?.id === room.id) received.push({ fen: payload.new.live_fen, at: Date.now() });
      })
    .subscribe((s) => { if (s === "SUBSCRIBED") subscribed = true; });

  for (let i = 0; i < 50 && !subscribed; i++) await sleep(100);
  check("manager can subscribe to the classrooms channel", subscribed);
  if (!subscribed) { console.log("\nFAIL - no subscription, aborting\n"); process.exit(1); }

  /* Snapshot AFTER subscribing - the ordering the wall itself now uses.
   * Fetching first leaves a window where a move lands in neither the snapshot
   * nor the stream, which is exactly how the board used to go stale. */
  let wallFen = (await manager.from("classrooms").select("live_fen").eq("id", room.id).single())
    .data?.live_fen ?? null;

  console.log("\nCoach plays four moves, Live Ops should follow each one:");
  const latencies = [];
  for (const fen of MOVES) {
    const before = received.length;
    const sentAt = Date.now();
    const { error } = await coach.from("classrooms")
      .update({ live_fen: fen, live_updated_at: new Date().toISOString() })
      .eq("id", room.id);
    if (error) { check(`write ${fen.slice(0, 18)}…`, false, error.message); continue; }

    let waited = 0;
    while (received.length === before && waited < 5000) { await sleep(50); waited += 50; }
    const got = received[received.length - 1];
    const ok = received.length > before && got.fen === fen;
    if (ok) { latencies.push(got.at - sentAt); wallFen = got.fen; }
    check(`move propagated (${fen.split(" ")[0].slice(0, 16)}…)`, ok,
      ok ? "" : `waited ${waited}ms, got ${got?.fen?.slice(0, 20)}`);
  }

  const ordered = received.map((r) => r.fen);
  check("moves arrived in order", ordered.every((f, i) => f === MOVES[MOVES.length - ordered.length + i]),
    `→ ${ordered.length} events`);

  // The guarantee that actually matters to a manager watching the wall.
  check("wall ends on the current position (not a stale board)", wallFen === MOVES.at(-1),
    `→ wall shows ${wallFen?.slice(0, 24)}`);

  if (latencies.length) {
    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    console.log(`\n  latency: min ${Math.min(...latencies)}ms · avg ${avg}ms · max ${Math.max(...latencies)}ms`);
    check("propagation under 2s", Math.max(...latencies) < 2000);
  }

  // A wall opened mid-game must render the CURRENT position, not the opening.
  console.log("\nLive Ops joining late (the stale-board case):");
  const { data: fresh } = await manager
    .from("classrooms").select("live_fen").eq("id", room.id).single();
  check("initial fetch returns the latest position", fresh?.live_fen === MOVES.at(-1),
    `→ got ${fresh?.live_fen?.slice(0, 24)}`);

  await manager.removeChannel(channel);
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} - ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
