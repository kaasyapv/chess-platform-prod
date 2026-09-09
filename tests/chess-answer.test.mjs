// Self-check for the shared "does this move solve it" predicate. Run: npm test
// Used by both the classroom quiz scorer and the curriculum puzzle player, so
// a slip here mis-scores a live class AND a self-paced drill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerMatches, simulResult } from "../src/lib/chess-answer.ts";

const MATE_IN_1 = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"; // Ra8#

test("exact SAN matches", () => {
  assert.equal(answerMatches(MATE_IN_1, "Ra8#", "Ra8#"), true);
});

test("notation is forgiving - check/mate/capture glyphs and coordinate form", () => {
  assert.equal(answerMatches(MATE_IN_1, "Ra8", "Ra8#"), true);
  assert.equal(answerMatches(MATE_IN_1, "a1a8", "Ra8#"), true);
});

test("a different legal move is wrong", () => {
  assert.equal(answerMatches(MATE_IN_1, "Kf1", "Ra8#"), false);
});

test("an illegal / unparseable move is wrong, not a throw", () => {
  assert.equal(answerMatches(MATE_IN_1, "Qz9", "Ra8#"), false);
});

test("only the first move of a multi-move answer line is checked", () => {
  assert.equal(answerMatches(MATE_IN_1, "Ra8#", "Ra8# Kf7 whatever"), true);
});

// The classroom promotion picker feeds a `promotion` piece into chess.js; the
// scorer has to tell an underpromotion apart from an automatic queening.
const PROMO = "4k3/P7/8/8/8/8/8/4K3 w - - 0 1";
test("underpromotion is distinguished from queening, glyphs still forgiving", () => {
  assert.equal(answerMatches(PROMO, "a8=N", "a8=N"), true);
  assert.equal(answerMatches(PROMO, "a8N", "a8=N+"), true);
  assert.equal(answerMatches(PROMO, "a8=Q", "a8=N"), false);
});

test("empty answer means manual review (null)", () => {
  assert.equal(answerMatches(MATE_IN_1, "Ra8#", ""), null);
  assert.equal(answerMatches(MATE_IN_1, "Ra8#", "   "), null);
});

// Simul grid adjudication — a wrong winner here shows the coach a lost game as won.
test("simulResult: checkmate credits the side that delivered it", () => {
  // after 1.f3 e5 2.g4 Qh4# — white to move and mated → black won
  assert.equal(simulResult("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"), "0-1");
  // Fool's-mate mirror: black to move and mated → white won
  assert.equal(simulResult("rnbqkbnr/ppp2Qpp/3p4/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 3"), "1-0");
});
test("simulResult: draws and live games", () => {
  assert.equal(simulResult("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"), "1/2-1/2");       // stalemate
  assert.equal(simulResult("8/8/8/4k3/8/4K3/8/8 w - - 0 1"), "1/2-1/2");         // K vs K
  assert.equal(simulResult("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), null); // live
  assert.equal(simulResult("not a fen"), null);
});
