// Self-checks for the PGN library ingest. Run: npm test
// Guards the shape the Clone_reference report documents: 336 game-groups,
// 10,548 games, exact folder names, curriculum root order.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  MANAGED_ROOTS, gameTitle, planRows, readLibrary, splitGames,
} from "../scripts/ingest-pgns.mjs";

const LIB = path.join(import.meta.dirname, "..", "Clone_reference", "PGN_Library");

test("splitGames - [EventDate] does not start a new game", () => {
  const pgn = `[Event "A"]\n[EventDate "2021.??.??"]\n\n1. e4 *\n\n[Event "B"]\n[EventDate "2020.??.??"]\n\n1. d4 *`;
  const games = splitGames(pgn);
  assert.equal(games.length, 2);
  assert.match(games[0], /\[Event "A"\]/);
  assert.match(games[1], /\[Event "B"\]/);
});

test("splitGames - CRLF files split the same as LF", () => {
  const lf = `[Event "A"]\n\n*\n\n[Event "B"]\n\n*`;
  assert.equal(splitGames(lf.replace(/\n/g, "\r\n")).length, splitGames(lf).length);
});

test("gameTitle - uses the Event tag, falls back when it is a bare ?", () => {
  assert.equal(gameTitle(`[Event "1. Movement of Pieces - 1 - 7"]`, "grp", 6), "1. Movement of Pieces - 1 - 7");
  assert.equal(gameTitle(`[Event "?"]`, "Tactices part 1", 0), "Tactices part 1 - 1");
  assert.equal(gameTitle(`[White "x"]`, "grp", 2), "grp - 3");
});

// The rest read the real reference library; skip if it was not checked out.
const hasLib = (await import("node:fs")).existsSync(LIB);

test("library totals match the reference report", { skip: !hasLib }, () => {
  const { folders, games } = planRows(readLibrary(LIB));
  const groups = new Set(games.map((g) => g.folderPath));
  assert.equal(groups.size, 336, "game-groups");
  assert.equal(games.length, 10548, "total games");

  const perRoot = (r) => games.filter((g) => g.folderPath.startsWith(`/${r}/`)).length;
  assert.equal(perRoot("Beginner"), 1283);
  assert.equal(perRoot("Intermediate"), 1145);
  assert.equal(perRoot("Advance"), 1254);
  assert.equal(perRoot("Master"), 1121);
  assert.equal(perRoot("Beginner Homework"), 268);
  assert.equal(perRoot("Intermediate Homework"), 829);
  assert.equal(perRoot("Advance Homework"), 357);
  assert.equal(perRoot("Master Homework"), 4000);
  assert.equal(perRoot("tactics"), 291);
  assert.equal(perRoot("chess planning"), 0, "ships empty");

  // Every folder's parent is emitted before it, or the insert loop breaks.
  const seen = new Set();
  for (const f of folders) {
    if (f.parentPath) assert.ok(seen.has(f.parentPath), `orphan: ${f.path}`);
    seen.add(f.path);
  }
});

test("roots are in curriculum order, and Public is never ingested", { skip: !hasLib }, () => {
  const { folders } = planRows(readLibrary(LIB), "", () => []);
  const roots = folders.filter((f) => !f.parentPath).map((f) => f.name);
  assert.deepEqual(roots, MANAGED_ROOTS);
  assert.ok(!folders.some((f) => f.name === "Public"));
});

test("a '/' in a group name is rejoined, not left as a folder", { skip: !hasLib }, () => {
  const { folders } = planRows(readLibrary(LIB), "", () => []);
  const paths = folders.map((f) => f.path);

  // "25. Italian Game /Colle System (White)" downloads as a directory holding
  // one .pgn; it must come back as a single group so IM-4 keeps its 8 entries.
  assert.ok(paths.includes("/Intermediate/IM-4/25. Italian Game /Colle System (White)"));
  assert.ok(paths.includes("/Master/MM-4/25. English Opening (White /Black)"));
  assert.equal(paths.filter((p) => p.startsWith("/Intermediate/IM-4/")).length, 8);
  assert.equal(folders.filter((f) => f.name.endsWith(" ")).length, 0, "no trailing-space folders");
});

test("game titles come straight from the Event tags", { skip: !hasLib }, () => {
  const { games } = planRows(readLibrary(LIB));
  const mov1 = games.filter((g) => g.folderPath === "/Beginner/BM-1/1. Movement of Pieces - 1");
  assert.equal(mov1.length, 54, "report: 54 individual games");
  assert.equal(mov1[0].title, "1. Movement of Pieces - 1 - 1");
  assert.equal(mov1[53].title, "1. Movement of Pieces - 1 - 54");
  // Report figure 7: game 2 records the move pair a3 / Rxe7.
  assert.match(mov1[1].content, /a3/);
  assert.match(mov1[1].content, /Rxe7/);
});
