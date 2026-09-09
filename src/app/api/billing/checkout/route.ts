import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { billingProvider } from "@/lib/billing";
import { rateLimitGuard } from "@/lib/rate-limit-guard";

/** Start an online payment for a due invoice. Returns the gateway checkout
 *  URL; the caller redirects the browser there. Provider-agnostic. */

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limited = rateLimitGuard(`checkout:${user.id}`, 10, 60_000);
  if (limited) return limited;

  const { invoiceId, returnPath } = (await req.json().catch(() => ({}))) as {
    invoiceId?: string;
    returnPath?: string;
  };
  if (!invoiceId) return NextResponse.json({ error: "invoiceId required" }, { status: 400 });

  // RLS: visible only to the invoice's student or academy admins
  const { data: inv } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (inv.status !== "due") return NextResponse.json({ error: "Invoice is not due" }, { status: 400 });

  try {
    const provider = billingProvider();
    await provider.ensureCustomer(inv.student_id);
    const session = await provider.createCheckout({
      invoiceId: inv.id,
      academyId: inv.academy_id,
      studentId: inv.student_id,
      amountInr: Number(inv.amount_inr),
      description: inv.description,
      // only allow same-app return targets ("//host/path" is protocol-relative, not same-origin)
      returnPath: returnPath?.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/",
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Checkout failed" },
      { status: 500 },
    );
  }
}
