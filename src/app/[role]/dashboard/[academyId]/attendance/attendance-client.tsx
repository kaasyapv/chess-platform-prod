"use client";

/* Offline Attendance Management - platform-sections.md #9: overview, student
 * search, batch filter, date, Quick Actions (Mark All Present/Absent, Clear
 * Changes), save; future-date guard toast (also enforced by DB trigger). */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, PageHeader, SearchInput, Select, Person, StatusPill, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

type Student = { id: string; display_name: string; username: string | null; avatar: string | null };
type Batch = { id: string; name: string };
type Status = "present" | "absent" | "late" | "excused";

const STATUSES: Status[] = ["present", "absent", "late", "excused"];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AttendanceClient({ academyId, markerId }: { academyId: string; markerId: string }) {
  const toast = useToast();
  const [students, setStudents] = useState<Student[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchMembers, setBatchMembers] = useState<Record<string, string[]>>({});
  const [date, setDate] = useState(today());
  const [batchFilter, setBatchFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [saved, setSaved] = useState<Record<string, Status>>({});
  const [busy, setBusy] = useState(false);

  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http");

  const load = useCallback(async (onDate: string) => {
    if (!configured) return;
    const supabase = createClient();
    const [{ data: profs }, { data: bs }, { data: members }, { data: recs }] = await Promise.all([
      supabase.from("profiles").select("id, display_name, username, avatar").eq("role", "student").eq("status", "active").order("display_name"),
      supabase.from("batches").select("id, name").order("name"),
      supabase.from("batch_members").select("batch_id, student_id"),
      supabase.from("attendance_records").select("student_id, status").eq("on_date", onDate),
    ]);
    setStudents(profs ?? []);
    setBatches(bs ?? []);
    const bm: Record<string, string[]> = {};
    (members ?? []).forEach((m) => { (bm[m.batch_id] ??= []).push(m.student_id); });
    setBatchMembers(bm);
    const existing: Record<string, Status> = {};
    (recs ?? []).forEach((r) => { existing[r.student_id] = r.status as Status; });
    setSaved(existing);
    setMarks(existing);
  }, [configured]);

  useEffect(() => { void load(date); }, [date, load]);

  function changeDate(d: string) {
    if (d > today()) {
      toast("Cannot view attendance for future dates", "error");
      return;
    }
    setDate(d);
  }

  const visible = students.filter((s) => {
    if (batchFilter !== "all" && !(batchMembers[batchFilter] ?? []).includes(s.id)) return false;
    if (search && !s.display_name.toLowerCase().includes(search.toLowerCase())
        && !(s.username ?? "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function markAll(status: Status) {
    setMarks((m) => {
      const next = { ...m };
      visible.forEach((s) => { next[s.id] = status; });
      return next;
    });
  }

  async function save() {
    if (!configured) { toast("Supabase not configured", "error"); return; }
    setBusy(true);
    const supabase = createClient();
    const rows = Object.entries(marks).map(([student_id, status]) => ({
      academy_id: academyId, student_id, status, on_date: date, marked_by: markerId,
      batch_id: batchFilter !== "all" ? batchFilter : null,
    }));
    const { error } = await supabase.from("attendance_records").upsert(rows, { onConflict: "student_id,on_date" });
    setBusy(false);
    if (error) { toast(error.message, "error"); return; }
    setSaved(marks);
    toast("Attendance saved", "success");
  }

  const counts = STATUSES.map((s) => ({ s, n: Object.values(marks).filter((v) => v === s).length }));
  const dirty = JSON.stringify(marks) !== JSON.stringify(saved);

  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle="Offline Attendance Management"
        action={<Button onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : "Save Attendance"}</Button>}
      />

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input
          type="date" value={date} max={today()}
          onChange={(e) => changeDate(e.target.value)}
          className="bg-surface-2 border border-border rounded-btn px-3 py-2"
        />
        <Select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
          <option value="all">All batches</option>
          {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
        <SearchInput placeholder="Search student…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex gap-2 ml-auto">
          <Button variant="secondary" onClick={() => markAll("present")}>Mark All Present</Button>
          <Button variant="secondary" onClick={() => markAll("absent")}>Mark All Absent</Button>
          <Button variant="ghost" onClick={() => setMarks(saved)}>Clear Changes</Button>
        </div>
      </div>

      <div className="flex gap-3 mb-4 text-sm">
        {counts.map(({ s, n }) => (
          <span key={s} className="flex items-center gap-1.5">
            <StatusPill status={s} /> <span className="text-muted-foreground">{n}</span>
          </span>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState text="No students match. Add students in Academy first." />
      ) : (
        <Card className="p-0 overflow-hidden">
          {visible.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0">
              <div className="flex-1 min-w-0">
                <Person id={s.id} name={s.display_name} avatar={s.avatar} role="student" size={32} className="font-medium" />
                <p className="text-xs text-muted-foreground">{s.username}</p>
              </div>
              <div className="flex gap-1">
                {STATUSES.map((st) => (
                  <button
                    key={st}
                    onClick={() => setMarks((m) => ({ ...m, [s.id]: st }))}
                    className={`px-3 py-1 rounded-btn text-xs font-medium capitalize transition-colors ${
                      marks[s.id] === st
                        ? st === "present" ? "bg-success/25 text-success"
                          : st === "absent" ? "bg-destructive/25 text-destructive"
                          : "bg-warning/25 text-warning"
                        : "bg-surface-3 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
