import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { BillingWebhookEvent } from "./index";

/** Shared webhook settlement - used by /api/billing/webhook (generic) and
 *  /api/webhooks/razorpay. Runs with the service role (no user session). */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function settleBillingEvent(event: BillingWebhookEvent, providerName: string) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Webhook settlement requires SUPABASE_SERVICE_ROLE_KEY - see .env.example" },
      { status: 501 },
    );
  }
  const db = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);

  /* Idempotency (0046). Gateways redeliver a webhook on any 5xx / timeout;
   * without this a `payment.succeeded` could be settled - and a billing_events
   * row written - twice. Claim the delivery id first; a PK conflict means we've
   * already processed it. `providerRef` is the closest thing to a stable
   * per-delivery id we carry. Degrades gracefully if 0046 isn't applied yet:
   * log and fall through rather than block a real payment. */
  if (event.providerRef) {
    const { error: dupErr } = await db.from("webhook_deliveries")
      .insert({ provider: providerName, event_id: event.providerRef, event_type: event.type });
    if (dupErr?.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    if (dupErr) console.error("webhook_deliveries:", dupErr.message);
  }

  if (event.type === "payment.succeeded" && event.invoiceId) {
    const { data: inv } = await db.from("invoices").select("*").eq("id", event.invoiceId).single();
    if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    if (inv.status === "due") {
      await db
        .from("invoices")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", inv.id);
    }
    await db.from("billing_events").insert({
      academy_id: inv.academy_id,
      provider: providerName,
      event_type: event.type,
      invoice_id: inv.id,
      payload: { ref: event.providerRef ?? null },
    });
  } else {
    // payment.failed / subscription.updated: log only - nothing to settle.
    // subscription ids from gateways aren't our uuids; keep them in payload.
    const subId = event.subscriptionId && UUID_RE.test(event.subscriptionId) ? event.subscriptionId : null;
    await db.from("billing_events").insert({
      provider: providerName,
      event_type: event.type,
      invoice_id: event.invoiceId ?? null,
      subscription_id: subId,
      payload: { ref: event.providerRef ?? null, external_subscription: subId ? null : event.subscriptionId ?? null },
    });
  }
  return NextResponse.json({ ok: true });
}
