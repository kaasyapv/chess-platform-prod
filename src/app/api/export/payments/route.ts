import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { inr, paymentRows, paymentTotals, SESSION_RATE_INR } from "@/lib/finance";
import { rateLimitGuard } from "@/lib/rate-limit-guard";

/** The coach's own payment statement as a spreadsheet.
 *
 *  Built from the same paymentRows()/paymentTotals() the screen uses, so the
 *  file can never disagree with the table it was downloaded from. Everything
 *  is scoped to the caller: the classroom query filters on their own id and
 *  RLS returns only their own penalties, so there is no way to ask this route
 *  for somebody else's earnings.
 */
export async function GET() {
  const profile = await requireProfile();
  if (profile.role === "student") {
    return NextResponse.json({ error: "No payment statement for students" }, { status: 403 });
  }
  const limited = rateLimitGuard(`export-payments:${profile.id}`, 5, 60_000);
  if (limited) return limited;

  const supabase = await createClient();
  const [{ data: classes }, { data: pens }] = await Promise.all([
    supabase.from("classrooms")
      .select("id, title, scheduled_at")
      .eq("coach_id", profile.id).eq("status", "completed")
      .order("scheduled_at", { ascending: false }).limit(1000),
    supabase.from("coach_penalties")
      .select("id, amount, status, category, custom_reason, created_at")
      .eq("coach_id", profile.id)
      .order("created_at", { ascending: false }),
  ]);

  const rows = paymentRows(
    (classes ?? []) as { id: string; title: string; scheduled_at: string }[],
    ((pens ?? []) as {
      id: string; amount: number; status: string; category: string;
      custom_reason: string | null; created_at: string;
    }[]).map((p) => ({
      id: p.id, amount: p.amount, status: p.status,
      reason: p.custom_reason || p.category.replace(/_/g, " "),
      created_at: p.created_at,
    })),
  );
  const totals = paymentTotals(rows);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Chess Academy Platform";
  wb.created = new Date();

  const sheet = wb.addWorksheet("Payment History");
  sheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Class", key: "label", width: 42 },
    { header: "Earnings (₹)", key: "earned", width: 15 },
    { header: "Deductions (₹)", key: "deducted", width: 16 },
    { header: "Status", key: "status", width: 12 },
  ];
  for (const r of rows) {
    sheet.addRow({
      date: new Date(r.at).toLocaleDateString(),
      label: r.penaltyId ? `Penalty: ${r.label}` : r.label,
      earned: r.earned || null,
      deducted: r.deducted || null,
      status: r.penaltyStatus ?? "completed",
    });
  }
  sheet.getRow(1).font = { bold: true };

  sheet.addRow({});
  const total = sheet.addRow({
    date: "Total", label: `${totals.sessions} session(s) at ${inr(SESSION_RATE_INR)}`,
    earned: totals.gross, deducted: totals.deductions || null, status: "",
  });
  total.font = { bold: true };
  const net = sheet.addRow({ date: "Net payable", label: "", earned: totals.net, deducted: null, status: "" });
  net.font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  const safeName = profile.display_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new NextResponse(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition":
        `attachment; filename="payment-history-${safeName}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
