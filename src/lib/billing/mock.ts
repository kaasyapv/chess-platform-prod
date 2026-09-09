import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingProvider, BillingWebhookEvent } from "./index";

/** Mock gateway: "checkout" is an internal route that settles the invoice
 *  behind an HMAC-signed link (see mock/checkout/route.ts) and redirects
 *  back. Webhook signatures are HMAC-SHA256 of the raw body with
 *  BILLING_WEBHOOK_SECRET - same shape real gateways use.
 *
 *  No fallback secret: a hardcoded default here would be a literal string in
 *  the public repo, letting anyone forge a valid `sig` or webhook signature
 *  and mark any invoice paid for free. Fail closed instead - every caller
 *  below treats a missing secret as "this request is not authentic". */

function secret(): string {
  const s = process.env.BILLING_WEBHOOK_SECRET;
  if (!s) throw new Error("BILLING_WEBHOOK_SECRET is not set - required for the mock billing provider");
  return s;
}

export function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

/** The exact string a mock-checkout link's `sig` is computed over. */
export function checkoutPayload(invoiceId: string, returnPath: string): string {
  return `${invoiceId}:${returnPath}`;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const mockProvider: BillingProvider = {
  name: "mock",

  async ensureCustomer(profileId) {
    return `mock_cus_${profileId}`;
  },

  async createCheckout(req) {
    const params = new URLSearchParams({
      invoice: req.invoiceId,
      return: req.returnPath,
      // returnPath is part of the signed payload so a caller can't keep a
      // valid sig for one invoice and swap in an arbitrary redirect target.
      sig: sign(checkoutPayload(req.invoiceId, req.returnPath)),
    });
    return { url: `/api/billing/mock/checkout?${params}` };
  },

  verifyWebhook(signature, rawBody) {
    if (!signature) return false;
    try {
      return safeEqual(signature, sign(rawBody));
    } catch {
      return false; // secret not configured - fail closed, not open
    }
  },

  parseWebhook(rawBody) {
    try {
      const e = JSON.parse(rawBody) as BillingWebhookEvent;
      return e.type ? e : null;
    } catch {
      return null;
    }
  },
};
