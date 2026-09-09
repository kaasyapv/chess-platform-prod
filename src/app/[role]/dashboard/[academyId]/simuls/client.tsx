"use client";

import { useState } from "react";
import type { Profile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import {
  Button, EmptyState, Input, Modal, PageHeader, Person, RowMenu, Select, StatusPill,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";

export type Simul = {
  id: string; title: string; status: string; starts_at: string | null;
  created_at: string; host: { id: string; display_name: string; avatar: string | null } | null;
};
export type SimulPlayer = {
  simul_id: string; student_id: string; result: string | null;
  profile: { id: string; display_name: string; avatar: string | null } | null;
};

export function SimulsClient({
  me, isStaff, initialSimuls, initialPlayers, people,
}: {
  me: Profile; isStaff: boolean;
  initialSimuls: Simul[]; initialPlayers: SimulPlayer[];
  people: { id: string; display_name: string; role: string }[];
}) {
  const supabase = createClient();
  const toast = useToast();
  const [simuls, setSimuls] = useState(initialSimuls);
  const [players, setPlayers] = useState(initialPlayers);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: "", host_id: me.id, starts_at: "" });
  const [playerToAdd, setPlayerToAdd] = useState("");

  const staff = people.filter((p) => p.role !== "student");
  const students = people.filter((p) => p.role === "student");

  async function refetch() {
    const [s, p] = await Promise.all([
      supabase.from("simuls")
        .select("id, title, status, starts_at, created_at, host:profiles!host_id(id, display_name, avatar)")
        .eq("academy_id", me.academy_id).order("created_at", { ascending: false }),
      supabase.from("simul_players")
        .select("simul_id, student_id, result, profile:profiles!student_id(id, display_name, avatar)"),
    ]);
    setSimuls((s.data ?? []) as unknown as Simul[]);
    setPlayers((p.data ?? []) as unknown as SimulPlayer[]);
  }

  const shown = simuls.filter((s) => statusFilter === "all" || s.status === statusFilter);

  async function createSimul() {
    if (!form.title.trim()) return toast("Title is required", "error");
    const { error } = await supabase.from("simuls").insert({
      academy_id: me.academy_id, title: form.title.trim(), host_id: form.host_id,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
    });
    if (error) return toast(error.message, "error");
    setCreateOpen(false); setForm({ title: "", host_id: me.id, starts_at: "" });
    toast("Simul created", "success");
    refetch();
  }

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("simuls").update({ status }).eq("id", id);
    if (error) return toast(error.message, "error");
    refetch();
  }

  async function deleteSimul(id: string) {
    const { error } = await supabase.from("simuls").delete().eq("id", id);
    if (error) return toast(error.message, "error");
    if (selected === id) setSelected(null);
    toast("Simul deleted", "success");
    refetch();
  }

  async function addPlayer() {
    if (!selected || !playerToAdd) return;
    const { error } = await supabase.from("simul_players").insert({
      simul_id: selected, student_id: playerToAdd,
    });
    if (error) return toast(error.message, "error");
    setPlayerToAdd("");
    refetch();
  }

  async function removePlayer(studentId: string) {
    if (!selected) return;
    const { error } = await supabase.from("simul_players").delete()
      .eq("simul_id", selected).eq("student_id", studentId);
    if (error) return toast(error.message, "error");
    refetch();
  }

  async function setResult(studentId: string, result: string) {
    if (!selected) return;
    const { error } = await supabase.from("simul_players")
      .update({ result: result || null })
      .eq("simul_id", selected).eq("student_id", studentId);
    if (error) return toast(error.message, "error");
    refetch();
  }

  const participants = players.filter((p) => p.simul_id === selected);
  const selectedS = simuls.find((s) => s.id === selected);

  return (
    <div>
      <PageHeader
        title="Simuls"
        subtitle="Simultaneous Exhibitions: watch masters play multiple games at once"
        action={isStaff && <Button onClick={() => setCreateOpen(true)}>+ Create Simul</Button>}
      />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          <option value="upcoming">Upcoming</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </div>

      {shown.length === 0 ? (
        <EmptyState text="No simuls yet."
          action={isStaff && <Button onClick={() => setCreateOpen(true)}>+ Create Simul</Button>} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map((s) => (
            <div key={s.id}
              className={`bg-surface-2 border rounded-card p-5 cursor-pointer transition-colors ${
                selected === s.id ? "border-primary" : "border-border hover:border-primary/50"}`}
              onClick={() => setSelected(selected === s.id ? null : s.id)}>
              <div className="flex items-start justify-between">
                <h3 className="font-semibold">{s.title}</h3>
                {isStaff && (
                  <span onClick={(e) => e.stopPropagation()}>
                    <RowMenu items={[
                      ...(s.status === "upcoming" ? [{ label: "Start", onClick: () => setStatus(s.id, "running") }] : []),
                      ...(s.status === "running" ? [{ label: "Complete", onClick: () => setStatus(s.id, "completed") }] : []),
                      ...(s.status !== "completed" && s.status !== "cancelled" ? [{ label: "Cancel", onClick: () => setStatus(s.id, "cancelled") }] : []),
                      { label: "Delete", onClick: () => deleteSimul(s.id), danger: true },
                    ]} />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                Host: <Person id={s.host?.id} name={s.host?.display_name ?? "?"} avatar={s.host?.avatar} role="coach" size={22} />
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {s.starts_at ? new Date(s.starts_at).toLocaleString("en", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Start TBD"}
                {" · "}{players.filter((p) => p.simul_id === s.id).length} participant{players.filter((p) => p.simul_id === s.id).length === 1 ? "" : "s"}
              </p>
              <div className="mt-2"><StatusPill status={s.status} /></div>
            </div>
          ))}
        </div>
      )}

      {selectedS && (
        <div className="mt-6 bg-surface-2 border border-border rounded-card p-5">
          <h2 className="font-semibold mb-3">Participants: {selectedS.title}</h2>
          {isStaff && (
            <div className="flex gap-2 mb-4">
              <Select className="flex-1 max-w-xs" value={playerToAdd} onChange={(e) => setPlayerToAdd(e.target.value)}>
                <option value="">Add a participant…</option>
                {students.filter((s) => !participants.some((p) => p.student_id === s.id)).map((s) => (
                  <option key={s.id} value={s.id}>{s.display_name}</option>
                ))}
              </Select>
              <Button onClick={addPlayer} disabled={!playerToAdd}>Add</Button>
            </div>
          )}
          {participants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No participants yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {participants.map((p) => (
                <li key={p.student_id} className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-2 text-sm">
                    <Person id={p.student_id} name={p.profile?.display_name ?? p.student_id} avatar={p.profile?.avatar} role="student" size={24} />
                    {!isStaff && p.result && <span className="text-muted-foreground">({p.result})</span>}
                  </span>
                  {isStaff && (
                    <span className="flex items-center gap-2">
                      <Select value={p.result ?? ""} onChange={(e) => setResult(p.student_id, e.target.value)}
                        className="text-sm py-1">
                        <option value="">Result…</option>
                        <option value="host-win">Host won</option>
                        <option value="student-win">Student won</option>
                        <option value="draw">Draw</option>
                      </Select>
                      <Button variant="ghost" className="text-destructive text-sm py-1"
                        onClick={() => removePlayer(p.student_id)}>Remove</Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Simul">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-muted-foreground">Title</span>
            <Input className="w-full mt-1" value={form.title} autoFocus
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Host</span>
            <Select className="w-full mt-1" value={form.host_id}
              onChange={(e) => setForm({ ...form, host_id: e.target.value })}>
              {staff.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </Select>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Starts at</span>
            <Input className="w-full mt-1" type="datetime-local" value={form.starts_at}
              onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createSimul}>Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
