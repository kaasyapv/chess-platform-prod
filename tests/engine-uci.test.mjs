// Self-check for UCI info-line parsing. Run: npm test
//
// The engine tab and eval bar read whatever this returns, so a regex slip here
// shows up as a frozen bar or a wrong best move in a live class.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInfoLine, formatScore } from "../src/lib/engine/uci.ts";

test("parses a normal multipv info line", () => {
  const l = parseInfoLine(
    "info depth 18 seldepth 24 multipv 2 score cp -37 nodes 900000 pv d2d4 g8f6 c2c4",
  );
  assert.equal(l.multipv, 2);
  assert.equal(l.depth, 18);
  assert.equal(l.score, -37);
  assert.equal(l.mate, null);
  assert.equal(l.move, "d2d4");
  assert.deepEqual(l.pv, ["d2d4", "g8f6", "c2c4"]);
});

test("maps mate to a sortable score but keeps the distance", () => {
  const l = parseInfoLine("info depth 20 multipv 1 score mate 3 pv e1e8 h7h8 e8h8");
  assert.equal(l.mate, 3);
  assert.equal(l.score, 30000);
  const neg = parseInfoLine("info depth 20 multipv 1 score mate -2 pv a1a2 b3b2");
  assert.equal(neg.mate, -2);
  assert.equal(neg.score, -30000);
});

test("rejects lines that aren't usable multipv info", () => {
  assert.equal(parseInfoLine("bestmove e2e4 ponder e7e5"), null);
  assert.equal(parseInfoLine("info depth 1 seldepth 1 multipv 1 score cp 0 nodes 20"), null, "no pv");
  assert.equal(parseInfoLine("id name Stockfish 17.1"), null);
});

test("formatScore renders bar-friendly labels", () => {
  assert.equal(formatScore({ score: 124, mate: null }), "+1.24");
  assert.equal(formatScore({ score: -30, mate: null }), "-0.30");
  assert.equal(formatScore({ score: 30000, mate: 3 }), "M3");
  assert.equal(formatScore(undefined), "…");
});
