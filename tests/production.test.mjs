// Self-checks for the production-integration helpers. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit, rateLimitHeaders } from "../src/lib/rate-limit.ts";
process.env.BILLING_WEBHOOK_SECRET ??= "test-secret";
import { mockProvider, sign, checkoutPayload } from "../src/lib/billing/mock.ts";
import { razorpayProvider } from "../src/lib/billing/razorpay.ts";
import { checkEnv } from "../src/lib/env.ts";

test("rateLimit - allows up to the limit, blocks after, resets by window", async () => {
  const key = `t:${Math.random()}`;
  assert.equal(rateLimit(key, 2, 50).ok, true);
  const second = rateLimit(key, 2, 50);
  assert.equal(second.ok, true);
  assert.equal(second.remaining, 0);
  assert.equal(rateLimit(key, 2, 50).ok, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(rateLimit(key, 2, 50).ok, true);
});

test("rateLimitHeaders - emits the Retry-After + X-RateLimit contract", () => {
  const rl = { ok: false, remaining: 0, resetAt: Date.now() + 30_000, limit: 5 };
  const h = rateLimitHeaders(rl);
  assert.ok(Number(h["Retry-After"]) >= 1 && Number(h["Retry-After"]) <= 30);
  assert.equal(h["X-RateLimit-Limit"], "5");
  assert.equal(h["X-RateLimit-Remaining"], "0");
  assert.match(h["X-RateLimit-Reset"], /^\d+$/);
});

test("mock billing - checkout link is signed and webhook verification round-trips", async () => {
  const session = await mockProvider.createCheckout({
    invoiceId: "inv-1", academyId: "a", studentId: "s",
    amountInr: 100, description: "d", returnPath: "/x",
  });
  const url = new URL(session.url, "http://localhost");
  assert.equal(url.searchParams.get("invoice"), "inv-1");
  assert.equal(url.searchParams.get("sig"), sign(checkoutPayload("inv-1", "/x")));

  const body = JSON.stringify({ type: "payment.succeeded", invoiceId: "inv-1" });
  assert.equal(mockProvider.verifyWebhook(sign(body), body), true);
  assert.equal(mockProvider.verifyWebhook("bad-sig", body), false);
  assert.equal(mockProvider.verifyWebhook(null, body), false);
  assert.deepEqual(mockProvider.parseWebhook(body), { type: "payment.succeeded", invoiceId: "inv-1" });
  assert.equal(mockProvider.parseWebhook("not json"), null);
});

test("mock billing - fails closed with no secret configured, not a forgeable default", async () => {
  const saved = process.env.BILLING_WEBHOOK_SECRET;
  delete process.env.BILLING_WEBHOOK_SECRET;
  try {
    await assert.rejects(() =>
      mockProvider.createCheckout({
        invoiceId: "inv-1", academyId: "a", studentId: "s",
        amountInr: 100, description: "d", returnPath: "/x",
      }),
    );
    assert.equal(mockProvider.verifyWebhook("anything", '{"type":"payment.succeeded"}'), false);
  } finally {
    process.env.BILLING_WEBHOOK_SECRET = saved;
  }
});

test("razorpay - webhook verification + event normalization", async () => {
  const { createHmac } = await import("node:crypto");
  const body = JSON.stringify({
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { reference_id: "inv-42" } },
      payment: { entity: { id: "pay_ABC" } },
    },
  });
  // no secret configured → verification must fail closed
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  assert.equal(razorpayProvider.verifyWebhook("whatever", body), false);

  process.env.RAZORPAY_WEBHOOK_SECRET = "rzp-test-secret";
  const sig = createHmac("sha256", "rzp-test-secret").update(body).digest("hex");
  assert.equal(razorpayProvider.verifyWebhook(sig, body), true);
  assert.equal(razorpayProvider.verifyWebhook("bad", body), false);

  assert.deepEqual(razorpayProvider.parseWebhook(body),
    { type: "payment.succeeded", invoiceId: "inv-42", providerRef: "pay_ABC" });
  assert.equal(razorpayProvider.parseWebhook(JSON.stringify({ event: "refund.created" })), null);
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});

test("checkEnv - flags placeholder Supabase config, reports disabled AI", () => {
  const saved = { ...process.env };
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "placeholder";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AI_PROVIDER;
    delete process.env.NEXT_PUBLIC_LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    const r = checkEnv();
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    assert.ok(Object.values(r.disabled).includes("ANTHROPIC_API_KEY"));
    // Video is optional, so it is "disabled", never "missing" - the app still runs.
    assert.ok("classroom video" in r.disabled);

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ref.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "x".repeat(40);
    process.env.ANTHROPIC_API_KEY = "k";
    // Classroom video (self-hosted LiveKit) is a tracked capability too: all
    // three vars must be present before checkEnv reports nothing disabled.
    process.env.NEXT_PUBLIC_LIVEKIT_URL = "ws://localhost:7880";
    process.env.LIVEKIT_API_KEY = "devkey";
    process.env.LIVEKIT_API_SECRET = "devsecret";
    assert.equal(checkEnv().ok, true);
    assert.deepEqual(checkEnv().disabled, {});
  } finally {
    process.env = saved;
  }
});
