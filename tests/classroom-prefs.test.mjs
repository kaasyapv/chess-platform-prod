// Self-check for the classroom presentation prefs. Run: npm test
//
// These come straight out of localStorage (untrusted, may be stale or hand-
// edited), feed the layout + board-size + sound-on-load knobs, and a bad value
// must never crash the classroom or blow the board up off-screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePrefs, clampScale, DEFAULT_CLASSROOM_PREFS,
  BOARD_SCALE_MIN, BOARD_SCALE_MAX,
} from "../src/components/classroom/use-classroom-prefs.ts";

test("garbage in -> safe defaults out", () => {
  assert.deepEqual(normalizePrefs(null), DEFAULT_CLASSROOM_PREFS);
  assert.deepEqual(normalizePrefs(undefined), DEFAULT_CLASSROOM_PREFS);
  assert.deepEqual(normalizePrefs("nope"), DEFAULT_CLASSROOM_PREFS);
});

test("board scale is clamped to a sane range", () => {
  assert.equal(clampScale(999), BOARD_SCALE_MAX);
  assert.equal(clampScale(0), BOARD_SCALE_MIN);
  assert.equal(clampScale("big"), 1);
  assert.equal(clampScale(NaN), 1);
  assert.equal(clampScale(0.9), 0.9);
});

test("unknown layout falls back to classic", () => {
  assert.equal(normalizePrefs({ layout: "spaceship" }).layout, "classic");
  assert.equal(normalizePrefs({ layout: "focus" }).layout, "focus");
});

test("sound-on-load defaults ON, off only on explicit false", () => {
  assert.equal(normalizePrefs({}).soundOnLoad, true);
  assert.equal(normalizePrefs({ soundOnLoad: false }).soundOnLoad, false);
  assert.equal(normalizePrefs({ soundOnLoad: 0 }).soundOnLoad, true);
});
