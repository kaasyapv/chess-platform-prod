"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Profile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import {
  Button, EmptyState, Input, Modal, PageHeader, Person, RowMenu,
  SearchInput, SegmentedTabs, Select,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { StudentStats } from "./student-stats";

export type Classroom = {
  id: string; title: string; status: string; scheduled_at: string;
  duration_minutes: number; started_at: string | null; coach_id: string;
  batch_id: string | null; series_id: string | null; course_id: string | null;
  coach: { display_name: string; avatar: string | null } | null;
  classroom_enrollments: { count: number }[];
};
export type Series = {
  id: string; title: string; created_at: string;
  coach: { display_name: string; avatar: string | null } | null;
};

const TABS = ["Current", "Upcoming", "Delayed", "Completed"];

function tabOf(c: Classroom): string {
  if (c.status === "live") return "Current";
  if (c.status === "completed" || c.status === "cancelled") return "Completed";
  if (c.status === "delayed") return "Delayed";
  // scheduled: future → Upcoming, past-due → Delayed
  return new Date(c.scheduled_at) > new Date() ? "Upcoming" : "Delayed";
}

/** Shows how long a class has been running.
 *
 *  The clock must not run while the page is rendered on the server: the server
 *  would print one number and the browser another a second later, and React
 *  would report a hydration mismatch. So we render a fixed "0:00" first, and
 *  only start reading the real time once the component is mounted in the
 *  browser. The first tick happens right away, so nobody sees "0:00" for long. */
function ElapsedTimer({ since }: { since: string }) {
  const [secs, setSecs] = useState<number | null>(null);

  useEffect(() => {
    const read = () => setSecs(Math.max(0, Math.floor((Date.now() - +new Date(since)) / 1000)));
    read();
    const t = setInterval(read, 1000);
    return () => clearInterval(t);
  }, [since]);

  // Same markup on the server and on the first client render.
  const shown = secs ?? 0;
  const m = Math.floor(shown / 60), s = shown % 60;
  return (
    <span className="text-live font-mono text-sm" suppressHydrationWarning>
      {m}:{String(s).padStart(2, "0")} elapsed
    </span>
  );
}

export function ClassroomsClient({
  me, isStaff, canManageSchedule, canSelfSchedule, base, initialClasses, series, batches, courses, myStudents,
}: {
  me: Profile; isStaff: boolean;
  /** Client req #10/#11: only CEO/manager schedule/cancel/reschedule - coach
   *  still runs (Start/End) their own classes via the broader `isStaff`. */
  canManageSchedule: boolean;
  /** Migration 0041: a coach may schedule a 1:1 class for their own assigned
   *  students (no batch, coach_id forced to self). */
  canSelfSchedule: boolean;
  base: string;
  initialClasses: Classroom[]; series: Series[];
  batches: { id: string; name: string }[];
  courses: { id: string; title: string }[];
  myStudents: { id: string; display_name: string }[];
}) {
  const supabase = createClient();
  const toast = useToast();
  // Coach self-scheduling: the batch/coach pickers are replaced by a single
  // student picker, and the enrolment row is written alongside the class.
  const selfOnly = canSelfSchedule && !canManageSchedule;
  const canCreate = canManageSchedule || canSelfSchedule;
  const [classes, setClasses] = useState(initialClasses);
  const [tab, setTab] = useState("Current");
  const [view, setView] = useState("Session");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeCourses, setIncludeCourses] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: "", batch_id: "", course_id: "", scheduled_at: "", duration: "60", coach_id: "", meeting_url: "", student_id: "" });
  const [staffList, setStaffList] = useState<{ id: string; display_name: string }[]>([]);
  // Cancel / Reschedule (client req #11) - "cancel completely" just cancels;
  // "cancel with a reschedule" cancels the original and adds a new class
  // (the "extra class") as its replacement, so the cancellation stays on record.
  const [cancelTarget, setCancelTarget] = useState<Classroom | null>(null);
  const [cancelChoice, setCancelChoice] = useState<"complete" | "reschedule" | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState("");

  // Coach picker (admin can schedule classes for any coach - demo §3:29)
  useEffect(() => {
    if (!isStaff || !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) return;
    supabase.from("profiles").select("id, display_name")
      .eq("academy_id", me.academy_id).in("role", ["ceo", "manager", "coach"])
      .then(({ data }) => setStaffList(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff]);

  async function refetch() {
    const { data } = await supabase
      .from("classrooms")
      .select("id, title, status, scheduled_at, duration_minutes, started_at, coach_id, batch_id, series_id, course_id, coach:profiles!coach_id(display_name, avatar), classroom_enrollments(count)")
      .eq("academy_id", me.academy_id)
      .order("scheduled_at", { ascending: false });
    setClasses((data ?? []) as unknown as Classroom[]);
  }

  const shown = useMemo(() => classes.filter((c) => {
    if (tabOf(c) !== tab) return false;
    if (!includeCourses && c.course_id) return false;
    const q = search.trim().toLowerCase();
    if (q && !c.title.toLowerCase().includes(q)) return false;
    const d = new Date(c.scheduled_at);
    if (from && d < new Date(from)) return false;
    if (to && d > new Date(`${to}T23:59:59`)) return false;
    return true;
  }), [classes, tab, search, from, to, includeCourses]);

  const emptyForm = { title: "", batch_id: "", course_id: "", scheduled_at: "", duration: "60", coach_id: "", meeting_url: "", student_id: "" };

  async function createClassroom() {
    if (!form.title.trim() || !form.scheduled_at) return toast("Title and schedule are required", "error");
    if (selfOnly && !form.student_id) return toast("Pick a student", "error");
    const { data, error } = await supabase.from("classrooms").insert({
      academy_id: me.academy_id,
      title: form.title.trim(),
      coach_id: selfOnly ? me.id : (form.coach_id || me.id),
      batch_id: selfOnly ? null : (form.batch_id || null),
      course_id: form.course_id || null,
      scheduled_at: new Date(form.scheduled_at).toISOString(),
      duration_minutes: parseInt(form.duration, 10) || 60,
      meeting_url: form.meeting_url.trim() || null,
    }).select("id").single();
    if (error) return toast(error.message, "error");
    if (selfOnly && data) {
      const { error: enrollErr } = await supabase.from("classroom_enrollments")
        .insert({ classroom_id: data.id, student_id: form.student_id });
      if (enrollErr) return toast(`Class made, but enrolling the student failed: ${enrollErr.message}`, "error");
    }
    setCreateOpen(false);
    setForm(emptyForm);
    toast("Classroom created", "success");
    refetch();
  }

  async function setStatus(c: Classroom, status: string) {
    const patch: Record<string, unknown> = { status };
    if (status === "live") patch.started_at = new Date().toISOString();
    if (status === "completed") patch.ended_at = new Date().toISOString();
    const { error } = await supabase.from("classrooms").update(patch).eq("id", c.id);
    if (error) return toast(error.message, "error");
    toast(`Classroom ${status === "live" ? "started" : status}`, "success");
    refetch();
  }

  async function confirmCancel() {
    if (!cancelTarget || !cancelChoice) return;
    const { error: cancelErr } = await supabase.from("classrooms")
      .update({ status: "cancelled" }).eq("id", cancelTarget.id);
    if (cancelErr) return toast(cancelErr.message, "error");

    if (cancelChoice === "reschedule") {
      if (!rescheduleAt) return toast("Pick a new date/time", "error");
      const { error: insErr } = await supabase.from("classrooms").insert({
        academy_id: me.academy_id, title: cancelTarget.title, coach_id: cancelTarget.coach_id,
        batch_id: cancelTarget.batch_id, course_id: cancelTarget.course_id,
        scheduled_at: new Date(rescheduleAt).toISOString(),
        duration_minutes: cancelTarget.duration_minutes,
      });
      if (insErr) return toast(insErr.message, "error");
      toast("Class cancelled, replacement class scheduled", "success");
    } else {
      toast("Class cancelled", "success");
    }
    setCancelTarget(null); setCancelChoice(null); setRescheduleAt("");
    refetch();
  }

  async function deleteClassroom(c: Classroom) {
    const { error } = await supabase.from("classrooms").delete().eq("id", c.id);
    if (error) return toast(error.message, "error");
    toast("Classroom deleted", "success");
    refetch();
  }

  return (
    <div>
      <PageHeader
        title="Classrooms"
        subtitle="Schedule, run and review your live classes"
        action={canCreate && <Button onClick={() => setCreateOpen(true)}>+ Create Classroom</Button>}
      />
      {me.role === "student" && <StudentStats me={me} base={base} />}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <SegmentedTabs tabs={TABS} active={tab} onChange={setTab} />
        <div className="ml-auto">
          <SegmentedTabs tabs={["Session", "Class Series"]} active={view} onChange={setView} />
        </div>
      </div>
      {view === "Session" && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <SearchInput placeholder="Search classes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-muted-foreground text-sm">to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <label className="flex items-center gap-2 text-sm cursor-pointer ml-2">
            <input
              type="checkbox"
              checked={includeCourses}
              onChange={(e) => setIncludeCourses(e.target.checked)}
              className="accent-[var(--primary)]"
            />
            Include Courses
          </label>
        </div>
      )}

      {view === "Class Series" ? (
        series.length === 0 ? (
          <EmptyState text="No class series yet. Sessions created from a series will appear here." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {series.map((s) => {
              const sessions = classes.filter((c) => c.series_id === s.id).length;
              return (
                <div key={s.id} className="bg-surface-2 border border-border rounded-card p-5">
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Coach: {s.coach?.display_name ?? ""} · {sessions} session{sessions === 1 ? "" : "s"}
                  </p>
                </div>
              );
            })}
          </div>
        )
      ) : shown.length === 0 ? (
        <EmptyState
          text={`No ${tab.toLowerCase()} classes.`}
          action={canCreate && <Button onClick={() => setCreateOpen(true)}>+ Create Classroom</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map((c) => {
            const d = new Date(c.scheduled_at);
            const count = c.classroom_enrollments?.[0]?.count ?? 0;
            return (
              <div key={c.id} className="bg-surface-2 border border-border rounded-card p-5 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="bg-surface-3 border border-border rounded-btn px-3 py-1.5 text-center shrink-0">
                    <div className="text-lg font-bold leading-tight">{d.getDate()}</div>
                    <div className="text-xs text-muted-foreground uppercase">
                      {d.toLocaleString("en", { month: "short" })}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">{c.title}</h3>
                      {c.status === "live" && (
                        <span className="bg-live/15 text-live rounded-full px-2 py-0.5 text-xs font-bold animate-pulse shrink-0">
                          LIVE NOW
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {d.toLocaleString("en", { hour: "numeric", minute: "2-digit", weekday: "short" })}
                      {" · "}{c.duration_minutes} min · {count} student{count === 1 ? "" : "s"}
                    </p>
                  </div>
                  {isStaff && (
                    <RowMenu items={[
                      ...(c.status === "scheduled" || c.status === "delayed"
                        ? [{ label: "Start", onClick: () => setStatus(c, "live") }] : []),
                      ...(c.status === "live"
                        ? [{ label: "End", onClick: () => setStatus(c, "completed") }] : []),
                      ...(canManageSchedule && c.status !== "completed" && c.status !== "cancelled"
                        ? [{ label: "Cancel / Reschedule…", onClick: () => { setCancelChoice(null); setRescheduleAt(""); setCancelTarget(c); } }] : []),
                      ...(canManageSchedule ? [{ label: "Delete", onClick: () => deleteClassroom(c), danger: true }] : []),
                    ]} />
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Person id={c.coach_id} name={c.coach?.display_name ?? "Coach"} avatar={c.coach?.avatar} role="coach" size={22} className="text-muted-foreground" />
                  {c.status === "live" && c.started_at && (
                    <span className="ml-auto"><ElapsedTimer since={c.started_at} /></span>
                  )}
                </div>
                <Link
                  href={`${base}/classrooms/${c.id}`}
                  className="bg-primary hover:bg-primary-hover text-primary-foreground rounded-btn px-4 py-2 text-center text-sm font-medium transition-colors"
                >
                  Join Classroom
                </Link>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Classroom">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-muted-foreground">Title</span>
            <Input className="w-full mt-1" value={form.title} autoFocus placeholder="e.g. Endgames: Rook vs Pawn"
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          {selfOnly ? (
            <label className="block text-sm">
              <span className="text-muted-foreground">Student</span>
              <Select className="w-full mt-1" value={form.student_id}
                onChange={(e) => setForm({ ...form, student_id: e.target.value })}>
                <option value="">Select a student…</option>
                {myStudents.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
              </Select>
              {myStudents.length === 0 && (
                <span className="text-muted-foreground text-xs">No students are assigned to you yet.</span>
              )}
            </label>
          ) : (
            <label className="block text-sm">
              <span className="text-muted-foreground">Batch</span>
              <Select className="w-full mt-1" value={form.batch_id}
                onChange={(e) => setForm({ ...form, batch_id: e.target.value })}>
                <option value="">No batch</option>
                {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </label>
          )}
          <label className="block text-sm">
            <span className="text-muted-foreground">Curriculum / topic (sets the class name)</span>
            <Select className="w-full mt-1" value={form.course_id}
              onChange={(e) => {
                const course = courses.find((c) => c.id === e.target.value);
                // Class name = curriculum + its running count, e.g. "Class 36 - XYZ"
                // (client req #10) - same topic can be scheduled repeatedly.
                const n = classes.filter((c) => c.course_id === e.target.value).length + 1;
                setForm({
                  ...form, course_id: e.target.value,
                  title: course ? `Class ${n}: ${course.title}` : form.title,
                });
              }}>
              <option value="">None (free-text title below)</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Select>
          </label>
          {!selfOnly && (
            <label className="block text-sm">
              <span className="text-muted-foreground">Coach</span>
              <Select className="w-full mt-1" value={form.coach_id}
                onChange={(e) => setForm({ ...form, coach_id: e.target.value })}>
                <option value="">Me ({me.display_name})</option>
                {staffList.filter((s) => s.id !== me.id).map((s) => (
                  <option key={s.id} value={s.id}>{s.display_name}</option>
                ))}
              </Select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-muted-foreground">Scheduled at</span>
              <Input className="w-full mt-1" type="datetime-local" value={form.scheduled_at}
                onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Duration (min)</span>
              <Input className="w-full mt-1" type="number" min={15} step={15} value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-muted-foreground">External meeting link (optional: Zoom / Google Meet)</span>
            <Input className="w-full mt-1" type="url" placeholder="Leave empty to use built-in video"
              value={form.meeting_url} onChange={(e) => setForm({ ...form, meeting_url: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createClassroom}>Create</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!cancelTarget} onClose={() => { setCancelTarget(null); setCancelChoice(null); }}
        title={`Cancel "${cancelTarget?.title ?? ""}"`}>
        <div className="space-y-4">
          {!cancelChoice ? (
            <div className="flex flex-col gap-2">
              <Button variant="secondary" onClick={() => setCancelChoice("complete")}>Cancel completely</Button>
              <Button onClick={() => setCancelChoice("reschedule")}>Cancel with a reschedule…</Button>
            </div>
          ) : cancelChoice === "complete" ? (
            <>
              <p className="text-sm text-muted-foreground">This class will be marked cancelled with no replacement.</p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setCancelChoice(null)}>Back</Button>
                <Button variant="danger" onClick={confirmCancel}>Confirm cancel</Button>
              </div>
            </>
          ) : (
            <>
              <label className="block text-sm">
                <span className="text-muted-foreground">New date/time for the replacement class</span>
                <Input className="w-full mt-1" type="datetime-local" value={rescheduleAt}
                  onChange={(e) => setRescheduleAt(e.target.value)} />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setCancelChoice(null)}>Back</Button>
                <Button onClick={confirmCancel} disabled={!rescheduleAt}>Cancel &amp; schedule replacement</Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
