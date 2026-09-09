"use client";

/* Self-paced activity player for the ABC curriculum. Renders per `kind`:
 *
 *   explanation  - board (from FEN) + commentary, "Got it" completes it
 *   puzzle       - solve over the board; move checked vs `answer` (chess-answer.ts)
 *   capture      - same solver, framed as "make the winning capture"
 *   mcq          - pick a choice, checked vs `answer` (the correct choice id)
 *   play         - board + a link out to the Play Area (vs-engine lives there)
 *
 * Progress is the student's own `curriculum_progress` row (RLS: self-write).
 * `attempts` and `time_ms` accumulate so a coach can see effort, not just
 * pass/fail - the market research flagged calculation-time tracking as a
 * differentiator.
 */

import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { ChessBoard } from "@/components/board/chess-board";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { answerMatches } from "@/lib/chess-answer";
import { ACTIVITY_KIND_LABEL, type CurriculumActivity, type CurriculumProgress } from "@/lib/curriculum";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function ActivityPlayer({
  activity, studentId, prior, onDone,
}: {
  activity: CurriculumActivity;
  studentId: string;
  prior?: CurriculumProgress;
  /** Called after a progress write so the parent can refresh its map. */
  onDone: (p: CurriculumProgress) => void;
}) {
  const supabase = createClient();
  const toast = useToast();
  const startedAt = useRef(Date.now());
  const chess = useRef(new Chess());
  const [fen, setFen] = useState(activity.fen || START);
  const [attempts, setAttempts] = useState(prior?.attempts ?? 0);
  const [result, setResult] = useState<"idle" | "correct" | "wrong">("idle");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try { chess.current = new Chess(activity.fen || START); } catch { chess.current = new Chess(); }
    setFen(chess.current.fen());
    startedAt.current = Date.now();
  }, [activity.id, activity.fen]);

  async function writeProgress(status: CurriculumProgress["status"], score: number | null, nextAttempts: number) {
    setSaving(true);
    const row: CurriculumProgress = {
      student_id: studentId,
      activity_id: activity.id,
      status,
      score,
      attempts: nextAttempts,
      time_ms: Date.now() - startedAt.current,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("curriculum_progress").upsert(row, { onConflict: "student_id,activity_id" });
    setSaving(false);
    if (error) { toast(`Could not save progress: ${error.message}`, "error"); return; }
    onDone(row);
  }

  function onMove(from: string, to: string) {
    const c = chess.current;
    let move;
    try {
      const piece = c.get(from as Parameters<Chess["get"]>[0]);
      const promo = piece?.type === "p" && (to[1] === "8" || to[1] === "1") ? "q" : undefined;
      move = c.move({ from, to, promotion: promo });
    } catch { return; }
    setFen(c.fen());
    const ok = answerMatches(activity.fen || START, move.san, activity.answer ?? "");
    const next = attempts + 1;
    setAttempts(next);
    if (ok) {
      setResult("correct");
      // Score: full for a first-try solve, then decays. Floor at 20%.
      void writeProgress("completed", Math.max(20, 100 - (next - 1) * 20), next);
    } else {
      setResult("wrong");
      void writeProgress("attempted", null, next);
      // Let them retry from the position.
      setTimeout(() => { c.undo(); setFen(c.fen()); setResult("idle"); }, 700);
    }
  }

  const isBoardSolver = activity.kind === "puzzle" || activity.kind === "capture";
  const done = result === "correct";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-surface-3 px-2.5 py-0.5 text-xs text-muted-foreground">
          {ACTIVITY_KIND_LABEL[activity.kind]}
        </span>
        {attempts > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">{attempts} attempt{attempts === 1 ? "" : "s"}</span>
        )}
      </div>
      {activity.prompt && <p className="text-sm">{activity.prompt}</p>}

      {(activity.fen || isBoardSolver || activity.kind === "explanation" || activity.kind === "play") && (
        <div className="mx-auto w-full max-w-[420px]">
          <ChessBoard
            fen={fen}
            movable={isBoardSolver && !done}
            coordinates
          />
        </div>
      )}

      {isBoardSolver && (
        <p className={`text-sm font-medium ${result === "correct" ? "text-success" : result === "wrong" ? "text-destructive" : "text-muted-foreground"}`}>
          {result === "correct" ? "Solved!" : result === "wrong" ? "Not that one - try again." : "Make your move on the board."}
        </p>
      )}

      {activity.kind === "mcq" && (
        <div className="flex flex-col gap-2">
          {activity.choices.map((c) => (
            <button
              key={c.id}
              disabled={done || saving}
              onClick={() => {
                const ok = c.id === (activity.answer ?? "");
                const next = attempts + 1;
                setAttempts(next);
                if (ok) { setResult("correct"); void writeProgress("completed", Math.max(20, 100 - (next - 1) * 25), next); }
                else { setResult("wrong"); void writeProgress("attempted", null, next); }
              }}
              className={`rounded-btn border px-3 py-2 text-left text-sm transition-colors ${
                done && c.id === activity.answer ? "border-success bg-success/10" : "border-border hover:bg-surface-2"
              }`}
            >
              {c.text}
            </button>
          ))}
          {result === "wrong" && <p className="text-sm text-destructive">Not quite - try another.</p>}
          {done && <p className="text-sm text-success">Correct!</p>}
        </div>
      )}

      {activity.kind === "explanation" && !done && (
        <Button onClick={() => { setResult("correct"); void writeProgress("completed", 100, attempts); }} disabled={saving}>
          Got it
        </Button>
      )}

      {activity.kind === "play" && (
        <p className="text-sm text-muted-foreground">
          Play this position against the engine in the <b>Play Area</b>, then come back and mark it done.
          {!done && (
            <Button variant="secondary" className="ml-2 !py-1 !px-2 text-xs"
              onClick={() => { setResult("correct"); void writeProgress("completed", 100, attempts); }}>
              Mark done
            </Button>
          )}
        </p>
      )}

      {done && <p className="text-sm text-success font-medium">Activity complete{saving ? " — saving…" : ""}.</p>}
    </div>
  );
}
