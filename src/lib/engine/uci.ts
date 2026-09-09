/* UCI `info` line parsing - the one bit of the engine layer worth unit-testing,
 * so it lives apart from the React hook. Stockfish speaks plain text over
 * postMessage; this turns one `info ... pv ...` line into a structured line. */

export type EngineLine = {
  multipv: number;
  depth: number;
  /** Centipawns, positive = good for the side to move. Mate is mapped to
   *  ±30000 so callers can sort without special-casing, `mate` keeps the real
   *  distance. */
  score: number;
  mate: number | null;
  move: string; // first token of the pv (coordinate notation, e.g. "e2e4")
  pv: string[];
};

const MATE_SCORE = 30000;

/** Parse one Stockfish stdout line. Returns null for anything that isn't a
 *  usable multipv info line (bestmove, id, option, shallow depth, …). */
export function parseInfoLine(line: string): EngineLine | null {
  if (!line.startsWith("info") || !line.includes(" pv ") || !line.includes("multipv")) {
    return null;
  }
  const depth = parseInt(line.match(/ depth (\d+)/)?.[1] ?? "0", 10);
  const multipv = parseInt(line.match(/ multipv (\d+)/)?.[1] ?? "1", 10);
  const cp = line.match(/ score cp (-?\d+)/);
  const mate = line.match(/ score mate (-?\d+)/);
  const pvMatch = line.match(/ pv (.+)$/);
  const pv = pvMatch ? pvMatch[1].trim().split(/\s+/) : [];
  const move = pv[0] ?? "";
  if (!move) return null;

  const mateN = mate ? parseInt(mate[1], 10) : null;
  const score = mateN != null ? (mateN > 0 ? MATE_SCORE : -MATE_SCORE) : cp ? parseInt(cp[1], 10) : 0;
  return { multipv, depth, score, mate: mateN, move, pv };
}

/** Short eval label for a bar / chip: "M3", "+1.24", "-0.30". `whiteRelative`
 *  when the caller already flipped to White's POV. */
export function formatScore(line: Pick<EngineLine, "score" | "mate"> | undefined): string {
  if (!line) return "…";
  if (line.mate != null && line.mate !== 0) return `M${Math.abs(line.mate)}`;
  const v = line.score / 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}
