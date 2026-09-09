/* One definition of "does this move solve the position", shared by the
 * classroom quiz scorer and the curriculum puzzle/capture activity player
 * (enterprise_system_architecture.md §6.3 - the rule must live in one pure
 * module so the client and any future server validator agree). Pure: no
 * React/DOM, so `node --test` loads it directly. */

import { Chess } from "chess.js";

/** Forgiving match: "Qxf7#", "Qf7" and "f5f7" all count when they are the same
 *  move. Compares the RESULTING position, falling back to a normalized string
 *  check. `answer` may be a single move or a space-separated line (only the
 *  first move is checked). Empty `answer` → null (manual review). */
export function answerMatches(fen: string, playedSan: string, answer: string): boolean | null {
  const sol = answer.trim().split(/\s+/)[0];
  if (!sol) return null;
  const norm = (s: string) => s.replace(/[+#x=!?]/g, "").toLowerCase();
  if (norm(playedSan) === norm(sol)) return true;
  try {
    const a = new Chess(fen); a.move(sol);
    const b = new Chess(fen); b.move(playedSan);
    return a.fen() === b.fen();
  } catch {
    return false;
  }
}

/** Adjudicate a simul board from its FEN. `"1-0"` / `"0-1"` / `"1/2-1/2"` or
 *  null while the game is still going. Used by the classroom simul grid so a
 *  finished board shows its result instead of a live turn indicator. */
export function simulResult(fen: string): "1-0" | "0-1" | "1/2-1/2" | null {
  let c: Chess;
  try { c = new Chess(fen); } catch { return null; }
  // c.turn() is the side to move; on checkmate that side lost.
  if (c.isCheckmate()) return c.turn() === "w" ? "0-1" : "1-0";
  if (c.isStalemate() || c.isInsufficientMaterial() || c.isThreefoldRepetition() || c.isDraw()) return "1/2-1/2";
  return null;
}
