"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { reconnectDelayMs, shouldReconnect } from "@/lib/classroom-sync";

export type BoardState = {
  fen: string;
  lastMove?: { from: string; to: string };
  icons?: Record<string, string>; // algebraic square -> emoji (gamified board stickers)
};
export type Annotation = {
  arrows: { from: string; to: string; color?: string }[];
  highlights: { square: string; color?: string }[];
};
export type ChatMessage = { from: string; name: string; text: string; at: number };
export type Participant = { userId: string; name: string; role: string; avatar?: string | null };
/** A live in-class quiz, as broadcast to students. The solution is NOT here -
 *  it is persisted server-side in `quizzes` (0037) and only the coach's client
 *  holds a copy for scoring. Students get the position and the stakes, never
 *  the answer. */
export type QuizItem = {
  fen: string; seconds: number; points: number; negative: number;
  hint?: string; attempts?: number;
};
export type QuizEvent = {
  id: string; fen: string;
  seconds: number; points: number; negative: number;
  endsAt: number;           // epoch ms - everyone's countdown agrees
  active: boolean;          // false = the coach ended it
  /** Optional coaching hint. Safe to broadcast - it is a nudge, never the
   *  solution (the answer stays in the coach's `quizAnswerRef` + `quizzes`). */
  hint?: string;
  /** How many moves a student may try on their own board before it locks.
   *  0 / undefined = unlimited until the timer ends. */
  attempts?: number;
  /** Multi-Ask self-paced run: every question up front (NO solutions), so each
   *  student advances through their own copy at their own pace. Each item's
   *  answers ride `quiz_answer` with quizId `<run.id>-<itemIndex>`. When
   *  present, `id`/`fen`/etc mirror `items[0]` for late-join compatibility. */
  run?: { id: string; total: number; items: QuizItem[] };
};
/** A student's answer intent - what they played and how long they took. The
 *  student does NOT decide whether it's correct; the coach's client scores it
 *  against the private solution and `score_quiz` (0037) banks the points. */
export type QuizAnswer = {
  quizId: string; userId: string; name: string;
  san: string; ms: number;
};
/** Coach → class, after `score_quiz` has run: the authoritative verdicts, so
 *  every client can show each student their result and update the leaderboard.
 *  A notification of a persisted outcome, not the outcome itself. */
export type QuizResult = {
  quizId: string;
  verdicts: { userId: string; correct: boolean }[];
};
/** Whiteboard: x/y are 0..1 fractions of canvas size, not pixels - so a
 *  stroke drawn on the coach's 1200px canvas replays correctly on a
 *  student's 400px one. `open`/`clear` are control messages on the same
 *  event so a spectator only needs one handler to mirror the whole thing. */
export type WhiteboardEvent =
  | { kind: "down" | "move"; from: string; x: number; y: number; tool: "pen" | "marker" }
  | { kind: "up"; from: string }
  | { kind: "clear"; from: string }
  | { kind: "open" | "close"; from: string };
export type WhiteboardPermission = { userId: string; allowed: boolean };
/** A visual reward dropped over the class board (gamification). `toUserId`
 *  null = the whole class; set = only that student's client pops it big. */
export type RewardEvent = {
  id: string; icon: string; label: string;
  toUserId?: string | null; from: string; at: number;
};
/** One student's individual game during a simul, mirrored to the coach's grid.
 *  A logical "sub-channel" carried as a `simul_game` event on the same
 *  `class:<id>` channel - see the ponytail note where this is handled. */
export type SimulGameState = {
  studentId: string; name: string; fen: string;
  lastMove?: { from: string; to: string };
  result?: "1-0" | "0-1" | "1/2-1/2" | null;
  /** The student's remaining clock (ms), counted down client-side. Not a
   *  server clock (the reference runs simuls on a separate game-server) - it
   *  is the `feature_config.timer.remaining_seconds` model: good enough for a
   *  classroom exhibition, published with every move + a periodic tick. */
  clockMs?: number;
};
/** Coach → class when the simul opens: the per-student time budget. `0` /
 *  absent = untimed. */
export type SimulConfig = { clockMs: number };
/** Coach → one student: a move the coach played on that student's simul board.
 *  `fen` is the resulting position (the coach's client did the chess.js move);
 *  the student applies it verbatim and echoes a `simul_game` back. Rides the
 *  same `class:<id>` channel - one policy, already deployed. */
export type SimulMove = {
  studentId: string;
  from: string; to: string;
  fen: string;
};

type Handlers = {
  onBoard?: (b: BoardState) => void;
  onAnnotation?: (a: Annotation) => void;
  onChat?: (m: ChatMessage) => void;
  onQuiz?: (q: QuizEvent) => void;
  onQuizAnswer?: (a: QuizAnswer) => void;
  onQuizResult?: (r: QuizResult) => void;
  onWhiteboard?: (e: WhiteboardEvent) => void;
  onWhiteboardPermission?: (p: WhiteboardPermission) => void;
  onReward?: (r: RewardEvent) => void;
  onSimulGame?: (g: SimulGameState) => void;
  onSimulMove?: (m: SimulMove) => void;
  onSimulConfig?: (c: SimulConfig) => void;
  /** The channel re-subscribed after a drop. The consumer should re-hydrate
   *  from the durable `classrooms.live_state` snapshot (a live broadcast that
   *  arrives afterwards still wins). Not fired on the first subscribe. */
  onResync?: () => void;
  /** A member asked everyone for a fresh snapshot (late join / reconnect).
   *  The coach's client answers by re-broadcasting the full board state; every
   *  other client ignores it. Rides the existing `class:<id>` channel, so it
   *  needs no new realtime.messages policy. */
  onRequestSync?: (from: string) => void;
};

/**
 * Realtime classroom room over a Supabase Realtime broadcast channel.
 * Ephemeral by design - state lives in the channel, resets when everyone
 * leaves (same model as the prior platform's in-memory rooms).
 * Authorized server-side by RLS on realtime.messages, keyed by classroom
 * membership (0036_realtime_channel_authorization_fix.sql) - `private: true`
 * is what makes the channel subject to those policies at all, and a private
 * channel with no matching policy is refused for everyone, which is exactly
 * how this went dark in production once.
 */
export function useClassroomChannel(
  sessionId: string,
  me: { userId: string; name: string; role: string; avatar?: string | null },
  handlers: Handlers,
  /** Silent spectator (live-ops): receive everything, never track presence,
   *  never send - invisible to rosters and unable to mutate class state. */
  opts?: { silent?: boolean },
) {
  const silent = opts?.silent ?? false;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const [connected, setConnected] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [roster, setRoster] = useState<Participant[]>([]);
  /* Auto-rejoin after a drop. `generation` bumps (after a backoff delay) when
   * the channel errors; it's in the effect deps, so the whole effect tears the
   * channel down and rebuilds it - the same path a fresh mount takes, which is
   * why a rebuilt channel is guaranteed to run `setAuth()` again before it
   * subscribes. `resyncNonce` bumps on every *re*-subscribe so the consumer
   * knows to re-hydrate. Both were previously absent: a CHANNEL_ERROR just set
   * a banner and the class stayed dead until a manual page refresh. */
  const [generation, setGeneration] = useState(0);
  const [resyncNonce, setResyncNonce] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) return;
    const supabase = createClient();
    const channel = supabase.channel(`class:${sessionId}`, {
      config: { broadcast: { self: false }, presence: { key: me.userId }, private: true },
    });
    const isReconnect = generation > 0;

    channel
      .on("broadcast", { event: "board" }, ({ payload }) =>
        handlersRef.current.onBoard?.(payload as BoardState),
      )
      .on("broadcast", { event: "annotation" }, ({ payload }) =>
        handlersRef.current.onAnnotation?.(payload as Annotation),
      )
      .on("broadcast", { event: "chat" }, ({ payload }) =>
        handlersRef.current.onChat?.(payload as ChatMessage),
      )
      .on("broadcast", { event: "quiz" }, ({ payload }) =>
        handlersRef.current.onQuiz?.(payload as QuizEvent),
      )
      .on("broadcast", { event: "quiz_answer" }, ({ payload }) =>
        handlersRef.current.onQuizAnswer?.(payload as QuizAnswer),
      )
      .on("broadcast", { event: "quiz_result" }, ({ payload }) =>
        handlersRef.current.onQuizResult?.(payload as QuizResult),
      )
      .on("broadcast", { event: "whiteboard" }, ({ payload }) =>
        handlersRef.current.onWhiteboard?.(payload as WhiteboardEvent),
      )
      .on("broadcast", { event: "whiteboard_permission" }, ({ payload }) =>
        handlersRef.current.onWhiteboardPermission?.(payload as WhiteboardPermission),
      )
      .on("broadcast", { event: "reward" }, ({ payload }) =>
        handlersRef.current.onReward?.(payload as RewardEvent),
      )
      /* ponytail: simul boards ride the existing `class:<id>` channel as a
       * `simul_game` event keyed by studentId, NOT their own
       * `class:<id>:game:<student_id>` private channels. A new private channel
       * pattern needs a matching realtime.messages RLS policy, and this repo
       * applies those to prod by hand - a channel shipped ahead of its policy
       * goes silently dead for everyone (this is exactly how board sync died
       * once, see 0032/0036). One channel, one policy, already deployed. */
      .on("broadcast", { event: "simul_game" }, ({ payload }) =>
        handlersRef.current.onSimulGame?.(payload as SimulGameState),
      )
      .on("broadcast", { event: "simul_move" }, ({ payload }) =>
        handlersRef.current.onSimulMove?.(payload as SimulMove),
      )
      .on("broadcast", { event: "simul_config" }, ({ payload }) =>
        handlersRef.current.onSimulConfig?.(payload as SimulConfig),
      )
      /* A late joiner / reconnecting client asks the room for a fresh snapshot.
       * Only the coach's client acts on it (re-broadcasts the full board); this
       * is a normal broadcast on the SAME `class:<id>` channel, so it is
       * covered by the one realtime.messages policy already deployed - the
       * ponytail rule from the simul_game comment above ("one channel, one
       * policy, already deployed") holds here too. */
      .on("broadcast", { event: "request_sync" }, ({ payload }) =>
        handlersRef.current.onRequestSync?.((payload as { from: string })?.from ?? ""),
      )
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name: string; role: string; avatar?: string | null }>();
        setRoster(
          Object.entries(state).map(([userId, metas]) => ({
            userId,
            name: metas[0]?.name ?? "?",
            role: metas[0]?.role ?? "student",
            avatar: metas[0]?.avatar ?? null,
          })),
        );
      })
      ;

    const scheduleReconnect = (why: string) => {
      if (reconnectTimerRef.current) return;            // one timer at a time
      if (!shouldReconnect(attemptRef.current)) {
        setReconnecting(false);
        setAuthError("Lost connection to this class. Refresh the page to rejoin.");
        return;
      }
      const delay = reconnectDelayMs(attemptRef.current);
      attemptRef.current += 1;
      setReconnecting(true);
      console.warn(`classroom channel ${why}; reconnect #${attemptRef.current} in ${delay}ms`);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        setGeneration((g) => g + 1);                    // -> effect re-runs, rebuilds the channel
      }, delay);
    };

    const onStatus = async (status: string, err?: Error) => {
      if (status === "SUBSCRIBED") {
        attemptRef.current = 0;
        if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
        setReconnecting(false);
        setConnected(true);
        setAuthError(null);
        if (!silent) await channel.track({ name: me.name, role: me.role, avatar: me.avatar ?? null });
        // A rebuilt channel means we may have missed broadcasts while away -
        // tell the consumer to re-hydrate from the durable snapshot, and ask
        // the room (mainly the coach) to push a fresh one.
        if (isReconnect) {
          setResyncNonce((n) => n + 1);
          if (!silent) channel.send({ type: "broadcast", event: "request_sync", payload: { from: me.userId } });
        }
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setConnected(false);
        /* A channel that fails to authorize used to look exactly like one
         * that had simply not connected yet: no banner, no console line, a
         * board that never moved. That silence is what turned a one-line
         * policy gap into a dead classroom nobody could diagnose from the
         * outside. Say it, in the UI and in the console - and now, actually
         * try to get back in. */
        if (status !== "CLOSED") {
          console.error("classroom channel refused:", status, err);
          setAuthError("Reconnecting to this class… moves and chat are paused.");
          scheduleReconnect(status);
        } else {
          // A bare CLOSED without an unmount (server drop) also warrants a
          // rejoin; the effect cleanup nulls channelRef, so if that ran this
          // is a no-op path anyway.
          if (channelRef.current) scheduleReconnect("closed");
        }
      }
    };

    /* Resolve the auth token BEFORE subscribing.
     *
     * `private: true` makes this channel subject to RLS on realtime.messages,
     * which needs the user's JWT on the join message. subscribe() builds that
     * payload synchronously from socket.accessTokenValue, and on a first
     * subscribe that value is still null - the token fetch it kicked off has
     * not resolved yet - so the join can go out carrying only the anon key
     * and be refused as unauthenticated. setAuth() resolves it first, which
     * makes the join deterministic instead of a race against the websocket
     * handshake.
     *
     * `torn` guards the async gap: React can mount -> unmount -> remount this
     * effect back-to-back (StrictMode in dev, and Offscreen / hydration
     * recovery in prod). Without the guard the FIRST run's `.then` fires AFTER
     * its own cleanup ran `removeChannel`, calling `.subscribe()` on an orphan
     * channel that shares the `class:<id>` topic with the second run's live
     * one - the Supabase realtime singleton then wedges on the topic clash and
     * every join times out until a full page reload. */
    let torn = false;
    void supabase.realtime
      .setAuth()
      .catch((e) => console.error("realtime setAuth failed:", e))
      .then(() => { if (!torn) channel.subscribe(onStatus); });

    channelRef.current = channel;
    return () => {
      torn = true;
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      supabase.removeChannel(channel);
      channelRef.current = null;
      setConnected(false);
      setAuthError(null);
    };
  // `generation` bumps on a drop so this effect rebuilds the channel; sessionId
  // / me.userId are the real identity of the room.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, me.userId, generation]);

  const sendBoard = useCallback((b: BoardState) => {
    if (silent) return;
    channelRef.current?.send({ type: "broadcast", event: "board", payload: b });
  }, [silent]);
  const sendAnnotation = useCallback((a: Annotation) => {
    if (silent) return;
    channelRef.current?.send({ type: "broadcast", event: "annotation", payload: a });
  }, [silent]);
  const sendChat = useCallback((m: ChatMessage) => {
    if (silent) return;
    channelRef.current?.send({ type: "broadcast", event: "chat", payload: m });
  }, [silent]);
  const sendQuiz = useCallback((q: QuizEvent) => {
    if (silent) return;
    channelRef.current?.send({ type: "broadcast", event: "quiz", payload: q });
  }, [silent]);
  const sendQuizAnswer = useCallback((a: QuizAnswer) => {
    if (silent) return;
    channelRef.current?.send({ type: "broadcast", event: "quiz_answer", payload: a });
  }, [silent]);
  const sendQuizResult = useCallback((r: QuizResult) => {
    if (silent) return;
    channelRef.current?.send({ type: "broadcast", event: "quiz_result", payload: r });
  }, [silent]);
  const sendWhiteboard = useCallback((e: WhiteboardEvent) => {
    if (silent) return;
    channelRef.current?.send({ type: "broadcast", event: "whiteboard", payload: e });
  }, [silent]);
  const sendWhiteboardPermission = useCallback((p: WhiteboardPermission) => {
    if (silent) return;
    channelRef.current?.send({ type: "broadcast", event: "whiteboard_permission", payload: p });
  }, [silent]);
  const sendReward = useCallback((r: RewardEvent) => {
    if (silent) return;
    channelRef.current?.send({ type: "broadcast", event: "reward", payload: r });
  }, [silent]);
  const sendSimulGame = useCallback((g: SimulGameState) => {
    if (silent) return;
    channelRef.current?.send({ type: "broadcast", event: "simul_game", payload: g });
  }, [silent]);
  const sendSimulMove = useCallback((m: SimulMove) => {
    if (silent) return;
    channelRef.current?.send({ type: "broadcast", event: "simul_move", payload: m });
  }, [silent]);
  const sendSimulConfig = useCallback((c: SimulConfig) => {
    if (silent) return;
    channelRef.current?.send({ type: "broadcast", event: "simul_config", payload: c });
  }, [silent]);
  /** Ask the room for a fresh snapshot (the coach's client answers). Used on a
   *  student's first join and after a reconnect; harmless if no coach is
   *  present (the durable `live_state` row is the fallback). */
  const sendRequestSync = useCallback(() => {
    if (silent) return;
    channelRef.current?.send({ type: "broadcast", event: "request_sync", payload: { from: me.userId } });
  }, [silent, me.userId]);

  return {
    connected, authError, reconnecting, resyncNonce, roster,
    sendBoard, sendAnnotation, sendChat, sendQuiz, sendQuizAnswer,
    sendQuizResult, sendWhiteboard, sendWhiteboardPermission, sendReward, sendSimulGame,
    sendSimulMove, sendSimulConfig, sendRequestSync,
  };
}
