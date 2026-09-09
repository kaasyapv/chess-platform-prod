"use client";

/* Full Report - one person, everything the academy knows.
 *
 * The financial block is absent rather than hidden: the server sends
 * `financials: null` to anyone who isn't the CEO, so there is nothing in the
 * payload to reveal by inspecting the page. See page.tsx. */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Wallet } from "lucide-react";
import { Avatar, Card, PageHeader, SegmentedTabs, StatusPill, EmptyState } from "@/components/ui";
import { inr } from "@/lib/finance";
import {
  formatDuration, ACTIVITY_LABEL, buildTimeline, dayStats, localDay,
  type ActivityKind,
} from "@/lib/activity";
import type { Profile } from "@/lib/auth";

type ClassRow = { id: string; title: string; scheduled_at: string; status: string; duration_minutes: number };
type Penalty = { id: string; category: string; custom_reason: string | null; amount: number; status: string; created_at: string; appeal_reason: string | null };
type Activity = { id: number; kind: ActivityKind; detail: string | null; seconds: number | null; created_at: string; classroom_id: string | null };
type Batch = { id: string; name: string; category: string | null; total_classes: number | null };
type Financials = {
  isCoach: boolean; completedClasses: number; estimatedEarnings: number;
  penaltiesTotal: number; invoicesPaid: number;
  invoices: { id: string; amount_inr: number; description: string; status: string; due_at: string | null; paid_at: string | null }[];
} | null;

/* "Activity" is the deep daily log -- exact login times, minutes inside a live
 * class, the moment someone left. That is the CEO's alone (0035), so the tab
 * is built per viewer rather than hidden with CSS. */
const BASE_TABS = ["Overview", "Classes", "Attendance"];

export function UserReportClient({
  me, person, upcoming, past, attendance, penalties, activity, batches, financials,
  canSeeAuditLog,
}: {
  me: Profile;
  person: { id: string; display_name: string; username: string | null; role: string; status: string; avatar: string | null; points: number; coins: number; created_at: string };
  upcoming: ClassRow[]; past: ClassRow[];
  attendance: { on_date: string; status: string }[];
  penalties: Penalty[]; activity: Activity[]; batches: Batch[];
  financials: Financials;
  canSeeAuditLog: boolean;
}) {
  const [tab, setTab] = useState("Overview");
  const tabs = canSeeAuditLog
    ? ["Overview", "Classes", "Activity", "Attendance"]
    : BASE_TABS;
  const isCoach = person.role === "coach";

  /* Genuine active time = the sum of heartbeat windows, which only accrue
   * while the person is actually interacting (lib/activity.ts). Idle rows are
   * shown separately so the two are never confused. */
  const { activeSeconds, idleSeconds, byDay } = useMemo(() => {
    let a = 0, i = 0;
    const days = new Map<string, number>();
    for (const e of activity) {
      if (e.kind === "active" && e.seconds) {
        a += e.seconds;
        const d = e.created_at.slice(0, 10);
        days.set(d, (days.get(d) ?? 0) + e.seconds);
      }
      if (e.kind === "idle" && e.seconds) i += e.seconds;
    }
    return { activeSeconds: a, idleSeconds: i, byDay: [...days.entries()].sort((x, y) => y[0].localeCompare(x[0])).slice(0, 14) };
  }, [activity]);

  const present = attendance.filter((a) => a.status === "present").length;
  const attendanceRate = attendance.length ? Math.round((present / attendance.length) * 100) : null;

  const stats = [
    ...(canSeeAuditLog
      ? [{ label: "Genuine active time", value: activeSeconds ? formatDuration(activeSeconds) : "-" }]
      : []),
    { label: isCoach ? "Classes taught" : "Classes enrolled", value: past.length + upcoming.length },
    { label: "Upcoming", value: upcoming.length },
    ...(attendanceRate !== null ? [{ label: "Attendance", value: `${attendanceRate}%` }] : []),
    // Penalties carry a salary deduction, so the rows are CEO-only at the RLS
    // level (0024). A manager gets no count rather than a misleading zero.
    ...(isCoach && financials ? [{ label: "Penalties", value: penalties.filter((p) => p.status !== "waived").length }] : []),
    ...(!isCoach ? [{ label: "Points", value: person.points }] : []),
  ];

  return (
    <div>
      <PageHeader
        title={person.display_name}
        subtitle={`${person.role.toUpperCase()}${person.username ? ` · ${person.username}` : ""} · joined ${new Date(person.created_at).toLocaleDateString()}`}
        action={<StatusPill status={person.status} />}
      />

      <div className="flex items-center gap-4 mb-6">
        <Avatar name={person.display_name} avatar={person.avatar} seed={person.id} role={person.role} size={64} />
        <div className="flex flex-wrap gap-2">
          {batches.map((b) => b && (
            <span key={b.id} className="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs">
              {b.name}{b.category ? ` · ${b.category}` : ""}{b.total_classes ? ` · ${b.total_classes} classes` : ""}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.25 }}>
            <Card>
              <p className="text-2xl font-bold tabular-nums">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* CEO-only. A manager's payload has no financials at all. */}
      {financials ? (
        <Card className="mb-6 border-primary/40">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h2 className="font-semibold flex items-center gap-1.5"><Wallet size={17} />Financials</h2>
            <span className="text-xs rounded-full border border-primary/40 bg-primary/10 text-primary-hover px-2.5 py-0.5">
              CEO only
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {financials.isCoach ? (
              <>
                <Figure label="Completed classes" value={String(financials.completedClasses)} />
                <Figure label="Estimated earnings" value={inr(financials.estimatedEarnings)} />
                <Figure label="Penalties deducted" value={inr(financials.penaltiesTotal)} />
                <Figure label="Net (estimate)" value={inr(financials.estimatedEarnings - financials.penaltiesTotal)} />
              </>
            ) : (
              <>
                <Figure label="Total paid" value={inr(financials.invoicesPaid)} />
                <Figure label="Invoices" value={String(financials.invoices.length)} />
                <Figure label="Outstanding" value={String(financials.invoices.filter((i) => i.status === "due").length)} />
              </>
            )}
          </div>
          {financials.isCoach && (
            <p className="text-xs text-muted-foreground mt-3">
              Earnings are derived from completed classes at the agreed coach share. The platform
              holds no payouts table, so treat this as an estimate, not payroll.
            </p>
          )}
        </Card>
      ) : (
        <Card className="mb-6">
          <p className="text-sm text-muted-foreground">
            Salary and financial details are visible to the CEO only.
          </p>
        </Card>
      )}

      <SegmentedTabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="mt-4">
        {tab === "Overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <h3 className="font-semibold mb-2">Recent activity</h3>
              {/* Honest about access rather than about the data: a manager is
                  told the log is restricted, not that the person did nothing. */}
              {!canSeeAuditLog ? (
                <p className="text-sm text-muted-foreground">
                  Per-day activity is part of the audit log, visible to the CEO only.
                </p>
              ) : byDay.length === 0 ? <EmptyState text="No tracked activity yet." /> : (
                <div className="flex flex-col gap-1.5">
                  {byDay.map(([day, secs]) => (
                    <div key={day} className="flex items-center gap-2 text-sm">
                      <span className="w-24 text-muted-foreground tabular-nums">{day}</span>
                      <div className="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${Math.min(100, (secs / 28800) * 100)}%` }} />
                      </div>
                      <span className="w-16 text-right tabular-nums">{formatDuration(secs)}</span>
                    </div>
                  ))}
                </div>
              )}
              {canSeeAuditLog && idleSeconds > 0 && (
                <p className="text-xs text-muted-foreground mt-3">
                  Idle time excluded from the total: {formatDuration(idleSeconds)}
                </p>
              )}
            </Card>
            {isCoach && !financials && (
              <Card>
                <h3 className="font-semibold mb-2">Penalty history</h3>
                <p className="text-sm text-muted-foreground">
                  Penalties are salary deductions, so the history is visible to the CEO only.
                </p>
              </Card>
            )}
            {isCoach && financials && (
              <Card>
                <h3 className="font-semibold mb-2">Penalty history</h3>
                {penalties.length === 0 ? <EmptyState text="No penalties." /> : (
                  <div className="flex flex-col gap-2">
                    {penalties.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 text-sm border-b border-border pb-1.5 last:border-0">
                        <span>{p.custom_reason || p.category.replace(/_/g, " ")}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          {financials && <span className="tabular-nums text-muted-foreground">{inr(p.amount)}</span>}
                          <StatusPill status={p.status} />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </div>
        )}

        {tab === "Classes" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <h3 className="font-semibold mb-2">Upcoming ({upcoming.length})</h3>
              {upcoming.length === 0 ? <EmptyState text="Nothing scheduled." /> : (
                <ClassList rows={upcoming} />
              )}
            </Card>
            <Card>
              <h3 className="font-semibold mb-2">Past ({past.length})</h3>
              {past.length === 0 ? <EmptyState text="No history yet." /> : <ClassList rows={past} />}
            </Card>
          </div>
        )}

        {tab === "Activity" && canSeeAuditLog && <AuditLog activity={activity} />}

        {tab === "Attendance" && (
          <Card>
            <h3 className="font-semibold mb-2">Attendance ({attendanceRate ?? "-"}%)</h3>
            {attendance.length === 0 ? <EmptyState text="No attendance records." /> : (
              <div className="flex flex-wrap gap-1.5">
                {attendance.map((a, i) => (
                  <span key={`${a.on_date}-${i}`}
                    title={`${a.on_date}: ${a.status}`}
                    className={`w-7 h-7 rounded text-[10px] flex items-center justify-center ${
                      a.status === "present" ? "bg-success/25 text-success"
                      : a.status === "late" ? "bg-warning/25 text-warning"
                      : a.status === "excused" ? "bg-surface-3 text-muted-foreground"
                      : "bg-destructive/25 text-destructive"
                    }`}>
                    {a.status[0].toUpperCase()}
                  </span>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

/** The day's audit trail.
 *
 *  "Detailed activity for that day" means a specific day, so this opens on the
 *  most recent one the person was active and lets the CEO step back through
 *  the rest. Times are exact to the second; heartbeat runs are folded into
 *  spans (see buildTimeline) so the deliberate actions -- logins, class
 *  starts, whiteboard use -- are not buried under 500 identical rows.
 */
function AuditLog({ activity }: { activity: Activity[] }) {
  const days = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const e of activity) {
      const d = localDay(e.created_at);
      const list = map.get(d);
      if (list) list.push(e); else map.set(d, [e]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [activity]);

  const [day, setDay] = useState<string | null>(null);
  const active = day ?? days[0]?.[0] ?? null;
  const events = useMemo(
    () => days.find(([d]) => d === active)?.[1] ?? [],
    [days, active],
  );
  const stats = useMemo(() => dayStats(events), [events]);
  const timeline = useMemo(() => buildTimeline(events), [events]);

  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  if (days.length === 0) {
    return (
      <Card>
        <h3 className="font-semibold mb-1">Audit log</h3>
        <EmptyState text="No activity recorded yet." />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-semibold">Audit log</h3>
          <p className="text-xs text-muted-foreground">
            Exact timestamps for one day. &quot;Active&quot; spans are one-minute windows recorded only
            while the person was genuinely interacting, so an open but idle tab adds nothing.
          </p>
        </div>
        <select
          value={active ?? ""}
          onChange={(e) => setDay(e.target.value)}
          className="bg-surface-2 border border-border rounded-btn px-3 py-1.5 text-sm text-foreground"
          aria-label="Day"
        >
          {days.map(([d, list]) => (
            <option key={d} value={d}>
              {new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "short", day: "numeric", month: "short",
              })} ({list.length})
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {/* "Logged in" is the sign-in event; "first seen" is the first row of
            any kind, which on a tab left open overnight comes earlier. Both
            are shown because the difference is exactly what a CEO is looking
            for when they ask when someone actually started. */}
        <Figure label="Logged in" value={stats.loginAt ? clock(stats.loginAt) : (stats.firstAt ? `${clock(stats.firstAt)} (first seen)` : "-")} />
        <Figure label="Last seen" value={stats.lastAt ? clock(stats.lastAt) : "-"} />
        <Figure label="Genuine active" value={stats.activeSeconds ? formatDuration(stats.activeSeconds) : "-"} />
        <Figure label="In live class" value={stats.classSeconds ? formatDuration(stats.classSeconds) : "-"} />
        <Figure label="Actions" value={String(stats.actions)} />
      </div>

      <div className="flex flex-col max-h-[32rem] overflow-y-auto">
        {timeline.map((t) => (
          <div key={t.id} className="flex items-baseline gap-3 text-sm py-1.5 border-b border-border last:border-0">
            <span className="w-44 shrink-0 text-muted-foreground tabular-nums text-xs">
              {clock(t.at)}{t.until ? ` to ${clock(t.until)}` : ""}
            </span>
            <span className={`font-medium ${t.kind === "idle" ? "text-warning" : ""}`}>
              {ACTIVITY_LABEL[t.kind] ?? t.kind}
            </span>
            {t.detail && <span className="text-muted-foreground truncate">· {t.detail}</span>}
            {t.seconds > 0 && (
              <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatDuration(t.seconds)}
              </span>
            )}
          </div>
        ))}
      </div>

      {stats.idleSeconds > 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          Idle on this day, excluded from active time: {formatDuration(stats.idleSeconds)}
        </p>
      )}
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function ClassList({ rows }: { rows: ClassRow[] }) {
  return (
    <div className="flex flex-col gap-1.5 max-h-96 overflow-y-auto">
      {rows.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-2 text-sm border-b border-border pb-1.5 last:border-0">
          <span className="truncate">{c.title}</span>
          <span className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground tabular-nums">
              {new Date(c.scheduled_at).toLocaleDateString()}
            </span>
            <StatusPill status={c.status} />
          </span>
        </div>
      ))}
    </div>
  );
}
