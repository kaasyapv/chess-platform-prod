// Self-check for the per-day audit log. Run: npm test
//
// The CEO uses this to verify someone genuinely worked, so two things have to
// hold: no real action may be swallowed by the heartbeat folding, and the
// totals must survive the fold intact. Both are easy to break by "tidying" the
// timeline later.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, dayStats, localDay } from "../src/lib/activity-timeline.ts";

const at = (hhmm, s = 0) => `2026-08-14T${hhmm}:${String(s).padStart(2, "0")}.000Z`;

/** A minute of heartbeat. */
const beat = (id, hhmm) => ({ id, kind: "active", seconds: 60, created_at: at(hhmm) });

test("consecutive heartbeats fold into one span carrying the full time", () => {
  const events = [beat(1, "09:00"), beat(2, "09:01"), beat(3, "09:02")];
  const timeline = buildTimeline(events);
  assert.equal(timeline.length, 1, "three beats should read as one span");
  assert.equal(timeline[0].seconds, 180, "folding lost time");
  assert.equal(timeline[0].count, 3);
  assert.ok(timeline[0].until, "a folded span needs an end time");
});

test("a real action is never swallowed by the beats around it", () => {
  // This is the whole point of the fold: the class start must stay visible.
  const events = [
    beat(1, "09:00"), beat(2, "09:01"),
    { id: 3, kind: "class_start", seconds: null, detail: "Endgames B", created_at: at("09:02") },
    beat(4, "09:03"), beat(5, "09:04"),
  ];
  const timeline = buildTimeline(events);
  assert.equal(timeline.length, 3, "expected span, action, span");
  assert.equal(timeline[1].kind, "class_start");
  assert.equal(timeline[1].detail, "Endgames B");
  // The beats either side stay separate rather than merging across the action.
  assert.equal(timeline[0].seconds, 120);
  assert.equal(timeline[2].seconds, 120);
});

test("idle stretches are never folded away", () => {
  // Two idle rows mean the person went quiet twice; collapsing them would hide
  // one of those, which is exactly the thing being audited.
  const events = [
    { id: 1, kind: "idle", seconds: 600, created_at: at("11:00") },
    { id: 2, kind: "idle", seconds: 300, created_at: at("14:00") },
  ];
  assert.equal(buildTimeline(events).length, 2);
});

test("out-of-order rows come back chronological", () => {
  // The report fetches newest-first, so the timeline must re-sort or it reads
  // backwards.
  const events = [beat(3, "09:05"), beat(1, "09:00"), beat(2, "09:02")];
  const times = buildTimeline(events).flatMap((t) => [t.at]);
  assert.deepEqual(times, [...times].sort());
});

test("day stats report the real bookends and separate active from idle", () => {
  const events = [
    { id: 1, kind: "login", seconds: null, created_at: at("09:00") },
    beat(2, "09:01"),
    beat(3, "09:02"),
    { id: 4, kind: "idle", seconds: 900, created_at: at("09:30") },
    { id: 5, kind: "whiteboard", seconds: null, created_at: at("10:15") },
  ];
  const s = dayStats(events);
  assert.equal(s.firstAt, at("09:00"));
  assert.equal(s.lastAt, at("10:15"));
  assert.equal(s.activeSeconds, 120);
  assert.equal(s.idleSeconds, 900, "idle must not count as active");
  // login + whiteboard are deliberate actions; beats and idle are not.
  assert.equal(s.actions, 2);
  assert.equal(s.loginAt, at("09:00"), "the sign-in moment, not merely the first row");
});

test("time inside a live class comes from the leave event, not the join", () => {
  // Joining records the arrival with no span; only leaving knows how long the
  // person actually sat in the room. Summing joins would total zero.
  const events = [
    { id: 1, kind: "login", seconds: null, created_at: at("09:00") },
    { id: 2, kind: "class_join", seconds: null, created_at: at("10:00") },
    { id: 3, kind: "class_leave", seconds: 3600, created_at: at("11:00") },
    { id: 4, kind: "class_join", seconds: null, created_at: at("14:00") },
    { id: 5, kind: "class_leave", seconds: 1800, created_at: at("14:30") },
  ];
  const s = dayStats(events);
  assert.equal(s.classSeconds, 5400, "two rooms, 60m + 30m");
  assert.equal(s.activeSeconds, 0, "class time is not heartbeat time");
  assert.equal(s.actions, 5);
  // The timeline must keep every arrival and departure as its own line, so a
  // CEO reading the day sees when each room was entered and when it was left.
  const kinds = buildTimeline(events).map((t) => t.kind);
  assert.deepEqual(kinds, ["login", "class_join", "class_leave", "class_join", "class_leave"]);
});

test("an empty day is zeroed, not NaN or null-crashing", () => {
  const s = dayStats([]);
  assert.deepEqual(s, {
    firstAt: null, lastAt: null, loginAt: null,
    activeSeconds: 0, idleSeconds: 0, classSeconds: 0, actions: 0,
  });
  assert.deepEqual(buildTimeline([]), []);
});

test("days are bucketed by local date, not UTC", () => {
  // A late-evening session in IST (UTC+5:30) must not be filed under tomorrow,
  // or a coach's evening work disappears from the day they did it.
  const evening = new Date(2026, 7, 14, 21, 30).toISOString();
  assert.equal(localDay(evening), "2026-08-14");
});
