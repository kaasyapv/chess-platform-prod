// Self-checks for the shared PGN helpers. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  START_FEN, looksLikeFen, normalizeGameText, pgnGameTitle, pgnHeaders,
  pgnInitialFen, pgnTag, sanitizePgn, splitPgnGames,
} from "../src/lib/pgn.ts";

const PUZZLE = `[Event "1. Movement of Pieces - 1 - 2"]
[Site "?"]
[White "?"]
[Black "?"]
[FEN "8/4p3/8/8/pP2R1p1/8/4P3/8 b - - 0 4"]
[SetUp "1"]

4... a3 5. Rxe7 *`;

test("pgnTag - a bare ? means unset, not a value", () => {
  assert.equal(pgnTag(PUZZLE, "White"), undefined);
  assert.equal(pgnTag(PUZZLE, "Event"), "1. Movement of Pieces - 1 - 2");
  assert.equal(pgnTag(PUZZLE, "Missing"), undefined);
});

test("pgnInitialFen - the game's own starting diagram, not a replayed position", () => {
  // Reference behaviour: the mini-board shows where the puzzle BEGINS.
  assert.equal(pgnInitialFen(PUZZLE), "8/4p3/8/8/pP2R1p1/8/4P3/8 b - - 0 4");
  assert.equal(pgnInitialFen(`[Event "x"]\n\n1. e4 e5 *`), START_FEN);
  assert.equal(pgnInitialFen(`[FEN "garbage"]\n\n*`), START_FEN);
});

test("pgnGameTitle - never builds '? vs ?' out of unset tags", () => {
  assert.equal(pgnGameTitle(PUZZLE, "grp", 1), "1. Movement of Pieces - 1 - 2");
  const noEvent = `[White "?"]\n[Black "?"]\n\n*`;
  assert.equal(pgnGameTitle(noEvent, "Tactices part 1", 0), "Tactices part 1 - 1");
  const named = `[White "Fischer"]\n[Black "Spassky"]\n\n*`;
  assert.equal(pgnGameTitle(named, "grp", 0), "Fischer vs Spassky");
});

test("splitPgnGames - [EventDate] never starts a new game", () => {
  const two = `[Event "A"]\n[EventDate "2021.??.??"]\n\n*\n\n[Event "B"]\n\n*`;
  assert.equal(splitPgnGames(two).length, 2);
});

test("looksLikeFen - spots bare positions, never real PGNs", () => {
  assert.equal(looksLikeFen("1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1"), true);
  assert.equal(looksLikeFen(START_FEN), true);
  assert.equal(looksLikeFen(PUZZLE), false);
  assert.equal(looksLikeFen("1. e4 e5 2. Nf3 *"), false);
});

test("normalizeGameText - bare FEN, multi-game and CRLF all load as ONE game", () => {
  // A saved "position" (bare FEN) becomes a parseable single-game PGN.
  const fen = "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1";
  const wrapped = normalizeGameText(fen);
  assert.ok(wrapped.includes(`[FEN "${fen}"]`));
  assert.ok(wrapped.includes('[SetUp "1"]'));
  // Multi-game rows load their first game instead of throwing.
  const two = `[Event "A"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. d4 d5 *`;
  assert.ok(normalizeGameText(two).startsWith('[Event "A"]'));
  assert.ok(!normalizeGameText(two).includes('[Event "B"]'));
  // Windows line endings never reach the parser.
  assert.ok(!normalizeGameText("[Event \"x\"]\r\n\r\n1. e4 e5 *").includes("\r"));
  // A normal single game passes through untouched.
  assert.equal(normalizeGameText(PUZZLE), PUZZLE);
});

test("sanitizePgn - repairs the quirks found across the 10k-game reference library", () => {
  // adjacent brace comments (Lichess studies)
  assert.ok(!sanitizePgn(`[Event "x"]\n\n{ a } { [%csl Ga5] } 1. e4 *`).includes("} {"));
  // comment-first variations and comments after a closing paren (ChessBase)
  assert.ok(!/\(\s*\{/.test(sanitizePgn(`[Event "x"]\n\n1. e4 ( {better} 1. d4 ) e5 *`)));
  assert.ok(!/\)\s*\{/.test(sanitizePgn(`[Event "x"]\n\n1. e4 (1. d4) {with} 1... e5 *`)));
  // null moves truncate the game but keep everything before them, balanced
  const cut = sanitizePgn(`[Event "x"]\n\n1. e4 e5 2. Nf3 ( 2. f4 -- 3. Nc3 ) 2... Nc6 *`);
  assert.ok(cut.includes("2. Nf3") && !cut.includes("--"));
  assert.equal((cut.match(/\(/g) ?? []).length, (cut.match(/\)/g) ?? []).length);
  // fullmove 0 in the FEN header becomes 1
  assert.ok(sanitizePgn(`[FEN "8/8/8/8/8/8/8/K1k5 w - - 0 0"]\n\n*`).includes('- 0 1"'));
  // unescaped quotes inside a header value
  assert.ok(sanitizePgn(`[Event "#155 "Immortal Game""]\n\n1. e4 *`).includes("’Immortal Game’"));
  // dangling move number before the result
  assert.ok(!/1\.\s*\*/.test(sanitizePgn(`[Event "x"]\n\n{intro}\n1. *`)));
});

test("pgnHeaders - blanks out the placeholder tags the table would show", () => {
  const h = pgnHeaders(PUZZLE);
  assert.equal(h.white, undefined);
  assert.equal(h.result, undefined); // "*" is not a result
  assert.equal(h.eco, undefined);

  const real = `[Date "1972.07.11"]\n[White "Spassky"]\n[Black "Fischer"]\n[WhiteElo "2660"]\n[Result "0-1"]\n[ECO "D59"]\n\n*`;
  const g = pgnHeaders(real);
  assert.equal(g.white, "Spassky");
  assert.equal(g.eloW, "2660");
  assert.equal(g.result, "0-1");
  assert.equal(g.eco, "D59");
});
