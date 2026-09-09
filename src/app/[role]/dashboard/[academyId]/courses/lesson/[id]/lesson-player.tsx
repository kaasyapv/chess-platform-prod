"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Chess } from "chess.js";
import { createClient } from "@/lib/supabase/client";
import { ChessBoard } from "@/components/board/chess-board";
import { useStockfish } from "@/hooks/use-stockfish";
import { PageHeader, Button, EmptyState, Card } from "@/components/ui";
import { CheckCircle2, Trophy, BookOpen } from "lucide-react";
import { useToast } from "@/components/ui/toast";

type Step = { fen: string; moves?: string[] | string; task?: string | null; explanation?: string | null };
type Question = { fen: string; prompt: string; answerSan: string };
type FlashCard = { front: { fen: string; prompt: string }; back: { answer: string } };
type Lesson = {
  id: string;
  kind: "lesson" | "quiz" | "flashcards";
  title: string;
  content: { steps?: Step[]; questions?: Question[]; cards?: FlashCard[] };
};

const START_FEN = new Chess().fen();

function stepMoves(step: Step): string[] {
  if (Array.isArray(step.moves)) return step.moves.filter(Boolean);
  if (typeof step.moves === "string") return step.moves.split(/\s+/).filter(Boolean);
  return [];
}

function sideToMove(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

/** Try a from/to move on a FEN; returns the resulting SAN + fen or null. */
function tryMove(fen: string, from: string, to: string): { san: string; fen: string } | null {
  try {
    const c = new Chess(fen);
    const mv = c.move({ from, to, promotion: "q" });
    return { san: mv.san, fen: c.fen() };
  } catch {
    return null;
  }
}

function sanEq(a: string, b: string) {
  const norm = (s: string) => s.replace(/[+#?!]/g, "");
  return norm(a) === norm(b);
}

function findMoveSquares(fen: string, san: string): { from: string; to: string } | null {
  try {
    const c = new Chess(fen);
    const mv = c.moves({ verbose: true }).find((m) => sanEq(m.san, san));
    return mv ? { from: mv.from, to: mv.to } : null;
  } catch {
    return null;
  }
}

export function LessonPlayer({
  academyId,
  role,
  lessonId,
  profileId,
}: {
  academyId: string;
  role: string;
  lessonId: string;
  profileId: string;
}) {
  const supabase = createClient();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("lessons")
      .select("id, kind, title, content")
      .eq("id", lessonId)
      .single()
      .then(({ data }) => {
        setLesson((data as Lesson) ?? null);
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  const saveProgress = useCallback(
    async (patch: Partial<{ completed_steps: number; total_steps: number; hints_used: number; score: number; completed_at: string | null }>) => {
      await supabase.from("lesson_progress").upsert({
        lesson_id: lessonId,
        student_id: profileId,
        updated_at: new Date().toISOString(),
        ...patch,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lessonId, profileId],
  );

  const back = (
    <div className="mb-4 text-sm">
      <Link href={`/${role}/dashboard/${academyId}/courses`} className="text-muted-foreground hover:text-foreground">
        ← Content Library
      </Link>
    </div>
  );

  if (loading) return <div>{back}<p className="text-muted-foreground py-12 text-center">Loading…</p></div>;
  if (!lesson) return <div>{back}<EmptyState text="Lesson not found." /></div>;

  return (
    <div>
      {back}
      {lesson.kind === "lesson" && <StepLesson lesson={lesson} saveProgress={saveProgress} />}
      {lesson.kind === "quiz" && <Quiz lesson={lesson} saveProgress={saveProgress} />}
      {lesson.kind === "flashcards" && <Flashcards lesson={lesson} />}
    </div>
  );
}

// ── Step-by-step lesson ───────────────────────────────────────────────────────
function StepLesson({
  lesson,
  saveProgress,
}: {
  lesson: Lesson;
  saveProgress: (p: Record<string, unknown>) => Promise<void>;
}) {
  const toast = useToast();
  const steps = useMemo(() => lesson.content.steps ?? [], [lesson]);
  const [stepIdx, setStepIdx] = useState(0);
  const [fen, setFen] = useState(steps[0]?.fen ?? START_FEN);
  const [moveIdx, setMoveIdx] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintArrow, setHintArrow] = useState<{ from: string; to: string } | null>(null);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | undefined>();
  const [done, setDone] = useState(false);
  const [analyze, setAnalyze] = useState(false);
  const [boardKey, setBoardKey] = useState(0); // bumped to force a board reset on wrong moves
  const autoplayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const step = steps[stepIdx];
  const moves = step ? stepMoves(step) : [];
  const expected = moves[moveIdx];
  const stepMovesDone = moveIdx >= moves.length;

  const { lines, depth } = useStockfish(fen, analyze);

  useEffect(() => () => { if (autoplayRef.current) clearTimeout(autoplayRef.current); }, []);

  function goToStep(idx: number) {
    if (idx >= steps.length) {
      setDone(true);
      saveProgress({
        completed_steps: steps.length,
        total_steps: steps.length,
        hints_used: hintsUsed,
        completed_at: new Date().toISOString(),
      });
      return;
    }
    setStepIdx(idx);
    setFen(steps[idx].fen);
    setMoveIdx(0);
    setHintArrow(null);
    setLastMove(undefined);
    saveProgress({ completed_steps: idx, total_steps: steps.length, hints_used: hintsUsed });
  }

  function advance(newFen: string, played: { from: string; to: string }, nextMoveIdx: number) {
    setFen(newFen);
    setLastMove(played);
    setHintArrow(null);
    setMoveIdx(nextMoveIdx);
    const reply = moves[nextMoveIdx];
    // Auto-play the opponent reply if one exists (user plays every other move)
    if (reply) {
      autoplayRef.current = setTimeout(() => {
        const sq = findMoveSquares(newFen, reply);
        const res = sq ? tryMove(newFen, sq.from, sq.to) : null;
        if (res && sq) {
          setFen(res.fen);
          setLastMove(sq);
          setMoveIdx(nextMoveIdx + 1);
        } else {
          // reply not playable - treat step as finished
          setMoveIdx(moves.length);
        }
      }, 450);
    }
  }

  function onMove(from: string, to: string) {
    if (!expected) return;
    const res = tryMove(fen, from, to);
    if (res && sanEq(res.san, expected)) {
      toast(`${res.san}`, "success");
      advance(res.fen, { from, to }, moveIdx + 1);
    } else {
      toast(res ? `${res.san} isn't it, try again` : "Illegal move, try again", "error");
      // Reset the board to the step's starting position
      setFen(step.fen);
      setMoveIdx(0);
      setLastMove(undefined);
      setBoardKey((k) => k + 1);
    }
  }

  function showHint() {
    if (!expected) return;
    const sq = findMoveSquares(fen, expected);
    if (sq) {
      setHintArrow(sq);
      setHintsUsed((h) => h + 1);
    }
  }

  if (done) {
    return (
      <div>
        <PageHeader title={lesson.title} />
        <Card className="max-w-lg mx-auto text-center py-12">
          <CheckCircle2 className="mx-auto mb-3 text-success" size={40} />
          <h2 className="text-xl font-semibold">Lesson complete!</h2>
          <p className="text-muted-foreground mt-2">
            {steps.length} step{steps.length === 1 ? "" : "s"} · {hintsUsed} hint{hintsUsed === 1 ? "" : "s"} used
          </p>
        </Card>
      </div>
    );
  }

  const progress = steps.length ? Math.round((stepIdx / steps.length) * 100) : 0;
  const userToMove = !stepMovesDone;
  const best = lines[0];

  return (
    <div>
      <PageHeader title={lesson.title} subtitle={`Step ${stepIdx + 1} of ${steps.length}`} />
      <div className="h-2 rounded-full bg-surface-3 mb-6 overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full max-w-[480px] aspect-square shrink-0">
          <ChessBoard
            key={`${stepIdx}-${boardKey}`}
            fen={fen}
            orientation={sideToMove(step.fen)}
            movable={userToMove ? sideToMove(fen) : false}
            lastMove={lastMove}
            arrows={hintArrow ? [{ from: hintArrow.from, to: hintArrow.to, color: "green" }] : []}
            onMove={onMove}
          />
        </div>

        <div className="flex-1 min-w-0 space-y-4">
          <Card>
            {step.task && <h3 className="font-semibold mb-1">{step.task}</h3>}
            {step.explanation && <p className="text-sm text-muted-foreground">{step.explanation}</p>}
            {!step.task && !step.explanation && (
              <p className="text-sm text-muted-foreground">
                {moves.length > 0 ? "Play the best move on the board." : "Study this position."}
              </p>
            )}
            {moves.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Move {Math.min(moveIdx + 1, moves.length)} of {moves.length}
              </p>
            )}
          </Card>

          <div className="flex flex-wrap gap-2">
            {userToMove && (
              <Button variant="secondary" onClick={showHint}>Hint ({hintsUsed})</Button>
            )}
            {stepMovesDone && (
              <Button onClick={() => goToStep(stepIdx + 1)}>
                {stepIdx + 1 >= steps.length ? "Finish" : "Next step →"}
              </Button>
            )}
            <Button
              variant={analyze ? "primary" : "secondary"}
              onClick={() => setAnalyze((a) => !a)}
            >
              Analyze
            </Button>
          </div>

          {analyze && (
            <Card>
              <h4 className="text-sm font-medium mb-2">Stockfish · depth {depth}</h4>
              {best ? (
                <div className="text-sm">
                  <span className="font-mono font-semibold mr-2">
                    {best.mate != null ? `M${Math.abs(best.mate)}` : `${(best.score / 100).toFixed(2)}`}
                  </span>
                  <span className="font-mono text-muted-foreground">{best.pv.slice(0, 8).join(" ")}</span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Thinking…</p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Quiz ─────────────────────────────────────────────────────────────────────
function Quiz({
  lesson,
  saveProgress,
}: {
  lesson: Lesson;
  saveProgress: (p: Record<string, unknown>) => Promise<void>;
}) {
  const toast = useToast();
  const questions = useMemo(() => lesson.content.questions ?? [], [lesson]);
  const [idx, setIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [done, setDone] = useState(false);

  const q = questions[idx];

  function next(gotIt: boolean) {
    const newCorrect = correct + (gotIt ? 1 : 0);
    setCorrect(newCorrect);
    if (idx + 1 >= questions.length) {
      setDone(true);
      const score = questions.length ? Math.round((newCorrect / questions.length) * 100) : 0;
      saveProgress({
        score,
        completed_steps: questions.length,
        total_steps: questions.length,
        completed_at: new Date().toISOString(),
      });
    } else {
      setIdx(idx + 1);
    }
  }

  function onMove(from: string, to: string) {
    const res = tryMove(q.fen, from, to);
    if (res && sanEq(res.san, q.answerSan)) {
      toast(`${res.san} is correct!`, "success");
      next(true);
    } else {
      toast(`${res?.san ?? "Illegal move"} was wrong: the answer was ${q.answerSan}`, "error");
      next(false);
    }
  }

  if (questions.length === 0) return <EmptyState text="This quiz has no questions." />;

  if (done) {
    const score = Math.round((correct / questions.length) * 100);
    return (
      <div>
        <PageHeader title={lesson.title} />
        <Card className="max-w-lg mx-auto text-center py-12">
          {score >= 70
            ? <Trophy className="mx-auto mb-3 text-warning" size={40} />
            : <BookOpen className="mx-auto mb-3 text-muted-foreground" size={40} />}
          <h2 className="text-xl font-semibold">Score: {score}%</h2>
          <p className="text-muted-foreground mt-2">{correct} of {questions.length} correct</p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={lesson.title} subtitle={`Question ${idx + 1} of ${questions.length} · ${correct} correct`} />
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full max-w-[480px] aspect-square shrink-0">
          <ChessBoard
            key={idx}
            fen={q.fen}
            orientation={sideToMove(q.fen)}
            movable={sideToMove(q.fen)}
            onMove={onMove}
          />
        </div>
        <Card className="flex-1 h-fit">
          <h3 className="font-semibold">{q.prompt}</h3>
          <p className="text-sm text-muted-foreground mt-2">
            {sideToMove(q.fen) === "white" ? "White" : "Black"} to move. Answer by playing the move on the board.
          </p>
        </Card>
      </div>
    </div>
  );
}

// ── Flashcards ───────────────────────────────────────────────────────────────
function Flashcards({ lesson }: { lesson: Lesson }) {
  const cards = useMemo(() => lesson.content.cards ?? [], [lesson]);
  const [queue, setQueue] = useState<number[]>(() => cards.map((_, i) => i));
  const [flipped, setFlipped] = useState(false);
  const [seen, setSeen] = useState(0);

  if (cards.length === 0) return <EmptyState text="This deck has no cards." />;

  if (queue.length === 0) {
    return (
      <div>
        <PageHeader title={lesson.title} />
        <Card className="max-w-lg mx-auto text-center py-12">
          <CheckCircle2 className="mx-auto mb-3 text-success" size={40} />
          <h2 className="text-xl font-semibold">All cards done!</h2>
          <p className="text-muted-foreground mt-2">{cards.length} cards · {seen} reviews</p>
          <Button className="mt-4" onClick={() => { setQueue(cards.map((_, i) => i)); setSeen(0); }}>
            Start over
          </Button>
        </Card>
      </div>
    );
  }

  const card = cards[queue[0]];

  function answer(gotIt: boolean) {
    setSeen((s) => s + 1);
    setFlipped(false);
    setQueue((prev) => (gotIt ? prev.slice(1) : [...prev.slice(1), prev[0]]));
  }

  return (
    <div>
      <PageHeader title={lesson.title} subtitle={`${queue.length} card${queue.length === 1 ? "" : "s"} remaining`} />
      <div className="max-w-[480px] mx-auto">
        <Card className="text-center">
          <div className="w-full aspect-square mb-4">
            <ChessBoard key={queue[0]} fen={card.front.fen} orientation={sideToMove(card.front.fen)} />
          </div>
          <p className="font-medium">{card.front.prompt}</p>
          {flipped && (
            <div className="mt-3 p-3 rounded-btn bg-surface-3 text-left">
              <p className="text-xs text-muted-foreground mb-1">Answer</p>
              <p className="font-mono text-sm">{card.back.answer}</p>
            </div>
          )}
          <div className="mt-4 flex justify-center gap-2">
            {!flipped ? (
              <Button onClick={() => setFlipped(true)}>Flip</Button>
            ) : (
              <>
                <Button onClick={() => answer(true)}>Got it</Button>
                <Button variant="secondary" onClick={() => answer(false)}>↩ Again</Button>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
