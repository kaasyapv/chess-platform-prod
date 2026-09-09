// Self-check for the classroom state-durability logic. Run: npm test
//
// The durable `live_state` snapshot is only worth adding if it (a) never
// carries anything the broadcast wouldn't - no answers leaking into the row,
// (b) never clobbers a live coach broadcast, and (c) never hydrates a fresh
// class from a stale leftover row. Those three, plus the reconnect backoff
// shape, are what these tests pin down.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  serializeSnapshot,
  snapshotKey,
  snapshotIsFresh,
  shouldApplyDurableSnapshot,
  reconnectDelayMs,
  shouldReconnect,
  RECONNECT_BACKOFF_MS,
  MAX_RECONNECT_ATTEMPTS,
  SNAPSHOT_MAX_AGE_MS,
} from "../src/lib/classroom-sync.ts";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("serializeSnapshot keeps only whitelisted keys - a stray solution never persists", () => {
  const snap = serializeSnapshot({
    fen: START,
    startFen: START,
    history: ["e4"],
    locked: true,
    // things a careless caller might spread in that must NOT survive:
    answer: "Qxf7#",
    solution: ["Qh5", "Qxf7"],
    loadedGame: { sans: ["e4", "e5", "Qh5"] },
    secretComment: "mate in 2",
  });
  assert.deepEqual(Object.keys(snap).sort(), ["fen", "history", "locked", "startFen"]);
  assert.equal(snap.answer, undefined);
  assert.equal(snap.solution, undefined);
  assert.equal(snap.loadedGame, undefined);
});

test("serializeSnapshot enforces hideMoves - the student snapshot has no notation", () => {
  const hidden = serializeSnapshot({ fen: START, history: ["e4", "e5", "Nf3"], hideMoves: true });
  assert.equal(hidden.hideMoves, true);
  assert.deepEqual(hidden.history, []); // enforced, not just a UI flag
  const shown = serializeSnapshot({ fen: START, history: ["e4", "e5", "Nf3"] });
  assert.equal("hideMoves" in shown, false);
  assert.deepEqual(shown.history, ["e4", "e5", "Nf3"]);
});

test("serializeSnapshot carries the active quiz but never its solution", () => {
  const snap = serializeSnapshot({
    fen: START,
    quiz: {
      id: "c-1", fen: START, seconds: 600, points: 10, negative: 1,
      endsAt: 1788491651147, active: true,
      answer: "e4", solution: ["e4"], // a QuizEvent-ish object with extras
    },
  });
  assert.deepEqual(Object.keys(snap.quiz).sort(),
    ["endsAt", "fen", "id", "negative", "points", "seconds"]);
  assert.equal(snap.quiz.answer, undefined);
  assert.equal(snap.quiz.solution, undefined);
  assert.equal(snap.quiz.active, undefined);
  // no quiz -> key absent
  assert.equal("quiz" in serializeSnapshot({ fen: START }), false);
  // malformed quiz (no fen / endsAt) -> dropped
  assert.equal("quiz" in serializeSnapshot({ fen: START, quiz: { id: "x" } }), false);

  // hint + attempts DO carry (safe - not the solution); answer/solution still don't
  const withExtras = serializeSnapshot({
    fen: START,
    quiz: {
      id: "c-2", fen: START, seconds: 300, points: 10, negative: 1,
      endsAt: 1788491651147, hint: "Look for a fork", attempts: 2,
      answer: "e4", solution: ["e4"],
    },
  });
  assert.equal(withExtras.quiz.hint, "Look for a fork");
  assert.equal(withExtras.quiz.attempts, 2);
  assert.equal(withExtras.quiz.answer, undefined);
  assert.equal(withExtras.quiz.solution, undefined);
  // empty hint / unlimited attempts -> keys stay absent
  const bare = serializeSnapshot({
    fen: START,
    quiz: { id: "c-3", fen: START, seconds: 300, points: 10, negative: 1, endsAt: 1, hint: "", attempts: 0 },
  });
  assert.equal("hint" in bare.quiz, false);
  assert.equal("attempts" in bare.quiz, false);
});

test("serializeSnapshot drops undefined and deep-copies nested objects", () => {
  const sides = { white: "u1" };
  const icons = { e4: "candy" };
  const snap = serializeSnapshot({ fen: START, sides, icons, gamify: undefined, coords: false });
  assert.equal("gamify" in snap, false);
  assert.equal(snap.coords, false);
  // deep copy: mutating the source must not touch the snapshot
  sides.white = "hacked";
  icons.e4 = "hacked";
  assert.equal(snap.sides.white, "u1");
  assert.equal(snap.icons.e4, "candy");
});

test("serializeSnapshot keeps annotations only when non-empty", () => {
  assert.equal(
    "annotations" in serializeSnapshot({ fen: START, annotations: { arrows: [], highlights: [] } }),
    false,
  );
  const withArrow = serializeSnapshot({
    fen: START,
    annotations: { arrows: [{ from: "e2", to: "e4", color: "green" }], highlights: [] },
  });
  assert.equal(withArrow.annotations.arrows.length, 1);
});

test("snapshotKey is deterministic for equal states, differs for changed ones", () => {
  const a = serializeSnapshot({ fen: START, locked: true, history: ["e4"] });
  const b = serializeSnapshot({ history: ["e4"], fen: START, locked: true }); // different input order
  assert.equal(snapshotKey(a), snapshotKey(b));
  const c = serializeSnapshot({ fen: START, locked: false, history: ["e4"] });
  assert.notEqual(snapshotKey(a), snapshotKey(c));
});

test("snapshotIsFresh - within the session window is fresh, older is not", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  assert.equal(snapshotIsFresh("2026-01-01T11:59:00Z", now), true); // 1 min ago
  assert.equal(snapshotIsFresh("2026-01-01T06:00:00Z", now), true); // exactly 6h ago - still on the boundary
  assert.equal(snapshotIsFresh("2026-01-01T05:59:59Z", now), false); // 6h + 1s ago - past the ceiling
  assert.equal(snapshotIsFresh(new Date(now - SNAPSHOT_MAX_AGE_MS + 1000).toISOString(), now), true);
  assert.equal(snapshotIsFresh(null, now), false);
  assert.equal(snapshotIsFresh("not-a-date", now), false);
});

test("snapshotIsFresh tolerates small clock skew (writer slightly ahead)", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  assert.equal(snapshotIsFresh("2026-01-01T12:00:30Z", now), true); // 30s in the "future"
});

test("shouldApplyDurableSnapshot - a live broadcast always beats the row", () => {
  assert.equal(
    shouldApplyDurableSnapshot({
      atIso: new Date().toISOString(),
      haveLiveBroadcast: true,
      lastAppliedAtIso: null,
    }),
    false,
  );
});

test("shouldApplyDurableSnapshot - fresh row, nothing applied yet -> apply", () => {
  assert.equal(
    shouldApplyDurableSnapshot({
      atIso: new Date().toISOString(),
      haveLiveBroadcast: false,
      lastAppliedAtIso: null,
    }),
    true,
  );
});

test("shouldApplyDurableSnapshot - monotonic: an older re-read is ignored", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  assert.equal(
    shouldApplyDurableSnapshot({
      atIso: "2026-01-01T11:58:00Z",
      haveLiveBroadcast: false,
      lastAppliedAtIso: "2026-01-01T11:59:00Z",
      now,
    }),
    false,
  );
  assert.equal(
    shouldApplyDurableSnapshot({
      atIso: "2026-01-01T11:59:30Z",
      haveLiveBroadcast: false,
      lastAppliedAtIso: "2026-01-01T11:59:00Z",
      now,
    }),
    true,
  );
});

test("shouldApplyDurableSnapshot - a stale fresh-class guard: 8h-old row is refused", () => {
  const now = Date.parse("2026-01-02T12:00:00Z");
  assert.equal(
    shouldApplyDurableSnapshot({
      atIso: "2026-01-02T04:00:00Z",
      haveLiveBroadcast: false,
      lastAppliedAtIso: null,
      now,
    }),
    false,
  );
});

test("reconnectDelayMs - ramps through the ladder then holds, always within +/-15%", () => {
  for (let i = 0; i < RECONNECT_BACKOFF_MS.length + 3; i++) {
    const base = RECONNECT_BACKOFF_MS[Math.min(i, RECONNECT_BACKOFF_MS.length - 1)];
    const lo = base * 0.85;
    const hi = base * 1.15;
    for (const jitter of [0, 0.5, 1]) {
      const d = reconnectDelayMs(i, jitter);
      assert.ok(d >= Math.floor(lo) && d <= Math.ceil(hi), `attempt ${i} jitter ${jitter}: ${d} not in [${lo},${hi}]`);
    }
  }
  // fixed jitter -> deterministic
  assert.equal(reconnectDelayMs(0, 0.5), 1000);
  assert.equal(reconnectDelayMs(99, 0.5), 30000);
  // negative / fractional attempt is clamped, not crashed
  assert.equal(reconnectDelayMs(-3, 0.5), 1000);
});

test("shouldReconnect stops after MAX_RECONNECT_ATTEMPTS", () => {
  assert.equal(shouldReconnect(0), true);
  assert.equal(shouldReconnect(MAX_RECONNECT_ATTEMPTS - 1), true);
  assert.equal(shouldReconnect(MAX_RECONNECT_ATTEMPTS), false);
  assert.equal(shouldReconnect(MAX_RECONNECT_ATTEMPTS + 50), false);
});
