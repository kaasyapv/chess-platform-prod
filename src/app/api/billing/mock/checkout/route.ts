import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { sign, checkoutPayload } from "@/lib/billing/mock";

/** Mock gateway "payment page": settles the invoice with the service role
 *  (record_invoice_payment is not callable by ordinary users - see
 *  0028_lock_invoice_payment_rpc.sql) and bounces back to the app. Only
 *  reachable with a valid HMAC `sig`, which is only ever issued to someone
 *  who could already see the invoice via RLS (/api/billing/checkout). */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const invoiceId = url.searchParams.get("invoice") ?? "";
  const sig = url.searchParams.get("sig") ?? "";
  const returnPathRaw = url.searchParams.get("return") ?? "/";
  // "//evil.example" passes startsWith("/") but the URL constructor resolves
  // it as protocol-relative to a different host - reject that too.
  const returnPath = returnPathRaw.startsWith("/") && !returnPathRaw.startsWith("//") ? returnPathRaw : "/";
  const back = new URL(returnPath, url.origin);

  const fail = (msg: string) => {
    back.searchParams.set("payment", "failed");
    back.searchParams.set("reason", msg);
    return NextResponse.redirect(back);
  };

  let expectedSig: string;
  try {
    expectedSig = sign(checkoutPayload(invoiceId, returnPath));
  } catch {
    return fail("Payment settlement is not configured");
  }
  if (!invoiceId || sig !== expectedSig) return fail("Invalid payment link");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return fail("Payment settlement requires SUPABASE_SERVICE_ROLE_KEY");
  const db = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);
  const { error } = await db.rpc("record_invoice_payment", {
    p_invoice: invoiceId,
    p_provider: "mock",
    p_ref: `mock_pay_${Date.now()}`,
  });
  if (error) return fail(error.message);

  back.searchParams.set("payment", "success");
  return NextResponse.redirect(back);
}
