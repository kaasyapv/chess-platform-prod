import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { financeSummary } from "@/lib/finance";
import { rateLimitGuard } from "@/lib/rate-limit-guard";

/** CEO-only revenue/financial export (client requirement #13). Builds the
 *  workbook from whatever the academy's own data has - same demo-data
 *  fallback financeSummary() already uses elsewhere, so a fresh academy
 *  still gets a populated, meaningful file instead of an empty shell. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role, academy_id").eq("id", user.id).single();
  if (!profile || profile.role !== "ceo") {
    return NextResponse.json({ error: "CEO only" }, { status: 403 });
  }
  // Heavy: 5-sheet workbook over the whole academy's financials + PII.
  const limited = rateLimitGuard(`export-finance:${user.id}`, 5, 60_000);
  if (limited) return limited;

  const yearStart = new Date();
  yearStart.setMonth(yearStart.getMonth() - 11); yearStart.setDate(1); yearStart.setHours(0, 0, 0, 0);

  const [paidYear, invoices, subs, penalties] = await Promise.all([
    supabase.from("invoices").select("amount_inr, paid_at").eq("status", "paid").gte("paid_at", yearStart.toISOString()),
    supabase.from("invoices")
      .select("id, amount_inr, description, status, due_at, paid_at, student:profiles!invoices_student_id_fkey(display_name)")
      .order("created_at", { ascending: false }).limit(1000),
    supabase.from("subscriptions").select("amount_inr, billing_interval, status, created_at"),
    supabase.from("coach_penalties")
      .select("amount, category, custom_reason, status, created_at, coach:profiles!coach_penalties_coach_id_fkey(display_name)")
      .order("created_at", { ascending: false }),
  ]);

  const byMonth = new Map<string, number>();
  for (const row of paidYear.data ?? []) {
    if (!row.paid_at) continue;
    const d = new Date(row.paid_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(row.amount_inr ?? 0));
  }
  const realMonths = [...byMonth.entries()].map(([key, revenue]) => {
    const [y, m] = key.split("-").map(Number);
    return { month: new Date(y, m, 1).toLocaleString("en-US", { month: "short", year: "2-digit" }), revenue };
  });
  const finance = financeSummary(realMonths);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Chess Academy Platform";
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary");
  summary.columns = [{ header: "Metric", key: "k", width: 28 }, { header: "Value (₹)", key: "v", width: 20 }];
  summary.addRows([
    { k: "Total Revenue (12mo)", v: Math.round(finance.totalRevenue) },
    { k: "Coach Earnings", v: Math.round(finance.coachEarnings) },
    { k: "Platform Deductions", v: Math.round(finance.platformDeductions) },
    { k: "Net Profit", v: Math.round(finance.netProfit) },
    { k: "Last-month change", v: `${finance.revenueChangePct.toFixed(1)}%` },
    { k: "Data source", v: finance.isDemo ? "Demo (no paid invoices yet)" : "Live invoices" },
  ]);
  summary.getRow(1).font = { bold: true };

  const revenue = wb.addWorksheet("Revenue by Month");
  revenue.columns = [{ header: "Month", key: "month", width: 14 }, { header: "Revenue (₹)", key: "revenue", width: 16 }];
  revenue.addRows(finance.months);
  revenue.getRow(1).font = { bold: true };

  const inv = wb.addWorksheet("Invoices");
  inv.columns = [
    { header: "Student", key: "student", width: 24 }, { header: "Description", key: "desc", width: 30 },
    { header: "Amount (₹)", key: "amount", width: 14 }, { header: "Status", key: "status", width: 12 },
    { header: "Due", key: "due", width: 14 }, { header: "Paid", key: "paid", width: 14 },
  ];
  for (const row of invoices.data ?? []) {
    inv.addRow({
      student: (row.student as unknown as { display_name: string } | null)?.display_name ?? "",
      desc: row.description, amount: Number(row.amount_inr), status: row.status,
      due: row.due_at ? new Date(row.due_at).toLocaleDateString() : "",
      paid: row.paid_at ? new Date(row.paid_at).toLocaleDateString() : "",
    });
  }
  inv.getRow(1).font = { bold: true };

  const subSheet = wb.addWorksheet("Subscriptions");
  subSheet.columns = [
    { header: "Amount (₹)", key: "amount", width: 14 }, { header: "Interval", key: "interval", width: 12 },
    { header: "Status", key: "status", width: 12 }, { header: "Since", key: "since", width: 14 },
  ];
  for (const row of subs.data ?? []) {
    subSheet.addRow({
      amount: Number(row.amount_inr), interval: row.billing_interval, status: row.status,
      since: row.created_at ? new Date(row.created_at).toLocaleDateString() : "",
    });
  }
  subSheet.getRow(1).font = { bold: true };

  const pen = wb.addWorksheet("Coach Penalties");
  pen.columns = [
    { header: "Coach", key: "coach", width: 22 }, { header: "Reason", key: "reason", width: 26 },
    { header: "Amount (₹)", key: "amount", width: 14 }, { header: "Status", key: "status", width: 12 },
    { header: "Date", key: "date", width: 14 },
  ];
  for (const row of penalties.data ?? []) {
    pen.addRow({
      coach: (row.coach as unknown as { display_name: string } | null)?.display_name ?? "",
      reason: row.custom_reason || row.category, amount: Number(row.amount), status: row.status,
      date: row.created_at ? new Date(row.created_at).toLocaleDateString() : "",
    });
  }
  pen.getRow(1).font = { bold: true };

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="finance-export-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
