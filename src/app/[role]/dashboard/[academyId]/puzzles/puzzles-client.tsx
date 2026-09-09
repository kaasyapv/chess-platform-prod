"use client";

/* Puzzle trainer - sleek solver over the shared ChessBoard. Pulls a random
 * puzzle in the chosen difficulty band from the 10k+ Lichess CC0 set. The
 * Lichess format: FEN is the position BEFORE the opponent's setup move; the
 * first move in `moves` is played automatically, then the solver must find
 * each subsequent move in sequence. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { ChessBoard } from "@/components/board/chess-board";
import { Button, Card, PageHeader, SegmentedTabs } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useChessSounds, soundForMove } from "@/hooks/use-chess-sounds";
import type { Profile } from "@/lib/auth";
import topicData from "@/data/topic-puzzles.json";
import { Trophy, CheckCircle2, XCircle } from "lucide-react";

type Puzzle = { id: string; fen: string; moves: string; rating: number; themes: string };

const BANDS: Record<string, [number, number]> = {
  Easy: [400, 1200], Medium: [1200, 1700], Hard: [1700, 2200], Expert: [2200, 3300],
};

/* ── Topic trainer data ───────────────────────────────────────────────────────
 * 50 Lichess CC0 puzzles (5 topics × 10, rating-ramped) live in
 * src/data/topic-puzzles.json, generated from the bundled set. Progress is a
 * client-side ledger in localStorage: puzzle id → correct | incorrect. */
const TOPICS = Object.keys(topicData) as (keyof typeof topicData)[];
type TopicName = keyof typeof topicData;
type Outcome = "correct" | "incorrect";

const progressKey = (profileId: string) => `puzzle-topics:${profileId}`;

function loadProgress(profileId: string): Record<string, Outcome> {
  try { return JSON.parse(localStorage.getItem(progressKey(profileId)) ?? "{}"); }
  catch { return {}; }
}

export function PuzzlesClient({ profile, total }: { profile: Profile; total: number }) {
  const toast = useToast();
  const { play } = useChessSounds(true);
  const [mode, setMode] = useState<"By Difficulty" | "By Topic">("By Difficulty");
  const [band, setBand] = useState("Easy");
  const [topic, setTopic] = useState<TopicName>(TOPICS[0]);
  const [progress, setProgress] = useState<Record<string, Outcome>>({});
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [fen, setFen] = useState("");
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [solveIdx, setSolveIdx] = useState(0); // index into the solution move list
  const [state, setState] = useState<"solving" | "solved" | "failed">("solving");
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | undefined>();
  const [streak, setStreak] = useState(0);
  const [solvedCount, setSolvedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const chess = useRef(new Chess());
  const solution = useRef<string[]>([]); // UCI moves the solver must find (opponent replies auto-played)

  // The topic ledger lives in localStorage - read once, write on every change.
  // loadPuzzle reads it through a ref: "next unattempted" must see the outcome
  // that was just saved, not the progress captured when the callback was built.
  const progressRef = useRef(progress);
  progressRef.current = progress;
  useEffect(() => { setProgress(loadProgress(profile.id)); }, [profile.id]);
  const saveOutcome = useCallback((id: string, o: Outcome) => {
    setProgress((prev) => {
      const next = { ...prev, [id]: o };
      try { localStorage.setItem(progressKey(profile.id), JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, [profile.id]);

  /** Put a puzzle on the board (shared by both modes). */
  const setupPuzzle = useCallback((p: Puzzle) => {
    setState("solving");
    setSolveIdx(0);
    setLastMove(undefined);
    const c = new Chess(p.fen);
    const uci = p.moves.split(" ");
    // Auto-play the opponent's setup move; solver plays from the reply.
    const first = uci.shift();
    if (first) {
      c.move({ from: first.slice(0, 2), to: first.slice(2, 4), promotion: first.slice(4) || undefined });
      setLastMove({ from: first.slice(0, 2), to: first.slice(2, 4) });
    }
    chess.current = c;
    solution.current = uci;
    setPuzzle(p);
    setFen(c.fen());
    setOrientation(c.turn() === "w" ? "white" : "black");
    setLoading(false);
  }, []);

  const loadPuzzle = useCallback(async () => {
    setLoading(true);
    if (mode === "By Topic") {
      // Next unattempted puzzle in the active topic; done = show the summary.
      const list = topicData[topic] as Puzzle[];
      const next = list.find((p) => !progressRef.current[p.id]);
      if (!next) { setPuzzle(null); setFen(""); setLoading(false); return; }
      setupPuzzle({ ...next, themes: "" });
      return;
    }
    const supabase = createClient();
    const [lo, hi] = BANDS[band];
    // Random pick in-band: offset into a bounded window (fast, index-backed).
    const { count } = await supabase.from("puzzles")
      .select("*", { count: "exact", head: true }).gte("rating", lo).lt("rating", hi);
    const n = count ?? 0;
    const offset = n > 1 ? Math.floor(Math.random() * n) : 0;
    const { data } = await supabase.from("puzzles")
      .select("id, fen, moves, rating, themes")
      .gte("rating", lo).lt("rating", hi)
      .order("id").range(offset, offset).limit(1);
    const p = data?.[0] as Puzzle | undefined;
    if (!p) { setLoading(false); toast("No puzzles in this band, seed puzzles first", "error"); return; }
    setupPuzzle(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band, mode, topic, setupPuzzle, toast]);

  // Reload when the band/topic/mode changes - NOT when progress does, or the
  // board would yank the next puzzle in the instant one is solved.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadPuzzle(); }, [band, mode, topic]);

  async function recordAttempt(solved: boolean) {
    if (profile.role !== "student") return;
    const supabase = createClient();
    await supabase.from("puzzle_attempts").insert({
      academy_id: profile.academy_id, student_id: profile.id,
      puzzle_id: puzzle!.id, solved,
    }).then(() => {});
    if (solved) void logActivity(profile.academy_id, profile.id, "puzzle_solved",
      { detail: puzzle!.themes || undefined });
  }

  function onMove(from: string, to: string) {
    if (state !== "solving") return;
    const expected = solution.current[solveIdx];
    const c = chess.current;
    // Try the user's move on a scratch board to get its UCI/SAN
    const scratch = new Chess(c.fen());
    let mv;
    try {
      mv = scratch.move({ from, to, promotion: "q" });
    } catch { play("illegal"); setFen(c.fen()); return; }
    const userUci = mv.from + mv.to + (mv.promotion ?? "");

    if (userUci !== expected && userUci.slice(0, 4) !== expected.slice(0, 4)) {
      // wrong
      play("illegal");
      setFen(c.fen());
      setState("failed");
      setStreak(0);
      if (mode === "By Topic" && puzzle) saveOutcome(puzzle.id, "incorrect");
      void recordAttempt(false);
      return;
    }
    // correct move
    c.move({ from, to, promotion: "q" });
    play(soundForMove(mv, c.inCheck()));
    setLastMove({ from, to });
    const nextIdx = solveIdx + 1;

    if (nextIdx >= solution.current.length) {
      setFen(c.fen());
      setState("solved");
      setStreak((s) => s + 1);
      setSolvedCount((n) => n + 1);
      if (mode === "By Topic" && puzzle) saveOutcome(puzzle.id, "correct");
      void recordAttempt(true);
      return;
    }
    // auto-play opponent reply
    const reply = solution.current[nextIdx];
    c.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply.slice(4) || undefined });
    setLastMove({ from: reply.slice(0, 2), to: reply.slice(2, 4) });
    setFen(c.fen());
    setSolveIdx(nextIdx + 1);
  }

  function showHint() {
    const next = solution.current[solveIdx];
    if (next) toast(`Move the piece on ${next.slice(0, 2)}`, "info");
  }

  const themeTags = puzzle?.themes.split(" ").filter(Boolean).slice(0, 4) ?? [];

  return (
    <div>
      <PageHeader
        title="Puzzles"
        subtitle={`${total.toLocaleString()} interactive tactics · train your calculation`}
        action={
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">Streak <b className="text-foreground tabular-nums">{streak}</b></span>
            <span className="text-muted-foreground">Solved <b className="text-foreground tabular-nums">{solvedCount}</b></span>
          </div>
        }
      />

      <div className="mb-3">
        <SegmentedTabs tabs={["By Difficulty", "By Topic"]} active={mode}
          onChange={(m) => setMode(m as typeof mode)} />
      </div>
      {mode === "By Difficulty" ? (
        <div className="mb-4"><SegmentedTabs tabs={Object.keys(BANDS)} active={band} onChange={setBand} /></div>
      ) : (
        <TopicTracker topic={topic} onTopic={setTopic} progress={progress}
          onReset={() => {
            try { localStorage.removeItem(progressKey(profile.id)); } catch { /* private mode */ }
            setProgress({});
            // Ledger is empty again - deal the active topic from the top.
            setTimeout(() => void loadPuzzle(), 0);
          }} />
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem] gap-6 items-start">
        <div className="rise mx-auto w-full max-w-xl aspect-square">
          {fen && (
            <ChessBoard
              fen={fen}
              orientation={orientation}
              movable={state === "solving" && !loading}
              lastMove={lastMove}
              lastMoveMode="highlight"
              check={chess.current.inCheck()}
              boardTheme={(profile.board_settings?.boardTheme as string) ?? "club-green"}
              pieceSet={(profile.board_settings?.pieceSet as string) ?? "loco"}
              onMove={onMove}
            />
          )}
        </div>

        <Card className="rise rise-1">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading puzzle…</p>
          ) : mode === "By Topic" && !puzzle ? (
            <div className="text-center py-4">
              <Trophy className="mx-auto mb-2 text-warning" size={28} />
              <p className="text-sm font-medium">{topic}, complete!</p>
              <p className="text-xs text-muted-foreground mt-1">
                You attempted all {(topicData[topic] as Puzzle[]).length} puzzles in this topic.
                Pick another topic above, or reset your progress to run it again.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">
                  {orientation === "white" ? "White" : "Black"} to move
                </span>
                {puzzle && <span className="text-xs text-muted-foreground tabular-nums">rating {puzzle.rating}</span>}
              </div>

              {state === "solving" && (
                <p className="text-sm text-muted-foreground">Find the best move{solution.current.length > 1 ? "s" : ""}.</p>
              )}
              {state === "solved" && (
                <p className="text-sm text-success font-medium flex items-center gap-2"><CheckCircle2 size={16} /> Solved! Well played.</p>
              )}
              {state === "failed" && (
                <p className="text-sm text-destructive font-medium flex items-center gap-2"><XCircle size={16} /> Not quite, the streak resets. Try the next one.</p>
              )}

              {themeTags.length > 0 && (state !== "solving") && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {themeTags.map((t) => (
                    <span key={t} className="text-[11px] bg-surface-3 rounded-full px-2 py-0.5 text-muted-foreground">{t}</span>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-2 mt-4">
                {state === "solving" && <Button variant="secondary" onClick={showHint}>Hint</Button>}
                {state === "solving"
                  ? <Button variant="ghost" onClick={() => {
                      setState("failed"); setStreak(0);
                      if (mode === "By Topic" && puzzle) saveOutcome(puzzle.id, "incorrect");
                      void recordAttempt(false);
                    }}>Skip / Give up</Button>
                  : <Button onClick={loadPuzzle}>Next puzzle →</Button>}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ── Topic tracker ────────────────────────────────────────────────────────────
 * One chip per tactical topic with its progress bar (green = correct share,
 * red = incorrect), the overall correct/incorrect tally, and Reset Progress. */
function TopicTracker({ topic, onTopic, progress, onReset }: {
  topic: TopicName;
  onTopic: (t: TopicName) => void;
  progress: Record<string, Outcome>;
  onReset: () => void;
}) {
  const tally = (list: { id: string }[]) => {
    let correct = 0, incorrect = 0;
    for (const p of list) {
      if (progress[p.id] === "correct") correct++;
      else if (progress[p.id] === "incorrect") incorrect++;
    }
    return { correct, incorrect, total: list.length };
  };
  const overall = tally(Object.values(topicData).flat());

  return (
    <div className="mb-4 rounded-card border border-border bg-surface-1 p-3">
      <div className="flex flex-wrap gap-2">
        {TOPICS.map((t) => {
          const { correct, incorrect, total } = tally(topicData[t]);
          const active = t === topic;
          return (
            <button key={t} onClick={() => onTopic(t)} aria-pressed={active}
              className={`min-w-40 flex-1 text-left rounded-btn border px-3 py-2 transition-colors ${
                active ? "border-primary bg-primary/10" : "border-border bg-surface-2 hover:bg-surface-3"
              }`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{t}</span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {correct + incorrect}/{total}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-surface-3 overflow-hidden flex">
                <span className="bg-success h-full" style={{ width: `${(correct / total) * 100}%` }} />
                <span className="bg-destructive h-full" style={{ width: `${(incorrect / total) * 100}%` }} />
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-3">
        <p className="text-xs text-muted-foreground tabular-nums">
          <span className="text-success font-medium">{overall.correct} correct</span>
          {" · "}
          <span className="text-destructive font-medium">{overall.incorrect} incorrect</span>
          {" · "}{overall.total - overall.correct - overall.incorrect} to go
        </p>
        <Button variant="ghost" className="!py-1 !px-3 text-xs"
          onClick={onReset} disabled={overall.correct + overall.incorrect === 0}>
          Reset Progress
        </Button>
      </div>
    </div>
  );
}
