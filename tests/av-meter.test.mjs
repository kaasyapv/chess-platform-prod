import { test } from "node:test";
import assert from "node:assert/strict";
import { peakLevel } from "../src/lib/av-meter.ts";

test("peakLevel - digital silence (all 128) reads 0", () => {
  assert.equal(peakLevel(new Uint8Array(2048).fill(128)), 0);
});

test("peakLevel - full negative swing (0) reads ~1", () => {
  const buf = new Uint8Array(64).fill(128);
  buf[10] = 0; // deviation 128
  assert.equal(peakLevel(buf), 1);
});

test("peakLevel - full positive swing (255) reads ~0.99", () => {
  const buf = new Uint8Array(64).fill(128);
  buf[3] = 255; // deviation 127
  assert.ok(Math.abs(peakLevel(buf) - 127 / 128) < 1e-9);
});

test("peakLevel - takes the max deviation over the frame, not the last", () => {
  assert.equal(peakLevel([128, 148, 128, 108, 128]), 20 / 128); // |148-128| = |108-128| = 20
});

test("peakLevel - half-scale tone reads ~0.5", () => {
  const buf = [128, 192, 128, 64]; // deviation 64
  assert.equal(peakLevel(buf), 0.5);
});
