"use client";

/* Billing / Payment History - playmate-board.md §Account (user menu shows
 * "Payment History" → billing exists). Students: own invoices + own plan.
 * CEO/Manager: manage all + create invoices/subscriptions. Online payments go
 * through the provider-agnostic layer (src/lib/billing - mock by default). */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select, StatusPill } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import type { Role } from "@/lib/auth";

type Invoice = {
  id: string; student_id: string; amount_inr: number; description: string;
  status: string; due_at: string | null; paid_at: string | null; created_at: string;
};
type Subscription = {
  id: string; student_id: string; plan: string; amount_inr: number;
  billing_interval: string; status: string; current_period_end: string;
};
type Student = { id: string; display_name: string };

export function BillingClient({ academyId, role }: { academyId: string; role: Role }) {
  const toast = useToast();
  const admin = role === "ceo" || role === "manager";
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [studentSel, setStudentSel] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [showSub, setShowSub] = useState(false);
  const [subPlan, setSubPlan] = useState("");
  const [subAmount, setSubAmount] = useState("");
  const [subInterval, setSubInterval] = useState("monthly");
  const [paying, setPaying] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) return;
    const supabase = createClient();
    const { data } = await supabase.from("invoices").select("*").order("created_at", { ascending: false });
    setInvoices(data ?? []);
    const { data: sb } = await supabase.from("subscriptions").select("*").order("created_at", { ascending: false });
    setSubs(sb ?? []);
    if (admin) {
      const { data: st } = await supabase.from("profiles").select("id, display_name").eq("role", "student");
      setStudents(st ?? []);
      if (st?.length) setStudentSel((cur) => cur || st[0].id);
    }
  }, [admin]);

  useEffect(() => { void load(); }, [load]);

  // Landing back from checkout (?payment=success|failed)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const result = q.get("payment");
    if (result === "success") toast("Payment recorded", "success");
    if (result === "failed") toast(`Payment failed: ${q.get("reason") ?? "unknown"}`, "error");
    if (result) window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function payOnline(invoiceId: string) {
    setPaying(invoiceId);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceId, returnPath: window.location.pathname }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { toast(body.error ?? "Checkout failed", "error"); return; }
      window.location.href = body.url;
    } finally {
      setPaying(null);
    }
  }

  async function createSubscription() {
    const supabase = createClient();
    const months = subInterval === "monthly" ? 1 : subInterval === "quarterly" ? 3 : 12;
    const end = new Date(); end.setMonth(end.getMonth() + months);
    const { error } = await supabase.from("subscriptions").insert({
      academy_id: academyId, student_id: studentSel, plan: subPlan.trim(),
      amount_inr: Number(subAmount), billing_interval: subInterval,
      current_period_end: end.toISOString(),
    });
    if (error) { toast(error.message, "error"); return; }
    toast("Subscription created", "success");
    setShowSub(false); setSubPlan(""); setSubAmount("");
    void load();
  }

  async function cancelSubscription(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("subscriptions")
      .update({ status: "canceled", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast(error.message, "error"); return; }
    void load();
  }

  async function runRenewals() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("renew_due_subscriptions");
    if (error) { toast(error.message, "error"); return; }
    toast(`${data ?? 0} renewal invoice(s) generated`, "success");
    void load();
  }

  async function createInvoice() {
    const supabase = createClient();
    const { error } = await supabase.from("invoices").insert({
      academy_id: academyId, student_id: studentSel,
      amount_inr: Number(amount), description: desc.trim(),
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
    });
    if (error) { toast(error.message, "error"); return; }
    toast("Invoice created", "success");
    setShowCreate(false); setAmount(""); setDesc("");
    void load();
  }

  async function setStatus(id: string, status: "paid" | "void") {
    const supabase = createClient();
    const { error } = await supabase.from("invoices").update({
      status, paid_at: status === "paid" ? new Date().toISOString() : null,
    }).eq("id", id);
    if (error) { toast(error.message, "error"); return; }
    void load();
  }

  const name = (id: string) => students.find((s) => s.id === id)?.display_name ?? "";

  return (
    <div>
      <PageHeader
        title={admin ? "Billing" : "Payment History"}
        subtitle={admin ? "Invoices and payments across the academy" : "Your invoices and payments"}
        action={admin ? (
          <span className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowSub(true)}>New Subscription</Button>
            <Button onClick={() => setShowCreate(true)}>Create Invoice</Button>
          </span>
        ) : undefined}
      />

      {(admin || subs.length > 0) && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-medium">{admin ? "Subscriptions" : "Your plan"}</h2>
            {admin && subs.some((s) => s.status === "active") && (
              <Button variant="ghost" onClick={runRenewals}>Run renewals</Button>
            )}
          </div>
          {subs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No subscriptions yet.</p>
          ) : (
            <ul className="text-sm divide-y divide-border">
              {subs.map((s) => (
                <li key={s.id} className="py-2 flex items-center gap-3">
                  <span className="flex-1">
                    {admin && <span className="text-muted-foreground">{name(s.student_id)} · </span>}
                    {s.plan}: ₹{Number(s.amount_inr).toLocaleString("en-IN")}/{s.billing_interval}
                    <span className="text-muted-foreground"> · renews {new Date(s.current_period_end).toLocaleDateString()}</span>
                  </span>
                  <StatusPill status={s.status} />
                  {admin && s.status === "active" && (
                    <Button variant="ghost" onClick={() => cancelSubscription(s.id)}>Cancel</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {invoices.length === 0 ? (
        <EmptyState text="No invoices yet." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-4 py-2">Date</th>
                {admin && <th className="px-4 py-2">Student</th>}
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2">Amount</th>
                <th className="px-4 py-2">Due</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">{new Date(inv.created_at).toLocaleDateString()}</td>
                  {admin && <td className="px-4 py-2.5">{name(inv.student_id)}</td>}
                  <td className="px-4 py-2.5">{inv.description}</td>
                  <td className="px-4 py-2.5 tabular-nums">₹{Number(inv.amount_inr).toLocaleString("en-IN")}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{inv.due_at ? new Date(inv.due_at).toLocaleDateString() : ""}</td>
                  <td className="px-4 py-2.5"><StatusPill status={inv.status} /></td>
                  <td className="px-4 py-2.5">
                    {inv.status === "due" && (
                      <span className="flex gap-1">
                        <Button variant="ghost" disabled={paying === inv.id} onClick={() => payOnline(inv.id)}>
                          {paying === inv.id ? "Redirecting…" : "Pay online"}
                        </Button>
                        {admin && (
                          <>
                            <Button variant="ghost" onClick={() => setStatus(inv.id, "paid")}>Mark paid</Button>
                            <Button variant="ghost" onClick={() => setStatus(inv.id, "void")}>Void</Button>
                          </>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Invoice">
        <div className="flex flex-col gap-3">
          <Select value={studentSel} onChange={(e) => setStudentSel(e.target.value)}>
            {students.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
          </Select>
          <Input type="number" min={0} placeholder="Amount (INR)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input placeholder="Description (e.g. July coaching fee)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <label className="text-sm text-muted-foreground">Due date
            <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
              className="block w-full mt-1 bg-surface-2 border border-border rounded-btn px-3 py-2 text-foreground" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createInvoice} disabled={!studentSel || !amount || !desc.trim()}>Create</Button>
          </div>
        </div>
      </Modal>

      <Modal open={showSub} onClose={() => setShowSub(false)} title="New Subscription">
        <div className="flex flex-col gap-3">
          <Select value={studentSel} onChange={(e) => setStudentSel(e.target.value)}>
            {students.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
          </Select>
          <Input placeholder="Plan name (e.g. Gold coaching)" value={subPlan} onChange={(e) => setSubPlan(e.target.value)} />
          <Input type="number" min={0} placeholder="Amount per period (INR)" value={subAmount} onChange={(e) => setSubAmount(e.target.value)} />
          <Select value={subInterval} onChange={(e) => setSubInterval(e.target.value)}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowSub(false)}>Cancel</Button>
            <Button onClick={createSubscription} disabled={!studentSel || !subPlan.trim() || !subAmount}>Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
