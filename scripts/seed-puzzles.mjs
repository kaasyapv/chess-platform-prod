#!/usr/bin/env node
// Seed the puzzles table from the bundled Lichess CC0 subset
// (src/data/puzzles.json, ~10.5k puzzles). Idempotent upsert.
//
//   node scripts/seed-puzzles.mjs
//
// Uses the service role (bypasses RLS) against the local stack by default.

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = "/Users/kaasyap/Desktop/chess-platform";

function envFromLocal() {
  const txt = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const get = (k) => txt.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
  return { url: get("NEXT_PUBLIC_SUPABASE_URL"), key: get("SUPABASE_SERVICE_ROLE_KEY") };
}

const { url, key } = envFromLocal();
if (!url || !key) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const puzzles = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/puzzles.json"), "utf8"));
  console.log(`Seeding ${puzzles.length} puzzles…`);
  let done = 0;
  for (let i = 0; i < puzzles.length; i += 1000) {
    const chunk = puzzles.slice(i, i + 1000).map((p) => ({
      id: p.id, fen: p.fen, moves: p.moves,
      rating: p.rating, popularity: p.popularity, plays: p.plays, themes: p.themes,
    }));
    const { error } = await db.from("puzzles").upsert(chunk, { onConflict: "id" });
    if (error) { console.error("upsert:", error.message); process.exit(1); }
    done += chunk.length;
    process.stdout.write(`\r  ${done}/${puzzles.length}`);
  }
  const { count } = await db.from("puzzles").select("*", { count: "exact", head: true });
  console.log(`\nDone. puzzles table now holds ${count} rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
