// Self-check for mesh offerer selection. Run: npm test
//
// The property that matters is agreement: run the rule on both peers and
// exactly one of them must decide to call. Both directions of getting this
// wrong end in the same black video tile - either nobody calls and nothing is
// ever negotiated, or two offers collide and the browser quietly rolls one
// side's media away (verified in Chrome: a spectator's offer carries zero
// m-lines, and the publisher that answers it ends up connected with a live
// camera and no transceiver actually sending).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldOffer } from "../src/lib/mesh-signaling.ts";

/** Both peers' verdicts on the same pair. */
const pair = (a, b, aOpts = {}, bOpts = {}) => [
  shouldOffer(a, b, { meViewOnly: aOpts.viewOnly, peerViewOnly: bOpts.viewOnly }),
  shouldOffer(b, a, { meViewOnly: bOpts.viewOnly, peerViewOnly: aOpts.viewOnly }),
];

test("exactly one publisher calls, whichever side asks first", () => {
  for (const [a, b] of [["aaa", "bbb"], ["bbb", "aaa"], ["z", "a"], ["9", "1"]]) {
    const [aCalls, bCalls] = pair(a, b);
    assert.equal(aCalls !== bCalls, true, `${a}/${b} must disagree, got ${aCalls}/${bCalls}`);
  }
});

test("a spectator never offers, and the publisher always calls it", () => {
  // Live Ops (viewOnly) watching a coach. Ids chosen so the plain comparison
  // would hand the offer to the spectator - the viewOnly rule has to win.
  const [coachCalls, opsCalls] = pair("aaa-coach", "zzz-ops", {}, { viewOnly: true });
  assert.equal(coachCalls, true, "the publisher must call the spectator");
  assert.equal(opsCalls, false, "a spectator's offer would carry no media");
});

test("two spectators on the same room never call each other", () => {
  const [x, y] = pair("ops-1", "ops-2", { viewOnly: true }, { viewOnly: true });
  assert.equal(x, false);
  assert.equal(y, false);
});

test("a peer never calls itself", () => {
  assert.equal(shouldOffer("same-id", "same-id"), false);
});
