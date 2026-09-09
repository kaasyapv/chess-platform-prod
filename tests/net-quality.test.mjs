// Self-check for the WebRTC network meter. Run: npm test
//
// The meter is only worth having if it reflects reality, so the two things
// worth pinning down are: (a) the worst dimension decides the rating - a fast
// link with heavy loss is not "good"; (b) the cumulative getStats counters are
// differenced, so a burst of loss shows up now and clears when it passes,
// instead of being averaged away over the whole session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreQuality, sampleFromStats } from "../src/lib/net-quality.ts";

const clean = { rttMs: 30, loss: 0, jitterMs: 5, kbps: 400, stalled: false };

test("connection state overrides measurements", () => {
  assert.equal(scoreQuality("failed", clean), "disconnected");
  assert.equal(scoreQuality("closed", clean), "disconnected");
  assert.equal(scoreQuality("disconnected", clean), "reconnecting");
  assert.equal(scoreQuality("connecting", clean), "reconnecting");
  // A pristine sample must not rescue a dead peer.
  assert.notEqual(scoreQuality("failed", clean), "excellent");
});

test("a healthy link rates excellent", () => {
  assert.equal(scoreQuality("connected", clean), "excellent");
});

test("the worst dimension decides", () => {
  // Fast round trip, but losing 10% of packets - not a good call.
  assert.equal(scoreQuality("connected", { rttMs: 20, loss: 0.1, jitterMs: 5, kbps: 400, stalled: false }), "poor");
  // Low loss, but a satellite-grade round trip.
  assert.equal(scoreQuality("connected", { rttMs: 400, loss: 0, jitterMs: 5, kbps: 400, stalled: false }), "poor");
  // Everything fine except jitter.
  assert.equal(scoreQuality("connected", { rttMs: 20, loss: 0, jitterMs: 90, kbps: 400, stalled: false }), "poor");
});

test("degradation and recovery move the rating both ways", () => {
  assert.equal(scoreQuality("connected", { rttMs: 150, loss: 0.02, jitterMs: 25, kbps: 300, stalled: false }), "good");
  assert.equal(scoreQuality("connected", { rttMs: 250, loss: 0.05, jitterMs: 50, kbps: 200, stalled: false }), "fair");
  assert.equal(scoreQuality("connected", { rttMs: 30, loss: 0.001, jitterMs: 5, kbps: 500, stalled: false }), "excellent");
});

test("connected but no packets arriving counts as poor", () => {
  // "Stalled" is packets, not bitrate - see the low-bitrate test below.
  assert.equal(scoreQuality("connected", { rttMs: 20, loss: 0, jitterMs: 2, kbps: 0, stalled: true }), "poor");
});

test("a healthy low-bitrate stream is NOT poor", () => {
  /* Regression: this was rated "poor" by a `kbps < 15` rule, on a real Chrome
   * peer connection carrying a low-motion 320x240 canvas stream at 1ms RTT
   * with zero loss and zero jitter. Video bitrate collapses legitimately on a
   * static scene - a coach sitting still in front of a webcam - so it says
   * nothing about link health. Only the unit tests' synthetic 0 kbps hid it. */
  assert.equal(scoreQuality("connected", { rttMs: 1, loss: 0, jitterMs: 0, kbps: 15, stalled: false }), "excellent");
  assert.equal(scoreQuality("connected", { rttMs: 12, loss: 0, jitterMs: 3, kbps: 6, stalled: false }), "excellent");
});

test("no readings yet does not fail the peer", () => {
  // First tick: counters exist but nothing has been differenced yet.
  assert.equal(scoreQuality("connected", { rttMs: null, loss: null, jitterMs: null, kbps: null, stalled: false }), "good");
});

const statsAt = (t, { lost = 0, recv = 0, bytes = 0, rtt = 0.05, jitter = 0.01 } = {}) => [
  { type: "candidate-pair", nominated: true, currentRoundTripTime: rtt },
  { type: "inbound-rtp", kind: "video", packetsLost: lost, packetsReceived: recv, bytesReceived: bytes, jitter, timestamp: t },
];

test("sampleFromStats differences the cumulative counters", () => {
  const first = sampleFromStats(statsAt(1000, { lost: 0, recv: 100, bytes: 50_000 }), null);
  // Nothing to diff against on the first sample.
  assert.equal(first.sample.loss, null);
  assert.equal(first.sample.kbps, null);
  assert.equal(Math.round(first.sample.rttMs), 50);

  // One second later: 10 lost out of 110 new packets, 50KB more received.
  const second = sampleFromStats(
    statsAt(2000, { lost: 10, recv: 200, bytes: 100_000 }),
    first.cursor,
  );
  assert.equal(second.sample.loss, 10 / 110);
  assert.equal(second.sample.kbps, 400); // 50_000 bytes * 8 / 1000ms
});

test("a loss burst clears once it passes, instead of being averaged forever", () => {
  const t0 = sampleFromStats(statsAt(1000, { lost: 0, recv: 100, bytes: 10_000 }), null);
  const burst = sampleFromStats(statsAt(2000, { lost: 50, recv: 150, bytes: 20_000 }), t0.cursor);
  assert.ok(burst.sample.loss > 0.4, `expected a visible spike, got ${burst.sample.loss}`);
  assert.equal(burst.sample.stalled, false, "packets were still arriving, just lossy");
  assert.equal(scoreQuality("connected", burst.sample), "poor");

  // Next window is clean: totals still carry the old 50 losses, but the delta is 0.
  const recovered = sampleFromStats(statsAt(3000, { lost: 50, recv: 250, bytes: 30_000 }), burst.cursor);
  assert.equal(recovered.sample.loss, 0);
  assert.equal(scoreQuality("connected", recovered.sample), "excellent");
});

test("worst jitter wins across multiple inbound streams", () => {
  const { sample } = sampleFromStats([
    { type: "inbound-rtp", kind: "audio", jitter: 0.005, packetsReceived: 10, timestamp: 1000 },
    { type: "inbound-rtp", kind: "video", jitter: 0.09, packetsReceived: 10, timestamp: 1000 },
  ], null);
  assert.equal(Math.round(sample.jitterMs), 90);
});
