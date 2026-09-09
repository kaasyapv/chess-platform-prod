// Self-check for the Call Manager priority queue ordering. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { sortHelpQueue } from "../src/lib/help-queue.ts";

test("sortHelpQueue - coach requests outrank student requests", () => {
  const items = [
    { id: "s1", requestedRole: "student", createdAt: "2026-01-01T00:00:00Z" },
    { id: "c1", requestedRole: "coach", createdAt: "2026-01-01T00:00:05Z" },
  ];
  const sorted = sortHelpQueue(items);
  assert.deepEqual(sorted.map((i) => i.id), ["c1", "s1"]);
});

test("sortHelpQueue - same role breaks ties oldest-first", () => {
  const items = [
    { id: "late", requestedRole: "coach", createdAt: "2026-01-01T00:00:10Z" },
    { id: "early", requestedRole: "coach", createdAt: "2026-01-01T00:00:01Z" },
  ];
  const sorted = sortHelpQueue(items);
  assert.deepEqual(sorted.map((i) => i.id), ["early", "late"]);
});

test("sortHelpQueue - 15 simultaneous requests never lose an item, and coaches lead", () => {
  const items = Array.from({ length: 15 }, (_, i) => ({
    id: `r${i}`,
    requestedRole: i % 4 === 0 ? "coach" : "student",
    createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
  }));
  const sorted = sortHelpQueue(items);
  assert.equal(sorted.length, 15);
  const firstStudentIdx = sorted.findIndex((i) => i.requestedRole === "student");
  const lastCoachIdx = sorted.map((i) => i.requestedRole).lastIndexOf("coach");
  assert.ok(lastCoachIdx < firstStudentIdx, "every coach request must sort before every student request");
});
