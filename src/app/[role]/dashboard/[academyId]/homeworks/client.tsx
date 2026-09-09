"use client";

import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import type { Profile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { ChessBoard } from "@/components/board/chess-board";
import {
  Button, EmptyState, Input, Modal, PageHeader, Person, RowMenu,
  SegmentedTabs, Select, StatusPill,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";

type HwContent = {
  instructions?: string; positions?: string[];
  attempts?: number; time_limit_minutes?: number; points?: number;
  classroom_id?: string; // set when created from a live class ("instant quiz")
};
type HwAnswers = {
  text?: string; moves?: { fen: string; san: string | null }[];
  attempts?: number; took_seconds?: number;
};
export type Assignment = {
  id: string; title: string; content: HwContent; status: string;
  due_at: string | null; created_at: string;
  student_id: string | null;
  batch: { name: string } | null;
  student: { display_name: string } | null;
  /** PostgREST count embed - staff oversight only; a student's own RLS makes
   *  this their own submission, which is why the column is staff-gated. */
  submissions: { count: number }[];
};
export type Template = { id: string; title: string; content: HwContent; created_at: string };
export type Submission = {
  id: string; assignment_id?: string; answers: Record<string, unknown>; status: string;
  review_note: string | null; score: number | null; submitted_at: string;
  student_id: string;
  student: { display_name: string; avatar: string | null } | null;
  assignment: { title: string } | null;
};

const STATUS_PILLS = ["All", "Draft", "Archived", "Active", "Completed", "Overdue"];
// Draft and archived assignments are not readable by a student at all (the
// hw_assign_student_read policy lists the three live statuses), so offering
// them those two filters is offering two buttons that always empty the table.
const STUDENT_STATUS_PILLS = STATUS_PILLS.filter((s) => s !== "Draft" && s !== "Archived");

export function HomeworksClient({
  me, isStaff, initialAssignments, initialTemplates, initialSubmissions, batches, students,
}: {
  me: Profile; isStaff: boolean;
  initialAssignments: Assignment[];
  initialTemplates: Template[];
  initialSubmissions: Submission[];
  batches: { id: string; name: string }[];
  students: { id: string; display_name: string }[];
}) {
  const supabase = createClient();
  const toast = useToast();
  const [tab, setTab] = useState("Assignments");
  const [assignments, setAssignments] = useState(initialAssignments);
  const [templates, setTemplates] = useState(initialTemplates);
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [statusFilter, setStatusFilter] = useState("All");

  const emptyForm = {
    title: "", instructions: "", batch_id: "", student_id: "", due_at: "", positions: "",
    template_id: "", attempts: "1", time_limit: "", points: "10",
  };
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [pgnLib, setPgnLib] = useState<{ id: string; title: string; content: string }[]>([]);

  // PGN library for "pick PGNs" in quiz creation (demo §9:18)
  useEffect(() => {
    if (!isStaff || !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) return;
    supabase.from("pgns").select("id, title, content").order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => setPgnLib(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff]);

  /** Append the selected library PGN's final position as a quiz FEN. */
  function addPgnPosition(id: string) {
    const p = pgnLib.find((x) => x.id === id);
    if (!p) return;
    try {
      const c = new Chess();
      c.loadPgn(p.content);
      setForm((f) => ({ ...f, positions: (f.positions ? f.positions + "\n" : "") + c.fen() }));
      toast(`Added final position of "${p.title}"`, "success");
    } catch {
      toast("Could not parse that PGN", "error");
    }
  }
  const [tplModal, setTplModal] = useState(false);
  const [tplEdit, setTplEdit] = useState<Template | null>(null);
  const [tplForm, setTplForm] = useState({ title: "", instructions: "", positions: "" });

  async function refetch() {
    const [a, t, s] = await Promise.all([
      supabase.from("homework_assignments")
        .select("id, title, content, status, due_at, created_at, student_id, batch:batches!batch_id(name), student:profiles!student_id(display_name), submissions:homework_submissions(count)")
        .eq("academy_id", me.academy_id).order("created_at", { ascending: false }),
      supabase.from("homework_templates")
        .select("id, title, content, created_at")
        .eq("academy_id", me.academy_id).order("created_at", { ascending: false }),
      (() => {
        const q = supabase.from("homework_submissions")
          .select("id, assignment_id, answers, status, review_note, score, submitted_at, student_id, student:profiles!student_id(display_name, avatar), assignment:homework_assignments!assignment_id(title)")
          .order("submitted_at", { ascending: false });
        return isStaff ? q.eq("status", "submitted") : q.eq("student_id", me.id);
      })(),
    ]);
    setAssignments((a.data ?? []) as unknown as Assignment[]);
    setTemplates((t.data ?? []) as Template[]);
    setSubmissions((s.data ?? []) as unknown as Submission[]);
  }

  const shownAssignments = useMemo(
    () => assignments.filter((a) => statusFilter === "All" || a.status === statusFilter.toLowerCase()),
    [assignments, statusFilter],
  );

  function applyTemplate(id: string) {
    const tpl = templates.find((t) => t.id === id);
    setForm((f) => ({
      ...f,
      template_id: id,
      ...(tpl ? {
        title: f.title || tpl.title,
        instructions: tpl.content.instructions ?? f.instructions,
        positions: (tpl.content.positions ?? []).join("\n") || f.positions,
      } : {}),
    }));
  }

  /** Notify the assignment's audience: the named student, else the batch's
   *  members, else every active student in the academy. */
  async function notifyStudents(title: string, batchId: string | null, studentId: string | null) {
    let studentIds: string[] = [];
    if (studentId) {
      studentIds = [studentId];
    } else if (batchId) {
      const { data } = await supabase.from("batch_members").select("student_id").eq("batch_id", batchId);
      studentIds = (data ?? []).map((m) => m.student_id);
    } else {
      const { data } = await supabase.from("profiles").select("id")
        .eq("academy_id", me.academy_id).eq("role", "student").eq("status", "active");
      studentIds = (data ?? []).map((p) => p.id);
    }
    if (studentIds.length === 0) return;
    const { error } = await supabase.from("notifications").insert(studentIds.map((id) => ({
      academy_id: me.academy_id, user_id: id,
      title: "New homework assigned", body: title,
    })));
    if (error) console.error("notify:", error.message);
  }

  async function createAssignment() {
    if (!form.title.trim()) return toast("Title is required", "error");
    const positions = form.positions.split("\n").map((l) => l.trim()).filter(Boolean);
    const { error } = await supabase.from("homework_assignments").insert({
      academy_id: me.academy_id,
      title: form.title.trim(),
      content: {
        instructions: form.instructions, positions,
        attempts: Math.max(1, parseInt(form.attempts, 10) || 1),
        time_limit_minutes: form.time_limit ? Math.max(1, parseInt(form.time_limit, 10)) : undefined,
        points: form.points ? Math.max(0, parseInt(form.points, 10)) : undefined,
      },
      // A named student wins over a batch - picking both would be ambiguous,
      // and the picker below clears one when the other is chosen.
      student_id: form.student_id || null,
      batch_id: form.student_id ? null : form.batch_id || null,
      due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
      template_id: form.template_id || null,
      status: "active",
      created_by: me.id,
    });
    if (error) return toast(error.message, "error");
    void notifyStudents(form.title.trim(), form.batch_id || null, form.student_id || null);
    setCreateOpen(false); setForm(emptyForm);
    toast("Assignment created", "success");
    refetch();
  }

  async function setAssignmentStatus(a: Assignment, status: string) {
    const { error } = await supabase.from("homework_assignments").update({ status }).eq("id", a.id);
    if (error) return toast(error.message, "error");
    toast(`Assignment ${status}`, "success");
    refetch();
  }

  async function deleteAssignment(a: Assignment) {
    const { error } = await supabase.from("homework_assignments").delete().eq("id", a.id);
    if (error) return toast(error.message, "error");
    toast("Assignment deleted", "success");
    refetch();
  }

  async function saveTemplate() {
    if (!tplForm.title.trim()) return toast("Title is required", "error");
    const content = {
      instructions: tplForm.instructions,
      positions: tplForm.positions.split("\n").map((l) => l.trim()).filter(Boolean),
    };
    const { error } = tplEdit
      ? await supabase.from("homework_templates")
          .update({ title: tplForm.title.trim(), content }).eq("id", tplEdit.id)
      : await supabase.from("homework_templates").insert({
          academy_id: me.academy_id, title: tplForm.title.trim(), content, created_by: me.id,
        });
    if (error) return toast(error.message, "error");
    setTplModal(false); setTplEdit(null);
    toast(tplEdit ? "Template updated" : "Template created", "success");
    refetch();
  }

  async function deleteTemplate(t: Template) {
    const { error } = await supabase.from("homework_templates").delete().eq("id", t.id);
    if (error) return toast(error.message, "error");
    toast("Template deleted", "success");
    refetch();
  }

  // ── Review queue ──
  const [reviews, setReviews] = useState<Record<string, { note: string; score: string }>>({});

  async function markReviewed(s: Submission) {
    const r = reviews[s.id] ?? { note: "", score: "" };
    const score = r.score ? parseInt(r.score, 10) : null;
    const { error } = await supabase.from("homework_submissions").update({
      status: "reviewed", review_note: r.note || null, score,
      reviewed_at: new Date().toISOString(),
    }).eq("id", s.id);
    if (error) return toast(error.message, "error");
    supabase.from("notifications").insert({
      academy_id: me.academy_id, user_id: s.student_id,
      title: "Homework reviewed",
      body: `${s.assignment?.title ?? "Your homework"}${r.score ? ` (score ${r.score})` : ""}`,
    }).then(({ error: nErr }) => { if (nErr) console.error("notify:", nErr.message); });
    if (score && score > 0) {
      const { error: pErr } = await supabase.from("points_ledger").insert({
        academy_id: me.academy_id, student_id: s.student_id,
        points: score, coins: 0, reason: "homework",
      });
      if (pErr) toast(`Reviewed, but points failed: ${pErr.message}`, "error");
      else toast(`Reviewed: ${score} points awarded`, "success");
    } else {
      toast("Marked reviewed", "success");
    }
    refetch();
  }

  const fmtDue = (d: string | null) =>
    d ? new Date(d).toLocaleString("en", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "No due date";

  // ── Student solve & submit ──
  const [solving, setSolving] = useState<Assignment | null>(null);
  const [solveMoves, setSolveMoves] = useState<Record<number, string>>({}); // position idx → SAN
  const [solveText, setSolveText] = useState("");
  const [solveStart, setSolveStart] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null); // seconds left (timed quizzes)
  const mySubmissionFor = (assignmentId: string) =>
    submissions.find((s) => s.assignment_id === assignmentId && s.student_id === me.id);

  function openSolve(a: Assignment) {
    const existing = mySubmissionFor(a.id);
    const prior = (existing?.answers ?? {}) as HwAnswers;
    const maxAttempts = a.content.attempts ?? Infinity;
    if ((prior.attempts ?? 0) >= maxAttempts) {
      toast(`No attempts left (${maxAttempts} allowed)`, "error");
      return;
    }
    const moves: Record<number, string> = {};
    (a.content.positions ?? []).forEach((fen, i) => {
      const m = prior.moves?.find((x) => x.fen === fen);
      if (m?.san) moves[i] = m.san;
    });
    setSolveMoves(moves);
    setSolveText(prior.text ?? "");
    setSolveStart(Date.now());
    setRemaining(a.content.time_limit_minutes ? a.content.time_limit_minutes * 60 : null);
    setSolving(a);
  }

  // Quiz countdown - auto-submits when time runs out (demo §10:06)
  useEffect(() => {
    if (!solving || remaining == null) return;
    if (remaining <= 0) {
      toast("Time's up, submitting your answers", "info");
      void submitHomework();
      return;
    }
    const id = setTimeout(() => setRemaining((r) => (r == null ? null : r - 1)), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, solving]);

  function onSolveMove(idx: number, fen: string, from: string, to: string) {
    try {
      const c = new Chess(fen);
      const piece = c.get(from as Parameters<Chess["get"]>[0]);
      const needsPromo = piece?.type === "p" && (to[1] === "8" || to[1] === "1");
      const move = c.move({ from, to, promotion: needsPromo ? "q" : undefined });
      setSolveMoves((m) => ({ ...m, [idx]: move.san }));
    } catch {
      toast("Illegal move", "error");
    }
  }

  async function submitHomework() {
    if (!solving) return;
    const positions = solving.content.positions ?? [];
    const prior = (mySubmissionFor(solving.id)?.answers ?? {}) as HwAnswers;
    const answers: HwAnswers = {
      text: solveText.trim() || undefined,
      moves: positions.map((fen, i) => ({ fen, san: solveMoves[i] ?? null })),
      attempts: (prior.attempts ?? 0) + 1,
      took_seconds: Math.round((Date.now() - solveStart) / 1000),
    };
    const { error } = await supabase.from("homework_submissions").upsert({
      assignment_id: solving.id, student_id: me.id,
      answers, status: "submitted", submitted_at: new Date().toISOString(),
    }, { onConflict: "assignment_id,student_id" });
    if (error) return toast(error.message, "error");
    void logActivity(me.academy_id, me.id, "homework_submit", { detail: solving.title });
    toast("Homework submitted", "success");
    setSolving(null);
    refetch();
  }

  return (
    <div>
      <PageHeader
        title="Homework"
        subtitle="Create and manage homework assignments and reusable templates"
        action={isStaff && (tab === "Templates"
          ? <Button onClick={() => { setTplEdit(null); setTplForm({ title: "", instructions: "", positions: "" }); setTplModal(true); }}>+ Create Template</Button>
          : <Button onClick={() => setCreateOpen(true)}>+ Create Assignment</Button>)}
      />
      <div className="mb-4">
        <SegmentedTabs
          tabs={isStaff ? ["Assignments", "Templates", "Review Queue"] : ["Assignments", "My Submissions"]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === "Assignments" && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {(isStaff ? STATUS_PILLS : STUDENT_STATUS_PILLS).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  statusFilter === s ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:text-foreground"
                }`}>
                {s}
              </button>
            ))}
          </div>
          {shownAssignments.length === 0 ? (
            <EmptyState text="No assignments here yet."
              action={isStaff && <Button onClick={() => setCreateOpen(true)}>+ Create Assignment</Button>} />
          ) : (
            <div className="bg-surface-2 border border-border rounded-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="px-4 py-3 font-medium">Title</th>
                    <th className="px-4 py-3 font-medium">Assigned to</th>
                    <th className="px-4 py-3 font-medium">Due</th>
                    <th className="px-4 py-3 font-medium">Positions</th>
                    {isStaff && <th className="px-4 py-3 font-medium">Submitted</th>}
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shownAssignments.map((a) => (
                    <tr key={a.id} className="border-b border-border last:border-0 hover:bg-surface-3/50">
                      <td className="px-4 py-3 font-medium">{a.title}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {a.student?.display_name ?? a.batch?.name ?? "Whole academy"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDue(a.due_at)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {a.content?.positions?.length ?? 0}
                        {a.content?.points != null && <> · {a.content.points} pts</>}
                        {a.content?.attempts != null && <> · {a.content.attempts} tr{a.content.attempts === 1 ? "y" : "ies"}</>}
                        {a.content?.time_limit_minutes != null && <> · {a.content.time_limit_minutes}m</>}
                      </td>
                      {isStaff && (
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">
                          {a.submissions?.[0]?.count ?? 0}
                        </td>
                      )}
                      <td className="px-4 py-3"><StatusPill status={a.status} /></td>
                      {isStaff ? (
                        <td className="px-4 py-3 text-right">
                          <RowMenu items={[
                            ...(a.status === "draft" ? [{ label: "Activate", onClick: () => setAssignmentStatus(a, "active") }] : []),
                            ...(a.status === "active" ? [{ label: "Mark completed", onClick: () => setAssignmentStatus(a, "completed") }] : []),
                            ...(a.status !== "archived" ? [{ label: "Archive", onClick: () => setAssignmentStatus(a, "archived") }] : []),
                            { label: "Delete", onClick: () => deleteAssignment(a), danger: true },
                          ]} />
                        </td>
                      ) : (
                        <td className="px-4 py-3 text-right">
                          {a.status === "active" || a.status === "overdue" ? (
                            <Button onClick={() => openSolve(a)}>
                              {mySubmissionFor(a.id) ? "Edit answers" : "Solve"}
                            </Button>
                          ) : mySubmissionFor(a.id) ? (
                            <StatusPill status={mySubmissionFor(a.id)!.status} />
                          ) : null}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "Templates" && (
        templates.length === 0 ? (
          <EmptyState text="No templates yet. Save reusable homework as templates."
            action={isStaff && <Button onClick={() => { setTplEdit(null); setTplForm({ title: "", instructions: "", positions: "" }); setTplModal(true); }}>+ Create Template</Button>} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((t) => (
              <div key={t.id} className="bg-surface-2 border border-border rounded-card p-5">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold">{t.title}</h3>
                  {isStaff && (
                    <RowMenu items={[
                      { label: "Edit", onClick: () => {
                        setTplEdit(t);
                        setTplForm({
                          title: t.title,
                          instructions: t.content.instructions ?? "",
                          positions: (t.content.positions ?? []).join("\n"),
                        });
                        setTplModal(true);
                      } },
                      { label: "Delete", onClick: () => deleteTemplate(t), danger: true },
                    ]} />
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {t.content.instructions || "No instructions"}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  {t.content.positions?.length ?? 0} position{(t.content.positions?.length ?? 0) === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
        )
      )}

      {tab === "My Submissions" && !isStaff && (
        submissions.length === 0 ? (
          <EmptyState text="No submissions yet. Open an active assignment and hit Solve." />
        ) : (
          <div className="space-y-3">
            {submissions.map((s) => (
              <div key={s.id} className="bg-surface-2 border border-border rounded-card p-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-48">
                  <p className="font-medium">{s.assignment?.title ?? "Assignment"}</p>
                  <p className="text-sm text-muted-foreground">
                    Submitted {new Date(s.submitted_at).toLocaleString()}
                  </p>
                  {s.review_note && (
                    <p className="text-sm mt-1"><span className="text-muted-foreground">Coach feedback:</span> {s.review_note}</p>
                  )}
                </div>
                {s.score != null && <span className="font-semibold tabular-nums">{s.score} pts</span>}
                <StatusPill status={s.status} />
              </div>
            ))}
          </div>
        )
      )}

      {tab === "Review Queue" && (
        submissions.length === 0 ? (
          <EmptyState text="Review queue is empty. Submitted homework will appear here." />
        ) : (
          <div className="space-y-4">
            {submissions.map((s) => {
              const r = reviews[s.id] ?? { note: "", score: "" };
              return (
                <div key={s.id} className="bg-surface-2 border border-border rounded-card p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div>
                      <Person id={s.student_id} name={s.student?.display_name ?? "Student"} avatar={s.student?.avatar} role="student" size={30} className="font-medium" />
                      <div className="text-sm text-muted-foreground">
                        {s.assignment?.title ?? "Assignment"} · submitted {new Date(s.submitted_at).toLocaleDateString()}
                      </div>
                    </div>
                    <span className="ml-auto flex items-center gap-3">
                      {(() => {
                        const a = s.answers as HwAnswers;
                        return (
                          <span className="text-xs text-muted-foreground">
                            {a.attempts != null && <>{a.attempts} attempt{a.attempts === 1 ? "" : "s"}</>}
                            {a.took_seconds != null && <> · took {Math.floor(a.took_seconds / 60)}m {a.took_seconds % 60}s</>}
                          </span>
                        );
                      })()}
                      <StatusPill status={s.status} />
                    </span>
                  </div>
                  <pre className="bg-surface-3 border border-border rounded-btn p-3 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {JSON.stringify(s.answers, null, 2)}
                  </pre>
                  <div className="flex flex-wrap items-end gap-3 mt-3">
                    <label className="block text-sm flex-1 min-w-48">
                      <span className="text-muted-foreground">Review note</span>
                      <Input className="w-full mt-1" value={r.note} placeholder="Feedback for the student…"
                        onChange={(e) => setReviews({ ...reviews, [s.id]: { ...r, note: e.target.value } })} />
                    </label>
                    <label className="block text-sm w-28">
                      <span className="text-muted-foreground">Score (pts)</span>
                      <Input className="w-full mt-1" type="number" min={0} value={r.score}
                        onChange={(e) => setReviews({ ...reviews, [s.id]: { ...r, score: e.target.value } })} />
                    </label>
                    <Button onClick={() => markReviewed(s)}>Mark Reviewed</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Student solve & submit */}
      <Modal open={!!solving} onClose={() => setSolving(null)} title={solving?.title ?? "Homework"} wide>
        {solving && (
          <div className="space-y-5">
            {remaining != null && (
              <p className={`text-sm font-semibold tabular-nums ${remaining <= 30 ? "text-destructive" : "text-warning"}`}>
                ⏱ {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")} remaining
              </p>
            )}
            {solving.content.instructions && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{solving.content.instructions}</p>
            )}
            {(solving.content.positions ?? []).map((fen, i) => (
              <div key={i} className="space-y-2">
                <p className="text-sm font-medium">
                  Position {i + 1}
                  {solveMoves[i]
                    ? <span className="text-success ml-2">your answer: {solveMoves[i]}</span>
                    : <span className="text-muted-foreground ml-2">play your best move on the board</span>}
                </p>
                <div className="w-72 aspect-square">
                  <ChessBoard
                    fen={fen}
                    movable
                    boardTheme={(me.board_settings?.boardTheme as string) ?? "club-green"}
                    pieceSet={(me.board_settings?.pieceSet as string) ?? "loco"}
                    onMove={(from, to) => onSolveMove(i, fen, from, to)}
                  />
                </div>
                {solveMoves[i] && (
                  <Button variant="ghost" onClick={() => setSolveMoves((m) => { const n = { ...m }; delete n[i]; return n; })}>
                    Retry position
                  </Button>
                )}
              </div>
            ))}
            <label className="block text-sm">
              <span className="text-muted-foreground">Notes for your coach (optional)</span>
              <textarea
                className="w-full mt-1 bg-surface-2 border border-border rounded-btn px-3 py-2 outline-none focus:ring-2 focus:ring-ring min-h-16"
                value={solveText}
                onChange={(e) => setSolveText(e.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSolving(null)}>Cancel</Button>
              <Button onClick={submitHomework}>Submit homework</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Create assignment */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Assignment" wide>
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-muted-foreground">Create from template</span>
            <Select className="w-full mt-1" value={form.template_id} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">Start blank</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </Select>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Title</span>
            <Input className="w-full mt-1" value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Instructions</span>
            <textarea
              className="w-full mt-1 bg-surface-2 border border-border rounded-btn px-3 py-2 outline-none focus:ring-2 focus:ring-ring min-h-20"
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-muted-foreground">Batch</span>
              <Select className="w-full mt-1" value={form.batch_id}
                disabled={!!form.student_id}
                onChange={(e) => setForm({ ...form, batch_id: e.target.value })}>
                <option value="">Whole academy</option>
                {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Or one student</span>
              <Select className="w-full mt-1" value={form.student_id}
                onChange={(e) => setForm({ ...form, student_id: e.target.value, batch_id: e.target.value ? "" : form.batch_id })}>
                <option value="">Everyone above</option>
                {students.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
              </Select>
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-muted-foreground">Due date</span>
            <Input className="w-full mt-1" type="datetime-local" value={form.due_at}
              onChange={(e) => setForm({ ...form, due_at: e.target.value })} />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="text-muted-foreground">Attempts</span>
              <Input className="w-full mt-1" type="number" min={1} value={form.attempts}
                onChange={(e) => setForm({ ...form, attempts: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Time limit (min)</span>
              <Input className="w-full mt-1" type="number" min={1} placeholder="none" value={form.time_limit}
                onChange={(e) => setForm({ ...form, time_limit: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Total points</span>
              <Input className="w-full mt-1" type="number" min={0} value={form.points}
                onChange={(e) => setForm({ ...form, points: e.target.value })} />
            </label>
          </div>
          {pgnLib.length > 0 && (
            <label className="block text-sm">
              <span className="text-muted-foreground">Add position from PGN library</span>
              <Select className="w-full mt-1" value="" onChange={(e) => e.target.value && addPgnPosition(e.target.value)}>
                <option value="">Pick a PGN: its final position is appended below</option>
                {pgnLib.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </Select>
            </label>
          )}
          <label className="block text-sm">
            <span className="text-muted-foreground">Positions (one FEN per line, optional)</span>
            <textarea
              className="w-full mt-1 bg-surface-2 border border-border rounded-btn px-3 py-2 outline-none focus:ring-2 focus:ring-ring min-h-20 font-mono text-xs"
              placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
              value={form.positions}
              onChange={(e) => setForm({ ...form, positions: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createAssignment}>Create</Button>
          </div>
        </div>
      </Modal>

      {/* Template modal */}
      <Modal open={tplModal} onClose={() => setTplModal(false)} title={tplEdit ? "Edit Template" : "Create Template"} wide>
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-muted-foreground">Title</span>
            <Input className="w-full mt-1" value={tplForm.title}
              onChange={(e) => setTplForm({ ...tplForm, title: e.target.value })} />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Instructions</span>
            <textarea
              className="w-full mt-1 bg-surface-2 border border-border rounded-btn px-3 py-2 outline-none focus:ring-2 focus:ring-ring min-h-20"
              value={tplForm.instructions}
              onChange={(e) => setTplForm({ ...tplForm, instructions: e.target.value })} />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Positions (one FEN per line)</span>
            <textarea
              className="w-full mt-1 bg-surface-2 border border-border rounded-btn px-3 py-2 outline-none focus:ring-2 focus:ring-ring min-h-20 font-mono text-xs"
              value={tplForm.positions}
              onChange={(e) => setTplForm({ ...tplForm, positions: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTplModal(false)}>Cancel</Button>
            <Button onClick={saveTemplate}>{tplEdit ? "Save" : "Create"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
