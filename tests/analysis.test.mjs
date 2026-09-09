// Self-check for the analysis board's pure logic. Run: npm test
// (node --test with native TypeScript type-stripping, Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyMove, gameAccuracy, toWhiteRelative, evalBarFraction, BOOK_PLIES,
} from "../src/lib/analysis/classify.ts";

const at = (ply, centipawnLoss, wasTop = false, extra = {}) =>
  ({ ply, centipawnLoss, wasTop, ...extra });

test("classifyMove - the six tiers, past the opening book", () => {
  const late = 20; // well past BOOK_PLIES
  assert.equal(classifyMove(at(late, 0, true)), "best");
  assert.equal(classifyMove(at(late, 8)), "best");        // as good as best
  assert.equal(classifyMove(at(late, 40)), "good");
  assert.equal(classifyMove(at(late, 120)), "mistake");
  assert.equal(classifyMove(at(late, 300)), "blunder");
});

test("classifyMove - Book only applies early AND only to sane moves", () => {
  assert.equal(classifyMove(at(2, 20)), "book");
  // A blunder in the opening is a blunder, not "book".
  assert.equal(classifyMove(at(2, 400)), "blunder");
  // Past the book window the same quiet move is judged on merit: a 20cp loss
  // that was NOT the engine's pick is a good move, not the best one.
  assert.equal(classifyMove(at(BOOK_PLIES, 20)), "good");
});

test("classifyMove - Brilliant needs a real sacrifice the engine still endorses", () => {
  const sac = { materialSacrificed: 3, evalAfter: 50 };
  assert.equal(classifyMove(at(20, 0, true, sac)), "brilliant");

  // Same sacrifice, but the engine does NOT agree it was best -> not brilliant.
  assert.equal(classifyMove(at(20, 200, false, sac)), "blunder");

  // Top move, but nothing was actually given up -> just the best move.
  assert.equal(classifyMove(at(20, 0, true, { materialSacrificed: 0, evalAfter: 50 })), "best");

  // A sacrifice that tanks the eval is not brilliant however you dress it up.
  assert.equal(
    classifyMove(at(20, 0, true, { materialSacrificed: 3, evalAfter: -400 })),
    "best",
  );
});

test("gameAccuracy - flawless is ~100, blunder-ridden is low", () => {
  assert.equal(gameAccuracy([]), 100);
  assert.equal(gameAccuracy([0, 0, 0]), 100);
  const sloppy = gameAccuracy([200, 200, 200]);
  assert.ok(sloppy < 15, `expected a blunder-filled game to score low, got ${sloppy}`);
  // Accuracy must fall as average loss rises.
  assert.ok(gameAccuracy([10]) > gameAccuracy([100]));
  assert.ok(gameAccuracy([100]) > gameAccuracy([500]));
});

test("toWhiteRelative - engine scores are side-to-move relative", () => {
  assert.equal(toWhiteRelative(120, "w"), 120);   // White to move, White better
  assert.equal(toWhiteRelative(120, "b"), -120);  // Black to move, Black better
});

test("evalBarFraction - centred at equality, saturates, and respects mate", () => {
  assert.equal(evalBarFraction(0, null, "w"), 0.5);
  assert.ok(evalBarFraction(500, null, "w") > 0.75);   // White clearly better
  assert.ok(evalBarFraction(-500, null, "w") < 0.25);  // Black clearly better
  assert.ok(evalBarFraction(10_000, null, "w") < 1);   // never fully pegs on cp alone

  // Mate is absolute: a mate score fills the bar for the mating side.
  assert.equal(evalBarFraction(0, 3, "w"), 1);   // White to move, White mates
  assert.equal(evalBarFraction(0, 3, "b"), 0);   // Black to move, Black mates
  assert.equal(evalBarFraction(0, -2, "w"), 0);  // White to move, White gets mated
});
