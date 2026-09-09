// Self-check for the board's pure logic. Run: npm test
// (node --test with native TypeScript type-stripping, Node ≥ 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatClock, levelToElo, soundForMove, isRenderableFen } from "../src/lib/chess-pure.ts";

test("formatClock - WorldChess M:SS with tenths under 10s", () => {
  assert.equal(formatClock(600_000), "10:00");
  assert.equal(formatClock(65_000), "1:05");
  assert.equal(formatClock(10_000), "0:10");
  assert.equal(formatClock(9_900), "0:09.9");
  assert.equal(formatClock(1_050), "0:01.0");
  assert.equal(formatClock(0), "0:00.0");
  assert.equal(formatClock(-500), "0:00.0");
});

test("levelToElo - level 1 = 500 ELO (research), 12 = 2700", () => {
  assert.equal(levelToElo(1), 500);
  assert.equal(levelToElo(12), 2700);
});

test("soundForMove - cue priority: check > promote > castle > capture > move", () => {
  assert.equal(soundForMove({ san: "e4" }, false), "move");
  assert.equal(soundForMove({ san: "exd5", captured: "p" }, false), "capture");
  assert.equal(soundForMove({ san: "O-O" }, false), "castle");
  assert.equal(soundForMove({ san: "O-O-O" }, false), "castle");
  assert.equal(soundForMove({ san: "e8=Q", promotion: "q" }, false), "promote");
  assert.equal(soundForMove({ san: "Qh5+" }, true), "check");
  assert.equal(soundForMove({ san: "exd8=Q+", captured: "r", promotion: "q" }, true), "check");
});

test("isRenderableFen - board-shaped is enough; legality is chess.js's job", () => {
  // Gamified setups: no kings, still renderable.
  assert.equal(isRenderableFen("8/8/8/8/8/2P5/8/8 w - - 0 1"), true);
  assert.equal(isRenderableFen("8/8/8/8/8/8/8/8 w - - 0 1"), true);
  assert.equal(isRenderableFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), true);
  // Not board-shaped: wrong rank count, overfull rank, junk letters.
  assert.equal(isRenderableFen("8/8/8/8/8/8/8 w - - 0 1"), false);
  assert.equal(isRenderableFen("9/8/8/8/8/8/8/8 w - - 0 1"), false);
  assert.equal(isRenderableFen("8/8/8/8/8/2X5/8/8 w - - 0 1"), false);
  assert.equal(isRenderableFen("ppppppppp/8/8/8/8/8/8/8 w - - 0 1"), false);
  assert.equal(isRenderableFen(""), false);
});
