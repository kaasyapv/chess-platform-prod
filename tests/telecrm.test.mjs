// Self-check for TeleCRM's DB-adjacent logic - lead distribution weighting,
// drip step timing, follow-up-call detection. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { needsFollowUpCall, nextDripSendAt, pickDistributionAgent } from "../src/lib/telecrm.ts";

test("pickDistributionAgent - ignores inactive and zero-weight rules", () => {
  const rules = [
    { agent_id: "a", weight_percent: 50, active: false },
    { agent_id: "b", weight_percent: 0, active: true },
    { agent_id: "c", weight_percent: 10, active: true },
  ];
  assert.equal(pickDistributionAgent(rules, () => 0.5), "c");
});

test("pickDistributionAgent - weighted split matches the roll, simulating many inserts", () => {
  const rules = [
    { agent_id: "a", weight_percent: 25, active: true },
    { agent_id: "b", weight_percent: 75, active: true },
  ];
  // 0 -> first bucket boundary, so first rule wins; near-1 exhausts it into the second.
  assert.equal(pickDistributionAgent(rules, () => 0), "a");
  assert.equal(pickDistributionAgent(rules, () => 0.99), "b");

  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 1000; i++) {
    const roll = (i * 7919) % 1000 / 1000; // deterministic pseudo-spread, no RNG flake
    counts[pickDistributionAgent(rules, () => roll)]++;
  }
  assert.ok(counts.a > 200 && counts.a < 300, `expected ~25% to a, got ${counts.a}`);
});

test("pickDistributionAgent - no active rules means no auto-assignment", () => {
  assert.equal(pickDistributionAgent([]), null);
  assert.equal(pickDistributionAgent([{ agent_id: "a", weight_percent: 10, active: false }]), null);
});

test("nextDripSendAt - adds the step's delay in hours", () => {
  const from = new Date("2026-01-01T00:00:00Z");
  const at = nextDripSendAt(from, { delay_hours: 24, template_name: "welcome" });
  assert.equal(at.toISOString(), "2026-01-02T00:00:00.000Z");
});

test("needsFollowUpCall - no prior call, or a stale unconnected one, needs a follow-up", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  assert.equal(needsFollowUpCall(null, now), true);
  assert.equal(
    needsFollowUpCall({ outcome: "no_answer", started_at: "2026-01-01T07:00:00Z" }, now),
    true, // 5h ago, past the 4h cooldown
  );
  assert.equal(
    needsFollowUpCall({ outcome: "no_answer", started_at: "2026-01-01T11:00:00Z" }, now),
    false, // 1h ago, still cooling down
  );
});

test("needsFollowUpCall - a connected call never needs a follow-up", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  assert.equal(
    needsFollowUpCall({ outcome: "connected", started_at: "2020-01-01T00:00:00Z" }, now),
    false,
  );
});
