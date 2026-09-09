/* Topic-based puzzles from the Lichess public puzzle API (client req #6) -
 * no key needed, unlike the bundled local puzzle set (src/data/topic-
 * puzzles.json) which only covers a fixed, pre-baked set of positions. */

export const LICHESS_PUZZLE_THEMES = [
  { id: "fork", label: "Fork" },
  { id: "pin", label: "Pin" },
  { id: "skewer", label: "Skewer" },
  { id: "discoveredAttack", label: "Discovered Attack" },
  { id: "sacrifice", label: "Sacrifice" },
  { id: "mateIn1", label: "Mate in 1" },
  { id: "mateIn2", label: "Mate in 2" },
  { id: "endgame", label: "Endgame" },
  { id: "opening", label: "Opening" },
  { id: "middlegame", label: "Middlegame" },
] as const;

export type LichessPuzzle = {
  id: string;
  fen: string;          // position right before the first solution move
  solutionUci: string[]; // e.g. ["e2e4", "e7e5"]
  solutionSan: string[]; // same moves, human-readable
  themes: string[];
  rating: number;
};

/** Replays the game's moves up to the puzzle's starting ply using the same
 *  chess.js already used everywhere else, so we don't add a second FEN/PGN
 *  parser to the codebase for one endpoint. */
export async function fetchLichessPuzzle(theme?: string): Promise<LichessPuzzle | null> {
  const url = new URL("https://lichess.org/api/puzzle/next");
  if (theme) url.searchParams.set("angle", theme);
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();

  const { Chess } = await import("chess.js");
  const chess = new Chess();
  chess.loadPgn(data.game.pgn);
  const history = chess.history({ verbose: true }) as { from: string; to: string }[];

  // initialPly is 0-indexed from the game start; the puzzle position is the
  // board right after that many plies have been played.
  const repl = new Chess();
  for (let i = 0; i < data.puzzle.initialPly; i++) {
    const m = history[i];
    if (!m) break;
    repl.move({ from: m.from, to: m.to, promotion: "q" });
  }

  const solutionUci = data.puzzle.solution as string[];
  const solutionSan: string[] = [];
  const sanChess = new Chess(repl.fen());
  for (const uci of solutionUci) {
    const move = sanChess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? "q" });
    solutionSan.push(move?.san ?? uci);
  }

  return {
    id: data.puzzle.id,
    fen: repl.fen(),
    solutionUci,
    solutionSan,
    themes: data.puzzle.themes as string[],
    rating: data.puzzle.rating as number,
  };
}
