"use client";

/* Daily logs: one day, everybody, exact times.
 *
 * The CEO's question is "what did this person actually do on Tuesday" -- when
 * they signed in, how long they sat inside a live class, when they walked out.
 * The per-person Full Report already answers it for one name (see
 * people/[userId]); this is the same audit trail read the other way round, so
 * a day can be opened without knowing whose name to click first.
 *
 * CEO only, and not merely by hiding the tab: RLS on activity_events restricts
 * every row that isn't your own to role 'ceo' (migration 0035), so a manager
 * who reached this component would receive an empty result from the database.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Avatar, Card, EmptyState } from "@/components/ui";
import {
  ACTIVITY_LABEL, buildTimeline, dayStats, formatDuration, localDay,
  type ActivityEvent, type ActivityKind,
} from "@/lib/activity";

type Row = ActivityEvent & { profile_id: string; kind: ActivityKind };
type Person = { id: string; display_name: string; role: string; avatar?: string | null };

/** Today in the browser's own calendar, formatted for <input type="date">. */
function todayValue() {
  return localDay(new Date().toISOString());
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function DailyLogs({ academyId, people, base }: {
  academyId: string; people: Person[]; base: string;
}) {
  const [day, setDay] = useState(todayValue);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  /* One query per day rather than a rolling window: a single day of heartbeats
   * for a whole academy is already a few thousand rows, and pulling a fortnight
   * to render one date would be the same data thirteen times over. The bounds
   * are local midnights, so the day shown is the day people worked. */
  const load = useCallback(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) { setRows([]); return; }
    setRows(null);
    const from = new Date(`${day}T00:00:00`).toISOString();
    const to = new Date(new Date(`${day}T00:00:00`).getTime() + 86_400_000).toISOString();
    const { data } = await createClient()
      .from("activity_events")
      .select("id, profile_id, kind, detail, seconds, created_at")
      .eq("academy_id", academyId)
      .gte("created_at", from).lt("created_at", to)
      .order("created_at")
      .limit(20_000);
    setRows((data ?? []) as Row[]);
  }, [academyId, day]);

  useEffect(() => { void load(); }, [load]);

  /* One line per person who left a trace that day, busiest first. People with
   * no rows are omitted rather than listed as zeroes: an absent coach and a
   * coach who never opened the app are different claims, and only the roster
   * knows which. */
  const perPerson = useMemo(() => {
    if (!rows) return [];
    const byPerson = new Map<string, Row[]>();
    for (const r of rows) {
      const list = byPerson.get(r.profile_id);
      if (list) list.push(r); else byPerson.set(r.profile_id, [r]);
    }
    const known = new Map(people.map((p) => [p.id, p]));
    return [...byPerson.entries()]
      .map(([id, events]) => ({
        person: known.get(id) ?? { id, display_name: "Former member", role: "unknown" },
        events,
        stats: dayStats(events),
      }))
      .sort((a, b) => b.stats.activeSeconds - a.stats.activeSeconds);
  }, [rows, people]);

  const open = perPerson.find((p) => p.person.id === openId) ?? null;
  const timeline = useMemo(() => (open ? buildTimeline(open.events) : []), [open]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold">Daily logs</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Login times, minutes spent inside live classes, and the moment each
              person left. Visible to the CEO only.
            </p>
          </div>
          <label className="text-sm">
            <span className="text-muted-foreground block text-xs mb-1">Day</span>
            <input
              type="date"
              value={day}
              max={todayValue()}
              onChange={(e) => { setDay(e.target.value || todayValue()); setOpenId(null); }}
              className="bg-surface-2 border border-border rounded-btn px-3 py-1.5 text-sm text-foreground"
            />
          </label>
        </div>
      </Card>

      {rows === null ? (
        <p className="text-sm text-muted-foreground px-1">Loading the day…</p>
      ) : perPerson.length === 0 ? (
        <EmptyState text="Nobody recorded any activity on this day." />
      ) : (
        <div className="flex flex-col gap-2">
          {perPerson.map(({ person, stats }) => {
            const expanded = openId === person.id;
            return (
              <Card key={person.id} className="flex flex-col gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <Avatar name={person.display_name} avatar={person.avatar} seed={person.id}
                    role={person.role} size={36} />
                  <div className="min-w-40">
                    <p className="font-medium text-sm">{person.display_name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{person.role}</p>
                  </div>

                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums ml-auto">
                    <Figure label="Logged in" value={stats.loginAt ? clock(stats.loginAt) : (stats.firstAt ? clock(stats.firstAt) : "-")} />
                    <Figure label="Last seen" value={stats.lastAt ? clock(stats.lastAt) : "-"} />
                    <Figure label="Active" value={stats.activeSeconds ? formatDuration(stats.activeSeconds) : "-"} />
                    <Figure label="In live class" value={stats.classSeconds ? formatDuration(stats.classSeconds) : "-"} />
                    <Figure label="Actions" value={String(stats.actions)} />
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button"
                      onClick={() => setOpenId(expanded ? null : person.id)}
                      className="text-xs border border-border bg-surface-2 hover:bg-surface-3 rounded-btn px-3 py-1.5">
                      {expanded ? "Hide timeline" : "Open timeline"}
                    </button>
                    <Link href={`${base}/people/${person.id}`}
                      className="text-xs text-primary hover:underline">
                      Full report
                    </Link>
                  </div>
                </div>

                {expanded && (
                  <div className="flex flex-col max-h-96 overflow-y-auto border-t border-border pt-2">
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
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}
