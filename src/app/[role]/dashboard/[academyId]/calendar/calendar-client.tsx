"use client";

/* Calendar - platform-sections.md #11: "academy command center";
 * Monthly/Weekly/Daily/Agenda views; color-coded event types
 * (Class/Homework/Tournament/Simul/Booking) + All/Upcoming/Completed filter.
 * Data = calendar_events SQL view (aggregates the domain tables). */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/auth";
import Link from "next/link";
import { Button, EmptyState, Input, Modal, PageHeader, SegmentedTabs, Select } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

type Ev = { id: string; kind: string; title: string; starts_at: string; duration_minutes: number; status: string };
type Meeting = {
  id: string; title: string; agenda: string | null; starts_at: string;
  duration_minutes: number; location_kind: string; external_url: string | null;
  organizer_id: string; status: string;
  organizer: { display_name: string } | null;
  meeting_attendees: { profile_id: string; profile: { display_name: string } | null }[];
};
type StaffOption = { id: string; display_name: string; role: string };
type Leave = {
  id: string; profile_id: string; starts_on: string; ends_on: string;
  reason: string | null; status: string;
  profile: { display_name: string; role: string } | null;
};

const KIND_COLOR: Record<string, string> = {
  class: "#4F46E5",
  homework: "#F97316",
  tournament: "#F5C518",
  simul: "#30A46C",
  booking: "#64748B",
  leave: "#A855F7",
  task: "#0EA5E9",
  meeting: "#EC4899",
};

export function CalendarClient({ me }: { me: Profile }) {
  const toast = useToast();
  const isReviewer = me.role === "ceo" || me.role === "manager";
  const isCeo = me.role === "ceo";
  // Convening a meeting is a staff-management act, so it stays with the two
  // roles that run the academy.
  const canOrganize = isReviewer;
  const [view, setView] = useState("Monthly");
  const [filter, setFilter] = useState("all");
  const [kinds, setKinds] = useState<Set<string>>(new Set()); // empty = every kind
  const [cursor, setCursor] = useState(() => new Date());
  const [events, setEvents] = useState<Ev[]>([]);

  const toggleKind = (k: string) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [leaveModal, setLeaveModal] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ from: "", to: "", reason: "" });

  // Tasks and meetings: the CEO's own planning surface. Meetings are stored
  // rows with an attendee list, so they land on everyone invited; tasks are
  // private to whoever wrote them.
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [taskModal, setTaskModal] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: "", at: "", minutes: "30", notes: "" });
  const [meetModal, setMeetModal] = useState(false);
  const [meetForm, setMeetForm] = useState({
    title: "", at: "", minutes: "30", agenda: "", kind: "internal", url: "", invitees: [] as string[],
  });
  const [openMeeting, setOpenMeeting] = useState<Meeting | null>(null);
  const [saving, setSaving] = useState(false);

  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http");

  function refetchLeaves() {
    if (!configured) return;
    createClient().from("leaves")
      .select("id, profile_id, starts_on, ends_on, reason, status, profile:profiles!leaves_profile_id_fkey(display_name, role)")
      .order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => setLeaves((data as unknown as Leave[]) ?? []));
  }

  function refetchMeetings() {
    if (!configured) return;
    createClient().from("meetings")
      .select("id, title, agenda, starts_at, duration_minutes, location_kind, external_url, organizer_id, status, organizer:profiles!meetings_organizer_id_fkey(display_name), meeting_attendees(profile_id, profile:profiles(display_name))")
      .order("starts_at", { ascending: false }).limit(200)
      .then(({ data }) => setMeetings((data as unknown as Meeting[]) ?? []));
  }

  function refetchEvents() {
    if (!configured) return;
    createClient().from("calendar_events").select("*").not("starts_at", "is", null)
      .then(({ data }) => setEvents((data as Ev[]) ?? []));
  }

  useEffect(() => {
    if (!configured) return;
    refetchEvents();
    refetchLeaves();
    refetchMeetings();
    // Only an organiser needs the staff list, and only they can act on it.
    if (canOrganize) {
      createClient().from("profiles")
        .select("id, display_name, role").in("role", ["ceo", "manager", "coach"])
        .eq("status", "active").order("display_name")
        .then(({ data }) => setStaff((data as StaffOption[]) ?? []));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addTask() {
    if (!taskForm.title.trim()) return toast("Give the task a name", "error");
    if (!taskForm.at) return toast("Pick a date and time", "error");
    setSaving(true);
    const { error } = await createClient().from("calendar_tasks").insert({
      academy_id: me.academy_id, owner_id: me.id,
      title: taskForm.title.trim(), notes: taskForm.notes.trim() || null,
      due_at: new Date(taskForm.at).toISOString(),
      duration_minutes: Number(taskForm.minutes) || 0,
    });
    setSaving(false);
    if (error) return toast(error.message, "error");
    toast("Task added", "success");
    setTaskModal(false);
    setTaskForm({ title: "", at: "", minutes: "30", notes: "" });
    refetchEvents();
  }

  async function scheduleMeeting() {
    if (!meetForm.title.trim()) return toast("Give the meeting a name", "error");
    if (!meetForm.at) return toast("Pick a date and time", "error");
    if (meetForm.kind === "external" && !/^https:\/\//i.test(meetForm.url.trim())) {
      return toast("An external meeting needs an https link", "error");
    }
    if (meetForm.invitees.length === 0) return toast("Invite at least one person", "error");

    setSaving(true);
    const supabase = createClient();
    const { data, error } = await supabase.from("meetings").insert({
      academy_id: me.academy_id, organizer_id: me.id,
      title: meetForm.title.trim(), agenda: meetForm.agenda.trim() || null,
      starts_at: new Date(meetForm.at).toISOString(),
      duration_minutes: Number(meetForm.minutes) || 30,
      location_kind: meetForm.kind,
      external_url: meetForm.kind === "external" ? meetForm.url.trim() : null,
    }).select("id").single();

    if (error || !data) { setSaving(false); return toast(error?.message ?? "Could not create", "error"); }

    /* The organiser is an attendee of their own meeting, so it shows on their
     * calendar too and in_meeting() treats them like everyone else. */
    const rows = [...new Set([...meetForm.invitees, me.id])]
      .map((profile_id) => ({ meeting_id: data.id, profile_id }));
    const { error: aErr } = await supabase.from("meeting_attendees").insert(rows);
    setSaving(false);
    if (aErr) return toast(aErr.message, "error");

    toast("Meeting scheduled", "success");
    setMeetModal(false);
    setMeetForm({ title: "", at: "", minutes: "30", agenda: "", kind: "internal", url: "", invitees: [] });
    refetchEvents();
    refetchMeetings();
  }

  async function cancelMeeting(m: Meeting) {
    const { error } = await createClient().from("meetings")
      .update({ status: "cancelled" }).eq("id", m.id);
    if (error) return toast(error.message, "error");
    toast("Meeting cancelled", "info");
    setOpenMeeting(null);
    refetchEvents();
    refetchMeetings();
  }

  async function requestLeave() {
    if (!leaveForm.from || !leaveForm.to) return toast("Pick both dates", "error");
    if (leaveForm.to < leaveForm.from) return toast("Leave cannot end before it starts", "error");
    const { error } = await createClient().from("leaves").insert({
      academy_id: me.academy_id, profile_id: me.id,
      starts_on: leaveForm.from, ends_on: leaveForm.to,
      reason: leaveForm.reason.trim() || null,
    });
    if (error) return toast(error.message, "error");
    toast("Leave requested, an admin will review it", "success");
    setLeaveModal(false);
    setLeaveForm({ from: "", to: "", reason: "" });
    refetchLeaves();
  }

  async function reviewLeave(l: Leave, status: "approved" | "rejected") {
    const { error } = await createClient().from("leaves")
      .update({ status, reviewed_by: me.id }).eq("id", l.id);
    if (error) return toast(error.message, "error");
    toast(`Leave ${status}${status === "approved" && l.profile?.role === "coach"
      ? " (reassign their classes from Academy → Batches if needed)" : ""}`,
      status === "approved" ? "success" : "info");
    refetchLeaves();
  }

  // Approved leaves appear on the calendar like any other event.
  const leaveEvents: Ev[] = useMemo(() => leaves
    .filter((l) => l.status === "approved")
    .map((l) => ({
      id: l.id, kind: "leave",
      title: `${l.profile?.display_name ?? "Someone"} on leave`,
      starts_at: `${l.starts_on}T00:00:00`, duration_minutes: 0, status: "approved",
    })), [leaves]);

  const filtered = useMemo(() => [...events, ...leaveEvents].filter((e) => {
    /* The CEO does not teach, so 56 live classes a day buried the handful of
     * entries that are actually theirs. Their calendar is their own schedule
     * -- meetings, tasks, leave to approve -- and Live Ops is where the
     * teaching timetable belongs. */
    if (isCeo && e.kind === "class") return false;
    if (kinds.size > 0 && !kinds.has(e.kind)) return false;
    if (filter === "upcoming") return new Date(e.starts_at) >= new Date();
    if (filter === "completed") return e.status === "completed";
    return true;
  }), [events, leaveEvents, filter, kinds, isCeo]);

  const byDay = useMemo(() => {
    const map: Record<string, Ev[]> = {};
    filtered.forEach((e) => {
      const key = e.starts_at.slice(0, 10);
      (map[key] ??= []).push(e);
    });
    return map;
  }, [filtered]);

  function shift(delta: number) {
    const d = new Date(cursor);
    if (view === "Monthly") d.setMonth(d.getMonth() + delta);
    else if (view === "Weekly") d.setDate(d.getDate() + 7 * delta);
    else d.setDate(d.getDate() + delta);
    setCursor(d);
  }

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  // Month grid: 6 rows × 7 cols from the Sunday before the 1st
  const gridDays = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const weekDays = useMemo(() => {
    const start = new Date(cursor);
    start.setDate(cursor.getDate() - cursor.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const isToday = (d: Date) => key(d) === key(new Date());

  function DayEvents({ d, compact }: { d: Date; compact?: boolean }) {
    const evs = byDay[key(d)] ?? [];
    return (
      <>
        {evs.slice(0, compact ? 3 : 20).map((e) => (
          <div
            key={`${e.kind}-${e.id}`}
            className="rounded px-1.5 py-0.5 text-xs truncate text-white"
            style={{ background: KIND_COLOR[e.kind] ?? "#64748B" }}
            title={`${e.title} · ${new Date(e.starts_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
          >
            {e.title}
          </div>
        ))}
        {compact && evs.length > 3 && <span className="text-[10px] text-muted-foreground">+{evs.length - 3} more</span>}
      </>
    );
  }

  const agenda = filtered
    .slice()
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .filter((e) => new Date(e.starts_at) >= new Date(Date.now() - 86400000 * 30));

  return (
    <div>
      <PageHeader title="Calendar"
        action={
          <span className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setTaskModal(true)}>+ Task</Button>
            {canOrganize && <Button onClick={() => setMeetModal(true)}>+ Meeting</Button>}
            <Button variant="secondary" onClick={() => setLeaveModal(true)}>Request leave</Button>
          </span>
        } />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <SegmentedTabs tabs={["Monthly", "Weekly", "Daily", "Agenda"]} active={view} onChange={setView} />
        <div className="flex items-center gap-1 ml-auto">
          <Button variant="ghost" onClick={() => shift(-1)}>‹</Button>
          <span className="font-medium min-w-40 text-center">
            {view === "Monthly" ? monthLabel : cursor.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
          </span>
          <Button variant="ghost" onClick={() => shift(1)}>›</Button>
          <Button variant="secondary" onClick={() => setCursor(new Date())}>Today</Button>
        </div>
      </div>

      {/* Tag chips - click to see only that kind (reference behaviour). */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {Object.entries(KIND_COLOR).filter(([k]) => !(isCeo && k === "class")).map(([k, c]) => {
          const on = kinds.size === 0 || kinds.has(k);
          return (
            <button
              key={k}
              onClick={() => toggleKind(k)}
              aria-pressed={kinds.has(k)}
              className={`flex items-center gap-1.5 capitalize rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                kinds.has(k)
                  ? "border-transparent text-white shadow-sm"
                  : on ? "border-border bg-surface-2 hover:bg-surface-3" : "border-border opacity-40 hover:opacity-70"
              }`}
              style={kinds.has(k) ? { background: c } : undefined}
            >
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: kinds.has(k) ? "#fff" : c }} /> {k}
            </button>
          );
        })}
        <span className="w-px h-5 bg-border mx-1" aria-hidden />
        {(["all", "upcoming", "completed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`capitalize rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface-2 hover:bg-surface-3"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {view === "Monthly" && (
        <div className="grid grid-cols-7 border border-border rounded-card overflow-hidden">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="bg-surface-1 px-2 py-1.5 text-xs font-medium text-muted-foreground border-b border-border">{d}</div>
          ))}
          {gridDays.map((d) => (
            <div
              key={d.toISOString()}
              className={`min-h-24 p-1.5 border-b border-r border-border flex flex-col gap-1 ${
                d.getMonth() !== cursor.getMonth() ? "opacity-40" : ""
              } ${isToday(d) ? "bg-primary/10" : "bg-surface-2"}`}
            >
              <span className={`text-xs ${isToday(d) ? "text-primary-hover font-bold" : "text-muted-foreground"}`}>{d.getDate()}</span>
              <DayEvents d={d} compact />
            </div>
          ))}
        </div>
      )}

      {view === "Weekly" && (
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((d) => (
            <div key={d.toISOString()} className={`rounded-card border border-border p-2 min-h-48 ${isToday(d) ? "bg-primary/10" : "bg-surface-2"}`}>
              <p className="text-xs font-medium mb-2">{d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}</p>
              <div className="flex flex-col gap-1"><DayEvents d={d} /></div>
            </div>
          ))}
        </div>
      )}

      {view === "Daily" && (
        <div className="max-w-xl">
          {(byDay[key(cursor)] ?? []).length === 0 ? (
            <EmptyState text="Nothing scheduled this day." />
          ) : (
            <div className="flex flex-col gap-2">
              {(byDay[key(cursor)] ?? [])
                .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
                .map((e) => (
                  <div key={`${e.kind}-${e.id}`} className="flex items-center gap-3 bg-surface-2 border border-border rounded-card px-4 py-3">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: KIND_COLOR[e.kind] }} />
                    <span className="text-sm text-muted-foreground w-20">
                      {new Date(e.starts_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="font-medium flex-1">{e.title}</span>
                    <span className="text-xs text-muted-foreground capitalize">{e.kind}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {view === "Agenda" && (
        <div className="max-w-xl">
          {agenda.length === 0 ? (
            <EmptyState text="No events found." />
          ) : (
            <div className="flex flex-col gap-2">
              {agenda.map((e) => (
                <div key={`${e.kind}-${e.id}`} className="flex items-center gap-3 bg-surface-2 border border-border rounded-card px-4 py-3">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: KIND_COLOR[e.kind] }} />
                  <span className="text-sm text-muted-foreground w-36">{new Date(e.starts_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="font-medium flex-1">{e.title}</span>
                  <span className="text-xs text-muted-foreground capitalize">{e.kind}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Meetings you are part of. Read from the meetings table rather than the
          calendar view, because this needs the attendee list and the joining
          link, which the aggregate view deliberately does not carry. */}
      {meetings.filter((m) => m.status === "scheduled").length > 0 && (
        <div className="mt-8 max-w-2xl">
          <h2 className="font-semibold mb-3">Meetings</h2>
          <div className="flex flex-col gap-2">
            {meetings.filter((m) => m.status === "scheduled").slice(0, 12).map((m) => (
              <button key={m.id} onClick={() => setOpenMeeting(m)}
                className="flex flex-wrap items-center gap-3 bg-surface-2 border border-border rounded-card px-4 py-3 text-left hover:bg-surface-3 transition-colors">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: KIND_COLOR.meeting }} />
                <span className="text-sm text-muted-foreground w-36 shrink-0">
                  {new Date(m.starts_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="font-medium flex-1 truncate">{m.title}</span>
                <span className="text-xs text-muted-foreground">
                  {m.meeting_attendees?.length ?? 0} attending
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Leave desk - admins approve here; everyone sees their own requests. */}
      {(isReviewer ? leaves : leaves.filter((l) => l.profile_id === me.id)).length > 0 && (
        <div className="mt-8 max-w-2xl">
          <h2 className="font-semibold mb-3">{isReviewer ? "Leave requests" : "My leaves"}</h2>
          <div className="flex flex-col gap-2">
            {(isReviewer ? leaves : leaves.filter((l) => l.profile_id === me.id)).slice(0, 12).map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-3 bg-surface-2 border border-border rounded-card px-4 py-3">
                <span className="font-medium">{l.profile?.display_name ?? "Me"}</span>
                <span className="text-xs text-muted-foreground capitalize">{l.profile?.role}</span>
                <span className="text-sm text-muted-foreground">
                  {new Date(l.starts_on).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  {" to "}
                  {new Date(l.ends_on).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                </span>
                {l.reason && <span className="text-sm text-muted-foreground truncate max-w-56">“{l.reason}”</span>}
                <span className="ml-auto flex items-center gap-2">
                  {l.status === "pending" && isReviewer ? (
                    <>
                      <Button variant="secondary" className="!py-1 !px-3 text-sm" onClick={() => reviewLeave(l, "approved")}>Approve</Button>
                      <Button variant="ghost" className="!py-1 !px-3 text-sm text-destructive" onClick={() => reviewLeave(l, "rejected")}>Reject</Button>
                    </>
                  ) : (
                    <span className={`text-xs font-medium capitalize ${
                      l.status === "approved" ? "text-success" : l.status === "rejected" ? "text-destructive" : "text-warning"
                    }`}>● {l.status}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={taskModal} onClose={() => setTaskModal(false)} title="Add a task">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-muted-foreground">Task</span>
            <Input className="w-full mt-1" placeholder="Call the Kumar family about renewal"
              value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-muted-foreground">When</span>
              <Input type="datetime-local" className="w-full mt-1"
                value={taskForm.at} onChange={(e) => setTaskForm({ ...taskForm, at: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Minutes</span>
              <Input type="number" min={0} max={480} className="w-full mt-1"
                value={taskForm.minutes} onChange={(e) => setTaskForm({ ...taskForm, minutes: e.target.value })} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-muted-foreground">Notes (optional)</span>
            <Input className="w-full mt-1" value={taskForm.notes}
              onChange={(e) => setTaskForm({ ...taskForm, notes: e.target.value })} />
          </label>
          <p className="text-xs text-muted-foreground">Tasks are private to you.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTaskModal(false)}>Cancel</Button>
            <Button onClick={addTask} disabled={saving}>{saving ? "Saving…" : "Add task"}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={meetModal} onClose={() => setMeetModal(false)} title="Schedule a meeting" wide>
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-muted-foreground">Meeting</span>
            <Input className="w-full mt-1" placeholder="Monthly coach review"
              value={meetForm.title} onChange={(e) => setMeetForm({ ...meetForm, title: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-muted-foreground">Starts</span>
              <Input type="datetime-local" className="w-full mt-1"
                value={meetForm.at} onChange={(e) => setMeetForm({ ...meetForm, at: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Minutes</span>
              <Input type="number" min={5} max={480} className="w-full mt-1"
                value={meetForm.minutes} onChange={(e) => setMeetForm({ ...meetForm, minutes: e.target.value })} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-muted-foreground">Where</span>
              <Select className="w-full mt-1" value={meetForm.kind}
                onChange={(e) => setMeetForm({ ...meetForm, kind: e.target.value })}>
                <option value="internal">On this platform</option>
                <option value="external">Zoom / Google Meet</option>
              </Select>
            </label>
            {meetForm.kind === "external" && (
              <label className="block text-sm">
                <span className="text-muted-foreground">Link</span>
                <Input className="w-full mt-1" placeholder="https://meet.google.com/…"
                  value={meetForm.url} onChange={(e) => setMeetForm({ ...meetForm, url: e.target.value })} />
              </label>
            )}
          </div>

          <div className="text-sm">
            <span className="text-muted-foreground">Who</span>
            <div className="mt-1 max-h-48 overflow-y-auto border border-border rounded-card divide-y divide-border">
              {staff.filter((p) => p.id !== me.id).map((p) => (
                <label key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-3 cursor-pointer">
                  <input type="checkbox" checked={meetForm.invitees.includes(p.id)}
                    onChange={(e) => setMeetForm((f) => ({
                      ...f,
                      invitees: e.target.checked
                        ? [...f.invitees, p.id]
                        : f.invitees.filter((id) => id !== p.id),
                    }))} />
                  <span className="flex-1">{p.display_name}</span>
                  <span className="text-xs text-muted-foreground capitalize">{p.role}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="block text-sm">
            <span className="text-muted-foreground">Agenda (optional)</span>
            <Input className="w-full mt-1" value={meetForm.agenda}
              onChange={(e) => setMeetForm({ ...meetForm, agenda: e.target.value })} />
          </label>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setMeetModal(false)}>Cancel</Button>
            <Button onClick={scheduleMeeting} disabled={saving}>{saving ? "Scheduling…" : "Schedule"}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!openMeeting} onClose={() => setOpenMeeting(null)} title={openMeeting?.title ?? "Meeting"}>
        {openMeeting && (
          <div className="space-y-3">
            <p className="text-sm">
              {new Date(openMeeting.starts_at).toLocaleString(undefined, {
                weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
              })}
              <span className="text-muted-foreground"> · {openMeeting.duration_minutes} min</span>
            </p>
            <p className="text-sm text-muted-foreground">
              Called by {openMeeting.organizer?.display_name ?? "?"}
            </p>
            {openMeeting.agenda && <p className="text-sm bg-surface-2 rounded-card px-3 py-2">{openMeeting.agenda}</p>}

            <div className="text-sm">
              <span className="text-muted-foreground">Attending</span>
              <p>{openMeeting.meeting_attendees?.map((a) => a.profile?.display_name ?? "?").join(", ") || "Nobody yet"}</p>
            </div>

            {openMeeting.location_kind === "external" && openMeeting.external_url ? (
              <a href={openMeeting.external_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center rounded-btn bg-primary hover:bg-primary-hover text-primary-foreground px-4 py-2 text-sm font-medium transition-colors">
                Join on {new URL(openMeeting.external_url).hostname.replace(/^www\./, "")}
              </a>
            ) : (
              /* Internal meetings reuse the platform's own video mesh; the
                 meeting id is the room key, so nothing needs provisioning. */
              <Link href={`/${me.role}/dashboard/${me.academy_id}/meetings/${openMeeting.id}`}
                className="inline-flex items-center rounded-btn bg-primary hover:bg-primary-hover text-primary-foreground px-4 py-2 text-sm font-medium transition-colors">
                Join meeting room
              </Link>
            )}

            {openMeeting.organizer_id === me.id && (
              <Button variant="ghost" className="text-destructive" onClick={() => cancelMeeting(openMeeting)}>
                Cancel meeting
              </Button>
            )}
          </div>
        )}
      </Modal>

      <Modal open={leaveModal} onClose={() => setLeaveModal(false)} title="Request leave">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-muted-foreground">From</span>
              <Input type="date" className="w-full mt-1" value={leaveForm.from}
                onChange={(e) => setLeaveForm({ ...leaveForm, from: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">To</span>
              <Input type="date" className="w-full mt-1" value={leaveForm.to}
                onChange={(e) => setLeaveForm({ ...leaveForm, to: e.target.value })} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-muted-foreground">Reason (optional)</span>
            <Input className="w-full mt-1" placeholder="Family trip, exams…" value={leaveForm.reason}
              onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setLeaveModal(false)}>Cancel</Button>
            <Button onClick={requestLeave}>Submit request</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
