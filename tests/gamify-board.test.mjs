// Self-check for the Gamified Board obstacle logic. Run: npm test
//
// The classroom's gamified board must behave like the reference: reward
// stickers (food/toys/emoji) are capturable by a normal piece, and obstacle
// stickers (rock/wall/fence) block a sliding piece's PATH, not just its
// landing square. squaresBetween is what makes "slide through" blocking work,
// so an off-by-one there silently lets a rook jump a wall.
import { test } from "node:test";
import assert from "node:assert/strict";
import { squaresBetween, applyBlocked } from "../src/lib/gamify-moves.ts";

test("squaresBetween walks rank / file / diagonal, exclusive of endpoints", () => {
  assert.deepEqual(squaresBetween("a1", "a1"), []);
  assert.deepEqual(squaresBetween("a1", "a2"), []);
  assert.deepEqual(squaresBetween("a1", "a4"), ["a2", "a3"]);
  assert.deepEqual(squaresBetween("a1", "d1"), ["b1", "c1"]);
  assert.deepEqual(squaresBetween("a1", "d4"), ["b2", "c3"]);
  assert.deepEqual(squaresBetween("h1", "e4"), ["g2", "f3"]);
});

test("squaresBetween is empty for knight hops / non-aligned pairs", () => {
  assert.deepEqual(squaresBetween("b1", "c3"), []);
  assert.deepEqual(squaresBetween("a1", "c2"), []);
});

test("applyBlocked drops a landing square AND anything sliding through it", () => {
  // Rook on a1 can reach a2..a8 and b1..h1.
  const dests = new Map([["a1", ["a2", "a3", "a4", "a5", "b1", "c1", "d1"]]]);
  const out = applyBlocked(dests, new Set(["a3"]));
  // a3 itself gone, a4/a5 gone (behind the wall), a2 kept, the rank kept.
  assert.deepEqual(out.get("a1"), ["a2", "b1", "c1", "d1"]);
});

test("applyBlocked is a no-op when nothing is blocked", () => {
  const dests = new Map([["a1", ["a2", "a3"]]]);
  assert.equal(applyBlocked(dests, new Set()), dests);
});

test("a diagonal slider is stopped by a wall on its path", () => {
  const dests = new Map([["c1", ["d2", "e3", "f4", "g5"]]]);
  assert.deepEqual(applyBlocked(dests, new Set(["e3"])).get("c1"), ["d2"]);
});
