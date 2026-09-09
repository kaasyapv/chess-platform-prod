"use client";

/* Live Operations wall. Scalability model (ARCHITECTURE_V2.md §3):
 * coaches persist board state to classrooms.live_fen (debounced); this page
 * holds ONE `postgres_changes` subscription on the classrooms table and
 * patches every miniature board from it. Boards are static FEN grids
 * (MiniBoard) - no per-board channels, no chessground instances. */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MiniBoard } from "@/components/board/mini-board";
import { MeshVideoRoom } from "@/components/class/mesh-video-room";
import { EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { sortHelpQueue } from "@/lib/help-queue";

type LiveClass = {
  id: string; title: string; status: string; live_fen: string | null;
  live_updated_at: string | null;
  started_at: string | null; scheduled_at: string; batch_id: string | null;
  coach: { display_name: string } | null;
  batch: { batch_members: { count: number }[] } | null;
  classroom_enrollments: { count: number }[];
};

type HelpRequest = {
  id: string; classroom_id: string; requested_role: string; created_at: string;
  classroom: { title: string } | null;
  requester: { display_name: string } | null;
};

/* How long a board may go without an update before the wall stops calling it
 * live. The coach's browser writes at most one row per 1.5s of activity and
 * only while they are moving pieces, so a quiet minute is normal thinking
 * time; past two, something is more likely wrong than contemplative. */
const BOARD_STALE_MS = 120_000;

/** Says plainly whether the position on screen is being fed right now.
 *
 *  Without this, a board that stopped updating -- coach disconnected, tab
 *  closed, a row that was written once and never again -- is pixel-identical
 *  to a live one, and a manager reads a frozen position as the current state
 *  of the class. A board nobody can vouch for should say so. */
function BoardFreshness({ at }: { at: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  // Before the first client tick, say nothing rather than risk a server/client
  // mismatch on a time-derived string.
  if (now === null) return null;
  if (!at) {
    return <span className="text-xs text-muted-foreground" suppressHydrationWarning>board not started</span>;
  }
  const age = now - +new Date(at);
  if (age <= BOARD_STALE_MS) {
    return <span className="text-xs text-success" suppressHydrationWarning>● board live</span>;
  }
  const mins = Math.floor(age / 60000);
  return (
    <span className="text-xs text-warning" suppressHydrationWarning>
      ● board idle {mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`}
    </span>
  );
}

/** Same rule as the classrooms list: never read the clock while rendering, or
 *  the server and the browser print different numbers and hydration fails. */
function Elapsed({ since }: { since: string | null }) {
  const [secs, setSecs] = useState<number | null>(null);

  useEffect(() => {
    if (!since) return;
    const read = () => setSecs(Math.max(0, Math.floor((Date.now() - +new Date(since)) / 1000)));
    read();
    const id = setInterval(read, 1000);
    return () => clearInterval(id);
  }, [since]);

  if (!since) return null;
  const s = secs ?? 0;
  return (
    <span className="tabular-nums" suppressHydrationWarning>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

export function LiveOpsClient({
  academyId, role, profileId, profileName,
}: { academyId: string; role: string; profileId: string; profileName: string }) {
  const router = useRouter();
  const [classes, setClasses] = useState<LiveClass[]>([]);
  const [connected, setConnected] = useState(false);
  const [helpRequests, setHelpRequests] = useState<HelpRequest[]>([]);
  /* Videos play automatically - no click required.
   *
   * They still can't ALL play at once: a wall can hold 50-60 live classes and
   * each mesh opens a peer connection per participant, so 58 cards would mean
   * hundreds of streams in one tab and a browser that stops responding. So
   * autoplay is scoped to the cards actually on screen: scroll a card into
   * view and its video connects itself, scroll away and it releases. The
   * manager never clicks anything, and the tab only ever carries the handful
   * of rooms they're actually looking at. MAX_CONCURRENT_VIDEO is the ceiling
   * if a very tall window shows more than that at once. */
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http");
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();

    const load = async () => {
      const { data } = await supabase
        .from("classrooms")
        .select("id, title, status, live_fen, live_updated_at, started_at, scheduled_at, batch_id, coach:profiles!classrooms_coach_id_fkey(display_name), batch:batches!classrooms_batch_id_fkey(batch_members(count)), classroom_enrollments(count)")
        .eq("status", "live")
        .order("started_at", { ascending: false });
      setClasses((data ?? []) as unknown as LiveClass[]);
      loadedOnce.current = true;
    };
    const loadHelpRequests = async () => {
      const { data } = await supabase
        .from("help_requests")
        .select("id, classroom_id, requested_role, created_at, classroom:classrooms(title), requester:profiles!help_requests_requested_by_fkey(display_name)")
        .eq("academy_id", academyId).eq("status", "open")
        .order("created_at");
      setHelpRequests((data ?? []) as unknown as HelpRequest[]);
    };

    // THE single realtime subscription - every mini board (and the help-request
    // queue) feeds from this one channel.
    const channel = supabase
      .channel("live-ops")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "classrooms", filter: `academy_id=eq.${academyId}` },
        (payload) => {
          const row = payload.new as {
            id: string; status: string; live_fen: string | null;
            live_updated_at: string | null; started_at: string | null;
          };
          // Class ended: drop it from the playing set so its mesh tears down
          // rather than staying connected to a room nobody is in.
          if (row.status !== "live") setVisibleIds((v) => v.filter((id) => id !== row.id));
          setClasses((cur) => {
            const known = cur.find((c) => c.id === row.id);
            if (row.status !== "live") return cur.filter((c) => c.id !== row.id);
            if (known) {
              return cur.map((c) => (c.id === row.id
                ? { ...c, live_fen: row.live_fen, live_updated_at: row.live_updated_at, started_at: row.started_at }
                : c));
            }
            void load(); // a class just went live - fetch its metadata once
            return cur;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "help_requests", filter: `academy_id=eq.${academyId}` },
        () => { void loadHelpRequests(); }, // fetch once for the classroom/requester names
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "help_requests", filter: `academy_id=eq.${academyId}` },
        (payload) => {
          const row = payload.new as { id: string; status: string };
          // claimed or resolved (by us or another manager) - drop it from the queue.
          if (row.status !== "open") setHelpRequests((cur) => cur.filter((r) => r.id !== row.id));
        },
      )
      /* Snapshot AFTER the subscription is live, never before.
       *
       * This is what the stale-board bug was: the wall used to fetch first and
       * subscribe second, so every move a coach made in the gap between those
       * two calls landed in neither - not in the snapshot (too late) and not in
       * the stream (not listening yet) - and the board sat on the pre-move
       * position until something else happened to touch that row. Loading from
       * inside the SUBSCRIBED callback closes the window: the stream is already
       * buffering by the time we read the table, so the snapshot can only be
       * newer than anything we might have missed.
       *
       * Supabase re-fires SUBSCRIBED after an automatic rejoin, which makes
       * this double as reconnection recovery - we re-sync instead of trusting a
       * board that may have moved on while the socket was down. */
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") {
          void load();
          void loadHelpRequests();
        }
      });

    /* Safety net: if the subscription never lands (Realtime down, connection
     * quota reached, flaky network), load anyway rather than leaving a manager
     * staring at "Loading live classes…" forever. Waiting for SUBSCRIBED is
     * what keeps the board fresh, but it must not be the only path to showing
     * data - an out-of-date wall still beats a blank one, and `connected`
     * already tells them the live indicator is off. */
    const fallback = setTimeout(() => {
      if (!loadedOnce.current) {
        void load();
        void loadHelpRequests();
      }
    }, 5000);

    return () => { clearTimeout(fallback); void supabase.removeChannel(channel); };
  }, [configured, academyId]);

  /* Autoplay driver: a card on screen gets its video, a card scrolled away
   * releases it. rootMargin starts the connection slightly before the card
   * is fully visible so it's usually already playing by the time it lands. */
  const classIdKey = classes.map((c) => c.id).join(",");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisibleIds((cur) => {
          const next = new Set(cur);
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.classId;
            if (!id) continue;
            if (e.isIntersecting) next.add(id); else next.delete(id);
          }
          /* Returning a fresh array unconditionally re-rendered the entire
           * wall on every observer callback - and the observer fires
           * continuously while a manager scrolls, on a page that can hold
           * ninety cards and half a dozen live video rooms. Most of those
           * callbacks change nothing; keep the identical array and React
           * bails out of the render altogether. */
          if (next.size === cur.length && cur.every((id) => next.has(id))) return cur;
          return [...next];
        });
      },
      { rootMargin: "200px 0px", threshold: 0.1 },
    );
    Object.values(cardRefs.current).forEach((el) => el && io.observe(el));
    return () => io.disconnect();
    // Keyed on which classes are on the wall, not how many: swapping one live
    // class for another leaves the count identical while every card is new.
  }, [classIdKey]);

  /* Hard ceiling regardless of viewport size - a very tall monitor could
   * otherwise put a dozen rooms on screen at once. Oldest-started first, so
   * the set stays stable while scrolling rather than reshuffling. */
  const MAX_CONCURRENT_VIDEO = 6;
  const playing = useMemo(
    () => visibleIds.slice(0, MAX_CONCURRENT_VIDEO),
    [visibleIds],
  );

  // Coach requests outrank student requests; ties break oldest-first - the
  // whole "priority queue" is this one sort (src/lib/help-queue.ts), no
  // separate ranking engine.
  const queue = sortHelpQueue(
    helpRequests.map((r) => ({ ...r, requestedRole: r.requested_role, createdAt: r.created_at })),
  );

  const claim = async (req: HelpRequest) => {
    const supabase = createClient();
    // Conditional UPDATE is the lock: only the manager whose write lands while
    // status is still 'open' gets a row back. Everyone else sees 0 rows and
    // backs off - no advisory lock, no separate claim table.
    const { data } = await supabase
      .from("help_requests")
      .update({ status: "claimed", claimed_by: profileId, claimed_at: new Date().toISOString() })
      .eq("id", req.id).eq("status", "open")
      .select().maybeSingle();
    setHelpRequests((cur) => cur.filter((r) => r.id !== req.id));
    if (data) router.push(`/${role}/dashboard/${academyId}/classrooms/${req.classroom_id}`);
    // else: lost the race - another manager already claimed it, nothing else to do.
  };

  const studentCount = (c: LiveClass) =>
    c.batch_id
      ? c.batch?.batch_members?.[0]?.count ?? 0
      : c.classroom_enrollments?.[0]?.count ?? 0;

  return (
    <div>
      <PageHeader
        title="Live Operations"
        subtitle="Every active class across the academy, updating in real time"
        action={
          <span className={`text-xs flex items-center gap-1 ${connected ? "text-success" : "text-muted-foreground"}`}>
            ● {connected ? "Realtime connected (1 channel)" : "Connecting…"}
          </span>
        }
      />

      {/* Free-tier connection budget (docs/PRODUCTION_READINESS.md "Live
          class scale limit"): 200-connection cap, ~2/class, 90-class safe
          line until Supabase Pro is confirmed on this project. */}
      {classes.length >= 90 && (
        <div className="mb-4 rounded-card border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning">
          {classes.length} classes live, at or past the ~90-class Free Tier connection
          budget (200 concurrent Realtime connections). Confirm Supabase Pro is active
          before this goes higher.
        </div>
      )}

      {classes.length === 0 ? (
        <EmptyState text={loadedOnce.current || !configured
          ? "No live classes right now. Boards appear here the moment a coach starts one."
          : "Loading live classes…"} />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {classes.map((c) => {
            const calling = helpRequests.some((r) => r.classroom_id === c.id);
            return (
            <div key={c.id}
              ref={(el) => { cardRefs.current[c.id] = el; }}
              data-class-id={c.id}
              className={`bg-surface-2 border rounded-card p-3 flex flex-col gap-2 ${calling ? "border-2 animate-help-blink" : "border-border"}`}>
              <MiniBoard fen={c.live_fen} />
              <div className="flex items-center justify-between gap-2">
                <BoardFreshness at={c.live_updated_at} />
              </div>

              {/* Participant video, directly below the board position. Real
                  classroom streams - the same mesh the room itself uses, joined
                  receive-only so the class never sees a manager tile appear.
                  Starts on its own once the card is on screen. */}
              {playing.includes(c.id) ? (
                <div className="h-56 rounded-lg overflow-hidden border border-border">
                  <MeshVideoRoom
                    classroomId={c.id}
                    me={{ userId: profileId, name: profileName, role }}
                    viewOnly
                  />
                </div>
              ) : (
                <div className="h-56 rounded-lg border border-dashed border-border flex items-center justify-center">
                  <p className="text-xs text-muted-foreground">Scroll into view to load video</p>
                </div>
              )}
              <div className="text-sm">
                <p className="font-medium truncate" title={c.title}>{c.title}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                  <span>♟ {c.coach?.display_name ?? ""}</span>
                  <span>· {studentCount(c)} student{studentCount(c) === 1 ? "" : "s"}</span>
                  <span>· <Elapsed since={c.started_at} /></span>
                  <StatusPill status="live" />
                </p>
              </div>
              <div className="flex gap-2 mt-auto">
                <Link href={`/${role}/dashboard/${academyId}/classrooms/${c.id}`}
                  className="flex-1 text-center rounded-btn bg-primary hover:bg-primary-hover text-primary-foreground px-3 py-1.5 text-sm transition-colors">
                  Join
                </Link>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Priority queue - persistent (not auto-dismissing like ToastProvider),
          sorted coach-first-then-oldest, one card per open request. At
          20-30 concurrent classes this is still a short list, never a modal
          per request. */}
      {queue.length > 0 && (
        <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
          {queue.map((r) => (
            <div key={r.id} className="bg-surface-3 border-2 border-destructive rounded-card p-3 shadow-lg">
              <p className="text-sm font-semibold">
                {r.requested_role === "coach" ? "Coach" : "Student"} needs help
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {r.classroom?.title ?? "Classroom"} · {r.requester?.display_name ?? "?"} · <Elapsed since={r.created_at} /> ago
              </p>
              <button
                onClick={() => void claim(r)}
                className="mt-2 w-full rounded-btn bg-destructive text-destructive-foreground hover:opacity-90 px-3 py-1.5 text-sm font-medium transition-opacity"
              >
                Join Class
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
