// Self-check for the coach payment statement. Run: npm test
//
// This is money someone is owed, so the arithmetic is worth pinning down: a
// silently dropped session or a waived penalty that keeps being deducted is
// the kind of bug a coach notices before anyone else does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentRows, paymentTotals, SESSION_RATE_INR } from "../src/lib/finance.ts";

const sessions = [
  { id: "c1", title: "Endgames A", scheduled_at: "2026-08-01T10:00:00Z" },
  { id: "c2", title: "Openings B", scheduled_at: "2026-08-03T10:00:00Z" },
  { id: "c3", title: "Tactics C", scheduled_at: "2026-08-05T10:00:00Z" },
];

test("the flat session rate is 300", () => {
  assert.equal(SESSION_RATE_INR, 300);
});

test("every completed session earns the rate, once", () => {
  const rows = paymentRows(sessions, []);
  const totals = paymentTotals(rows);
  assert.equal(totals.sessions, 3);
  assert.equal(totals.gross, 900);
  assert.equal(totals.deductions, 0);
  assert.equal(totals.net, 900);
});

test("an active penalty is withheld from the total", () => {
  const rows = paymentRows(sessions, [
    { id: "p1", amount: 250, status: "active", reason: "Joining late", created_at: "2026-08-04T09:00:00Z" },
  ]);
  const totals = paymentTotals(rows);
  assert.equal(totals.gross, 900);
  assert.equal(totals.deductions, 250);
  assert.equal(totals.net, 650);
});

test("an appealed penalty is still withheld while the CEO decides", () => {
  // Pending is not the same as forgiven; the coach should see the money as at
  // risk rather than have it quietly restored before a decision.
  const rows = paymentRows(sessions, [
    { id: "p1", amount: 250, status: "appealed", reason: "Joining late", created_at: "2026-08-04T09:00:00Z" },
  ]);
  assert.equal(paymentTotals(rows).net, 650);
});

test("a waived penalty costs nothing but still appears on the statement", () => {
  const rows = paymentRows(sessions, [
    { id: "p1", amount: 250, status: "waived", reason: "Joining late", created_at: "2026-08-04T09:00:00Z" },
  ]);
  const totals = paymentTotals(rows);
  assert.equal(totals.deductions, 0, "a successful appeal must not deduct");
  assert.equal(totals.net, 900);
  // Still listed, so a coach can see the appeal succeeded rather than the row
  // vanishing without explanation.
  const waived = rows.find((r) => r.penaltyId === "p1");
  assert.ok(waived, "waived penalty disappeared from the statement");
  assert.equal(waived.deducted, 0);
  assert.equal(waived.penaltyStatus, "waived");
});

test("rows are newest first, sessions and penalties interleaved by date", () => {
  const rows = paymentRows(sessions, [
    { id: "p1", amount: 100, status: "active", reason: "Late", created_at: "2026-08-04T09:00:00Z" },
  ]);
  const dates = rows.map((r) => r.at);
  assert.deepEqual(dates, [...dates].sort((a, b) => b.localeCompare(a)));
  // The penalty sits between the 3rd and the 5th, not bolted onto an end.
  assert.equal(rows[1].penaltyId, "p1");
});

test("penalties alone still produce a coherent, negative-free statement", () => {
  const rows = paymentRows([], [
    { id: "p1", amount: 500, status: "active", reason: "No-show", created_at: "2026-08-04T09:00:00Z" },
  ]);
  const totals = paymentTotals(rows);
  assert.equal(totals.sessions, 0);
  assert.equal(totals.gross, 0);
  assert.equal(totals.deductions, 500);
  // Net genuinely can go negative when someone owes more than they earned;
  // the statement must show that rather than clamping it to zero and hiding it.
  assert.equal(totals.net, -500);
});

test("a non-numeric penalty amount cannot poison the total", () => {
  const rows = paymentRows(sessions, [
    { id: "p1", amount: undefined, status: "active", reason: "Broken row", created_at: "2026-08-04T09:00:00Z" },
  ]);
  assert.equal(paymentTotals(rows).net, 900, "NaN leaked into the arithmetic");
});

test("an empty statement totals zero rather than NaN", () => {
  const totals = paymentTotals(paymentRows([], []));
  assert.deepEqual(totals, { sessions: 0, gross: 0, deductions: 0, net: 0 });
});
