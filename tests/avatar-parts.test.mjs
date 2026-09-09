// Self-check for the avatar id codec. Run: npm test
//
// The point of these tests is backward compatibility. Avatar ids are persisted
// on profiles, and coin purchases are recorded as INDICES into these lists, so
// an id written months ago must still decode to the same face today.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCustomAvatar, customAvatarId,
  FACE_EXTRAS, FACE_HATS, FACE_BG_STYLES, FACE_BGS, FACE_OUTFITS, PREMIUM_EXTRA_START,
} from "../src/lib/avatar-parts.ts";

test("round-trips a fully specified avatar", () => {
  const face = { bg: 1, skin: 2, eyes: 3, mouth: 1, extra: 4, hair: 2, hat: 3, bgStyle: 4, outfit: 2 };
  assert.deepEqual(parseCustomAvatar(customAvatarId(face)), face);
});

test("legacy ids (written before hat/bgStyle/outfit existed) still parse", () => {
  // The original 5-field format: c:bg:skin:eyes:mouth:extra
  assert.deepEqual(
    parseCustomAvatar("c:0:1:2:3:4"),
    { bg: 0, skin: 1, eyes: 2, mouth: 3, extra: 4, hair: 0, hat: 0, bgStyle: 0, outfit: 0 },
  );
  // The 6-field format, once hair was added.
  assert.deepEqual(
    parseCustomAvatar("c:5:4:3:2:1:4"),
    { bg: 5, skin: 4, eyes: 3, mouth: 2, extra: 1, hair: 4, hat: 0, bgStyle: 0, outfit: 0 },
  );
  // The 8-field format, before the outfit layer.
  assert.deepEqual(
    parseCustomAvatar("c:1:1:1:1:1:1:1:1"),
    { bg: 1, skin: 1, eyes: 1, mouth: 1, extra: 1, hair: 1, hat: 1, bgStyle: 1, outfit: 0 },
  );
});

test("a legacy extra keeps its exact meaning - purchases must not shift", () => {
  // A student who bought "Wizard hat" has index 5 recorded in unlocks.
  // That index must still be the wizard hat, not something else.
  assert.equal(FACE_EXTRAS[5], "Wizard hat");
  assert.equal(FACE_EXTRAS[PREMIUM_EXTRA_START], "Wizard hat");
  assert.equal(FACE_EXTRAS[1], "Crown");
  assert.equal(FACE_EXTRAS[8], "Halo");

  const legacy = parseCustomAvatar("c:0:0:0:0:5");
  assert.equal(legacy.extra, 5); // still the wizard hat
  assert.equal(legacy.hat, 0);   // and the new hat layer is simply unused
});

test("rejects out-of-range and malformed ids rather than throwing", () => {
  assert.equal(parseCustomAvatar(null), null);
  assert.equal(parseCustomAvatar(undefined), null);
  assert.equal(parseCustomAvatar(""), null);
  assert.equal(parseCustomAvatar("knight"), null);         // a preset, not custom
  assert.equal(parseCustomAvatar("c:99:0:0:0:0"), null);   // bg out of range
  assert.equal(parseCustomAvatar("c:0:0:0:0:0:0:0:99"), null); // bgStyle out of range
  assert.equal(parseCustomAvatar("c:x:0:0:0:0"), null);    // not a number
  assert.equal(parseCustomAvatar("c:-1:0:0:0:0"), null);   // negative
  assert.equal(parseCustomAvatar("c:1.5:0:0:0:0"), null);  // not an integer
});

test("every new layer's last index is reachable", () => {
  // Guards against a bounds check that is off by one and quietly makes the last
  // hat (or background) unselectable.
  const maxed = {
    bg: FACE_BGS.length - 1, skin: 0, eyes: 0, mouth: 0, extra: 0, hair: 0,
    hat: FACE_HATS.length - 1,
    bgStyle: FACE_BG_STYLES.length - 1,
    outfit: FACE_OUTFITS.length - 1,
  };
  assert.deepEqual(parseCustomAvatar(customAvatarId(maxed)), maxed);
});
