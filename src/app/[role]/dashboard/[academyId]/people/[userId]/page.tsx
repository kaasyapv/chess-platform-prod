import { redirect } from "next/navigation";
import { requireProfile, dashboardPath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { COACH_SHARE } from "@/lib/finance";
import { UserReportClient } from "./user-report-client";

/** Full Report - everything the academy knows about one person.
 *
 *  CEO and managers only. Salary/financial figures are CEO-only, and that is
 *  decided HERE, on the server: a manager's response never contains the
 *  numbers, so there is nothing for a hidden UI element or a devtools poke to
 *  reveal. The client component is given `showFinancials` and simply has no
 *  data to draw when it's false.
 */
export default async function UserReportPage({
  params,
}: { params: Promise<{ role: string; academyId: string; userId: string }> }) {
  const { role, academyId, userId } = await params;
  const me = await requireProfile(role, academyId);
  if (me.role !== "ceo" && me.role !== "manager") redirect(dashboardPath(me));

  const supabase = await createClient();
  const showFinancials = me.role === "ceo";

  const { data: person } = await supabase
    .from("profiles")
    .select("id, display_name, username, role, status, avatar, points, coins, created_at, coach_id")
    .eq("id", userId)
    .single();
  if (!person) redirect(`${`/${role}/dashboard/${academyId}`}/academy`);

  const now = new Date().toISOString();
  const isCoach = person.role === "coach";

  const [classesUpcoming, classesPast, attendance, penalties, , activity, batches] =
    await Promise.all([
      isCoach
        ? supabase.from("classrooms")
            .select("id, title, scheduled_at, status, duration_minutes")
            .eq("coach_id", userId).gte("scheduled_at", now)
            .order("scheduled_at").limit(25)
        : supabase.from("classroom_enrollments")
            .select("classroom:classrooms(id, title, scheduled_at, status, duration_minutes)")
            .eq("student_id", userId).limit(200),
      isCoach
        ? supabase.from("classrooms")
            .select("id, title, scheduled_at, status, duration_minutes")
            .eq("coach_id", userId).lt("scheduled_at", now)
            .order("scheduled_at", { ascending: false }).limit(50)
        : supabase.from("classroom_enrollments")
            .select("classroom:classrooms(id, title, scheduled_at, status, duration_minutes)")
            .eq("student_id", userId).limit(200),
      isCoach
        ? Promise.resolve({ data: [] })
        : supabase.from("attendance_records")
            .select("on_date, status").eq("student_id", userId)
            .order("on_date", { ascending: false }).limit(120),
      isCoach
        ? supabase.from("coach_penalties")
            .select("id, category, custom_reason, amount, status, created_at, appeal_reason")
            .eq("coach_id", userId).order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      // Placeholder slot - financials are fetched separately below so the coach
      // and student shapes don't collapse into one union type.
      Promise.resolve({ data: [] }),
      /* The audit log is per-day and has to hold a full day of heartbeats
       * (one a minute, so ~500 on a long day) plus the actions around them.
       * 200 rows silently truncated the most recent day to a couple of hours
       * and made the timeline look like the person had stopped working.
       *
       * CEO-only, decided here rather than in the UI: a manager's response
       * carries no timestamps at all, so there is nothing to reveal by poking
       * at the page. RLS agrees independently since 0035. */
      showFinancials
        ? supabase.from("activity_events")
            .select("id, kind, detail, seconds, created_at, classroom_id")
            .eq("profile_id", userId).order("created_at", { ascending: false }).limit(4000)
        : Promise.resolve({ data: [] }),
      supabase.from("batch_members")
        .select("batch:batches(id, name, category, total_classes)")
        .eq("student_id", userId),
    ]);

  /* Financials are CEO-only, so for a manager these queries never run at all -
   * the numbers aren't merely hidden in the UI, they're never fetched or sent.
   *
   * Coach pay is derived, not stored: the platform has no payouts table (see
   * lib/finance.ts), so it's completed classes x the agreed coach share of a
   * nominal fee, labelled an estimate in the UI so nobody reads it as payroll. */
  type StudentInvoice = {
    id: string; amount_inr: number; description: string;
    status: string; due_at: string | null; paid_at: string | null;
  };
  let financials: {
    isCoach: boolean; completedClasses: number; estimatedEarnings: number;
    penaltiesTotal: number; invoicesPaid: number; invoices: StudentInvoice[];
  } | null = null;

  if (showFinancials) {
    const penaltiesTotal = (penalties.data ?? [])
      .filter((p) => p.status !== "waived")
      .reduce((n, p) => n + Number(p.amount), 0);

    if (isCoach) {
      const { count } = await supabase
        .from("classrooms")
        .select("id", { count: "exact", head: true })
        .eq("coach_id", userId).eq("status", "completed");
      const completed = count ?? 0;
      financials = {
        isCoach: true, completedClasses: completed,
        estimatedEarnings: completed * 1500 * COACH_SHARE,
        penaltiesTotal, invoicesPaid: 0, invoices: [],
      };
    } else {
      const { data } = await supabase
        .from("invoices")
        .select("id, amount_inr, description, status, due_at, paid_at")
        .eq("student_id", userId).order("created_at", { ascending: false }).limit(50);
      const rows = (data ?? []) as StudentInvoice[];
      financials = {
        isCoach: false, completedClasses: 0, estimatedEarnings: 0, penaltiesTotal,
        invoices: rows,
        invoicesPaid: rows.filter((i) => i.status === "paid").reduce((n, i) => n + Number(i.amount_inr), 0),
      };
    }
  }

  const flatten = (rows: unknown[]) =>
    (rows ?? []).map((r) => {
      const row = r as { classroom?: unknown } & Record<string, unknown>;
      return (row.classroom ?? row) as {
        id: string; title: string; scheduled_at: string; status: string; duration_minutes: number;
      };
    }).filter(Boolean);

  const allEnrolled = flatten((classesUpcoming.data ?? []) as unknown[]);
  const upcoming = isCoach
    ? flatten((classesUpcoming.data ?? []) as unknown[])
    : allEnrolled.filter((c) => c.scheduled_at >= now).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).slice(0, 25);
  const past = isCoach
    ? flatten((classesPast.data ?? []) as unknown[])
    : flatten((classesPast.data ?? []) as unknown[])
        .filter((c) => c.scheduled_at < now)
        .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at)).slice(0, 50);

  return (
    <UserReportClient
      me={me}
      person={person}
      upcoming={upcoming}
      past={past}
      attendance={(attendance.data ?? []) as { on_date: string; status: string }[]}
      penalties={(penalties.data ?? []) as never[]}
      activity={(activity.data ?? []) as never[]}
      canSeeAuditLog={showFinancials}
      batches={(batches.data ?? []).map((b) => (b as { batch: unknown }).batch as { id: string; name: string; category: string | null; total_classes: number | null })}
      financials={financials}
    />
  );
}
