#!/usr/bin/env node
/* PGN library pipeline proof (spec §8).
 *
 * Drives the same steps the upload button does - parse the file, insert, read
 * it back in a fresh session - and checks the parts that are easy to get
 * silently wrong: multi-game files splitting, persistence surviving a
 * re-login, the stored text still being loadable by chess.js, and invalid
 * files being rejected rather than stored as junk.
 *
 *   node scripts/verify-pgn.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { splitPgnGames, pgnGameTitle } from "../src/lib/pgn.ts";
import { Chess } from "chess.js";

const SUPA = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };

const TWO_GAMES = `[Event "Italian Game - Model"]
[White "Coach"]
[Black "Student"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 1-0

[Event "Ruy Lopez - Model"]
[White "Anand"]
[Black "Carlsen"]
[Result "1/2-1/2"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 1/2-1/2
`;

const GARBAGE = "this is not a pgn file at all, it is just prose about chess.";

/* Mirrors what the upload path now requires of every chunk before it is
 * stored: it has to actually replay. The app calls loadPgnLenient (which also
 * accepts a bare FEN setup); that module imports through the "@/" alias, which
 * plain node can't resolve, so this is the same test expressed with chess.js. */
function replays(text) {
  try {
    const c = new Chess();
    c.loadPgn(text);
    return c.history().length > 0;
  } catch { return false; }
}

async function main() {
  console.log(`\nTarget: ${SUPA}\n`);

  const sb = createClient(SUPA, ANON);
  const { data: auth, error } = await sb.auth.signInWithPassword({
    email: "coach@chessacademy.test", password: "chesspass123",
  });
  if (error) throw new Error(`login: ${error.message}`);
  const me = auth.user.id;

  const { data: prof } = await sb.from("profiles").select("academy_id").eq("id", me).single();
  const academy = prof.academy_id;

  const { data: folder } = await sb.from("pgn_folders")
    .insert({ academy_id: academy, name: `verify-pgn ${Date.now()}` })
    .select("id").single();
  check("coach can create a PGN folder", Boolean(folder?.id));

  console.log("\nParsing (what the file input does before inserting):");
  const games = splitPgnGames(TWO_GAMES);
  check("multi-game file splits into its games", games.length === 2, `→ ${games.length}`);
  const titles = games.map((g, i) => pgnGameTitle(g, "upload", i));
  check("valid games survive validation", games.every(replays));
  check("titles come from the [Event] tags",
    titles[0] === "Italian Game - Model" && titles[1] === "Ruy Lopez - Model", `→ ${titles.join(" | ")}`);

  console.log("\nUpload + persistence:");
  const { data: inserted, error: insErr } = await sb.from("pgns").insert(
    games.map((content, i) => ({
      academy_id: academy, folder_id: folder.id,
      title: titles[i], content, created_by: me,
    })),
  ).select("id, title, content");
  check("insert succeeds", !insErr && inserted?.length === 2, insErr?.message ?? `→ ${inserted?.length}`);

  // Fresh client = fresh session, the "still there after re-login" case.
  const sb2 = createClient(SUPA, ANON);
  await sb2.auth.signInWithPassword({ email: "coach@chessacademy.test", password: "chesspass123" });
  const { data: readBack } = await sb2.from("pgns")
    .select("id, title, content").eq("folder_id", folder.id).order("position").order("created_at");
  check("PGNs survive a fresh login", readBack?.length === 2, `→ ${readBack?.length}`);
  check("content round-trips byte-for-byte",
    readBack?.[0]?.content === games[0] || readBack?.[1]?.content === games[0]);

  console.log("\nStored PGNs are actually usable by the app:");
  let loaded = 0;
  for (const row of readBack ?? []) {
    try {
      const c = new Chess();
      c.loadPgn(row.content);
      if (c.history().length > 0) loaded++;
    } catch { /* counted as a failure below */ }
  }
  check("every stored PGN replays through chess.js", loaded === 2, `→ ${loaded}/2 replayed`);

  console.log("\nInvalid input:");
  // splitPgnGames only looks for [Event] boundaries, so a tagless file comes
  // back as one "game" - validation is what has to reject it.
  const junkChunks = splitPgnGames(GARBAGE);
  const junkGames = junkChunks.filter(replays);
  check("garbage produces no insertable games", junkGames.length === 0,
    `→ split gave ${junkChunks.length}, ${junkGames.length} survived validation`);

  // The UI path: parsePgnFile falls back to the raw text when the splitter
  // finds nothing, so validation has to reject it before the insert.
  const c = new Chess();
  let junkReplays = true;
  try { c.loadPgn(GARBAGE); junkReplays = c.history().length > 0; } catch { junkReplays = false; }
  check("garbage does not replay as a game either", !junkReplays);

  // cleanup
  await sb.from("pgns").delete().eq("folder_id", folder.id);
  await sb.from("pgn_folders").delete().eq("id", folder.id);

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} - ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
