import { createClient } from "@/lib/supabase/server";

/** Public parent-shareable student report. Anonymous read through
 *  shared_student_report(slug) - the slug has to be *presented*, so the table
 *  itself stays member-only and cannot be listed with the anon key
 *  (0027_audit_hardening.sql). Renders the snapshot taken at share time - no
 *  live academy data is reachable from this page. */

type Snapshot = {
  student_name: string;
  academy_name: string;
  generated_at: string;
  attendance_rate: number | null;
  total_points: number;
  homework: { total: number; reviewed: number; avg_score: number | null };
  recent: { title: string; score: number | null; status: string; at: string }[];
};

export default async function ShareReportPage({
  params,
}: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: rows } = await supabase.rpc("shared_student_report", { p_slug: slug });
  const data = (rows as { snapshot: unknown; created_at: string }[] | null)?.[0];

  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-xl font-semibold mb-2">Report not found</h1>
          <p className="text-muted-foreground">This link may be invalid or expired.</p>
        </div>
      </main>
    );
  }
  const s = data.snapshot as Snapshot;
  const stats = [
    { label: "Attendance", value: s.attendance_rate != null ? `${s.attendance_rate}%` : "" },
    { label: "Total points", value: String(s.total_points) },
    { label: "Homework done", value: `${s.homework.reviewed}/${s.homework.total}` },
    { label: "Avg score", value: s.homework.avg_score != null ? String(s.homework.avg_score) : "" },
  ];

  return (
    <main className="min-h-screen max-w-2xl mx-auto p-6 sm:p-10">
      <p className="text-sm text-muted-foreground mb-1">{s.academy_name} · Student progress report</p>
      <h1 className="text-3xl font-bold tracking-tight mb-1">{s.student_name}</h1>
      <p className="text-xs text-muted-foreground mb-8">
        Generated {new Date(s.generated_at).toLocaleDateString()}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {stats.map((st) => (
          <div key={st.label} className="bg-surface-2 border border-border rounded-card p-4">
            <p className="text-2xl font-bold tabular-nums">{st.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{st.label}</p>
          </div>
        ))}
      </div>

      <h2 className="font-semibold mb-3">Recent quizzes & homework</h2>
      {s.recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <div className="bg-surface-2 border border-border rounded-card overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {s.recent.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">{r.title}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{new Date(r.at).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 capitalize">{r.status}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                    {r.score != null ? `${r.score} pts` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-8">
        Shared read-only report · ChessAcademy
      </p>
    </main>
  );
}
