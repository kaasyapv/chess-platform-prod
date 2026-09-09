/* Classroom state durability - pure logic, deliberately separated from the
 * React / Supabase-Realtime plumbing in `use-classroom-channel.ts` and
 * `classroom-client.tsx` so it can be unit-tested without a browser or a live
 * channel (see tests/classroom-sync.test.mjs).
 *
 * WHY THIS EXISTS
 * --------------
 * The live classroom syncs over a Supabase Realtime *broadcast* channel
 * (`class:<id>`). That transport is fire-and-forget: the coach broadcasts the
 * full board snapshot on every move, and the only recovery for a student who
 * joins late or drops their websocket is the coach's own browser noticing the
 * roster grew and re-broadcasting. If the coach's tab is backgrounded, asleep,
 * or closed, a late joiner sees a frozen starting position with no error.
 *
 * This module adds a second, *durable* copy of the same snapshot: the coach's
 * client mirrors it into `classrooms.live_state` (alongside the existing
 * `live_fen` write - same row, same debounce, same UPDATE policy), and any
 * client hydrates from that row on mount and after a reconnect. Nothing about
 * the existing broadcast path changes - a live broadcast still always wins;
 * the durable copy is only the floor.
 *
 * It is purely additive. The projection below is a strict subset of the
 * `SyncState` already broadcast today (answers - loaded-PGN continuations,
 * quiz solutions - are never in `SyncState` and so are never here either).
 */

/** The "revealed world" of a live class, safe to persist and replay to any
 *  member. Mirrors the broadcast `SyncState` (a superset would be a leak). */
export type ClassroomSnapshot = {
  /** Live head position (FEN). */
  fen: string;
  /** Where the current game/line begins - `‹ ›` replay is relative to this. */
  startFen?: string;
  /** Last move played, for the board's from/to highlight. */
  lastMove?: { from: string; to: string };
  /** SANs the class has already been shown (never the unrevealed tail). */
  history?: string[];
  /** Students gated from moving. */
  locked?: boolean;
  /** Assigned sides: userId per colour. */
  sides?: { white?: string; black?: string };
  /** Coordinate labels visible. */
  coords?: boolean;
  /** Gamify mode (capture celebrations). */
  gamify?: boolean;
  /** A quiz is running - students' shared board is paused. */
  quizActive?: boolean;
  /** The active quiz itself, so a student who joins mid-quiz gets the board,
   *  timer and scoring rules without waiting for the coach to re-broadcast.
   *  The solution is NEVER here - it is not in `SyncState` either, and scoring
   *  stays coach-side through `score_quiz` (0037). */
  quiz?: {
    id: string; fen: string;
    seconds: number; points: number; negative: number;
    endsAt: number;
    hint?: string;      // a nudge, never the solution - safe to persist
    attempts?: number;  // tries a student gets; 0/undefined = unlimited
  };
  /** Free Move / Teaching Mode - illegal positions allowed. */
  free?: boolean;
  /** Coach has hidden the move list from students. Enforced, not cosmetic:
   *  when true, `history` is projected to `[]` for the student-facing snapshot
   *  (broadcast + durable row), so the notation is not merely CSS-hidden - it
   *  never reaches the student's client. Flipping it off re-sends the history. */
  hideMoves?: boolean;
  /** Coach has the simul grid open - students mirror their board. */
  simulActive?: boolean;
  /** Gamified board stickers: algebraic square -> emoji/id. */
  icons?: Record<string, string>;
  /** Board annotations (arrows + highlights) so a late joiner sees them too. */
  annotations?: {
    arrows: { from: string; to: string; color?: string }[];
    highlights: { square: string; color?: string }[];
  };
};

/** Loose shape of the live in-memory state the classroom keeps (a superset of
 *  `ClassroomSnapshot`). Only `fen` is required. */
export type LiveClassroomState = Partial<ClassroomSnapshot> & { fen: string };

/**
 * Project the live classroom state down to the persisted snapshot shape.
 *
 * - Only whitelisted keys survive (a forgotten `answer`/`solution` field on the
 *   input can therefore never be written to the row).
 * - `undefined` values are dropped so the stored JSON stays small and stable
 *   (two equal states serialise identically - handy for tests and for skipping
 *   no-op writes).
 * - Nested objects (`lastMove`, `sides`, `icons`, `annotations`) are shallow
 *   copied so the caller's live objects can't mutate what was already sent.
 */
export function serializeSnapshot(state: LiveClassroomState): ClassroomSnapshot {
  const out: ClassroomSnapshot = { fen: state.fen };

  if (typeof state.startFen === "string") out.startFen = state.startFen;
  // "Hide moves" is enforced here: the student-facing snapshot carries an empty
  // history, so the notation is absent from the wire and the durable row, not
  // just hidden in the UI.
  if (state.hideMoves) out.hideMoves = true;
  if (Array.isArray(state.history)) out.history = state.hideMoves ? [] : [...state.history];
  if (typeof state.locked === "boolean") out.locked = state.locked;
  if (typeof state.coords === "boolean") out.coords = state.coords;
  if (typeof state.gamify === "boolean") out.gamify = state.gamify;
  if (typeof state.quizActive === "boolean") out.quizActive = state.quizActive;
  if (typeof state.free === "boolean") out.free = state.free;

  if (state.quiz && typeof state.quiz.fen === "string" && typeof state.quiz.endsAt === "number") {
    const q = state.quiz;
    out.quiz = {
      id: q.id, fen: q.fen,
      seconds: q.seconds, points: q.points, negative: q.negative,
      endsAt: q.endsAt,
    };
    if (typeof q.hint === "string" && q.hint) out.quiz.hint = q.hint;
    if (typeof q.attempts === "number" && q.attempts > 0) out.quiz.attempts = q.attempts;
  }
  if (typeof state.simulActive === "boolean") out.simulActive = state.simulActive;

  if (state.lastMove && typeof state.lastMove.from === "string" && typeof state.lastMove.to === "string") {
    out.lastMove = { from: state.lastMove.from, to: state.lastMove.to };
  }
  if (state.sides && (state.sides.white || state.sides.black)) {
    out.sides = {};
    if (state.sides.white) out.sides.white = state.sides.white;
    if (state.sides.black) out.sides.black = state.sides.black;
  }
  if (state.icons && Object.keys(state.icons).length > 0) {
    out.icons = { ...state.icons };
  }
  if (state.annotations && (state.annotations.arrows?.length || state.annotations.highlights?.length)) {
    out.annotations = {
      arrows: (state.annotations.arrows ?? []).map((a) => ({ ...a })),
      highlights: (state.annotations.highlights ?? []).map((h) => ({ ...h })),
    };
  }
  return out;
}

/** Stable JSON of a snapshot - used to skip a DB write when nothing changed. */
export function snapshotKey(snap: ClassroomSnapshot): string {
  // Object.keys order is insertion order and `serializeSnapshot` always inserts
  // in the same sequence, so JSON.stringify is deterministic here.
  return JSON.stringify(snap);
}

/** A class session's plausible outer bound. A `live_state` row older than this
 *  is treated as a leftover from a previous class and ignored on hydrate. */
export const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Is a persisted `live_state` recent enough to trust as the current class
 * position? Guards against hydrating a brand-new class from yesterday's row.
 */
export function snapshotIsFresh(
  atIso: string | null | undefined,
  now: number = Date.now(),
  maxAgeMs: number = SNAPSHOT_MAX_AGE_MS,
): boolean {
  if (!atIso) return false;
  const t = Date.parse(atIso);
  if (Number.isNaN(t)) return false;
  const age = now - t;
  // A small negative age (clock skew between the writer and this client) is
  // fine - it just means "very fresh".
  return age <= maxAgeMs && age > -maxAgeMs;
}

/**
 * Decide whether a freshly-fetched durable snapshot should be applied to the
 * local board, given what this client has already seen.
 *
 * - Never overwrite a live broadcast we've already received in this session
 *   (`haveLiveBroadcast`): the coach's push is always newer/truer than the row.
 * - Otherwise apply it only if it's fresh and its timestamp is at least as new
 *   as the last durable snapshot we applied (monotonic; ignores a stale re-read).
 */
export function shouldApplyDurableSnapshot(opts: {
  atIso: string | null | undefined;
  haveLiveBroadcast: boolean;
  lastAppliedAtIso: string | null;
  now?: number;
  maxAgeMs?: number;
}): boolean {
  const { atIso, haveLiveBroadcast, lastAppliedAtIso, now, maxAgeMs } = opts;
  if (haveLiveBroadcast) return false;
  if (!snapshotIsFresh(atIso, now, maxAgeMs)) return false;
  if (!lastAppliedAtIso) return true;
  return Date.parse(atIso as string) >= Date.parse(lastAppliedAtIso);
}

// ── Reconnect backoff ───────────────────────────────────────────────────────
// The Supabase Realtime channel used to just set an error banner and stop when
// it dropped (CHANNEL_ERROR / TIMED_OUT). These drive a bounded auto-rejoin.

/** Delay before reconnect attempt N (0-indexed). Ramps, then holds at 30s. */
export const RECONNECT_BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000, 15000, 30000];

/** Stop retrying after this many consecutive failures (~ a few minutes at the
 *  30s ceiling). A manual page refresh is the escape hatch past this. */
export const MAX_RECONNECT_ATTEMPTS = 20;

/** Backoff for attempt `n` (0-indexed), with light jitter to avoid a
 *  thundering herd when a class of 30 all reconnect at once. */
export function reconnectDelayMs(attempt: number, jitter: number = Math.random()): number {
  const i = Math.min(Math.max(0, Math.floor(attempt)), RECONNECT_BACKOFF_MS.length - 1);
  const base = RECONNECT_BACKOFF_MS[i];
  // +/- 15%
  return Math.round(base * (0.85 + jitter * 0.3));
}

/** Whether to keep retrying after `attempt` failures. */
export function shouldReconnect(attempt: number): boolean {
  return attempt < MAX_RECONNECT_ATTEMPTS;
}
