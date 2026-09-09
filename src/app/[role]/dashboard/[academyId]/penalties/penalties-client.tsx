"use client";

/* Absence/penalty system: the CEO's desk.
 *
 * The CEO applies penalties to any staff member -- coaches and managers alike
 * -- and decides the appeals. Nobody else opens this page (0025): a penalised
 * person reads the reason and appeals from their own Payment History, so a
 * manager is subject to the system without being an observer of it. */

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, PageHeader, Select, Input, StatusPill, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { inr } from "@/lib/finance";
import type { Profile } from "@/lib/auth";

const CATEGORIES: { value: string; label: string }[] = [
  { value: "late", label: "Joining late" },
  { value: "misbehavior", label: "Misbehavior" },
  { value: "no_recording", label: "Not recording session" },
  { value: "no_report", label: "Not updating report after session" },
  { value: "no_show", label: "No-show / missed class entirely" },
  { value: "unprofessional_conduct", label: "Unprofessional conduct" },
  { value: "policy_violation", label: "Policy violation" },
  { value: "other", label: "Other" },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

type Penalty = {
  id: string; coach_id: string; category: string; custom_reason: string | null;
  amount: number; status: "active" | "appealed" | "waived";
  appeal_reason: string | null; created_at: string;
  coach: { display_name: string } | null;
  applied_by_profile: { display_name: string } | null;
};
type Staff = { id: string; display_name: string; role: string };

export function PenaltiesClient({ me }: { me: Profile }) {
  const toast = useToast();
  const isCeo = me.role === "ceo";
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http");

  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Apply-penalty form (CEO only)
  const [coachId, setCoachId] = useState("");
  const [category, setCategory] = useState("late");
  const [customReason, setCustomReason] = useState("");
  const [amount, setAmount] = useState("0");
  const [submitting, setSubmitting] = useState(false);

  // Appeal form (coach only) - which penalty id has its textarea open
  const [appealingId, setAppealingId] = useState<string | null>(null);
  const [appealReason, setAppealReason] = useState("");

  // Which penalty is mid-delete, so its trash icon can show it is working.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!configured) return;
    const supabase = createClient();
    const [{ data: rows }, { data: coachRows }] = await Promise.all([
      supabase.from("coach_penalties")
        .select("id, coach_id, category, custom_reason, amount, status, appeal_reason, created_at, coach:profiles!coach_penalties_coach_id_fkey(display_name), applied_by_profile:profiles!coach_penalties_applied_by_fkey(display_name)")
        .order("created_at", { ascending: false }),
      isCeo
        ? supabase.from("profiles").select("id, display_name, role")
            .in("role", ["coach", "manager"]).eq("status", "active").order("display_name")
        : Promise.resolve({ data: [] }),
    ]);
    setPenalties((rows ?? []) as unknown as Penalty[]);
    setStaff((coachRows ?? []) as Staff[]);
    setLoaded(true);
  }, [configured, isCeo]);

  useEffect(() => { void load(); }, [load]);

  async function applyPenalty() {
    if (!coachId) { toast("Pick who this applies to", "error"); return; }
    if (category === "other" && !customReason.trim()) { toast("Add a reason for \"Other\"", "error"); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) { toast("Amount must be 0 or more", "error"); return; }
    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.from("coach_penalties").insert({
      academy_id: me.academy_id, coach_id: coachId, category,
      custom_reason: category === "other" ? customReason.trim() : null,
      amount: amt, applied_by: me.id,
    });
    setSubmitting(false);
    if (error) { toast(error.message, "error"); return; }
    toast("Penalty applied", "success");
    setCoachId(""); setCategory("late"); setCustomReason(""); setAmount("0");
    void load();
  }

  async function submitAppeal(id: string) {
    if (!appealReason.trim()) { toast("Explain why you're appealing", "error"); return; }
    const supabase = createClient();
    const { error } = await supabase.rpc("appeal_penalty", { p_id: id, p_reason: appealReason.trim() });
    if (error) { toast(error.message, "error"); return; }
    toast("Appeal sent to CEO", "success");
    setAppealingId(null); setAppealReason("");
    void load();
  }

  /* Undo, not waive. A waived penalty stays on the record because it is the
   * outcome of an appeal; a penalty issued against the wrong person or for the
   * wrong amount is a typo and should vanish. Removing the row is what makes
   * the outstanding total and the coach's statement recalculate, since both
   * derive from these rows rather than from a stored balance. */
  async function removePenalty(p: Penalty) {
    const who = p.coach?.display_name ?? "this person";
    if (!confirm(`Delete the ${inr(p.amount)} penalty on ${who}? Their earnings recalculate immediately.`)) return;
    setDeletingId(p.id);
    const supabase = createClient();
    const { error } = await supabase.from("coach_penalties").delete().eq("id", p.id);
    setDeletingId(null);
    if (error) { toast(error.message, "error"); return; }
    // Drop it locally first so the total moves on the click, then reconcile.
    setPenalties((cur) => cur.filter((x) => x.id !== p.id));
    toast("Penalty deleted", "success");
    void load();
  }

  async function decide(id: string, approve: boolean) {
    const supabase = createClient();
    const { error } = await supabase.rpc("decide_penalty_appeal", { p_id: id, p_approve: approve });
    if (error) { toast(error.message, "error"); return; }
    toast(approve ? "Appeal approved, penalty removed" : "Appeal declined, penalty stands", "success");
    void load();
  }

  const totalActive = penalties.filter((p) => p.status !== "waived").reduce((s, p) => s + p.amount, 0);
  const reasonText = (p: Penalty) => p.category === "other" ? (p.custom_reason || "Other") : CATEGORY_LABEL[p.category] ?? p.category;

  return (
    <div>
      <PageHeader title="Penalties" subtitle="Absences, conduct issues, and their financial impact" />

      {isCeo && (
        <Card className="mb-4">
          <p className="text-sm font-semibold mb-3">Apply a penalty</p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Select value={coachId} onChange={(e) => setCoachId(e.target.value)}>
              <option value="">Coach or manager…</option>
              {staff.map((c) => (
                <option key={c.id} value={c.id}>{c.display_name} ({c.role})</option>
              ))}
            </Select>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
            <Input type="number" min="0" step="1" placeholder="Amount (₹)" value={amount}
              onChange={(e) => setAmount(e.target.value)} />
            <Button onClick={applyPenalty} disabled={submitting}>{submitting ? "Applying…" : "Apply"}</Button>
          </div>
          {category === "other" && (
            <Input className="mt-2 w-full" placeholder="Custom reason" value={customReason}
              onChange={(e) => setCustomReason(e.target.value)} />
          )}
        </Card>
      )}

      <p className="text-sm text-muted-foreground mb-2">
        Total outstanding (active + appealed): <span className="font-semibold text-foreground">{inr(totalActive)}</span>
      </p>

      {!loaded ? null : penalties.length === 0 ? (
        <EmptyState text="No penalties recorded." />
      ) : (
        <div className="flex flex-col gap-2">
          {penalties.map((p) => (
            <Card key={p.id} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-medium">
                  {p.coach?.display_name ?? "Coach"} · {reasonText(p)} · <span className="text-muted-foreground">{inr(p.amount)}</span>
                </p>
                <span className="flex items-center gap-2">
                  <StatusPill status={p.status} />
                  {isCeo && (
                    <button
                      type="button"
                      onClick={() => removePenalty(p)}
                      disabled={deletingId === p.id}
                      aria-label={`Delete penalty on ${p.coach?.display_name ?? "this person"}`}
                      title="Delete this penalty"
                      className="text-muted-foreground hover:text-destructive disabled:opacity-40 transition-colors p-1 -m-1 rounded-btn"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Applied by {p.applied_by_profile?.display_name ?? "?"} on {new Date(p.created_at).toLocaleDateString()}
              </p>
              {p.appeal_reason && (
                <p className="text-xs bg-surface-2 rounded px-2 py-1">
                  <span className="font-medium">Appeal:</span> {p.appeal_reason}
                </p>
              )}

              {/* Coach: appeal an active penalty of their own */}
              {!isCeo && p.coach_id === me.id && p.status === "active" && (
                appealingId === p.id ? (
                  <div className="flex gap-2 mt-1">
                    <Input className="flex-1" placeholder="Why should this be removed?"
                      value={appealReason} onChange={(e) => setAppealReason(e.target.value)} />
                    <Button variant="secondary" onClick={() => submitAppeal(p.id)}>Send</Button>
                    <Button variant="secondary" onClick={() => setAppealingId(null)}>Cancel</Button>
                  </div>
                ) : (
                  <Button variant="secondary" className="self-start mt-1" onClick={() => setAppealingId(p.id)}>Appeal</Button>
                )
              )}

              {/* CEO: decide a pending appeal */}
              {isCeo && p.status === "appealed" && (
                <div className="flex gap-2 mt-1">
                  <Button onClick={() => decide(p.id, true)}>Approve appeal (remove)</Button>
                  <Button variant="danger" onClick={() => decide(p.id, false)}>Decline (keep)</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
