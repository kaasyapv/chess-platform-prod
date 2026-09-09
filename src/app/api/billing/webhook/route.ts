import { NextResponse } from "next/server";
import { billingProvider } from "@/lib/billing";
import { settleBillingEvent } from "@/lib/billing/settle";

/** Generic gateway webhook receiver - no user session; authenticity comes
 *  from the active provider's signature (x-billing-signature). The mock flow
 *  settles in-session and never needs this route. Razorpay posts to its own
 *  /api/webhooks/razorpay endpoint instead.
 *  Test locally:
 *    body='{"type":"payment.succeeded","invoiceId":"<id>"}'
 *    sig=$(printf %s "$body" | openssl dgst -sha256 -hmac "$BILLING_WEBHOOK_SECRET" -hex | awk '{print $NF}')
 *    curl -X POST /api/billing/webhook -H "x-billing-signature: $sig" -d "$body" */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const provider = billingProvider();

  if (!provider.verifyWebhook(req.headers.get("x-billing-signature"), rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const event = provider.parseWebhook(rawBody);
  if (!event) return NextResponse.json({ ok: true, ignored: true });
  return settleBillingEvent(event, provider.name);
}
