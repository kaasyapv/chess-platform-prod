"use client";

import { useState } from "react";
import type { Profile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import {
  Button, EmptyState, Input, Modal, PageHeader, Person, RowMenu, Select, StatusPill,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";

export type Tournament = {
  id: string; title: string; kind: string; status: string;
  starts_at: string | null; time_control: string | null; created_at: string;
};
export type Player = {
  tournament_id: string; student_id: string; score: number;
  profile: { display_name: string; username: string | null; avatar: string | null } | null;
};

const KINDS = ["swiss", "round-robin", "knockout", "arena"];

export function TournamentsClient({
  me, isStaff, initialTournaments, initialPlayers, students,
}: {
  me: Profile; isStaff: boolean;
  initialTournaments: Tournament[]; initialPlayers: Player[];
  students: { id: string; display_name: string }[];
}) {
  const supabase = createClient();
  const toast = useToast();
  const [tournaments, setTournaments] = useState(initialTournaments);
  const [players, setPlayers] = useState(initialPlayers);
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: "", kind: "swiss", starts_at: "", time_control: "" });
  const [playerToAdd, setPlayerToAdd] = useState("");

  async function refetch() {
    const [t, p] = await Promise.all([
      supabase.from("tournaments")
        .select("id, title, kind, status, starts_at, time_control, created_at")
        .eq("academy_id", me.academy_id).order("created_at", { ascending: false }),
      supabase.from("tournament_players")
        .select("tournament_id, student_id, score, profile:profiles!student_id(display_name, username, avatar)"),
    ]);
    setTournaments((t.data ?? []) as Tournament[]);
    setPlayers((p.data ?? []) as unknown as Player[]);
  }

  const shown = tournaments.filter((t) =>
    (kindFilter === "all" || t.kind === kindFilter) &&
    (statusFilter === "all" || t.status === statusFilter));

  async function createTournament() {
    if (!form.title.trim()) return toast("Title is required", "error");
    const { error } = await supabase.from("tournaments").insert({
      academy_id: me.academy_id, title: form.title.trim(), kind: form.kind,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      time_control: form.time_control.trim() || null, created_by: me.id,
    });
    if (error) return toast(error.message, "error");
    setCreateOpen(false); setForm({ title: "", kind: "swiss", starts_at: "", time_control: "" });
    toast("Tournament created", "success");
    refetch();
  }

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("tournaments").update({ status }).eq("id", id);
    if (error) return toast(error.message, "error");
    // Completing a tournament pays the podium straight onto the leaderboard.
    if (status === "completed") {
      const podium = players
        .filter((p) => p.tournament_id === id)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const prize = [50, 30, 20];
      if (podium.length) {
        const { error: pErr } = await supabase.from("points_ledger").insert(podium.map((p, i) => ({
          academy_id: me.academy_id, student_id: p.student_id,
          points: prize[i], coins: i === 0 ? 10 : 0, reason: "tournament",
        })));
        if (pErr) toast(`Completed, but podium points failed: ${pErr.message}`, "error");
        else toast(`Tournament completed, podium awarded (${podium.length} player${podium.length === 1 ? "" : "s"})`, "success");
      }
    }
    refetch();
  }

  async function deleteTournament(id: string) {
    const { error } = await supabase.from("tournaments").delete().eq("id", id);
    if (error) return toast(error.message, "error");
    if (selected === id) setSelected(null);
    toast("Tournament deleted", "success");
    refetch();
  }

  async function registerPlayer() {
    if (!selected || !playerToAdd) return;
    const { error } = await supabase.from("tournament_players").insert({
      tournament_id: selected, student_id: playerToAdd,
    });
    if (error) return toast(error.message, "error");
    setPlayerToAdd("");
    toast("Player registered", "success");
    refetch();
  }

  async function removePlayer(studentId: string) {
    if (!selected) return;
    const { error } = await supabase.from("tournament_players").delete()
      .eq("tournament_id", selected).eq("student_id", studentId);
    if (error) return toast(error.message, "error");
    refetch();
  }

  async function saveScore(studentId: string, score: string) {
    if (!selected) return;
    const { error } = await supabase.from("tournament_players")
      .update({ score: parseFloat(score) || 0 })
      .eq("tournament_id", selected).eq("student_id", studentId);
    if (error) return toast(error.message, "error");
    refetch();
  }

  const standings = players
    .filter((p) => p.tournament_id === selected)
    .sort((a, b) => b.score - a.score);
  const selectedT = tournaments.find((t) => t.id === selected);

  return (
    <div>
      <PageHeader
        title="Tournaments"
        subtitle="Manage and track chess tournaments"
        action={isStaff && <Button onClick={() => setCreateOpen(true)}>+ Create Tournament</Button>}
      />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
          <option value="all">All Types</option>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          <option value="upcoming">Upcoming</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </div>

      {shown.length === 0 ? (
        <EmptyState text="No tournaments yet."
          action={isStaff && <Button onClick={() => setCreateOpen(true)}>+ Create Tournament</Button>} />
      ) : (
        <div className="bg-surface-2 border border-border rounded-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Starts</th>
                <th className="px-4 py-3 font-medium">Time control</th>
                <th className="px-4 py-3 font-medium">Players</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {isStaff && <th className="px-4 py-3 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id}
                  className={`border-b border-border last:border-0 cursor-pointer ${selected === t.id ? "bg-surface-3/70" : "hover:bg-surface-3/50"}`}
                  onClick={() => setSelected(selected === t.id ? null : t.id)}>
                  <td className="px-4 py-3 font-medium">{t.title}</td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{t.kind}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {t.starts_at ? new Date(t.starts_at).toLocaleString("en", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "TBD"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{t.time_control ?? ""}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {players.filter((p) => p.tournament_id === t.id).length}
                  </td>
                  <td className="px-4 py-3"><StatusPill status={t.status} /></td>
                  {isStaff && (
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <RowMenu items={[
                        ...(t.status === "upcoming" ? [{ label: "Start", onClick: () => setStatus(t.id, "running") }] : []),
                        ...(t.status === "running" ? [{ label: "Complete", onClick: () => setStatus(t.id, "completed") }] : []),
                        ...(t.status !== "completed" && t.status !== "cancelled" ? [{ label: "Cancel", onClick: () => setStatus(t.id, "cancelled") }] : []),
                        { label: "Delete", onClick: () => deleteTournament(t.id), danger: true },
                      ]} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedT && (
        <div className="mt-6 bg-surface-2 border border-border rounded-card p-5">
          <h2 className="font-semibold mb-3">Standings: {selectedT.title}</h2>
          {isStaff && (
            <div className="flex gap-2 mb-4">
              <Select className="flex-1 max-w-xs" value={playerToAdd} onChange={(e) => setPlayerToAdd(e.target.value)}>
                <option value="">Register a player…</option>
                {students.filter((s) => !standings.some((p) => p.student_id === s.id)).map((s) => (
                  <option key={s.id} value={s.id}>{s.display_name}</option>
                ))}
              </Select>
              <Button onClick={registerPlayer} disabled={!playerToAdd}>Register</Button>
            </div>
          )}
          {standings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No players registered yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Player</th>
                  <th className="px-3 py-2 font-medium">Score</th>
                  {isStaff && <th className="px-3 py-2 font-medium text-right"></th>}
                </tr>
              </thead>
              <tbody>
                {standings.map((p, i) => (
                  <tr key={p.student_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <Person id={p.student_id} name={p.profile?.display_name ?? p.student_id} avatar={p.profile?.avatar} role="student" size={24} />
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {isStaff ? (
                        <Input type="number" step={0.5} min={0} defaultValue={p.score}
                          className="w-20 py-1 text-sm"
                          onBlur={(e) => e.target.value !== String(p.score) && saveScore(p.student_id, e.target.value)} />
                      ) : p.score}
                    </td>
                    {isStaff && (
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" className="text-destructive text-sm py-1"
                          onClick={() => removePlayer(p.student_id)}>Remove</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Tournament">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-muted-foreground">Title</span>
            <Input className="w-full mt-1" value={form.title} autoFocus
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-muted-foreground">Type</span>
              <Select className="w-full mt-1" value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </Select>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Time control</span>
              <Input className="w-full mt-1" value={form.time_control} placeholder="e.g. 5+3"
                onChange={(e) => setForm({ ...form, time_control: e.target.value })} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-muted-foreground">Starts at</span>
            <Input className="w-full mt-1" type="datetime-local" value={form.starts_at}
              onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createTournament}>Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
