// Self-check for the admin "Reset password" temp-credential generator.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateTempPassword, isStrongTempPassword } from "../src/lib/temp-password.ts";

test("generateTempPassword - always meets the strength contract", () => {
  for (let i = 0; i < 500; i++) {
    const pw = generateTempPassword();
    assert.ok(isStrongTempPassword(pw), `weak: ${pw}`);
  }
});

test("generateTempPassword - no ambiguous glyphs, grouped in 4s", () => {
  const pw = generateTempPassword();
  assert.match(pw, /^[^-]{4}(-[^-]{4}){2}-[^-]{2}$/); // xxxx-xxxx-xxxx-xx
  assert.doesNotMatch(pw.replace(/-/g, ""), /[0O1lI]/);
});

test("generateTempPassword - high entropy across many draws (no obvious repeats)", () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(generateTempPassword());
  assert.equal(seen.size, 1000, "collision in 1000 draws - RNG or space too small");
});

test("generateTempPassword - injectable RNG is honoured (deterministic under a fixed stream)", () => {
  // constant-byte RNG: pick() rejection-samples but with b=7 every byte it
  // resolves immediately; both calls with the same stream must match.
  const fixed = () => new Uint8Array(8).fill(7);
  assert.equal(generateTempPassword(fixed), generateTempPassword(fixed));
});

test("isStrongTempPassword - rejects the obvious failures", () => {
  assert.equal(isStrongTempPassword("short1!A"), false);       // too short
  assert.equal(isStrongTempPassword("alllowercase123!"), false); // no upper
  assert.equal(isStrongTempPassword("NOLOWERCASE123!"), false);  // no lower
  assert.equal(isStrongTempPassword("NoDigitsHere!!!!"), false); // no digit
  assert.equal(isStrongTempPassword("NoSymbols12345A"), false);  // no symbol
  assert.equal(isStrongTempPassword("HasZero0Digit1!A"), false); // ambiguous glyph
  assert.equal(isStrongTempPassword("Kk7p-mN4x-qW9t@"), true);   // lower+upper+digit+symbol, no 0O1lI
});
