"use client";

/* TeleCRM native clone - docs/telecrm-architecture.md §3 (Path B). Three
 * tables of real, wired-up state on top of the existing `leads` pipeline:
 * whatsapp_messages (realtime thread), call_logs (post-call record, dialing
 * itself stays a plain tel: link per §3.3 - no in-browser dialer), and
 * lead_distribution_rules + drip_campaigns (config + status, no automation
 * cron yet - see 0014_telecrm.sql). Weighted-pick and drip-timing math live
 * in src/lib/telecrm.ts so they're unit-tested outside the browser. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Button, EmptyState, Input, Modal, PageHeader, Person, SearchInput,
  SegmentedTabs, Select, StatusPill,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import type { Profile } from "@/lib/auth";
import {
  needsFollowUpCall, nextDripSendAt, pickDistributionAgent,
  type CallOutcome, type DistributionRule,
} from "@/lib/telecrm";

type Lead = { id: string; name: string; contact: { phone?: string | null }; status: string; assigned_to: string | null };
type Staff = { id: string; display_name: string; role: string; avatar: string | null };
type WaMessage = { id: string; lead_id: string; direction: "in" | "out"; body: string; status: string; created_at: string };
type CallLog = { id: string; lead_id: string; agent_id: string; direction: "in" | "out"; duration_seconds: number; outcome: CallOutcome; started_at: string };
type DistRule = { id: string; agent_id: string; weight_percent: number; active: boolean };
type DripCampaign = { id: string; name: string; steps: { delay_hours: number; template_name: string }[]; active: boolean };
type DripEnrollment = { id: string; campaign_id: string; lead_id: string; status: string };

export type TeleCrmPerms = {
  can_use_whatsapp: boolean;
  can_view_call_logs: boolean;
  can_manage_leads: boolean; // gates Drip Campaigns + Distribution - same flag RLS already uses for those tables
};

export function TeleCrmClient({ me, perms, hideHeader = false }: { me: Profile; perms: TeleCrmPerms; hideHeader?: boolean }) {
  const toast = useToast();
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http");
  // RBAC: a manager only sees the modules the CEO granted (Admin Settings →
  // Academy → Coaches → Permissions). CEO always has every tab, plus the
  // CEO-only Integration panel (Path A - existing TeleCRM account).
  const tabs = useMemo(() => [
    ...(perms.can_use_whatsapp ? ["WhatsApp"] : []),
    ...(perms.can_view_call_logs ? ["Call Logs"] : []),
    ...(perms.can_manage_leads ? ["Drip Campaigns", "Distribution"] : []),
    ...(me.role === "ceo" ? ["Integration"] : []),
  ], [perms, me.role]);
  const [tab, setTab] = useState(tabs[0] ?? "");
  useEffect(() => { if (!tabs.includes(tab)) setTab(tabs[0] ?? ""); }, [tabs, tab]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [rules, setRules] = useState<DistRule[]>([]);
  const [campaigns, setCampaigns] = useState<DripCampaign[]>([]);
  const [enrollments, setEnrollments] = useState<DripEnrollment[]>([]);

  const load = useCallback(async () => {
    if (!configured) return;
    const supabase = createClient();
    const [l, s, m, c, r, dc, de] = await Promise.all([
      supabase.from("leads").select("id, name, contact, status, assigned_to").order("updated_at", { ascending: false }),
      supabase.from("profiles").select("id, display_name, role, avatar")
        .eq("academy_id", me.academy_id).in("role", ["manager", "coach", "ceo"]),
      supabase.from("whatsapp_messages").select("id, lead_id, direction, body, status, created_at").order("created_at"),
      supabase.from("call_logs").select("id, lead_id, agent_id, direction, duration_seconds, outcome, started_at").order("started_at", { ascending: false }),
      supabase.from("lead_distribution_rules").select("id, agent_id, weight_percent, active"),
      supabase.from("drip_campaigns").select("id, name, steps, active").order("created_at", { ascending: false }),
      supabase.from("drip_enrollments").select("id, campaign_id, lead_id, status"),
    ]);
    setLeads((l.data ?? []) as Lead[]);
    setStaff(s.data ?? []);
    setMessages((m.data ?? []) as WaMessage[]);
    setCalls((c.data ?? []) as CallLog[]);
    setRules((r.data ?? []) as DistRule[]);
    setCampaigns((dc.data ?? []) as DripCampaign[]);
    setEnrollments((de.data ?? []) as DripEnrollment[]);
  }, [configured, me.academy_id]);

  useEffect(() => { void load(); }, [load]);

  // One realtime channel for the WhatsApp thread - same idiom as Live Ops
  // (single postgres_changes subscription, patch state from the payload).
  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    const channel = supabase
      .channel("telecrm-whatsapp")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages" },
        (payload) => setMessages((cur) => [...cur, payload.new as WaMessage]))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [configured]);

  const staffName = (id: string | null) => staff.find((s) => s.id === id)?.display_name ?? "Unassigned";

  if (tabs.length === 0) {
    return (
      <div>
        {!hideHeader && <PageHeader title="TeleCRM" />}
        <EmptyState text="No TeleCRM modules are enabled for your account yet. Ask your CEO to grant access from Academy → Coaches → Permissions." />
      </div>
    );
  }

  return (
    <div>
      {!hideHeader && (
        <PageHeader title="TeleCRM" subtitle="WhatsApp sync, call logs, drip campaigns and lead distribution" />
      )}
      <div className="mb-4">
        <SegmentedTabs tabs={tabs} active={tab} onChange={setTab} />
      </div>

      {tab === "WhatsApp" && (
        <WhatsAppTab leads={leads} messages={messages} me={me} staffName={staffName}
          reload={load} toast={toast} />
      )}
      {tab === "Call Logs" && (
        <CallLogsTab leads={leads} calls={calls} me={me} staffName={staffName}
          reload={load} toast={toast} />
      )}
      {tab === "Drip Campaigns" && (
        <DripTab leads={leads} campaigns={campaigns} enrollments={enrollments}
          me={me} reload={load} toast={toast} />
      )}
      {tab === "Distribution" && (
        <DistributionTab staff={staff} rules={rules} me={me} reload={load} toast={toast} />
      )}
      {tab === "Integration" && <IntegrationTab me={me} toast={toast} />}
    </div>
  );
}

type ToastFn = ReturnType<typeof useToast>;

/* ── WhatsApp - lead list + realtime thread ─────────────────────────────── */
function WhatsAppTab({ leads, messages, me, staffName, reload, toast }: {
  leads: Lead[]; messages: WaMessage[]; me: Profile; staffName: (id: string | null) => string;
  reload: () => void; toast: ToastFn;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [draft, setDraft] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => !q || l.name.toLowerCase().includes(q));
  }, [leads, search]);

  const lastMessage = (leadId: string) =>
    [...messages].reverse().find((m) => m.lead_id === leadId) ?? null;
  const thread = selected ? messages.filter((m) => m.lead_id === selected.id) : [];

  async function send(direction: "in" | "out", body: string) {
    if (!selected || !body.trim()) return;
    const supabase = createClient();
    const { error } = await supabase.from("whatsapp_messages").insert({
      academy_id: me.academy_id, lead_id: selected.id, direction, body: body.trim(),
      status: direction === "out" ? "sent" : "read",
    });
    if (error) return toast(error.message, "error");
    if (direction === "out") setDraft("");
    void reload();
  }

  if (leads.length === 0) return <EmptyState text="No leads yet. Add one from the Leads pipeline first." />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-4 items-start">
      <div className="bg-surface-2 border border-border rounded-card overflow-hidden">
        <div className="p-2 border-b border-border">
          <SearchInput placeholder="Search leads…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="max-h-[32rem] overflow-y-auto">
          {filtered.map((l) => {
            const last = lastMessage(l.id);
            return (
              <button key={l.id} onClick={() => setSelected(l)}
                className={`w-full text-left px-3 py-2.5 border-b border-border last:border-0 transition-colors ${selected?.id === l.id ? "bg-surface-3" : "hover:bg-surface-3/60"}`}>
                <p className="text-sm font-medium truncate">{l.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {last ? `${last.direction === "out" ? "You: " : ""}${last.body}` : "No messages yet"}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-surface-2 border border-border rounded-card flex flex-col h-[32rem]">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Pick a lead to see the WhatsApp thread.
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div>
                <p className="font-medium">{selected.name}</p>
                <p className="text-xs text-muted-foreground">{staffName(selected.assigned_to)}</p>
              </div>
              <Button variant="secondary"
                onClick={() => void send("in", "(simulated inbound reply from lead)")}
                title="Simulates a webhook delivering an inbound WhatsApp message">
                Simulate inbound
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
              {thread.length === 0 && <p className="text-sm text-muted-foreground text-center mt-8">No messages yet.</p>}
              {thread.map((m) => (
                <div key={m.id} className={`max-w-[75%] rounded-card px-3 py-2 text-sm ${m.direction === "out" ? "self-end bg-primary text-primary-foreground" : "self-start bg-surface-3"}`}>
                  {m.body}
                  <p className={`text-[10px] mt-1 ${m.direction === "out" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {new Date(m.created_at).toLocaleTimeString()} · {m.status}
                  </p>
                </div>
              ))}
            </div>
            <form className="p-3 border-t border-border flex gap-2"
              onSubmit={(e) => { e.preventDefault(); void send("out", draft); }}>
              <Input className="flex-1" placeholder="Message…" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <Button type="submit" disabled={!draft.trim()}>Send</Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Call Logs - post-call record; dialing is a tel: link, per §3.3 ────── */
function CallLogsTab({ leads, calls, me, staffName, reload, toast }: {
  leads: Lead[]; calls: CallLog[]; me: Profile; staffName: (id: string | null) => string;
  reload: () => void; toast: ToastFn;
}) {
  const [open, setOpen] = useState(false);
  const [leadId, setLeadId] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [outcome, setOutcome] = useState<CallOutcome>("connected");
  const [duration, setDuration] = useState("60");

  const leadName = (id: string) => leads.find((l) => l.id === id)?.name ?? "Unknown lead";
  const lastCallByLead = (id: string) =>
    calls.filter((c) => c.lead_id === id).sort((a, b) => +new Date(b.started_at) - +new Date(a.started_at))[0] ?? null;

  async function logCall() {
    if (!leadId) return toast("Pick a lead", "error");
    const supabase = createClient();
    const { error } = await supabase.from("call_logs").insert({
      academy_id: me.academy_id, lead_id: leadId, agent_id: me.id, direction,
      duration_seconds: Math.max(0, parseInt(duration, 10) || 0), outcome,
    });
    if (error) return toast(error.message, "error");
    const phone = leads.find((l) => l.id === leadId)?.contact.phone;
    if (direction === "out" && phone) window.location.href = `tel:${phone}`;
    setOpen(false);
    toast("Call logged", "success");
    void reload();
  }

  const needingFollowUp = leads.filter((l) => needsFollowUpCall(lastCallByLead(l.id), new Date()));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">
          {needingFollowUp.length} lead{needingFollowUp.length === 1 ? "" : "s"} due a follow-up call
        </p>
        <Button onClick={() => { setLeadId(""); setOutcome("connected"); setDuration("60"); setOpen(true); }}>
          + Log a call
        </Button>
      </div>
      {calls.length === 0 ? (
        <EmptyState text="No calls logged yet." action={<Button onClick={() => setOpen(true)}>+ Log a call</Button>} />
      ) : (
        <div className="bg-surface-2 border border-border rounded-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-4 py-3 font-medium">Lead</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Direction</th>
                <th className="px-4 py-3 font-medium">Outcome</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-3/50">
                  <td className="px-4 py-3">{leadName(c.lead_id)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{staffName(c.agent_id)}</td>
                  <td className="px-4 py-3 capitalize">{c.direction === "out" ? "Outbound" : "Inbound"}</td>
                  <td className="px-4 py-3"><StatusPill status={c.outcome} /></td>
                  <td className="px-4 py-3 tabular-nums">{Math.floor(c.duration_seconds / 60)}:{String(c.duration_seconds % 60).padStart(2, "0")}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(c.started_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Log a call">
        <div className="space-y-3">
          <Select className="w-full" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">Pick a lead…</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Select value={direction} onChange={(e) => setDirection(e.target.value as "in" | "out")}>
              <option value="out">Outbound</option>
              <option value="in">Inbound</option>
            </Select>
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome)}>
              <option value="connected">Connected</option>
              <option value="no_answer">No answer</option>
              <option value="voicemail">Voicemail</option>
              <option value="busy">Busy</option>
              <option value="wrong_number">Wrong number</option>
            </Select>
          </div>
          <label className="block text-sm">
            <span className="text-muted-foreground">Duration (seconds)</span>
            <Input className="w-full mt-1" type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={logCall} disabled={!leadId}>
              {direction === "out" ? "Log & call" : "Log call"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ── Drip campaigns - config + enrollment status, no send automation yet ── */
function DripTab({ leads, campaigns, enrollments, me, reload, toast }: {
  leads: Lead[]; campaigns: DripCampaign[]; enrollments: DripEnrollment[]; me: Profile;
  reload: () => void; toast: ToastFn;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [delayHours, setDelayHours] = useState("24");
  const [template, setTemplate] = useState("");
  const [enrollLead, setEnrollLead] = useState<Record<string, string>>({});

  const countByStatus = (campaignId: string, status: string) =>
    enrollments.filter((e) => e.campaign_id === campaignId && e.status === status).length;

  async function createCampaign() {
    if (!name.trim() || !template.trim()) return toast("Name and a message template are required", "error");
    const supabase = createClient();
    const { error } = await supabase.from("drip_campaigns").insert({
      academy_id: me.academy_id, name: name.trim(),
      steps: [{ delay_hours: Math.max(0, parseInt(delayHours, 10) || 0), template_name: template.trim() }],
    });
    if (error) return toast(error.message, "error");
    setOpen(false); setName(""); setTemplate(""); setDelayHours("24");
    toast("Campaign created", "success");
    void reload();
  }

  async function toggleActive(c: DripCampaign) {
    const supabase = createClient();
    const { error } = await supabase.from("drip_campaigns").update({ active: !c.active }).eq("id", c.id);
    if (error) return toast(error.message, "error");
    void reload();
  }

  async function enroll(c: DripCampaign) {
    const leadId = enrollLead[c.id];
    if (!leadId) return;
    const step = c.steps[0];
    const supabase = createClient();
    const { error } = await supabase.from("drip_enrollments").insert({
      academy_id: me.academy_id, campaign_id: c.id, lead_id: leadId,
      next_send_at: step ? nextDripSendAt(new Date(), step).toISOString() : null,
    });
    if (error) return toast(error.message, "error");
    toast("Lead enrolled", "success");
    void reload();
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setOpen(true)}>+ New campaign</Button>
      </div>
      {campaigns.length === 0 ? (
        <EmptyState text="No drip campaigns yet." action={<Button onClick={() => setOpen(true)}>+ New campaign</Button>} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campaigns.map((c) => (
            <div key={c.id} className="bg-surface-2 border border-border rounded-card p-4">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold">{c.name}</h3>
                <button onClick={() => void toggleActive(c)}>
                  <StatusPill status={c.active ? "active" : "inactive"} />
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {c.steps[0]?.template_name ?? "no template"} · sends {c.steps[0]?.delay_hours ?? 0}h after enrollment
              </p>
              <div className="flex gap-3 mt-3 text-sm">
                <span>{countByStatus(c.id, "active")} active</span>
                <span className="text-muted-foreground">{countByStatus(c.id, "completed")} completed</span>
                <span className="text-muted-foreground">{countByStatus(c.id, "paused")} paused</span>
              </div>
              <div className="flex gap-2 mt-3">
                <Select className="flex-1" value={enrollLead[c.id] ?? ""}
                  onChange={(e) => setEnrollLead((m) => ({ ...m, [c.id]: e.target.value }))}>
                  <option value="">Enroll a lead…</option>
                  {leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
                <Button variant="secondary" onClick={() => void enroll(c)} disabled={!enrollLead[c.id]}>Enroll</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New drip campaign">
        <div className="space-y-3">
          <Input className="w-full" placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <Input className="w-full" placeholder="WhatsApp template name" value={template} onChange={(e) => setTemplate(e.target.value)} />
          <label className="block text-sm">
            <span className="text-muted-foreground">Send after (hours from enrollment)</span>
            <Input className="w-full mt-1" type="number" min={0} value={delayHours} onChange={(e) => setDelayHours(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={createCampaign}>Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ── Distribution - weighted round-robin config for inbound leads ───────── */
function DistributionTab({ staff, rules, me, reload, toast }: {
  staff: Staff[]; rules: DistRule[]; me: Profile; reload: () => void; toast: ToastFn;
}) {
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const agents = staff.filter((s) => s.role === "manager" || s.role === "coach");

  async function saveRule(agentId: string) {
    const w = Math.max(1, Math.min(100, parseInt(weights[agentId] ?? "0", 10) || 0));
    const supabase = createClient();
    const { error } = await supabase.from("lead_distribution_rules")
      .upsert({ academy_id: me.academy_id, agent_id: agentId, weight_percent: w, active: true }, { onConflict: "academy_id,agent_id" });
    if (error) return toast(error.message, "error");
    toast("Rule saved", "success");
    void reload();
  }

  async function toggleActive(r: DistRule) {
    const supabase = createClient();
    const { error } = await supabase.from("lead_distribution_rules").update({ active: !r.active }).eq("id", r.id);
    if (error) return toast(error.message, "error");
    void reload();
  }

  function simulate() {
    const active: DistributionRule[] = rules.map((r) => ({ agent_id: r.agent_id, weight_percent: r.weight_percent, active: r.active }));
    const pick = pickDistributionAgent(active);
    setPreview(pick ? staff.find((s) => s.id === pick)?.display_name ?? pick : null);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">
          Next inbound lead auto-assigns by weight below. Weights don&apos;t need to add to 100, they&apos;re relative.
        </p>
        <Button variant="secondary" onClick={simulate}>Simulate next assignment</Button>
      </div>
      {preview !== null && (
        <p className="text-sm mb-3 bg-primary/10 border border-primary/40 rounded-btn px-3 py-2 inline-block">
          Next lead would go to: <b>{preview}</b>
        </p>
      )}
      {agents.length === 0 ? (
        <EmptyState text="No coaches or managers to distribute leads to yet." />
      ) : (
        <div className="bg-surface-2 border border-border rounded-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Weight %</th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3 font-medium text-right">Save</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const rule = rules.find((r) => r.agent_id === a.id);
                return (
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 flex items-center gap-2">
                      <Person id={a.id} name={a.display_name} avatar={a.avatar} role={a.role} size={24} />
                    </td>
                    <td className="px-4 py-3">
                      <Input type="number" min={1} max={100} className="w-20"
                        defaultValue={rule?.weight_percent ?? ""}
                        placeholder="-"
                        onChange={(e) => setWeights((w) => ({ ...w, [a.id]: e.target.value }))} />
                    </td>
                    <td className="px-4 py-3">
                      {rule ? (
                        <button onClick={() => void toggleActive(rule)}>
                          <StatusPill status={rule.active ? "active" : "inactive"} />
                        </button>
                      ) : <span className="text-muted-foreground text-xs">no rule yet</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="secondary" onClick={() => void saveRule(a.id)}>Save</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Integration - Path A: point this dashboard at an existing TeleCRM
 *    account instead of (or alongside) the native tables above. CEO-only,
 *    same academy_secrets table the webhook token already lives in. ──── */
function IntegrationTab({ me, toast }: { me: Profile; toast: ToastFn }) {
  const [apiKey, setApiKey] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.from("academy_secrets").select("telecrm_api_key, telecrm_webhook_url")
      .eq("academy_id", me.academy_id).maybeSingle()
      .then(({ data }) => {
        setApiKey(data?.telecrm_api_key ?? "");
        setWebhookUrl(data?.telecrm_webhook_url ?? "");
        setLoaded(true);
      });
  }, [me.academy_id]);

  async function save() {
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("academy_secrets")
      .update({ telecrm_api_key: apiKey.trim() || null, telecrm_webhook_url: webhookUrl.trim() || null })
      .eq("academy_id", me.academy_id);
    setSaving(false);
    if (error) return toast(error.message, "error");
    toast("TeleCRM integration saved", "success");
  }

  return (
    <div className="max-w-xl">
      <div className="bg-surface-2 border border-border rounded-card p-5">
        <h3 className="font-semibold mb-1">Integrate an existing TeleCRM account</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Path A (docs/telecrm-architecture.md §2) - point inbound/outbound sync
          at your existing TeleCRM subscription instead of the native tables on
          the other tabs. Leave blank to keep using the native clone only.
        </p>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-muted-foreground">API key</span>
            <Input className="w-full mt-1 font-mono" type="password" value={apiKey}
              placeholder={loaded ? "sk_live_…" : "Loading…"} onChange={(e) => setApiKey(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Webhook URL</span>
            <Input className="w-full mt-1 font-mono" value={webhookUrl}
              placeholder="https://your-telecrm-instance.example.com/hooks/…" onChange={(e) => setWebhookUrl(e.target.value)} />
          </label>
          <div className="flex justify-end">
            <Button onClick={save} disabled={!loaded || saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
