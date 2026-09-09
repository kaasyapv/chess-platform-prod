/* Move-quality taxonomy for the analysis board - the six tiers the reference
 * surfaces (Clone_reference/Chessiga_ref/recreation-code/analysis-engine.md §3,
 * renamed to the plain-English labels the product actually shows).
 *
 * Everything here is pure: centipawn numbers in, a tier out. The engine driver
 * (analyze-game.ts) owns the worker; this file owns the judgement, so the
 * thresholds can be tuned and tested without booting Stockfish.
 */

export type MoveTier = "brilliant" | "best" | "good" | "book" | "mistake" | "blunder";

export const TIER_META: Record<MoveTier, { label: string; color: string; glyph: string }> = {
  brilliant: { label: "Brilliant", color: "#26c2a3", glyph: "!!" },
  best:      { label: "Best",      color: "#81b64c", glyph: "!" },
  good:      { label: "Good",      color: "#95b776", glyph: "G" },
  book:      { label: "Book",      color: "#a88865", glyph: "B" },
  mistake:   { label: "Mistake",   color: "#e6912c", glyph: "?" },
  blunder:   { label: "Blunder",   color: "#ca3431", glyph: "??" },
};

/** Plies still considered opening theory. Kept small: past this the engine, not
 *  a book, is the authority. */
export const BOOK_PLIES = 10;

export type MoveJudgement = {
  /** Centipawns lost versus the engine's best move, from the mover's side. */
  centipawnLoss: number;
  /** Was the move the engine's own top choice? */
  wasTop: boolean;
  /** Ply index (0-based) - drives the Book tier. */
  ply: number;
  /** Material the mover gave up on this move, in pawns. Drives Brilliant. */
  materialSacrificed?: number;
  /** Eval AFTER the move, from the mover's side, in centipawns. */
  evalAfter?: number;
};

/**
 * A sacrifice only earns "Brilliant" when the engine agrees it was correct:
 * real material given up, still the engine's top move, and the position does
 * not collapse. Anything less is just a good move that happened to hang a piece.
 */
function isBrilliant(j: MoveJudgement): boolean {
  return (j.materialSacrificed ?? 0) >= 1
    && j.wasTop
    && (j.evalAfter ?? 0) >= -20;
}

export function classifyMove(j: MoveJudgement): MoveTier {
  if (isBrilliant(j)) return "brilliant";
  if (j.ply < BOOK_PLIES && j.centipawnLoss <= 30) return "book";
  if (j.wasTop || j.centipawnLoss <= 10) return "best";
  if (j.centipawnLoss <= 50) return "good";
  if (j.centipawnLoss <= 150) return "mistake";
  return "blunder";
}

/**
 * Game accuracy as a 0-100 figure. An exponential decay on average centipawn
 * loss: a flawless game lands near 100, a game of repeated 200cp blunders lands
 * in the low teens. K is the tuning knob - raise it to be more forgiving.
 *
 * ponytail: this is the common exp-decay approximation, not any vendor's exact
 * (undisclosed) formula. Swap the curve here if you ever calibrate against one.
 */
export function gameAccuracy(losses: number[], K = 90): number {
  if (losses.length === 0) return 100;
  const mean = losses.reduce((sum, l) => sum + Math.exp(-Math.max(0, l) / K), 0) / losses.length;
  return Math.round(mean * 1000) / 10;
}

/** Convert an engine score (positive = good for the side to move) to a
 *  White-relative score, which is what an evaluation bar draws. */
export function toWhiteRelative(score: number, sideToMove: "w" | "b"): number {
  return sideToMove === "w" ? score : -score;
}

/**
 * Fraction of the eval bar that should be White, 0..1. Uses a logistic curve so
 * that the bar moves a lot near equality and saturates gently at big advantages
 * - a linear bar would peg to the edge at +3 and stop telling you anything.
 */
export function evalBarFraction(whiteCp: number, mate: number | null, sideToMove: "w" | "b"): number {
  if (mate != null && mate !== 0) {
    const whiteMating = sideToMove === "w" ? mate > 0 : mate < 0;
    return whiteMating ? 1 : 0;
  }
  return 1 / (1 + Math.exp(-whiteCp / 350));
}
