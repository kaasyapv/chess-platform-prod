import { NextResponse } from "next/server";
import { razorpayProvider } from "@/lib/billing/razorpay";
import { settleBillingEvent } from "@/lib/billing/settle";

/** Razorpay webhook receiver - signature-verified (x-razorpay-signature,
 *  HMAC-SHA256 with RAZORPAY_WEBHOOK_SECRET), settled via the service role.
 *  Configure in the Razorpay dashboard: events payment_link.paid,
 *  payment.captured, payment.failed → <site>/api/webhooks/razorpay */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!razorpayProvider.verifyWebhook(req.headers.get("x-razorpay-signature"), rawBody)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  const event = razorpayProvider.parseWebhook(rawBody);
  if (!event) return NextResponse.json({ ok: true, ignored: true });
  return settleBillingEvent(event, "razorpay");
}
