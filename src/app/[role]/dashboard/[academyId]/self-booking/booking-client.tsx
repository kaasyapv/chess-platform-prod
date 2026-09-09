"use client";

/* Self Booking - platform-sections.md #10: availability rules + booking,
 * RBAC-gated (coaches own their rules; the observed "You do not have
 * permission…" toast pattern is enforced by RLS avail_own policy). */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, EmptyState, PageHeader, SegmentedTabs, Select, StatusPill } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import type { Role } from "@/lib/auth";

type Rule = { id: string; coach_id: string; weekday: number; start_time: string; end_time: string; slot_minutes: number };
type Booking = { id: string; coach_id: string; student_id: string; starts_at: string; duration_minutes: number; status: string };
type Coach = { id: string; display_name: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SelfBookingClient({ profileId, academyId, role }: { profileId: string; academyId: string; role: Role }) {
  const toast = useToast();
  const isCoach = role === "coach";
  const isStudent = role === "student";
  const [tab, setTab] = useState(isCoach ? "Availability" : "Book a session");
  const [rules, setRules] = useState<Rule[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [coachSel, setCoachSel] = useState("");
  // new rule form
  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState("16:00");
  const [end, setEnd] = useState("19:00");
  const [slotMin, setSlotMin] = useState(60);

  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http");

  const load = useCallback(async () => {
    if (!configured) return;
    const supabase = createClient();
    const [{ data: rs }, { data: bs }, { data: cs }] = await Promise.all([
      supabase.from("availability_rules").select("*"),
      supabase.from("bookings").select("*").gte("starts_at", new Date(Date.now() - 86400000).toISOString()).order("starts_at"),
      supabase.from("profiles").select("id, display_name").eq("role", "coach").eq("status", "active"),
    ]);
    setRules(rs ?? []);
    setBookings(bs ?? []);
    setCoaches(cs ?? []);
    if (cs?.length && !coachSel) setCoachSel(cs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  useEffect(() => { void load(); }, [load]);

  async function addRule() {
    const supabase = createClient();
    const { error } = await supabase.from("availability_rules").insert({
      academy_id: academyId, coach_id: profileId, weekday,
      start_time: start, end_time: end, slot_minutes: slotMin,
    });
    if (error) { toast(error.message.includes("policy") ? "You do not have permission to manage availability rules" : error.message, "error"); return; }
    toast("Availability added", "success");
    void load();
  }

  async function removeRule(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("availability_rules").delete().eq("id", id);
    if (error) { toast("You do not have permission to modify this rule", "error"); return; }
    void load();
  }

  /** Open slots for the selected coach over the next 14 days. */
  function openSlots(): { starts: Date; rule: Rule }[] {
    const out: { starts: Date; rule: Rule }[] = [];
    const coachRules = rules.filter((r) => r.coach_id === coachSel);
    const taken = new Set(
      bookings.filter((b) => b.coach_id === coachSel && b.status === "booked")
        .map((b) => new Date(b.starts_at).getTime()),
    );
    const now = new Date();
    for (let d = 0; d < 14; d++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      for (const r of coachRules.filter((r) => r.weekday === day.getDay())) {
        const [sh, sm] = r.start_time.split(":").map(Number);
        const [eh, em] = r.end_time.split(":").map(Number);
        const from = new Date(day); from.setHours(sh, sm, 0, 0);
        const to = new Date(day); to.setHours(eh, em, 0, 0);
        for (let t = from.getTime(); t + r.slot_minutes * 60000 <= to.getTime(); t += r.slot_minutes * 60000) {
          if (t > Date.now() && !taken.has(t)) out.push({ starts: new Date(t), rule: r });
        }
      }
    }
    return out.slice(0, 40);
  }

  async function book(slot: { starts: Date; rule: Rule }) {
    const supabase = createClient();
    const { error } = await supabase.from("bookings").insert({
      academy_id: academyId, coach_id: coachSel, student_id: profileId,
      starts_at: slot.starts.toISOString(), duration_minutes: slot.rule.slot_minutes,
    });
    if (error) { toast(error.message, "error"); return; }
    toast("Session booked", "success");
    void load();
  }

  async function cancel(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", id);
    if (error) { toast(error.message, "error"); return; }
    void load();
  }

  const tabs = [
    ...(isCoach ? ["Availability"] : []),
    ...(isStudent ? ["Book a session"] : []),
    "My bookings",
  ];

  return (
    <div>
      <PageHeader title="Self Booking" subtitle="Coach availability and one-on-one session booking" />
      <div className="mb-5"><SegmentedTabs tabs={tabs} active={tab} onChange={setTab} /></div>

      {tab === "Availability" && isCoach && (
        <div className="flex flex-col gap-4 max-w-2xl">
          <Card>
            <h2 className="font-medium mb-3">Add availability</h2>
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
              </Select>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="bg-surface-2 border border-border rounded-btn px-3 py-2" />
              <span className="text-muted-foreground">to</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="bg-surface-2 border border-border rounded-btn px-3 py-2" />
              <Select value={slotMin} onChange={(e) => setSlotMin(Number(e.target.value))}>
                {[30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min slots</option>)}
              </Select>
              <Button onClick={addRule}>Add</Button>
            </div>
          </Card>
          {rules.filter((r) => r.coach_id === profileId).length === 0 ? (
            <EmptyState text="No availability rules yet." />
          ) : (
            <Card className="p-0 overflow-hidden">
              {rules.filter((r) => r.coach_id === profileId).map((r) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0">
                  <span>{WEEKDAYS[r.weekday]} · {r.start_time.slice(0, 5)}-{r.end_time.slice(0, 5)} · {r.slot_minutes}min</span>
                  <Button variant="ghost" onClick={() => removeRule(r.id)}>Delete</Button>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {tab === "Book a session" && isStudent && (
        <div className="max-w-2xl flex flex-col gap-4">
          <Select value={coachSel} onChange={(e) => setCoachSel(e.target.value)} className="w-64">
            {coaches.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
          </Select>
          {openSlots().length === 0 ? (
            <EmptyState text="No open slots in the next 14 days for this coach." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {openSlots().map((s) => (
                <button
                  key={s.starts.getTime()}
                  onClick={() => book(s)}
                  className="border border-border rounded-btn px-3 py-2 text-sm hover:bg-surface-3 hover:border-primary transition-colors text-left"
                >
                  <span className="block font-medium">{s.starts.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
                  <span className="text-muted-foreground">{s.starts.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · {s.rule.slot_minutes}min</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "My bookings" && (
        bookings.filter((b) => b.student_id === profileId || b.coach_id === profileId).length === 0 ? (
          <EmptyState text="No bookings yet." />
        ) : (
          <Card className="p-0 overflow-hidden max-w-2xl">
            {bookings.filter((b) => b.student_id === profileId || b.coach_id === profileId).map((b) => (
              <div key={b.id} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0">
                <div>
                  <p className="font-medium">{new Date(b.starts_at).toLocaleString()} · {b.duration_minutes}min</p>
                  <p className="text-xs text-muted-foreground">
                    Coach: {coaches.find((c) => c.id === b.coach_id)?.display_name ?? ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status={b.status} />
                  {b.status === "booked" && <Button variant="ghost" onClick={() => cancel(b.id)}>Cancel</Button>}
                </div>
              </div>
            ))}
          </Card>
        )
      )}
    </div>
  );
}
