// Self-check for generated avatars. Run: npm test
//
// The requirement these guard is "the same user always gets the same avatar" -
// the failure mode being a face that reshuffles on every reload, which reads as
// a bug to anyone using the product. Determinism is the whole contract here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dicebearUrl, customAvatarUrl } from "../src/lib/dicebear.ts";

const ALICE = "44444444-4444-4444-4444-444444444444";
const BOB = "33333333-3333-3333-3333-333333333333";

test("same seed always produces the same avatar", () => {
  const a = dicebearUrl(ALICE, "student");
  const b = dicebearUrl(ALICE, "student");
  assert.equal(a, b);
});

test("different users get different avatars", () => {
  assert.notEqual(dicebearUrl(ALICE, "student"), dicebearUrl(BOB, "student"));
});

test("avatars are self-contained data URIs, not network requests", () => {
  // A remote <img src> would mean hundreds of third-party requests on a student
  // list, and blank avatars whenever that host is slow or blocked.
  const url = dicebearUrl(ALICE, "student");
  assert.ok(url.startsWith("data:image/svg+xml;utf8,"), url.slice(0, 40));
  assert.ok(!url.includes("api.dicebear.com"));
  assert.ok(decodeURIComponent(url).includes("<svg"));
});

test("role picks the style, and stays stable for that role", () => {
  const asStudent = dicebearUrl(ALICE, "student");
  const asCeo = dicebearUrl(ALICE, "ceo");
  assert.notEqual(asStudent, asCeo, "different roles should draw from different styles");
  assert.equal(asCeo, dicebearUrl(ALICE, "ceo"), "same role must stay stable");
});

test("an unknown role still yields a stable avatar rather than throwing", () => {
  const a = dicebearUrl(ALICE, "visitor");
  assert.ok(a.startsWith("data:image/svg+xml"));
  assert.equal(a, dicebearUrl(ALICE, "visitor"));
});

test("size affects rendering but not identity of the seed", () => {
  // Different sizes are allowed to differ (viewBox/size attrs), but each size
  // must itself be stable - this is what keeps a list from flickering.
  assert.equal(dicebearUrl(ALICE, "student", 64), dicebearUrl(ALICE, "student", 64));
  assert.equal(dicebearUrl(ALICE, "student", 96), dicebearUrl(ALICE, "student", 96));
});

test("a customised avatar beats the generated one, and stays the person's own", () => {
  /* This is the "still showing generic profile pictures" bug, caught at the
   * layer it actually lived in. A user picks a style and seed in Profile →
   * Avatar; if any list drops that value on the floor, they fall back to a
   * face generated from their id - which looks fine in isolation and is
   * completely wrong. These are real stored values from the demo seed. */
  const seeded = [
    ["Kabir Shah",   "dicebear:micah:bright-pawn"],
    ["Prisha Rao",   "dicebear:thumbs:swift-rook"],
    ["Rudra Kapoor", "dicebear:micah:lucky-mate"],
    ["Sara Iyer",    "dicebear:adventurerNeutral:keen-gambit"],
  ];

  const urls = seeded.map(([, stored]) => {
    const url = customAvatarUrl(stored, 96);
    assert.ok(url?.startsWith("data:image/svg+xml"), `nothing rendered for ${stored}`);
    return url;
  });

  assert.equal(new Set(urls).size, urls.length, "customised avatars are not distinct");

  for (const [i, [name]] of seeded.entries()) {
    assert.notEqual(urls[i], dicebearUrl(name, "student", 96),
      `${name}'s chosen avatar collapsed back to the generated fallback`);
  }

  // Same style, different seed must still differ.
  assert.notEqual(urls[0], urls[2], "the seed is being ignored within a style");
});

test("a garbled or absent avatar value falls back instead of rendering nothing", () => {
  assert.equal(customAvatarUrl("dicebear:", 96), null);
  assert.equal(customAvatarUrl("not-an-avatar", 96), null);
  // A legacy hand-drawn id is not a DiceBear value; Avatar handles those
  // separately, so this must decline rather than half-render.
  assert.equal(customAvatarUrl("knight", 96), null);
});

test("the cache cannot grow without bound", () => {
  // 600-entry cap, cleared wholesale when hit. Generating well past the cap
  // must keep working and must not start returning someone else's face.
  for (let i = 0; i < 700; i++) dicebearUrl(`seed-${i}`, "student");
  const again = dicebearUrl(ALICE, "student");
  assert.equal(again, dicebearUrl(ALICE, "student"));
  assert.notEqual(again, dicebearUrl(BOB, "student"));
});
