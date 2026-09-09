"use client";


import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { GraduationCap, Magnet, UserX, Users, X } from "lucide-react";
import type { Profile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import {
  Avatar, Button, EmptyState, Input, Modal, PageHeader, Pagination, Person as PersonChip, RowMenu,
  SearchInput, SegmentedTabs, Select, StatCard, StatusPill,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { DailyLogs } from "./daily-logs";

export type Person = {
  /** Customised DiceBear avatar (or legacy art id) - so lists show the face
   *  the person actually chose, not a generated stand-in. */
  avatar?: string | null;
  id: string; display_name: string; username: string | null; role: string;
  status: string; tags: string[]; created_at: string;
  coach_id?: string | null;
};
export type Invite = {
  id: string; display_name: string; username: string | null; role: string;
  code: string; created_at: string;
};
export type Batch = {
  id: string; name: string; coach_id: string | null; created_at: string;
  category: "group" | "individual" | "buddy" | null;
  total_classes: 24 | 48 | 96 | null;
  coach: { display_name: string } | null;
};
type Member = { batch_id: string; student_id: string };

const PAGE_SIZE = 20;

/** Auto username: ca_<name><2 digits> - own prefix, mirroring Playmate's cbpm_ pattern (PLAN.md: IM). */
function makeUsername(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || "student";
  return `ca_${base}${String(Math.floor(Math.random() * 90) + 10)}`;
}

export function AcademyClient({
  me, initialPeople, initialInvites, initialBatches, initialMembers,
}: {
  me: Profile;
  initialPeople: Person[];
  initialInvites: Invite[];
  initialBatches: Batch[];
  initialMembers: Member[];
}) {
  const supabase = createClient();
  const toast = useToast();
  const [tab, setTab] = useState("Students");
  const [people, setPeople] = useState(initialPeople);
  const [invites, setInvites] = useState(initialInvites);
  const [batches, setBatches] = useState(initialBatches);
  const [members, setMembers] = useState(initialMembers);

  // Admin-only KPI - open leads (cross-cutting, not visible to managers scoped
  // to their own leads only). CEO's Academy overview gets this extra tile.
  const [openLeadsCount, setOpenLeadsCount] = useState<number | null>(null);
  useEffect(() => {
    if (me.role !== "ceo") return;
    supabase.from("leads").select("id", { count: "exact", head: true })
      .not("status", "in", "(enrolled,lost)")
      .then(({ count }) => setOpenLeadsCount(count ?? 0));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.role]);

  /* Roster counts refresh on their own, so the summary is current even when a
   * second admin adds or deactivates someone in another window. A 60s poll
   * rather than a realtime channel: the roster changes a handful of times a
   * day, and putting `profiles` on the realtime publication would broadcast
   * every profile write in the academy to pay for it. */
  useEffect(() => {
    const t = setInterval(() => { void refetchPeople(); }, 60_000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Students state ──
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [addRole, setAddRole] = useState<"student" | "coach" | "manager">("student");
  const [newName, setNewName] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Person | null>(null);
  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState("");
  const [assignCoach, setAssignCoach] = useState<Person | null>(null);
  const [assignSel, setAssignSel] = useState<string[]>([]);

  // Manager role presets (client requirement #5) - CEO picks one, or "Other"
  // for anything not covered, which reveals the freeform field below it.
  const MANAGER_TITLES = ["Finance Manager", "HR Manager", "Class Coordinator Manager", "Operations Manager"];

  // Manager permission flags (0006, +0016 for TeleCRM) - CEO edits title + boolean capabilities
  const PERM_FLAGS = [
    ["can_manage_leads", "Manage all leads (CRM): also grants Drip Campaigns & Distribution in TeleCRM"],
    ["can_view_billing", "View billing & revenue"],
    ["can_schedule_classes", "Schedule classes for any coach"],
    ["can_manage_students", "Manage students & batches"],
    ["can_view_reports", "View reports & analytics"],
    ["can_run_demos", "Run demo sessions"],
    ["can_use_whatsapp", "TeleCRM: WhatsApp messaging"],
    ["can_view_call_logs", "TeleCRM: Call logs"],
  ] as const;
  type PermForm = { title: string } & Record<(typeof PERM_FLAGS)[number][0], boolean>;
  const emptyPerms: PermForm = {
    title: "Manager", can_manage_leads: false, can_view_billing: false,
    can_schedule_classes: false, can_manage_students: false,
    can_view_reports: false, can_run_demos: false,
    can_use_whatsapp: false, can_view_call_logs: false,
  };
  const [permTarget, setPermTarget] = useState<Person | null>(null);
  const [permForm, setPermForm] = useState<PermForm>(emptyPerms);

  async function openPerms(p: Person) {
    const { data } = await supabase.from("manager_permissions").select("*").eq("profile_id", p.id).single();
    setPermForm(data ? { ...emptyPerms, ...data } : emptyPerms);
    setPermTarget(p);
  }

  async function savePerms() {
    if (!permTarget) return;
    const { error } = await supabase.from("manager_permissions").upsert({
      profile_id: permTarget.id, academy_id: me.academy_id,
      ...permForm, title: permForm.title.trim() || "Manager",
      updated_at: new Date().toISOString(),
    });
    if (error) return toast(error.message, "error");
    toast(`${permTarget.display_name}: permissions saved`, "success");
    setPermTarget(null);
  }

  const students = useMemo(() => {
    const fromProfiles = people
      .filter((p) => p.role === "student")
      .map((p) => ({ ...p, kind: "profile" as const }));
    const fromInvites = invites
      .filter((i) => i.role === "student")
      .map((i) => ({
        id: i.id, display_name: i.display_name, username: i.username,
        role: i.role, status: "invited", tags: [] as string[],
        created_at: i.created_at, avatar: null, kind: "invite" as const,
      }));
    return [...fromProfiles, ...fromInvites].sort(
      (a, b) => +new Date(b.created_at) - +new Date(a.created_at), // Newest first
    );
  }, [people, invites]);

  const allTags = useMemo(
    () => Array.from(new Set(students.flatMap((s) => s.tags))).sort(),
    [students],
  );

  const filtered = students.filter((s) => {
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    if (tagFilter !== "all" && !s.tags.includes(tagFilter)) return false;
    const q = search.trim().toLowerCase();
    if (q && !s.display_name.toLowerCase().includes(q) && !(s.username ?? "").toLowerCase().includes(q))
      return false;
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const activeCount = students.filter((s) => s.status === "active").length;
  const inactiveCount = students.filter((s) => s.status === "inactive").length;

  async function refetchPeople() {
    const [p, i] = await Promise.all([
      supabase.from("profiles")
        .select("id, display_name, username, role, status, tags, created_at, coach_id, avatar")
        .eq("academy_id", me.academy_id).order("created_at", { ascending: false }),
      supabase.from("invites")
        .select("id, display_name, username, role, code, created_at")
        .eq("academy_id", me.academy_id).is("claimed_by", null)
        .order("created_at", { ascending: false }),
    ]);
    setPeople((p.data ?? []) as Person[]);
    setInvites((i.data ?? []) as Invite[]);
  }

  async function addPerson() {
    if (!newName.trim()) return toast(`Enter the ${addRole}'s name`, "error");
    const { data, error } = await supabase
      .from("invites")
      .insert({
        academy_id: me.academy_id, role: addRole, display_name: newName.trim(),
        username: makeUsername(newName), created_by: me.id,
      })
      .select("code")
      .single();
    if (error) return toast(error.message, "error");
    setInviteCode((data as { code: string }).code);
    setNewName("");
    toast("Invite created", "success");
    refetchPeople();
  }

  /** Assign specific students to a coach (demo §1:17) - profiles.coach_id. */
  function openAssign(coach: Person) {
    setAssignSel(people.filter((p) => p.role === "student" && p.coach_id === coach.id).map((p) => p.id));
    setAssignCoach(coach);
  }

  async function saveAssign() {
    if (!assignCoach) return;
    const current = people.filter((p) => p.role === "student" && p.coach_id === assignCoach.id).map((p) => p.id);
    const toAdd = assignSel.filter((id) => !current.includes(id));
    const toRemove = current.filter((id) => !assignSel.includes(id));
    if (toAdd.length) {
      const { error } = await supabase.from("profiles").update({ coach_id: assignCoach.id }).in("id", toAdd);
      if (error) return toast(error.message, "error");
    }
    if (toRemove.length) {
      const { error } = await supabase.from("profiles").update({ coach_id: null }).in("id", toRemove);
      if (error) return toast(error.message, "error");
    }
    toast(`${assignSel.length} student(s) assigned to ${assignCoach.display_name}`, "success");
    setAssignCoach(null);
    refetchPeople();
  }

  /** Parent-shareable report URL (demo §10:41) - snapshot into student_reports. */
  async function shareReport(s: Person) {
    const [att, pts, subs, academy] = await Promise.all([
      supabase.from("attendance_records").select("status").eq("student_id", s.id),
      supabase.from("points_ledger").select("points").eq("student_id", s.id),
      supabase.from("homework_submissions")
        .select("score, status, submitted_at, assignment:homework_assignments(title)")
        .eq("student_id", s.id).order("submitted_at", { ascending: false }).limit(10),
      supabase.from("academies").select("name").eq("id", me.academy_id).single(),
    ]);
    const a = att.data ?? [];
    const submissions = subs.data ?? [];
    const scored = submissions.filter((x) => x.score != null);
    const snapshot = {
      student_name: s.display_name,
      academy_name: academy.data?.name ?? "Chess Academy",
      generated_at: new Date().toISOString(),
      attendance_rate: a.length ? Math.round((a.filter((r) => r.status === "present").length / a.length) * 100) : null,
      total_points: (pts.data ?? []).reduce((n, p) => n + p.points, 0),
      homework: {
        total: submissions.length,
        reviewed: submissions.filter((x) => x.status === "reviewed").length,
        avg_score: scored.length ? Math.round(scored.reduce((n, x) => n + (x.score ?? 0), 0) / scored.length) : null,
      },
      recent: submissions.map((x) => ({
        title: (x.assignment as unknown as { title: string })?.title ?? "Homework",
        score: x.score, status: x.status, at: x.submitted_at,
      })),
    };
    const { data, error } = await supabase.from("student_reports")
      .insert({ academy_id: me.academy_id, student_id: s.id, snapshot, created_by: me.id })
      .select("slug").single();
    if (error) return toast(error.message, "error");
    const url = `${window.location.origin}/share/report/${data.slug}`;
    await navigator.clipboard.writeText(url).catch(() => {});
    toast("Report link copied, share it with parents", "success");
  }

  // ── Coins & penalties - one ledger, two signs ──
  const [grantTarget, setGrantTarget] = useState<Person | null>(null);
  const [grantMode, setGrantMode] = useState<"coins" | "penalty">("coins");
  const [grantForm, setGrantForm] = useState({ amount: "10", reason: "" });

  async function submitGrant() {
    if (!grantTarget) return;
    const n = Math.max(1, parseInt(grantForm.amount, 10) || 0);
    const entry = grantMode === "coins"
      ? { points: 0, coins: n, reason: grantForm.reason.trim() || "gift" }
      : { points: -n, coins: 0, reason: grantForm.reason.trim() || "penalty" };
    const { error } = await supabase.from("points_ledger").insert({
      academy_id: me.academy_id, student_id: grantTarget.id, ...entry,
    });
    if (error) return toast(error.message, "error");
    void supabase.from("notifications").insert({
      academy_id: me.academy_id, user_id: grantTarget.id,
      title: grantMode === "coins" ? "You received coins!" : "Penalty applied",
      body: grantMode === "coins"
        ? `${n} coins from ${me.display_name}${grantForm.reason ? ` (${grantForm.reason})` : ""}. Spend them in your profile!`
        : `−${n} points${grantForm.reason ? ` (${grantForm.reason})` : ""}.`,
    });
    toast(grantMode === "coins" ? `${n} coins sent to ${grantTarget.display_name}` : `Penalty recorded for ${grantTarget.display_name}`, "success");
    setGrantTarget(null);
  }

  async function setStatus(p: Person, status: "active" | "inactive") {
    const { error } = await supabase.from("profiles").update({ status }).eq("id", p.id);
    if (error) return toast(error.message, "error");
    toast(`${p.display_name} marked ${status}`, "success");
    refetchPeople();
  }

  async function deleteStudent(s: (typeof students)[number]) {
    if (s.kind === "invite") {
      const { error } = await supabase.from("invites").delete().eq("id", s.id);
      if (error) return toast(error.message, "error");
      toast("Invite deleted", "success");
      refetchPeople();
      return;
    }
    // Profiles have no delete policy on purpose - removal goes through the
    // RPC, which unlinks the account and keeps history if it must.
    const { data, error } = await supabase.rpc("remove_academy_member", { target: s.id });
    if (error) return toast(error.message, "error");
    toast(data === "deleted"
      ? `${s.display_name} removed`
      : `${s.display_name} had activity on record, account deactivated instead`, "success");
    refetchPeople();
  }

  // ── Remove coach/manager (CEO) - hand off students, batches and classes ──
  const [removeTarget, setRemoveTarget] = useState<Person | null>(null);
  const [removeReplacement, setRemoveReplacement] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);
  // "Transfer Account": same RPC, but the replacement is mandatory and
  // nothing about the flow is framed as a removal - for when a manager
  // leaves and someone else is stepping into their role, not just leaving.
  const [transferMode, setTransferMode] = useState(false);

  async function removeMemberConfirmed() {
    if (!removeTarget) return;
    if (transferMode && !removeReplacement) return toast("Pick who's taking over", "error");
    setRemoveBusy(true);
    const { data, error } = await supabase.rpc("remove_academy_member", {
      target: removeTarget.id,
      replacement: removeReplacement || null,
    });
    setRemoveBusy(false);
    if (error) return toast(error.message, "error");
    toast(transferMode
      ? `${removeTarget.display_name}'s leads and permissions transferred`
      : data === "deleted"
      ? `${removeTarget.display_name} removed from the academy`
      : `${removeTarget.display_name} had teaching history, account deactivated and unassigned`, "success");
    setRemoveTarget(null);
    setRemoveReplacement("");
    setTransferMode(false);
    refetchPeople();
    refetchBatches();
  }

  // ── Reset a member's password (CEO/manager) ──
  // Server does the work (POST /api/admin/reset-password, service role); the
  // member is handed a one-time temp password and must_change_password is set,
  // so requireProfile() bounces them to /account/change-password next login.
  const [resetTarget, setResetTarget] = useState<Person | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetResult, setResetResult] = useState<{ name: string; tempPassword: string } | null>(null);

  async function resetPasswordConfirmed() {
    if (!resetTarget) return;
    setResetBusy(true);
    let res: Response;
    try {
      res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: resetTarget.id }),
      });
    } catch {
      setResetBusy(false);
      return toast("Could not reach the server - try again", "error");
    }
    const body = await res.json().catch(() => ({} as Record<string, unknown>));
    setResetBusy(false);
    if (!res.ok) {
      return toast((body as { error?: string }).error ?? "Password reset failed", "error");
    }
    setResetResult({
      name: (body as { member?: { name?: string } }).member?.name ?? resetTarget.display_name,
      tempPassword: String((body as { tempPassword?: string }).tempPassword ?? ""),
    });
    setResetTarget(null);
    toast("Password reset - share the temporary password below", "success");
  }

  // ── Reassign a batch to another coach ──
  const [reassignBatch, setReassignBatch] = useState<Batch | null>(null);
  const [reassignCoach, setReassignCoach] = useState("");

  async function saveBatchCoach() {
    if (!reassignBatch) return;
    const { error } = await supabase.from("batches")
      .update({ coach_id: reassignCoach || null }).eq("id", reassignBatch.id);
    if (error) return toast(error.message, "error");
    toast("Batch coach updated", "success");
    setReassignBatch(null);
    refetchBatches();
  }

  async function saveEdit() {
    if (!editTarget) return;
    const tags = editTags.split(",").map((t) => t.trim()).filter(Boolean);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: editName.trim() || editTarget.display_name, tags })
      .eq("id", editTarget.id);
    if (error) return toast(error.message, "error");
    setEditTarget(null);
    toast("Student updated", "success");
    refetchPeople();
  }

  // ── Batches state ──
  const [batchModal, setBatchModal] = useState(false);
  const [batchName, setBatchName] = useState("");
  const [batchCoach, setBatchCoach] = useState("");
  const [batchCategory, setBatchCategory] = useState("");
  const [batchTotalClasses, setBatchTotalClasses] = useState("");
  // Recurring weekly schedule (0044). The materialiser job turns this into
  // `classrooms` rows ~7 days ahead.
  const [batchRecurring, setBatchRecurring] = useState(false);
  const [batchDays, setBatchDays] = useState<string[]>([]);
  const [batchStart, setBatchStart] = useState("");
  const [batchEnd, setBatchEnd] = useState("");
  const [batchEndType, setBatchEndType] = useState("indefinite");
  const [batchEndDate, setBatchEndDate] = useState("");
  const [batchCount, setBatchCount] = useState("");
  const [manageBatch, setManageBatch] = useState<Batch | null>(null);
  const [memberToAdd, setMemberToAdd] = useState("");
  const staff = people.filter((p) => p.role !== "student");
  const studentProfiles = people.filter((p) => p.role === "student");
  /* "Active" means the same thing for every role: the profile is not
   * deactivated. Coaches and managers were previously totalled into one tile,
   * which answered neither "how many people are teaching" nor "how many are
   * running the place". */
  const activeCoaches = people.filter((p) => p.role === "coach" && p.status === "active").length;
  const activeManagers = people.filter((p) => p.role === "manager" && p.status === "active").length;

  async function refetchBatches() {
    const [b, m] = await Promise.all([
      supabase.from("batches")
        .select("id, name, coach_id, created_at, category, total_classes, coach:profiles!coach_id(display_name)")
        .eq("academy_id", me.academy_id).order("created_at", { ascending: false }),
      supabase.from("batch_members").select("batch_id, student_id"),
    ]);
    setBatches((b.data ?? []) as unknown as Batch[]);
    setMembers((m.data ?? []) as Member[]);
  }

  async function createBatch() {
    if (!batchName.trim()) return toast("Enter a batch name", "error");
    if (batchRecurring && (!batchDays.length || !batchStart || !batchEnd)) {
      return toast("Pick at least one day and a start/end time", "error");
    }
    const { error } = await supabase.from("batches").insert({
      academy_id: me.academy_id, name: batchName.trim(), coach_id: batchCoach || null,
      category: batchCategory || null,
      total_classes: batchTotalClasses ? Number(batchTotalClasses) : null,
      // Recurrence (0044) - only sent when the toggle is on, so a non-recurring
      // batch still inserts fine on a prod that hasn't applied 0044 yet.
      ...(batchRecurring ? {
        is_recurring: true,
        recurrence_frequency: "weekly",
        recurrence_days: batchDays,
        schedule_start_time: batchStart,
        schedule_end_time: batchEnd,
        recurrence_end_type: batchEndType,
        recurrence_count: batchEndType === "count" && batchCount ? Number(batchCount) : null,
        recurrence_end_date: batchEndType === "date" && batchEndDate ? batchEndDate : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      } : {}),
    });
    if (error) return toast(error.message, "error");
    setBatchModal(false); setBatchName(""); setBatchCoach(""); setBatchCategory(""); setBatchTotalClasses("");
    setBatchRecurring(false); setBatchDays([]); setBatchStart(""); setBatchEnd(""); setBatchEndType("indefinite"); setBatchEndDate(""); setBatchCount("");
    toast("Batch created", "success");
    refetchBatches();
  }

  async function addMember() {
    if (!manageBatch || !memberToAdd) return;
    const { error } = await supabase.from("batch_members").insert({
      batch_id: manageBatch.id, student_id: memberToAdd,
    });
    if (error) return toast(error.message, "error");
    setMemberToAdd("");
    refetchBatches();
  }

  async function removeMember(studentId: string) {
    if (!manageBatch) return;
    const { error } = await supabase.from("batch_members").delete()
      .eq("batch_id", manageBatch.id).eq("student_id", studentId);
    if (error) return toast(error.message, "error");
    refetchBatches();
  }

  async function deleteBatch(b: Batch) {
    const { error } = await supabase.from("batches").delete().eq("id", b.id);
    if (error) return toast(error.message, "error");
    toast("Batch deleted", "success");
    refetchBatches();
  }

  const batchMembers = manageBatch
    ? members.filter((m) => m.batch_id === manageBatch.id).map((m) => m.student_id)
    : [];

  return (
    <div>
      <PageHeader
        title="Academy"
        subtitle="User Management: students, coaches, batches and invitations"
        action={tab === "Students"
          ? <Button onClick={() => { setInviteCode(null); setAddRole("student"); setAddOpen(true); }}>+ Add Student</Button>
          : tab === "Coaches"
          ? <span className="flex gap-2">
              {me.role === "ceo" && (
                <Button variant="secondary" onClick={() => { setInviteCode(null); setAddRole("manager"); setAddOpen(true); }}>+ Add Manager</Button>
              )}
              <Button onClick={() => { setInviteCode(null); setAddRole("coach"); setAddOpen(true); }}>+ Add Coach</Button>
            </span>
          : <Button onClick={() => setBatchModal(true)}>+ Create Batch</Button>}
      />

      <p className="text-sm text-muted-foreground -mt-2 mb-4">
        {activeCount} Active {activeCount === 1 ? "Student" : "Students"}
        <span className="mx-2">·</span>
        {activeCoaches} Active {activeCoaches === 1 ? "Coach" : "Coaches"}
        <span className="mx-2">·</span>
        {activeManagers} {activeManagers === 1 ? "Manager" : "Managers"}
      </p>

      <div className={`grid grid-cols-2 gap-3 mb-6 ${me.role === "ceo" ? "md:grid-cols-6" : "md:grid-cols-5"}`}>
        <StatCard label="Active students" value={activeCount} tint="violet" icon={<Users size={20} />} />
        <StatCard label="Inactive students" value={inactiveCount} tint="rose" icon={<UserX size={20} />} />
        <StatCard label="Active coaches" value={activeCoaches} tint="mint" icon={<GraduationCap size={20} />} />
        <StatCard label="Managers" value={activeManagers} tint="mint" icon={<Users size={20} />} />
        <StatCard label="Batches" value={batches.length} tint="amber" icon={<Users size={20} />} />
        {me.role === "ceo" && (
          <StatCard label="Open leads" value={openLeadsCount ?? "…"} tint="violet" icon={<Magnet size={20} />} />
        )}
      </div>

      <div className="mb-4">
        {/* Daily Logs is the CEO's alone (0035). Built into the tab list rather
            than rendered-then-hidden, so nothing about it exists for anyone
            else to find. */}
        <SegmentedTabs
          tabs={me.role === "ceo"
            ? ["Students", "Coaches", "Batches", "Daily Logs"]
            : ["Students", "Coaches", "Batches"]}
          active={tab} onChange={setTab} />
      </div>

      {tab === "Students" && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <SearchInput placeholder="Search students…" value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="invited">Invited</option>
            </Select>
            <Select value={tagFilter} onChange={(e) => { setTagFilter(e.target.value); setPage(1); }}>
              <option value="all">All Tags</option>
              {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            <div className="ml-auto text-sm text-muted-foreground">
              <span className="text-success font-medium">{activeCount} Active</span>
              <span className="mx-2">·</span>
              <span className="text-destructive font-medium">{inactiveCount} Inactive</span>
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState text="No students match your filters."
              action={<Button onClick={() => { setInviteCode(null); setAddOpen(true); }}>+ Add Student</Button>} />
          ) : (
            <div className="bg-surface-2 border border-border rounded-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="px-4 py-3 font-medium">S.No</th>
                    <th className="px-4 py-3 font-medium">Username</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Tags</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s, i) => (
                    <tr key={s.id} className="border-b border-border last:border-0 hover:bg-surface-3/50">
                      <td className="px-4 py-3 text-muted-foreground">{(page - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="px-4 py-3 font-mono text-xs">{s.username ?? ""}</td>
                      <td className="px-4 py-3">
                        <PersonChip id={s.id} name={s.display_name} avatar={s.avatar} role="student" size={26} />
                      </td>
                      <td className="px-4 py-3">
                        {s.tags.length === 0 ? <span className="text-muted-foreground"></span> :
                          s.tags.map((t) => (
                            <span key={t} className="inline-block bg-surface-3 rounded-full px-2 py-0.5 text-xs mr-1">{t}</span>
                          ))}
                      </td>
                      <td className="px-4 py-3"><StatusPill status={s.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <RowMenu items={[
                          ...(s.kind === "profile" ? [
                            { label: "Edit", onClick: () => { setEditTarget(s); setEditName(s.display_name); setEditTags(s.tags.join(", ")); } },
                            { label: "Student report (share URL)", onClick: () => void shareReport(s) },
                            { label: "Award coins…", onClick: () => { setGrantTarget(s); setGrantMode("coins"); setGrantForm({ amount: "10", reason: "" }); } },
                            { label: "Penalty…", onClick: () => { setGrantTarget(s); setGrantMode("penalty"); setGrantForm({ amount: "5", reason: "" }); }, danger: true },
                            { label: "Reset password…", onClick: () => setResetTarget(s) },
                            s.status === "inactive"
                              ? { label: "Activate", onClick: () => setStatus(s, "active") }
                              : { label: "Deactivate", onClick: () => setStatus(s, "inactive") },
                          ] : []),
                          { label: "Delete", onClick: () => deleteStudent(s), danger: true },
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground mt-4">{PAGE_SIZE}/page</span>
            <Pagination page={page} pageCount={pageCount} onPage={setPage} />
          </div>
        </>
      )}

      {tab === "Coaches" && (
        (() => {
          const coachRows = [
            ...staff.map((p) => ({ ...p, kind: "profile" as const })),
            ...invites.filter((i) => i.role === "coach" || i.role === "manager").map((i) => ({
              id: i.id, display_name: i.display_name, username: i.username,
              role: i.role, status: "invited", tags: [] as string[],
              created_at: i.created_at, coach_id: null, avatar: null, kind: "invite" as const,
            })),
          ];
          return coachRows.length === 0 ? (
            <EmptyState text="No coaches yet."
              action={<Button onClick={() => { setInviteCode(null); setAddRole("coach"); setAddOpen(true); }}>+ Add Coach</Button>} />
          ) : (
            <div className="bg-surface-2 border border-border rounded-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Username</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Assigned students</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {coachRows.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-3/50">
                      <td className="px-4 py-3">
                        <PersonChip id={c.kind === "profile" ? c.id : undefined} name={c.display_name} avatar={c.avatar} role={c.role} size={26} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{c.username ?? ""}</td>
                      <td className="px-4 py-3 capitalize">{c.role}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.kind === "profile" ? studentProfiles.filter((s) => s.coach_id === c.id).length : ""}
                      </td>
                      <td className="px-4 py-3"><StatusPill status={c.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <RowMenu items={[
                          ...(c.kind === "profile" ? [
                            ...(c.role === "manager" && me.role === "ceo"
                              ? [{ label: "Permissions & title", onClick: () => void openPerms(c) }] : []),
                            ...(c.role === "manager" && me.role === "ceo" && c.status === "active"
                              ? [{ label: "Transfer Account…", onClick: () => { setRemoveReplacement(""); setTransferMode(true); setRemoveTarget(c); } }] : []),
                            { label: "Assign students", onClick: () => openAssign(c) },
                            ...(c.role !== "ceo" && c.id !== me.id
                              ? [{ label: "Reset password…", onClick: () => setResetTarget(c) }] : []),
                            c.status === "inactive"
                              ? { label: "Activate", onClick: () => setStatus(c, "active") }
                              : { label: "Deactivate", onClick: () => setStatus(c, "inactive") },
                            ...(me.role === "ceo"
                              ? [{ label: "Remove from academy…", onClick: () => { setRemoveReplacement(""); setTransferMode(false); setRemoveTarget(c); }, danger: true }]
                              : []),
                          ] : [
                            { label: "Delete invite", onClick: () => deleteStudent(c as (typeof students)[number]), danger: true },
                          ]),
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()
      )}

      {tab === "Batches" && (
        batches.length === 0 ? (
          <EmptyState text="No batches yet, group students under a coach."
            action={<Button onClick={() => setBatchModal(true)}>+ Create Batch</Button>} />
        ) : (
          /* Reference interaction: picking a batch ZOOMS its card out of the
             list into the main panel (shared layoutId), while the rest of the
             list collapses into a side rail. Closing reverses the flight. */
          <LayoutGroup>
            <div className={manageBatch ? "flex flex-col lg:flex-row gap-4 items-start" : ""}>
              <div className={manageBatch
                ? "flex lg:flex-col gap-3 w-full lg:w-64 shrink-0 overflow-x-auto"
                : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"}>
                {batches.map((b) => {
                  if (manageBatch?.id === b.id) return null; // it's on stage in the panel
                  const count = members.filter((m) => m.batch_id === b.id).length;
                  return (
                    <motion.div
                      key={b.id}
                      layout
                      layoutId={`batch-${b.id}`}
                      onClick={() => setManageBatch(b)}
                      className="cursor-pointer min-w-52 bg-surface-2 border border-border rounded-card p-5 shadow-card transition-shadow hover:shadow-raised"
                    >
                      <div className="flex items-start justify-between">
                        <h3 className="font-semibold">{b.name}</h3>
                        <span onClick={(e) => e.stopPropagation()}>
                          <RowMenu items={[
                            { label: "Manage members", onClick: () => setManageBatch(b) },
                            { label: "Change coach", onClick: () => { setReassignCoach(b.coach_id ?? ""); setReassignBatch(b); } },
                            { label: "Delete", onClick: () => deleteBatch(b), danger: true },
                          ]} />
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        Coach: {b.coach?.display_name ?? "Unassigned"}
                      </p>
                      <p className="text-sm text-muted-foreground">{count} student{count === 1 ? "" : "s"}</p>
                      {(b.category || b.total_classes) && (
                        <p className="text-xs text-muted-foreground mt-1 capitalize">
                          {b.category ?? ""}{b.category && b.total_classes ? " · " : ""}{b.total_classes ? `${b.total_classes} classes` : ""}
                        </p>
                      )}
                    </motion.div>
                  );
                })}
              </div>

              <AnimatePresence>
                {manageBatch && (
                  <motion.div
                    key={manageBatch.id}
                    layoutId={`batch-${manageBatch.id}`}
                    className="flex-1 min-w-0 w-full bg-surface-2 border border-border rounded-card p-6 shadow-raised"
                  >
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <h3 className="text-xl font-bold tracking-tight">{manageBatch.name}</h3>
                      <button onClick={() => setManageBatch(null)} aria-label="Close"
                        className="w-7 h-7 rounded-btn flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground hover:bg-surface-3"><X size={16} /></button>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      Coach: {manageBatch.coach?.display_name ?? "Unassigned"} · {batchMembers.length} student{batchMembers.length === 1 ? "" : "s"}
                    </p>

                    <div className="flex gap-2 mb-4">
                      <Select className="flex-1" value={memberToAdd} onChange={(e) => setMemberToAdd(e.target.value)}>
                        <option value="">Add a student…</option>
                        {studentProfiles.filter((s) => !batchMembers.includes(s.id)).map((s) => (
                          <option key={s.id} value={s.id}>{s.display_name}</option>
                        ))}
                      </Select>
                      <Button onClick={addMember} disabled={!memberToAdd}>Add</Button>
                    </div>
                    {batchMembers.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">No members yet.</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {batchMembers.map((id) => {
                          const s = studentProfiles.find((p) => p.id === id);
                          return (
                            <li key={id} className="flex items-center justify-between py-2">
                              <span className="flex items-center gap-2 text-sm">
                                <PersonChip id={s?.id} name={s?.display_name ?? id} avatar={s?.avatar} role="student" size={24} />
                              </span>
                              <Button variant="ghost" className="text-destructive text-sm" onClick={() => removeMember(id)}>
                                Remove
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-border">
                      <Button variant="secondary" onClick={() => { setReassignCoach(manageBatch.coach_id ?? ""); setReassignBatch(manageBatch); }}>
                        Change coach
                      </Button>
                      <Button variant="danger" onClick={() => { void deleteBatch(manageBatch); setManageBatch(null); }}>
                        Delete batch
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </LayoutGroup>
        )
      )}

      {tab === "Daily Logs" && me.role === "ceo" && (
        <DailyLogs
          academyId={me.academy_id}
          people={people}
          base={`/${me.role}/dashboard/${me.academy_id}`}
        />
      )}

      {/* Award coins / apply a penalty */}
      <Modal open={!!grantTarget} onClose={() => setGrantTarget(null)}
        title={grantMode === "coins" ? `Award coins: ${grantTarget?.display_name ?? ""}` : `Penalty: ${grantTarget?.display_name ?? ""}`}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {grantMode === "coins"
              ? "Coins are gifts: students spend them on avatars and board styles."
              : "A penalty subtracts leaderboard points. Use it for no-shows or misconduct."}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-muted-foreground">{grantMode === "coins" ? "Coins" : "Points to deduct"}</span>
              <Input type="number" min={1} className="w-full mt-1" value={grantForm.amount}
                onChange={(e) => setGrantForm({ ...grantForm, amount: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Reason</span>
              <Input className="w-full mt-1" placeholder={grantMode === "coins" ? "Great effort in class!" : "Missed class"}
                value={grantForm.reason} onChange={(e) => setGrantForm({ ...grantForm, reason: e.target.value })} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setGrantTarget(null)}>Cancel</Button>
            <Button variant={grantMode === "penalty" ? "danger" : "primary"} onClick={submitGrant}>
              {grantMode === "coins" ? "Send coins" : "Apply penalty"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Remove coach/manager, or Transfer Account - same handoff RPC, the
          transfer path just requires picking a successor and isn't framed
          as removing anyone. */}
      <Modal open={!!removeTarget} onClose={() => { setRemoveTarget(null); setTransferMode(false); }}
        title={transferMode
          ? `Transfer ${removeTarget?.display_name ?? ""}'s account`
          : `Remove ${removeTarget?.display_name ?? ""}?`}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {transferMode
              ? "Their leads, permission title/flags, assigned students, batches and upcoming classes all move to the person you pick below, and their own account is closed."
              : "Their assigned students, batches and upcoming classes move to the replacement you pick (or become unassigned). If they have teaching history, the account is deactivated instead of deleted so records stay intact."}
          </p>
          <label className="block text-sm">
            <span className="text-muted-foreground">{transferMode ? "New person taking over" : "Hand everything to"}</span>
            <Select className="w-full mt-1" value={removeReplacement}
              onChange={(e) => setRemoveReplacement(e.target.value)}>
              {!transferMode && <option value="">No one (leave unassigned, cancel their upcoming classes)</option>}
              {transferMode && <option value="">Pick a replacement…</option>}
              {staff.filter((s) => s.id !== removeTarget?.id && s.status === "active")
                .map((s) => <option key={s.id} value={s.id}>{s.display_name} ({s.role})</option>)}
            </Select>
          </label>
          {transferMode && (
            <p className="text-xs text-muted-foreground">
              Don&apos;t see them? Add them as a manager first (they need an account here before you can transfer anything to them).
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setRemoveTarget(null); setTransferMode(false); }}>Cancel</Button>
            <Button variant={transferMode ? "primary" : "danger"} onClick={removeMemberConfirmed} disabled={removeBusy || (transferMode && !removeReplacement)}>
              {removeBusy ? (transferMode ? "Transferring…" : "Removing…") : (transferMode ? "Transfer account" : "Remove member")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reset a member's password — confirm */}
      <Modal open={!!resetTarget} onClose={() => setResetTarget(null)}
        title={`Reset ${resetTarget?.display_name ?? ""}'s password?`}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            A one-time temporary password is generated for{" "}
            <span className="text-foreground">{resetTarget?.display_name}</span>{" "}
            (shown on the next screen for you to pass on). Their current password stops working
            immediately, and they&apos;ll be asked to choose a new one the next time they sign in.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button onClick={resetPasswordConfirmed} disabled={resetBusy}>
              {resetBusy ? "Resetting…" : "Reset password"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reset a member's password — result (temp password to hand over) */}
      <Modal open={!!resetResult} onClose={() => setResetResult(null)}
        title={`Temporary password for ${resetResult?.name ?? ""}`}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Give this to <span className="text-foreground">{resetResult?.name}</span> however you
            normally would. It works once — they set their own password on first sign-in, and it
            won&apos;t be shown again.
          </p>
          <div className="rounded-card border border-border bg-surface-2 px-4 py-3 text-center">
            <code className="text-lg font-mono tracking-wide select-all">{resetResult?.tempPassword}</code>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => {
              navigator.clipboard?.writeText(resetResult?.tempPassword ?? "");
              toast("Temporary password copied", "success");
            }}>Copy</Button>
            <Button onClick={() => setResetResult(null)}>Done</Button>
          </div>
        </div>
      </Modal>

      {/* Reassign a batch to another coach */}
      <Modal open={!!reassignBatch} onClose={() => setReassignBatch(null)}
        title={`Change coach: ${reassignBatch?.name ?? ""}`}>
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-muted-foreground">Coach</span>
            <Select className="w-full mt-1" value={reassignCoach}
              onChange={(e) => setReassignCoach(e.target.value)}>
              <option value="">Unassigned</option>
              {staff.filter((s) => s.status === "active")
                .map((s) => <option key={s.id} value={s.id}>{s.display_name} ({s.role})</option>)}
            </Select>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReassignBatch(null)}>Cancel</Button>
            <Button onClick={saveBatchCoach}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* Add Student / Add Coach → invite */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={addRole === "coach" ? "Add Coach" : "Add Student"}>
        {inviteCode ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Share this invite code: the {addRole} enters it at sign-up to join your academy.
            </p>
            <div className="bg-surface-2 border border-border rounded-btn p-4 text-center font-mono text-xl tracking-widest">
              {inviteCode}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => {
                navigator.clipboard?.writeText(inviteCode); toast("Code copied", "success");
              }}>Copy code</Button>
              <Button onClick={() => setAddOpen(false)}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block text-sm">
              <span className="text-muted-foreground">{addRole === "coach" ? "Coach" : "Student"} name</span>
              <Input className="w-full mt-1" value={newName} placeholder="e.g. Anita Rao"
                onChange={(e) => setNewName(e.target.value)} autoFocus />
            </label>
            <p className="text-xs text-muted-foreground">
              Username will be auto-generated ({newName.trim() ? makeUsername(newName).replace(/\d\d$/, "##") : "ca_name##"}).
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={addPerson}>Create invite</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit student */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Student">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-muted-foreground">Display name</span>
            <Input className="w-full mt-1" value={editName} onChange={(e) => setEditName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Tags (comma-separated)</span>
            <Input className="w-full mt-1" value={editTags} placeholder="beginner, u12"
              onChange={(e) => setEditTags(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={saveEdit}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* Manager permissions & title (V2: boolean flags, never title matching) */}
      <Modal open={!!permTarget} onClose={() => setPermTarget(null)}
        title={`Permissions: ${permTarget?.display_name ?? ""}`}>
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-muted-foreground">Role (display only; capabilities below are what&apos;s actually enforced)</span>
            <Select className="w-full mt-1"
              value={MANAGER_TITLES.includes(permForm.title) ? permForm.title : "Other"}
              onChange={(e) => setPermForm({ ...permForm, title: e.target.value === "Other" ? "" : e.target.value })}>
              {MANAGER_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value="Other">Other…</option>
            </Select>
            {!MANAGER_TITLES.includes(permForm.title) && (
              <Input className="w-full mt-1.5" value={permForm.title} placeholder="Custom role title"
                onChange={(e) => setPermForm({ ...permForm, title: e.target.value })} />
            )}
          </label>
          <div className="flex flex-col gap-1.5">
            {PERM_FLAGS.map(([flag, label]) => (
              <label key={flag} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-btn hover:bg-surface-3 cursor-pointer">
                <input type="checkbox" checked={permForm[flag]}
                  onChange={(e) => setPermForm({ ...permForm, [flag]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Capabilities are enforced by database row-level security. The title is a label, never a permission.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPermTarget(null)}>Cancel</Button>
            <Button onClick={savePerms}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* Assign students to coach (demo §1:17) */}
      <Modal open={!!assignCoach} onClose={() => setAssignCoach(null)}
        title={`Assign students: ${assignCoach?.display_name ?? ""}`}>
        <div className="space-y-4">
          {studentProfiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No students in the academy yet.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto flex flex-col gap-1">
              {studentProfiles.map((s) => (
                <label key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-btn hover:bg-surface-3 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={assignSel.includes(s.id)}
                    onChange={(e) => setAssignSel((sel) =>
                      e.target.checked ? [...sel, s.id] : sel.filter((id) => id !== s.id))}
                  />
                  <Avatar name={s.display_name} avatar={s.avatar} seed={s.id} role="student" size={22} />
                  {s.display_name}
                  {s.coach_id && s.coach_id !== assignCoach?.id && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      with {staff.find((c) => c.id === s.coach_id)?.display_name ?? "another coach"}
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAssignCoach(null)}>Cancel</Button>
            <Button onClick={saveAssign}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* Create batch */}
      <Modal open={batchModal} onClose={() => setBatchModal(false)} title="Create Batch">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-muted-foreground">Batch name</span>
            <Input className="w-full mt-1" value={batchName} placeholder="e.g. Beginners A"
              onChange={(e) => setBatchName(e.target.value)} autoFocus />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Coach</span>
            <Select className="w-full mt-1" value={batchCoach} onChange={(e) => setBatchCoach(e.target.value)}>
              <option value="">Unassigned</option>
              {staff.map((c) => <option key={c.id} value={c.id}>{c.display_name} ({c.role})</option>)}
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-muted-foreground">Type</span>
              <Select className="w-full mt-1" value={batchCategory} onChange={(e) => setBatchCategory(e.target.value)}>
                <option value="">-</option>
                <option value="group">Group</option>
                <option value="individual">Individual</option>
                <option value="buddy">Buddy</option>
              </Select>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Package size</span>
              <Select className="w-full mt-1" value={batchTotalClasses} onChange={(e) => setBatchTotalClasses(e.target.value)}>
                <option value="">-</option>
                <option value="24">24 classes</option>
                <option value="48">48 classes</option>
                <option value="96">96 classes</option>
              </Select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={batchRecurring} onChange={(e) => setBatchRecurring(e.target.checked)} />
            <span>Recurring weekly schedule</span>
          </label>
          {batchRecurring && (
            <div className="space-y-3 rounded-btn border border-border bg-surface-2 p-3">
              <div className="flex flex-wrap gap-1.5">
                {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => (
                  <button key={d} type="button"
                    onClick={() => setBatchDays((xs) => xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d])}
                    className={`rounded-btn border px-2 py-1 text-xs capitalize ${batchDays.includes(d) ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                    {d.slice(0, 3)}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs">Start<Input type="time" className="w-full mt-1" value={batchStart} onChange={(e) => setBatchStart(e.target.value)} /></label>
                <label className="block text-xs">End<Input type="time" className="w-full mt-1" value={batchEnd} onChange={(e) => setBatchEnd(e.target.value)} /></label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs">Ends
                  <Select className="w-full mt-1" value={batchEndType} onChange={(e) => setBatchEndType(e.target.value)}>
                    <option value="indefinite">Never</option>
                    <option value="count">After N classes</option>
                    <option value="date">On a date</option>
                  </Select>
                </label>
                {batchEndType === "count" && <label className="block text-xs">Count<Input type="number" min={1} className="w-full mt-1" value={batchCount} onChange={(e) => setBatchCount(e.target.value)} /></label>}
                {batchEndType === "date" && <label className="block text-xs">Date<Input type="date" className="w-full mt-1" value={batchEndDate} onChange={(e) => setBatchEndDate(e.target.value)} /></label>}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setBatchModal(false)}>Cancel</Button>
            <Button onClick={createBatch}>Create</Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
