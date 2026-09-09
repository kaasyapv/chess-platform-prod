/* Activity vocabulary and the pure timeline maths.
 *
 * Deliberately dependency-free -- no React, no Supabase client -- so the audit
 * log's logic can be exercised by `npm test` directly. lib/activity.ts adds the
 * browser half (the heartbeat, the writes) on top and re-exports all of this,
 * so callers still import from one place.
 */

export type ActivityKind =
  | "login" | "logout" | "active" | "idle"
  | "class_start" | "class_join" | "class_leave" | "class_end"
  | "whiteboard" | "pgn_upload" | "puzzle_solved" | "homework_submit"
  | "report_view" | "page_view";

/** Human-readable duration for report UIs: 3h 42m, 47m, 12s. */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export type ActivityEvent = {
  id: number | string;
  kind: ActivityKind;
  detail?: string | null;
  seconds?: number | null;
  created_at: string;
};

/** One line of the day's audit trail. A `run` is a stretch of heartbeats
 *  folded into a single entry; everything else is a discrete action. */
export type TimelineEntry = {
  id: string;
  kind: ActivityKind;
  /** ISO timestamp the entry starts at. */
  at: string;
  /** Present on folded heartbeat runs: when the stretch ended. */
  until?: string;
  seconds: number;
  detail?: string | null;
  /** How many raw rows this entry stands for. */
  count: number;
};

/** Fold a day's raw events into a readable timeline.
 *
 *  The heartbeat writes one row per minute, so a genuinely productive day
 *  produces 400+ near-identical "Active" rows. Printed as-is they bury the
 *  three lines anyone actually wants -- when the person logged in, when they
 *  started a class, when they opened the whiteboard. Consecutive heartbeats
 *  are therefore folded into one entry carrying the span they cover, which
 *  keeps every real action visible without losing a second of the totals.
 *
 *  Input may be in any order; output is chronological.
 */
export function buildTimeline(events: ActivityEvent[]): TimelineEntry[] {
  const sorted = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out: TimelineEntry[] = [];

  for (const e of sorted) {
    const secs = e.seconds ?? 0;
    const prev = out[out.length - 1];
    // Only 'active' folds: an idle stretch or a repeated feature use is
    // information, and collapsing those would hide it.
    if (e.kind === "active" && prev?.kind === "active") {
      prev.seconds += secs;
      prev.until = new Date(+new Date(e.created_at) + secs * 1000).toISOString();
      prev.count += 1;
      continue;
    }
    out.push({
      id: String(e.id),
      kind: e.kind,
      at: e.created_at,
      until: e.kind === "active"
        ? new Date(+new Date(e.created_at) + secs * 1000).toISOString()
        : undefined,
      seconds: secs,
      detail: e.detail ?? null,
      count: 1,
    });
  }
  return out;
}

/** The day's headline numbers: when they started, when they stopped, how much
 *  of the gap between those was genuine work. */
export function dayStats(events: ActivityEvent[]): {
  firstAt: string | null; lastAt: string | null; loginAt: string | null;
  activeSeconds: number; idleSeconds: number; classSeconds: number; actions: number;
} {
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  let loginAt: string | null = null;
  let activeSeconds = 0;
  let idleSeconds = 0;
  let classSeconds = 0;
  let actions = 0;

  for (const e of events) {
    if (!firstAt || e.created_at < firstAt) firstAt = e.created_at;
    if (!lastAt || e.created_at > lastAt) lastAt = e.created_at;
    // The first explicit login of the day, which is not always the first row:
    // a tab left open overnight heartbeats before anyone signs in again.
    if (e.kind === "login" && (!loginAt || e.created_at < loginAt)) loginAt = e.created_at;
    if (e.kind === "active") activeSeconds += e.seconds ?? 0;
    else if (e.kind === "idle") idleSeconds += e.seconds ?? 0;
    else {
      // Time inside a live class is carried on the leave event, which is the
      // only row that knows the span between walking in and walking out.
      if (e.kind === "class_leave") classSeconds += e.seconds ?? 0;
      // "Actions" means things the person did on purpose, so the heartbeat and
      // its idle counterpart are not counted as activity of their own.
      actions += 1;
    }
  }
  return { firstAt, lastAt, loginAt, activeSeconds, idleSeconds, classSeconds, actions };
}

/** Local calendar day (YYYY-MM-DD) an event belongs to. Local, not UTC: a
 *  9pm IST login must land on the day the person actually worked. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Label + emoji per event kind, so the timeline reads at a glance. */
export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  login: "Logged in",
  logout: "Logged out",
  active: "Active",
  idle: "Idle",
  class_start: "Started class",
  class_join: "Joined class",
  class_leave: "Left class",
  class_end: "Ended class",
  whiteboard: "Used whiteboard",
  pgn_upload: "Uploaded PGN",
  puzzle_solved: "Solved puzzle",
  homework_submit: "Submitted homework",
  report_view: "Viewed report",
  page_view: "Opened page",
};
