"use client";

/* Post-class review (ChessPlay demo §8:09) - completed classrooms show
 * Attendance / Quizzes / Student Solutions / Leaderboard tabs instead of the
 * live UI. Data: attendance_records on the class date, homework_assignments
 * tagged with this classroom_id (instant quizzes), their submissions. */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, EmptyState, PageHeader, SegmentedTabs, StatusPill } from "@/components/ui";

type Classroom = {
  id: string; title: string; scheduled_at: string; batch_id: string | null;
  started_at: string | null; ended_at: string | null;
  coach: { display_name: string } | null;
};
type Student = { id: string; display_name: string };
type AttRow = { student_id: string; status: string };
type Quiz = { id: string; title: string; status: string; created_at: string; content: { positions?: string[]; points?: number } };
type Sub = {
  id: string; assignment_id: string; student_id: string; status: string; score: number | null;
  submitted_at: string; answers: { moves?: { fen: string; san: string | null }[]; attempts?: number; took_seconds?: number };
};
// Live-classroom quiz (0037) + per-student answer (0043).
type LiveQuiz = { id: string; fen: string; answer: string; points: number; created_at: string };
type Response = { quiz_id: string; user_id: string; san: string | null; ms: number | null; is_correct: boolean | null; tries: number };

export function ClassroomReview({ classroom, academyId }: { classroom: Classroom; academyId: string }) {
  const [tab, setTab] = useState("Attendance");
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<AttRow[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [liveQuizzes, setLiveQuizzes] = useState<LiveQuiz[]>([]);
  const [responses, setResponses] = useState<Response[]>([]);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) return;
    const supabase = createClient();
    const onDate = new Date(classroom.scheduled_at).toISOString().slice(0, 10);
    (async () => {
      // Roster: batch members if the class had a batch, else all students
      let roster: Student[] = [];
      if (classroom.batch_id) {
        const { data } = await supabase
          .from("batch_members")
          .select("student:profiles!batch_members_student_id_fkey(id, display_name)")
          .eq("batch_id", classroom.batch_id);
        roster = (data ?? []).map((r) => r.student as unknown as Student).filter(Boolean);
      } else {
        const { data } = await supabase.from("profiles")
          .select("id, display_name").eq("role", "student").eq("academy_id", academyId);
        roster = data ?? [];
      }
      setStudents(roster);

      const [att, qz] = await Promise.all([
        supabase.from("attendance_records").select("student_id, status").eq("on_date", onDate),
        supabase.from("homework_assignments")
          .select("id, title, status, created_at, content")
          .eq("content->>classroom_id", classroom.id)
          .order("created_at"),
      ]);
      setAttendance(att.data ?? []);
      const quizRows = (qz.data ?? []) as Quiz[];
      setQuizzes(quizRows);
      if (quizRows.length) {
        const { data: s } = await supabase.from("homework_submissions")
          .select("id, assignment_id, student_id, status, score, submitted_at, answers")
          .in("assignment_id", quizRows.map((q) => q.id));
        setSubs((s ?? []) as Sub[]);
      }

      // Live-classroom quizzes (0037) + their per-student answers (0043).
      // Best-effort: quietly empty if the migrations aren't applied yet.
      const lq = await supabase.from("quizzes")
        .select("id, fen, answer, points, created_at")
        .eq("classroom_id", classroom.id).order("created_at");
      if (!lq.error && lq.data?.length) {
        setLiveQuizzes(lq.data as LiveQuiz[]);
        const rs = await supabase.from("classroom_responses")
          .select("quiz_id, user_id, san, ms, is_correct, tries")
          .eq("classroom_id", classroom.id);
        if (!rs.error) setResponses((rs.data ?? []) as Response[]);
      }
    })();
  }, [classroom.id, classroom.batch_id, classroom.scheduled_at, academyId]);

  const name = (id: string) => students.find((s) => s.id === id)?.display_name ?? "";

  // Leaderboard: total score across this class's quizzes
  const board = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of subs) totals.set(s.student_id, (totals.get(s.student_id) ?? 0) + (s.score ?? 0));
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [subs]);

  const duration = classroom.started_at && classroom.ended_at
    ? `${Math.round((+new Date(classroom.ended_at) - +new Date(classroom.started_at)) / 60000)} min`
    : null;

  return (
    <div>
      <PageHeader
        title={classroom.title}
        subtitle={`Completed session · ${new Date(classroom.scheduled_at).toLocaleString()} · Coach ${classroom.coach?.display_name ?? ""}${duration ? ` · ran ${duration}` : ""}`}
      />
      <div className="mb-4">
        <SegmentedTabs
          tabs={["Attendance", "Quizzes", "Student Solutions", ...(liveQuizzes.length ? ["Quiz Answers"] : []), "Leaderboard"]}
          active={tab} onChange={setTab}
        />
      </div>

      {tab === "Attendance" && (
        students.length === 0 ? <EmptyState text="No students on this class's roster." /> : (
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {students.map((s) => {
                  const rec = attendance.find((a) => a.student_id === s.id);
                  return (
                    <tr key={s.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5">{s.display_name}</td>
                      <td className="px-4 py-2.5 text-right">
                        <StatusPill status={rec?.status ?? "absent"} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )
      )}

      {tab === "Quizzes" && (
        quizzes.length === 0 ? <EmptyState text="No quizzes were created during this class." /> : (
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="px-4 py-2">Quiz</th><th className="px-4 py-2">Positions</th>
                  <th className="px-4 py-2">Submissions</th><th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {quizzes.map((q) => (
                  <tr key={q.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5">{q.title}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{q.content.positions?.length ?? 0}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{subs.filter((s) => s.assignment_id === q.id).length}</td>
                    <td className="px-4 py-2.5"><StatusPill status={q.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      )}

      {tab === "Student Solutions" && (
        subs.length === 0 ? <EmptyState text="No submissions yet." /> : (
          <div className="flex flex-col gap-3">
            {subs.map((s) => {
              const quiz = quizzes.find((q) => q.id === s.assignment_id);
              const maxPts = quiz?.content.points ?? null;
              return (
                <Card key={s.id}>
                  <div className="flex items-center gap-3 mb-2">
                    <p className="font-medium flex-1">{name(s.student_id)} <span className="text-muted-foreground">· {quiz?.title}</span></p>
                    {s.answers.attempts != null && <span className="text-xs text-muted-foreground">{s.answers.attempts} attempt{s.answers.attempts === 1 ? "" : "s"}</span>}
                    {s.answers.took_seconds != null && <span className="text-xs text-muted-foreground">{Math.round(s.answers.took_seconds / 60)}m {s.answers.took_seconds % 60}s</span>}
                    <StatusPill status={s.status} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(s.answers.moves ?? []).map((m, i) => (
                      // wrong/blank answers highlighted red (demo §8:35)
                      <span key={i}
                        className={`text-xs font-mono px-2 py-1 rounded-btn border ${
                          m.san ? "border-border bg-surface-3" : "border-destructive/40 bg-destructive/15 text-destructive"
                        }`}>
                        #{i + 1}: {m.san ?? "no answer"}
                      </span>
                    ))}
                  </div>
                  {s.score != null && (
                    <p className={`text-sm mt-2 font-medium ${maxPts != null && s.score < maxPts ? "text-destructive" : "text-success"}`}>
                      Score: {s.score}{maxPts != null ? ` / ${maxPts}` : ""}
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        )
      )}

      {tab === "Quiz Answers" && (
        <div className="flex flex-col gap-3">
          {liveQuizzes.map((q, qi) => {
            const rows = responses.filter((r) => r.quiz_id === q.id);
            return (
              <Card key={q.id}>
                <div className="mb-2 flex items-center gap-2">
                  <p className="font-medium">Question {qi + 1}</p>
                  {q.answer && <span className="text-xs font-mono text-muted-foreground">answer {q.answer}</span>}
                  <span className="flex-1" />
                  <span className="text-xs text-muted-foreground">{rows.length} answered · {q.points} pts</span>
                </div>
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No answers.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.user_id} className="border-b border-border last:border-0">
                          <td className="py-1.5">{name(r.user_id)}</td>
                          <td className="py-1.5 font-mono">{r.san ?? "—"}</td>
                          <td className="py-1.5 text-right text-muted-foreground tabular-nums">
                            {r.ms != null ? `${(r.ms / 1000).toFixed(1)}s` : ""}{r.tries > 1 ? ` · ${r.tries} tries` : ""}
                          </td>
                          <td className={`py-1.5 w-16 text-right text-xs font-medium ${
                            r.is_correct == null ? "text-muted-foreground" : r.is_correct ? "text-success" : "text-destructive"
                          }`}>
                            {r.is_correct == null ? "—" : r.is_correct ? "Correct" : "Wrong"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {tab === "Leaderboard" && (
        board.length === 0 ? <EmptyState text="No scores yet. Review submissions to award points." /> : (
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {board.map(([sid, pts], i) => (
                  <tr key={sid} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 w-10 font-bold text-muted-foreground">#{i + 1}</td>
                    <td className="px-4 py-2.5">{name(sid)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{pts} pts</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      )}
    </div>
  );
}
