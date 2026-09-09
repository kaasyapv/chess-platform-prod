import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, StatusPill } from "@/components/ui";
import { ExternalTracker } from "./external-tracker";

/* Report - platform-sections.md #15. Academy analytics
 * for staff + recent audit-log entries (RLS: audit visible to ceo/manager). */
export default async function ReportPage({
  params,
}: { params: Promise<{ role: string; academyId: string }> }) {
  const { role, academyId } = await params;
  await requireProfile(role, academyId);

  const supabase = await createClient();
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [students, batches, classesMonth, attendance, submissions, points, audit] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student").eq("status", "active"),
    supabase.from("batches").select("id", { count: "exact", head: true }),
    supabase.from("classrooms").select("id", { count: "exact", head: true }).gte("scheduled_at", monthStart.toISOString()),
    supabase.from("attendance_records").select("status").gte("on_date", monthStart.toISOString().slice(0, 10)),
    supabase.from("homework_submissions").select("status"),
    supabase.from("points_ledger").select("points"),
    supabase.from("audit_log").select("table_name, action, actor_id, created_at").order("created_at", { ascending: false }).limit(25),
  ]);

  const att = attendance.data ?? [];
  const attRate = att.length ? Math.round((att.filter((a) => a.status === "present").length / att.length) * 100) : null;
  const subs = submissions.data ?? [];
  const hwRate = subs.length ? Math.round((subs.filter((s) => s.status === "reviewed").length / subs.length) * 100) : null;
  const totalPoints = (points.data ?? []).reduce((n, p) => n + p.points, 0);

  const stats = [
    { label: "Active students", value: students.count ?? 0 },
    { label: "Batches", value: batches.count ?? 0 },
    { label: "Classes this month", value: classesMonth.count ?? 0 },
    { label: "Attendance rate (month)", value: attRate == null ? "" : `${attRate}%` },
    { label: "Homework reviewed", value: hwRate == null ? "" : `${hwRate}%` },
    { label: "Points awarded (all time)", value: totalPoints },
  ];

  return (
    <div>
      <PageHeader title="Report" subtitle="Academy analytics and audit trail" />
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        {stats.map((s) => (
          <Card key={s.label}>
            <p className="text-3xl font-bold">{s.value}</p>
            <p className="text-sm text-muted-foreground mt-1">{s.label}</p>
          </Card>
        ))}
      </div>

      <h2 className="text-lg font-medium mb-3">Recent activity (audit log)</h2>
      {(audit.data ?? []).length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No audit entries visible. The audit trail is restricted to CEO and Manager roles.
        </p>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-4 py-2">When</th><th className="px-4 py-2">Table</th><th className="px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {(audit.data ?? []).map((a, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 text-muted-foreground">{new Date(a.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2">{a.table_name}</td>
                  <td className="px-4 py-2"><StatusPill status={a.action.toLowerCase()} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ExternalTracker role={role} academyId={academyId} />
    </div>
  );
}
