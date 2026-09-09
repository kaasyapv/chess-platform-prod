// Self-checks for the CEO dashboard money maths. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COACH_SHARE, DEMO_MONTHS, GATEWAY_FEE_RATE, PLATFORM_FEE_RATE, LIVE_TAIL,
  changePct, easeOut, financeSummary, inr, inrShort, lerpAll, nudge,
} from "../src/lib/finance.ts";

test("financeSummary - empty or thin data falls back to the demo months", () => {
  for (const input of [undefined, null, [], [{ month: "Jul", revenue: 1000 }]]) {
    const s = financeSummary(input);
    assert.equal(s.isDemo, true, `expected demo for ${JSON.stringify(input)}`);
    assert.deepEqual(s.months, DEMO_MONTHS);
    assert.ok(s.totalRevenue > 0, "demo revenue must be non-zero");
  }
});

test("financeSummary - real data is used and never mixed with demo data", () => {
  const months = [
    { month: "Jun", revenue: 100_000 },
    { month: "Jul", revenue: 150_000 },
  ];
  const s = financeSummary(months);
  assert.equal(s.isDemo, false);
  assert.deepEqual(s.months, months);
  assert.equal(s.totalRevenue, 250_000);
});

test("financeSummary - the split adds back up to the revenue", () => {
  const s = financeSummary([
    { month: "Jun", revenue: 200_000 },
    { month: "Jul", revenue: 300_000 },
  ]);
  assert.equal(s.coachEarnings, 500_000 * COACH_SHARE);
  assert.equal(s.platformDeductions, 500_000 * (GATEWAY_FEE_RATE + PLATFORM_FEE_RATE));
  // No rupee is invented or lost.
  const sum = s.coachEarnings + s.platformDeductions + s.netProfit;
  assert.ok(Math.abs(sum - s.totalRevenue) < 1e-6, `split ${sum} != revenue ${s.totalRevenue}`);
  assert.ok(s.netProfit > 0);
});

test("financeSummary - revenue change compares the last two months", () => {
  const s = financeSummary([
    { month: "Jun", revenue: 100_000 },
    { month: "Jul", revenue: 125_000 },
  ]);
  assert.equal(s.revenueChangePct, 25);
});

test("changePct - no divide by zero", () => {
  assert.equal(changePct(0, 500), 0);
  assert.equal(changePct(200, 100), -50);
});

test("financeSummary - bad rows are dropped, not crashed on", () => {
  const s = financeSummary([
    { month: "Jun", revenue: 100_000 },
    { month: "Jul", revenue: Number.NaN },
  ]);
  // Only one good row survives -> too thin -> demo.
  assert.equal(s.isDemo, true);
});

test("nudge - only the newest months move, and only a little", () => {
  const base = [100, 200, 300, 400, 500, 600];
  const worst = nudge(base, () => 1);   // biggest possible upward nudge
  base.slice(0, -LIVE_TAIL).forEach((v, i) => {
    assert.equal(worst[i], v, `settled month ${i} must not move`);
  });
  base.slice(-LIVE_TAIL).forEach((v, i) => {
    const moved = worst[base.length - LIVE_TAIL + i];
    assert.notEqual(moved, v);
    const pct = Math.abs(moved - v) / v * 100;
    assert.ok(pct < 1, `nudge of ${pct.toFixed(3)}% must stay under 1%`);
  });
  assert.equal(worst.length, base.length, "point count never changes");
});

test("nudge - never produces a negative revenue", () => {
  assert.ok(nudge([0, 0, 0], () => 0).every((v) => v >= 0));
  assert.ok(nudge([10, 5, 1], () => 0).every((v) => v >= 0));
});

test("easeOut / lerpAll - starts at `from`, lands exactly on `to`", () => {
  assert.equal(easeOut(0), 0);
  assert.equal(easeOut(1), 1);
  assert.equal(easeOut(-5), 0, "clamped");
  assert.equal(easeOut(5), 1, "clamped");

  const from = [10, 20], to = [30, 40];
  assert.deepEqual(lerpAll(from, to, 0), from);
  assert.deepEqual(lerpAll(from, to, 1), to);
  const mid = lerpAll(from, to, 0.5);
  assert.ok(mid[0] > 10 && mid[0] < 30);
  assert.equal(lerpAll(from, to, 0.5).length, 2, "no points added or dropped");
});

test("inr / inrShort - Indian grouping and short forms", () => {
  assert.equal(inr(1_245_000), "₹12,45,000");
  assert.equal(inrShort(812_600), "₹8.13L");
  assert.equal(inrShort(12_500_000), "₹1.25Cr");
  assert.equal(inrShort(4_500), "₹4.5K");
  assert.equal(inrShort(-250_000), "-₹2.50L");
});
