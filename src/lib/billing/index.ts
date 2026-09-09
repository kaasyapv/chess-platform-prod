/** Provider-agnostic billing layer. The app only ever talks to this
 *  interface; BILLING_PROVIDER picks the implementation. "mock" simulates
 *  checkout + webhooks end-to-end with zero external accounts - a real
 *  gateway (Razorpay/Stripe/…) lands as one new module registered here,
 *  with no changes to routes, UI, or schema. */

import { mockProvider } from "./mock";
import { razorpayProvider } from "./razorpay";

export type CheckoutRequest = {
  invoiceId: string;
  academyId: string;
  studentId: string;
  amountInr: number;
  description: string;
  /** Where the gateway should send the payer afterwards. */
  returnPath: string;
};

export type CheckoutSession = { url: string };

/** Normalized webhook event - every provider maps its payload to this. */
export type BillingWebhookEvent = {
  type: "payment.succeeded" | "payment.failed" | "subscription.updated";
  invoiceId?: string;
  subscriptionId?: string;
  providerRef?: string;
};

export interface BillingProvider {
  name: string;
  /** Provider-side customer id for a profile (created lazily). */
  ensureCustomer(profileId: string): Promise<string>;
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /** Authenticate a webhook delivery before trusting its body. */
  verifyWebhook(signature: string | null, rawBody: string): boolean;
  /** Map a verified raw body to a normalized event (null = ignore). */
  parseWebhook(rawBody: string): BillingWebhookEvent | null;
}

export function billingProvider(): BillingProvider {
  // ponytail: switch grows one case per real gateway; no registry needed for 1-3 entries
  switch (process.env.BILLING_PROVIDER) {
    case "razorpay":
      return razorpayProvider;
    case "mock":
    case undefined:
    case "":
      return mockProvider;
    default:
      throw new Error(`Unknown BILLING_PROVIDER "${process.env.BILLING_PROVIDER}"`);
  }
}
