import { Chess } from "chess.js";
import { normalizeGameText, sanitizePgn } from "./pgn";

/* Loading a library row into chess.js, leniently. sanitizePgn repairs the
 * mechanical quirks; this handles what repair can't - files damaged mid-game.
 * The longest loadable prefix wins, so a corrupt annotation late in the file
 * costs a few tail moves, never the whole game. */

function tryLoad(pgn: string): Chess | null {
  const c = new Chess();
  try {
    c.loadPgn(pgn);
    const fen = c.getHeaders().FEN;
    if (fen) new Chess(fen); // a rules-illegal FEN header fails the load
    return c;
  } catch {
    return null;
  }
}

export function loadPgnLenient(content: string): { chess: Chess; exact: boolean } | null {
  const norm = normalizeGameText(content);
  const full = tryLoad(norm);
  if (full) return { chess: full, exact: true };

  const m = /^([\s\S]*?\n)\n([\s\S]*)$/.exec(norm);
  if (!m) return null;
  // Comments are atomic tokens, so a cut can never land inside one; running
  // each candidate back through sanitizePgn closes whatever the cut opened.
  const toks = m[2].match(/\{[^}]*\}|\(|\)|\S+/g) ?? [];
  const attempt = (n: number) => tryLoad(sanitizePgn(`${m[1]}\n${toks.slice(0, n).join(" ")}`));

  let lo = 0, hi = toks.length - 1, best: Chess | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = attempt(mid);
    if (c) { best = c; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best ? { chess: best, exact: false } : null;
}
