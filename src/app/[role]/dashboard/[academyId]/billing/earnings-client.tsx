"use client";

/* Payment History for the people the academy pays: coaches, and managers who
 * have been penalised.
 *
 * One statement, newest first: a line per completed class at the flat session
 * rate, a line per penalty. The arithmetic lives in lib/finance.ts so it can be
 * tested without a browser, and the Excel export is built from the same rows
 * the table renders -- a spreadsheet that disagrees with the screen is worse
 * than no spreadsheet. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, Input, Modal, PageHeader, StatusPill } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { inr, paymentRows, paymentTotals, SESSION_RATE_INR, type PaymentRow } from "@/lib/finance";
import type { Profile } from "@/lib/auth";

type Session = { id: string; title: string; scheduled_at: string };
type Penalty = {
  id: string; amount: number; status: string; category: string;
  custom_reason: string | null; appeal_reason: string | null; created_at: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  late: "Joining late",
  misbehavior: "Misbehavior",
  no_recording: "Not recording session",
  no_report: "Not updating report after session",
  no_show: "No-show / missed class entirely",
  unprofessional_conduct: "Unprofessional conduct",
  policy_violation: "Policy violation",
  other: "Other",
};

const reasonOf = (p: Penalty) =>
  p.category === "other" ? (p.custom_reason || "Other") : CATEGORY_LABEL[p.category] ?? p.category;

export function EarningsClient({ me }: { me: Profile }) {
  const toast = useToast();
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http");

  const [sessions, setSessions] = useState<Session[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<Penalty | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!configured) { setLoaded(true); return; }
    const supabase = createClient();
    const [{ data: classes }, { data: pens }] = await Promise.all([
      supabase.from("classrooms")
        .select("id, title, scheduled_at")
        .eq("coach_id", me.id).eq("status", "completed")
        .order("scheduled_at", { ascending: false }).limit(500),
      // RLS returns only this person's own rows (0025) -- no filter needed here,
      // and none would help if the policy were wrong.
      supabase.from("coach_penalties")
        .select("id, amount, status, category, custom_reason, appeal_reason, created_at")
        .eq("coach_id", me.id)
        .order("created_at", { ascending: false }),
    ]);
    setSessions((classes ?? []) as Session[]);
    setPenalties((pens ?? []) as Penalty[]);
    setLoaded(true);
  }, [configured, me.id]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(
    () => paymentRows(
      sessions,
      penalties.map((p) => ({
        id: p.id, amount: p.amount, status: p.status,
        reason: reasonOf(p), created_at: p.created_at,
      })),
    ),
    [sessions, penalties],
  );
  const totals = useMemo(() => paymentTotals(rows), [rows]);

  async function submitAppeal() {
    if (!open) return;
    if (!appealReason.trim()) { toast("Explain why you are appealing", "error"); return; }
    setSending(true);
    const { error } = await createClient()
      .rpc("appeal_penalty", { p_id: open.id, p_reason: appealReason.trim() });
    setSending(false);
    if (error) { toast(error.message, "error"); return; }
    toast("Appeal sent to the CEO", "success");
    setOpen(null); setAppealReason("");
    void load();
  }

  const penaltyOf = (r: PaymentRow) => penalties.find((p) => p.id === r.penaltyId) ?? null;

  return (
    <div>
      <PageHeader
        title="Payment History"
        action={
          // A file download, not a page: <Link> would soft-navigate and never
          // hand the browser the spreadsheet.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a
            href="/api/export/payments"
            className="inline-flex items-center rounded-btn bg-primary hover:bg-primary-hover text-primary-foreground px-4 py-2 text-sm font-medium transition-colors"
          >
            Download to Excel
          </a>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <p className="text-2xl font-bold tabular-nums">{totals.sessions}</p>
          <p className="text-xs text-muted-foreground mt-1">Sessions taught</p>
        </Card>
        <Card>
          <p className="text-2xl font-bold tabular-nums">{inr(totals.gross)}</p>
          <p className="text-xs text-muted-foreground mt-1">Earnings at {inr(SESSION_RATE_INR)}/session</p>
        </Card>
        <Card>
          <p className="text-2xl font-bold tabular-nums text-destructive">
            {totals.deductions ? `-${inr(totals.deductions)}` : inr(0)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Deductions</p>
        </Card>
        <Card className="border-primary/40">
          <p className="text-2xl font-bold tabular-nums">{inr(totals.net)}</p>
          <p className="text-xs text-muted-foreground mt-1">Net payable</p>
        </Card>
      </div>

      {!loaded ? null : rows.length === 0 ? (
        <EmptyState text="No sessions or deductions yet. Completed classes appear here." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Class</th>
                  <th className="px-4 py-2.5 font-medium text-right">Earnings</th>
                  <th className="px-4 py-2.5 font-medium text-right">Deductions</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const p = penaltyOf(r);
                  return (
                    <tr key={r.penaltyId ?? `s-${i}`} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground tabular-nums">
                        {new Date(r.at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5">
                        {p ? (
                          // The whole penalty line is the click target: the ask
                          // is "click it, see the reason, appeal".
                          <button onClick={() => { setOpen(p); setAppealReason(""); }}
                            className="text-left hover:underline">
                            <span className="text-destructive font-medium">Penalty</span>
                            <span className="text-muted-foreground"> · {r.label}</span>
                          </button>
                        ) : r.label}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {r.earned ? inr(r.earned) : ""}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-destructive">
                        {r.deducted ? `-${inr(r.deducted)}` : ""}
                      </td>
                      <td className="px-4 py-2.5">
                        {p && <StatusPill status={p.status} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="px-4 py-3" colSpan={2}>Total</td>
                  <td className="px-4 py-3 text-right tabular-nums">{inr(totals.gross)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-destructive">
                    {totals.deductions ? `-${inr(totals.deductions)}` : ""}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{inr(totals.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title="Penalty">
        {open && (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Reason</p>
              <p className="font-medium">{reasonOf(open)}</p>
            </div>
            <div className="flex gap-6">
              <div>
                <p className="text-sm text-muted-foreground">Amount</p>
                <p className="font-medium tabular-nums">{inr(open.amount)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Applied</p>
                <p className="font-medium">{new Date(open.created_at).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <StatusPill status={open.status} />
              </div>
            </div>

            {open.appeal_reason && (
              <div className="bg-surface-2 rounded-card px-3 py-2 text-sm">
                <span className="font-medium">Your appeal:</span> {open.appeal_reason}
              </div>
            )}

            {open.status === "active" ? (
              <>
                <label className="block text-sm">
                  <span className="text-muted-foreground">Why should this be removed?</span>
                  <Input className="w-full mt-1" value={appealReason}
                    onChange={(e) => setAppealReason(e.target.value)} />
                </label>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setOpen(null)}>Close</Button>
                  <Button onClick={submitAppeal} disabled={sending}>
                    {sending ? "Sending…" : "Appeal Penalty"}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {open.status === "appealed"
                  ? "Appealed. The CEO decides whether it stands."
                  : "Appeal approved, so this was removed and costs you nothing."}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
