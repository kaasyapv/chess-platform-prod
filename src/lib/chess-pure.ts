/* Pure chess-platform logic - no React/DOM imports so node can run the
 * self-check in tests/ directly (node --test with type stripping). */

/** WorldChess clock format: M:SS, switching to tenths under 10s
 *  (worldchess-board.md §Clock). */
export function formatClock(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  if (totalSec < 10) {
    const tenths = Math.floor((ms % 1000) / 100);
    return `${m}:${String(s).padStart(2, "0")}.${tenths}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Play Area level slider 1-12 → ELO; level 1 = 500 (playmate-board.md). */
export function levelToElo(level: number): number {
  return 300 + 200 * level;
}

/** True when the FEN's board field is shaped like a board - 8 ranks that each
 *  sum to 8 files of valid piece letters. chess.js additionally demands a
 *  LEGAL position (both kings present, etc.), which gamified/teaching setups
 *  deliberately aren't; anything passing this check can still be RENDERED
 *  and played in free-move mode. */
export function isRenderableFen(fen: string): boolean {
  const board = fen.trim().split(/\s+/)[0];
  if (!board) return false;
  const ranks = board.split("/");
  if (ranks.length !== 8) return false;
  return ranks.every((rank) => {
    let files = 0;
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) files += Number(ch);
      else if (/[pnbrqk]/i.test(ch)) files++;
      else return false;
    }
    return files === 8;
  });
}

export type SoundType =
  | "move" | "capture" | "check" | "castle" | "promote"
  | "illegal" | "game-end" | "low-time";

/** Pick the audio cue for a chess.js verbose move result. */
export function soundForMove(
  move: { san: string; captured?: string; promotion?: string },
  inCheck: boolean,
): SoundType {
  if (inCheck) return "check";
  if (move.promotion) return "promote";
  if (move.san === "O-O" || move.san === "O-O-O") return "castle";
  if (move.captured) return "capture";
  return "move";
}
