// Self-check for tenant resolution from the request host. Run: npm test
//
// This decides which academy's logo/colour the login page shows. A slip that
// returns "vercel" or "www" as a slug shows a stranger's brand or a 404 on
// every preview deploy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { academySlugFromHost } from "../src/lib/branding.ts";

test("pulls the subdomain as the slug", () => {
  assert.equal(academySlugFromHost("panama.chessacademy.com"), "panama");
  assert.equal(academySlugFromHost("Panama.ChessAcademy.com:443"), "panama");
  assert.equal(academySlugFromHost("deep.sub.chessacademy.com"), "deep");
});

test("no subdomain / non-tenant hosts return null", () => {
  for (const h of [
    "chessacademy.com", "www.chessacademy.com", "app.chessacademy.com",
    "localhost", "localhost:3000", "127.0.0.1", "chess-platform-abc.vercel.app",
    null, undefined, "",
  ]) {
    assert.equal(academySlugFromHost(h), null, `${h} should be null`);
  }
});
