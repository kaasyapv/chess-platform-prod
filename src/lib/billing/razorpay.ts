import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingProvider, BillingWebhookEvent } from "./index";

/** Razorpay provider (Indian market) - Payment Links via the REST API, no SDK.
 *  Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET.
 *  Webhooks land on /api/webhooks/razorpay (x-razorpay-signature). */

const API = "https://api.razorpay.com/v1";

function auth(): string {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new Error("Razorpay not configured - set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET");
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const razorpayProvider: BillingProvider = {
  name: "razorpay",

  async ensureCustomer(profileId) {
    // ponytail: Payment Links don't require a Razorpay customer object -
    // synthetic ref now; create real customers when subscriptions-by-mandate land.
    return `rzp_ref_${profileId}`;
  },

  async createCheckout(req) {
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const res = await fetch(`${API}/payment_links`, {
      method: "POST",
      headers: { authorization: auth(), "content-type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(req.amountInr * 100), // paise
        currency: "INR",
        reference_id: req.invoiceId,
        description: req.description.slice(0, 255),
        callback_url: `${origin}${req.returnPath}?payment=success`,
        callback_method: "get",
        notes: { invoice_id: req.invoiceId, academy_id: req.academyId, student_id: req.studentId },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Razorpay ${res.status}: ${body.slice(0, 200)}`);
    }
    const link = await res.json();
    return { url: link.short_url as string };
  },

  verifyWebhook(signature, rawBody) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return safeEqual(signature, expected);
  },

  parseWebhook(rawBody): BillingWebhookEvent | null {
    try {
      const e = JSON.parse(rawBody) as {
        event?: string;
        payload?: {
          payment_link?: { entity?: { reference_id?: string } };
          payment?: { entity?: { id?: string; notes?: { invoice_id?: string } } };
          subscription?: { entity?: { id?: string } };
        };
      };
      const payment = e.payload?.payment?.entity;
      const invoiceId = e.payload?.payment_link?.entity?.reference_id ?? payment?.notes?.invoice_id;
      switch (e.event) {
        case "payment_link.paid":
        case "payment.captured":
          return invoiceId ? { type: "payment.succeeded", invoiceId, providerRef: payment?.id } : null;
        case "payment.failed":
          return { type: "payment.failed", invoiceId, providerRef: payment?.id };
        case "subscription.charged":
        case "subscription.cancelled":
          return { type: "subscription.updated", subscriptionId: e.payload?.subscription?.entity?.id };
        default:
          return null; // unrecognized events acknowledged, not processed
      }
    } catch {
      return null;
    }
  },
};
