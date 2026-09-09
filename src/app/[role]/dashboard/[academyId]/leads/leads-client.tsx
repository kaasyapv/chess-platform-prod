"use client";

/* Leads CRM - pipeline board + lead drawer (notes, history, assignment,
 * demo-session creation). State machine: new → qualified → assigned → demo
 * → trial → enrolled (∪ lost). Every mutation writes a lead_events row so
 * the history survives handovers. RLS: docs/ARCHITECTURE_V2.md §2. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, EmptyState, Input, Modal, PageHeader, SearchInput, Select } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import type { Profile } from "@/lib/auth";
import { Mail, Phone, MessageCircle } from "lucide-react";

type Lead = {
  id: string; name: string; contact: { email?: string | null; phone?: string | null; whatsapp?: string | null };
  source: string; status: string; assigned_to: string | null; student_id: string | null;
  created_at: string; updated_at: string;
};
type LeadEvent = { id: number; kind: string; body: string | null; actor_id: string | null; created_at: string };
type Staff = { id: string; display_name: string; role: string };
type Demo = { id: string; lead_id: string; status: string; expires_at: string; invite_id: string | null; classroom_id: string | null };

const STAGES = ["new", "qualified", "assigned", "demo", "trial", "enrolled"] as const;
const STAGE_LABEL: Record<string, string> = {
  new: "New", qualified: "Qualified", assigned: "Assigned",
  demo: "Demo", trial: "Trial", enrolled: "Enrolled", lost: "Lost",
};

export function LeadsClient({ me, hideHeader = false }: { me: Profile; hideHeader?: boolean }) {
  const toast = useToast();
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [demos, setDemos] = useState<Demo[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [open, setOpen] = useState<Lead | null>(null);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [note, setNote] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", source: "manual" });
  const [showDemo, setShowDemo] = useState(false);
  const [demoCoach, setDemoCoach] = useState("");
  const [demoAt, setDemoAt] = useState("");
  const [demoInvite, setDemoInvite] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!configured) return;
    const supabase = createClient();
    const [l, s, d] = await Promise.all([
      supabase.from("leads").select("*").order("updated_at", { ascending: false }),
      supabase.from("profiles").select("id, display_name, role")
        .eq("academy_id", me.academy_id).in("role", ["manager", "coach", "ceo"]),
      supabase.from("demo_sessions").select("id, lead_id, status, expires_at, invite_id, classroom_id"),
    ]);
    setLeads((l.data ?? []) as Lead[]);
    setStaff(s.data ?? []);
    setDemos((d.data ?? []) as Demo[]);
  }, [configured, me.academy_id]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = leads.filter((l) =>
      !q || l.name.toLowerCase().includes(q)
      || (l.contact.email ?? "").toLowerCase().includes(q)
      || (l.contact.phone ?? "").includes(q)
      || l.source.includes(q));
    if (sort === "name") arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "oldest") arr.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    else arr.sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
    return arr;
  }, [leads, search, sort]);

  const staffName = (id: string | null) => staff.find((s) => s.id === id)?.display_name ?? "";
  const age = (d: string) => {
    const days = Math.floor((Date.now() - +new Date(d)) / 86_400_000);
    return days === 0 ? "today" : `${days}d`;
  };

  async function logEvent(leadId: string, kind: LeadEvent["kind"], body: string) {
    const supabase = createClient();
    await supabase.from("lead_events").insert({
      lead_id: leadId, academy_id: me.academy_id, kind, actor_id: me.id, body,
    });
  }

  async function openLead(l: Lead) {
    setOpen(l);
    setNote("");
    setDemoInvite(null);
    const supabase = createClient();
    const { data } = await supabase.from("lead_events")
      .select("id, kind, body, actor_id, created_at")
      .eq("lead_id", l.id).order("created_at", { ascending: false }).limit(50);
    setEvents((data ?? []) as LeadEvent[]);
  }

  async function createLead() {
    const supabase = createClient();
    const { data, error } = await supabase.from("leads").insert({
      academy_id: me.academy_id,
      name: form.name.trim(),
      contact: { email: form.email.trim() || null, phone: form.phone.trim() || null },
      source: form.source,
      // managers without the global flag can only see leads assigned to them -
      // self-assign so the row remains visible to its creator under RLS
      assigned_to: me.role === "ceo" ? null : me.id,
    }).select("id").single();
    if (error) { toast(error.message, "error"); return; }
    await logEvent(data.id, "note", `Lead created manually by ${me.display_name}`);
    setShowCreate(false);
    setForm({ name: "", email: "", phone: "", source: "manual" });
    toast("Lead created", "success");
    void load();
  }

  async function setStatus(l: Lead, status: string) {
    const supabase = createClient();
    const { error } = await supabase.from("leads")
      .update({ status, updated_at: new Date().toISOString() }).eq("id", l.id);
    if (error) { toast(error.message, "error"); return; }
    await logEvent(l.id, "status", `Stage: ${STAGE_LABEL[l.status]} → ${STAGE_LABEL[status]}`);
    setOpen((o) => (o && o.id === l.id ? { ...o, status } : o));
    void load();
    void openLead({ ...l, status });
  }

  async function assign(l: Lead, managerId: string) {
    const supabase = createClient();
    const { error } = await supabase.from("leads").update({
      assigned_to: managerId || null,
      status: l.status === "new" || l.status === "qualified" ? "assigned" : l.status,
      updated_at: new Date().toISOString(),
    }).eq("id", l.id);
    if (error) { toast(error.message, "error"); return; }
    await logEvent(l.id, "assignment",
      managerId ? `Assigned to ${staffName(managerId)}` : "Unassigned");
    toast("Assignment updated", "success");
    void load();
    void openLead({ ...l, assigned_to: managerId || null });
  }

  async function addNote(l: Lead) {
    if (!note.trim()) return;
    await logEvent(l.id, "note", note.trim());
    setNote("");
    void openLead(l);
  }

  /** Demo cycle: invite (temp student credential) + classroom + demo_sessions
   *  row; lead moves to 'demo'. Expiry cleanup: expire_demo_sessions(). */
  async function createDemo(l: Lead) {
    if (!demoCoach || !demoAt) { toast("Pick a coach and time", "error"); return; }
    const supabase = createClient();
    const when = new Date(demoAt);

    const { data: room, error: roomErr } = await supabase.from("classrooms").insert({
      academy_id: me.academy_id, title: `Demo: ${l.name}`,
      coach_id: demoCoach, scheduled_at: when.toISOString(), duration_minutes: 45,
    }).select("id").single();
    if (roomErr) { toast(roomErr.message, "error"); return; }

    // demo_classroom_id scopes the invite's RLS to this one classroom only -
    // see supabase/migrations/0017_demo_isolation.sql.
    const { data: invite, error: invErr } = await supabase.from("invites").insert({
      academy_id: me.academy_id, role: "student",
      display_name: `${l.name} (demo)`,
      username: `ca_demo${String(Math.floor(Math.random() * 9000) + 1000)}`,
      created_by: me.id, demo_classroom_id: room.id,
    }).select("id, code").single();
    if (invErr) { toast(invErr.message, "error"); return; }

    const expires = new Date(when.getTime() + 7 * 86_400_000); // 7 days post-demo
    const { error: demoErr } = await supabase.from("demo_sessions").insert({
      academy_id: me.academy_id, lead_id: l.id, coach_id: demoCoach,
      classroom_id: room.id, invite_id: invite.id, expires_at: expires.toISOString(),
    });
    if (demoErr) { toast(demoErr.message, "error"); return; }

    await supabase.from("leads").update({ status: "demo", updated_at: new Date().toISOString() }).eq("id", l.id);
    await logEvent(l.id, "demo",
      `Demo scheduled ${when.toLocaleString()} with ${staffName(demoCoach)}, invite code ${invite.code}`);
    setShowDemo(false);
    setDemoInvite(invite.code);
    toast("Demo provisioned, share the invite code", "success");
    void load();
    void openLead({ ...l, status: "demo" });
  }

  /** Convert: temp account (claimed invite) becomes the permanent student. */
  async function convert(l: Lead) {
    const supabase = createClient();
    const demo = demos.find((d) => d.lead_id === l.id && d.status === "scheduled");
    let studentId: string | null = null;
    if (demo?.invite_id) {
      const { data: inv } = await supabase.from("invites").select("claimed_by").eq("id", demo.invite_id).single();
      studentId = inv?.claimed_by ?? null;
    }
    if (demo) await supabase.from("demo_sessions").update({ status: "converted" }).eq("id", demo.id);
    const { error } = await supabase.from("leads").update({
      status: "enrolled", student_id: studentId, updated_at: new Date().toISOString(),
    }).eq("id", l.id);
    if (error) { toast(error.message, "error"); return; }
    await logEvent(l.id, "status",
      studentId ? "Enrolled: demo account converted to permanent student" : "Enrolled");
    toast("Lead enrolled", "success");
    void load();
    void openLead({ ...l, status: "enrolled" });
  }

  async function runCleanup() {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("expire_demo_sessions");
    if (error) { toast(error.message, "error"); return; }
    toast(`${data ?? 0} expired demo(s) cleaned up`, "success");
    void load();
  }

  const managers = staff.filter((s) => s.role === "manager" || s.role === "ceo");
  const coaches = staff.filter((s) => s.role === "coach" || s.role === "manager");
  const lost = shown.filter((l) => l.status === "lost");

  const headerAction = (
    <span className="flex gap-2">
      <Button variant="secondary" onClick={runCleanup}>Run demo cleanup</Button>
      <Button onClick={() => setShowCreate(true)}>+ New Lead</Button>
    </span>
  );

  return (
    <div>
      {hideHeader ? (
        <div className="flex justify-end mb-4">{headerAction}</div>
      ) : (
        <PageHeader
          title="Leads"
          subtitle="Pipeline: Lead → Qualification → Assignment → Demo → Trial → Enrollment"
          action={headerAction}
        />
      )}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <SearchInput placeholder="Search name, email, phone, source…" value={search}
          onChange={(e) => setSearch(e.target.value)} />
        <Select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Recently updated</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name A-Z</option>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">{shown.length} lead{shown.length === 1 ? "" : "s"}</span>
      </div>

      {leads.length === 0 ? (
        <EmptyState text="No leads yet. Add one manually or point an n8n workflow at /api/webhooks/leads (docs/ARCHITECTURE_V2.md §4)."
          action={<Button onClick={() => setShowCreate(true)}>+ New Lead</Button>} />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 items-start">
          {STAGES.map((stage) => {
            const col = shown.filter((l) => l.status === stage);
            return (
              <div key={stage} className="bg-surface-1 border border-border rounded-card p-2 min-h-40">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 py-1.5 flex justify-between">
                  {STAGE_LABEL[stage]} <span>{col.length}</span>
                </p>
                <div className="flex flex-col gap-2">
                  {col.map((l) => (
                    <button key={l.id} onClick={() => void openLead(l)}
                      className="text-left bg-surface-2 border border-border rounded-btn p-2.5 hover:border-primary/60 transition-colors">
                      <p className="text-sm font-medium truncate">{l.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {l.source.replace(/_/g, " ")} · {age(l.created_at)}
                        {l.assigned_to && <> · {staffName(l.assigned_to)}</>}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {lost.length > 0 && (
        <p className="text-xs text-muted-foreground mt-4">
          Lost: {lost.map((l) => l.name).join(", ")}
        </p>
      )}

      {/* Lead drawer */}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.name ?? ""} wide>
        {open && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              {open.contact.email && <span className="flex items-center gap-1"><Mail size={13} />{open.contact.email}</span>}
              {open.contact.phone && <span className="flex items-center gap-1"><Phone size={13} />{open.contact.phone}</span>}
              {open.contact.whatsapp && <span className="flex items-center gap-1"><MessageCircle size={13} />{open.contact.whatsapp}</span>}
              <span>· via {open.source.replace(/_/g, " ")}</span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[...STAGES, "lost"].map((s) => (
                <button key={s}
                  onClick={() => s !== open.status && void setStatus(open, s)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    open.status === s
                      ? "bg-primary text-white border-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}>
                  {STAGE_LABEL[s]}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-muted-foreground">Owner</label>
              <Select value={open.assigned_to ?? ""} onChange={(e) => void assign(open, e.target.value)}>
                <option value="">Unassigned</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
              </Select>
              {(open.status === "qualified" || open.status === "assigned") && (
                <Button variant="secondary" onClick={() => { setDemoAt(""); setShowDemo(true); }}>
                  Schedule demo
                </Button>
              )}
              {(open.status === "demo" || open.status === "trial") && (
                <Button onClick={() => void convert(open)}>Convert to student</Button>
              )}
            </div>

            {demoInvite && (
              <p className="text-sm bg-primary/10 border border-primary/40 rounded-btn px-3 py-2">
                Demo invite code: <b className="font-mono">{demoInvite}</b>, the lead signs up
                with it at /signup and lands as a temp student.
              </p>
            )}

            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void addNote(open); }}>
              <Input className="flex-1" placeholder="Add a note…" value={note}
                onChange={(e) => setNote(e.target.value)} />
              <Button type="submit" disabled={!note.trim()}>Add</Button>
            </form>

            <div className="max-h-56 overflow-y-auto flex flex-col gap-2">
              {events.map((e) => (
                <div key={e.id} className="text-sm border-l-2 border-border pl-3">
                  <p>{e.body}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {e.kind} · {staffName(e.actor_id)} · {new Date(e.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
              {events.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
            </div>
          </div>
        )}
      </Modal>

      {/* New lead */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Lead">
        <div className="space-y-3">
          <Input className="w-full" placeholder="Name" value={form.name} autoFocus
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input className="w-full" placeholder="Email (optional)" type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input className="w-full" placeholder="Phone (optional)" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Select className="w-full" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
            <option value="manual">Manual</option>
            <option value="website">Website</option>
            <option value="meta_ads">Meta Ads</option>
            <option value="google_form">Google Form</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="calendly">Calendly</option>
            <option value="telecrm">TeleCRM</option>
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createLead} disabled={!form.name.trim()}>Create</Button>
          </div>
        </div>
      </Modal>

      {/* Schedule demo */}
      <Modal open={showDemo} onClose={() => setShowDemo(false)} title="Schedule demo session">
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-muted-foreground">Coach</span>
            <Select className="w-full mt-1" value={demoCoach} onChange={(e) => setDemoCoach(e.target.value)}>
              <option value="">Pick a coach…</option>
              {coaches.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </Select>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">When</span>
            <Input className="w-full mt-1" type="datetime-local" value={demoAt}
              onChange={(e) => setDemoAt(e.target.value)} />
          </label>
          <p className="text-xs text-muted-foreground">
            Creates a temp student invite + a 45-min demo classroom. Unconverted
            sandboxes are cleaned up automatically 7 days after the demo.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowDemo(false)}>Cancel</Button>
            <Button onClick={() => open && void createDemo(open)} disabled={!demoCoach || !demoAt}>
              Provision demo
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
