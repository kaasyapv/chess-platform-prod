/* Pure PGN helpers - no chess.js, no DOM, so they run in tests and on the
 * server. The classroom, the PGN Library grid and the Master Database panel
 * all read games the same way through these. */

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** A PGN tag pair value, e.g. pgnTag(text, "White"). "?" means "unset" in the
 *  PGN spec, and these files use it heavily - treat it as absent. */
export function pgnTag(pgn: string, name: string): string | undefined {
  const v = new RegExp(`^\\[${name}\\s+"([^"]*)"`, "m").exec(pgn)?.[1];
  return v && v !== "?" && v !== "????.??.??" ? v : undefined;
}

/** The position a game STARTS from: its [FEN] header when it sets one up,
 *  otherwise the standard opening position. Never replays moves - the library
 *  grid and board previews show the starting diagram, not a later position. */
export function pgnInitialFen(pgn: string): string {
  const fen = pgnTag(pgn, "FEN");
  // A FEN needs at least a piece placement and a side to move.
  return fen && /^[1-8pnbrqkPNBRQK/]+\s+[wb]\b/.test(fen) ? fen : START_FEN;
}

/** Split a multi-game PGN at each game's [Event tag. The `\b` stops
 *  [EventDate "…"] - very common in these files - from starting a new game. */
export function splitPgnGames(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split(/(?=^\[Event\b)/m)
    .map((g) => g.trim())
    .filter((g) => g.length > 8);
}

/** How a game is named in the library. The reference PGNs already carry the
 *  platform's exact title in [Event]; fall back to a numbered name. */
export function pgnGameTitle(pgn: string, group: string, index: number): string {
  const event = pgnTag(pgn, "Event");
  const white = pgnTag(pgn, "White");
  const black = pgnTag(pgn, "Black");
  const name = event ?? (white && black ? `${white} vs ${black}` : `${group} - ${index + 1}`);
  return name.slice(0, 140);
}

/** True when the text is a bare FEN string (piece placement + side to move),
 *  not a PGN. Coaches paste these into the library as "positions"; loading one
 *  through a PGN parser is what used to throw "Invalid PGN". */
export function looksLikeFen(text: string): boolean {
  const t = text.trim();
  return !t.includes("\n") && !t.startsWith("[") &&
    /^[1-8pnbrqkPNBRQK/]{15,}\s+[wb](\s|$)/.test(t);
}

/** A bare FEN wrapped as a single-game PGN, so one parser handles both. */
export function fenToPgn(fen: string): string {
  return `[SetUp "1"]\n[FEN "${fen.trim()}"]\n\n*`;
}

/** The first game of a possibly multi-game PGN. chess.js rejects multi-game
 *  text outright, so library rows that kept several games load their first. */
export function firstPgnGame(text: string): string {
  return splitPgnGames(text)[0] ?? text.trim();
}

/** Mechanical repairs for the quirks real course files ship with - found by
 *  running every game in the reference library through chess.js:
 *   - adjacent brace comments `{ a } { [%csl ...] }` (Lichess studies),
 *   - null moves `--` / `Z0` (ChessBase "and White is better" stubs),
 *   - `[FEN]` headers with fullmove number 0,
 *   - `%` escape lines.
 *  chess.js rejects each of these outright; every one is safe to repair. */
export function sanitizePgn(text: string): string {
  let t = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
  t = t.replace(/^%.*$/gm, "");
  // Split headers from movetext so movetext fixes can't touch header strings.
  const m = /^(\[[\s\S]*?\n)\n([\s\S]*)$/.exec(t);
  let headers = m ? m[1] : (t.startsWith("[") ? t : "");
  let moves = m ? m[2] : (t.startsWith("[") ? "" : t);
  // Header values with unescaped inner quotes - [Event "#155 "Immortal Game""]
  // - kill the whole game. Swap the inner quotes for apostrophes.
  headers = headers.split("\n").map((line) => {
    const h = /^\[(\w+)\s+"(.*)"\]\s*$/.exec(line);
    return h && h[2].includes('"') ? `[${h[1]} "${h[2].replace(/"/g, "’")}"]` : line;
  }).join("\n");
  headers = headers.replace(/\[FEN\s+"([^"]+)"\]/, (whole, fen: string) => {
    const parts = fen.trim().split(/\s+/);
    if (parts.length >= 6 && !/^[1-9]\d*$/.test(parts[5])) { parts[5] = "1"; return `[FEN "${parts.join(" ")}"]`; }
    return whole;
  });
  moves = moves.replace(/\}\s*\{/g, " ");
  // A variation that OPENS with a comment - "( {Loses…} 7.Rxc2 )" - is the
  // single biggest parser killer in ChessBase course exports. chess.js only
  // accepts comments after a move, so hoist the brace out of the way.
  moves = moves.replace(/\(\s*\{[^}]*\}\s*/g, "( ");
  // …and the mirror image: a comment straight after a closing paren, ") {with}".
  moves = moves.replace(/\)\s*\{[^}]*\}/g, ")");
  // Null moves ("--"/"Z0") cannot be represented - keep the game up to there.
  const nul = moves.search(/(^|[\s.])(--|Z0)(\s|$)/);
  const truncated = nul !== -1;
  if (truncated) moves = moves.slice(0, nul).trim();
  // Files truncated (by us or at the source) mid-comment or mid-variation
  // leave "{" and "(" hanging open - close them, in that order, and only then
  // terminate the game. (Counts ignore brackets inside comments: good enough
  // for repair, and a wrong close still beats a refused game.)
  const unclosed = (moves.match(/\{/g) ?? []).length - (moves.match(/\}/g) ?? []).length;
  if (unclosed > 0) moves += " }".repeat(unclosed);
  const bare = moves.replace(/\{[^}]*\}/g, " ");
  const unclosedVar = (bare.match(/\(/g) ?? []).length - (bare.match(/\)/g) ?? []).length;
  if (unclosedVar > 0) moves += " )".repeat(unclosedVar);
  if (truncated) moves += " *";
  // NAGs glued to evaluation signs - "$18+" - are not NAGs to the parser.
  moves = moves.replace(/(\$\d+)[+\-=∓±⩱⩲]+/g, "$1");
  // A move number with no move after it ("1. *") also kills the parser.
  moves = moves.replace(/(\s|^)\d+\.(\.\.)?\s*(?=(\*|1-0|0-1|1\/2-1\/2)?\s*$)/, " ");
  return headers ? `${headers}\n${moves}`.trim() : moves.trim();
}

/** Whatever a library row holds - a PGN, several PGNs, or a bare FEN - turned
 *  into ONE parseable single-game PGN. */
export function normalizeGameText(content: string): string {
  const t = content.replace(/\r\n/g, "\n").trim();
  return looksLikeFen(t) ? fenToPgn(t) : sanitizePgn(firstPgnGame(t));
}

export type GameHeaders = {
  date?: string; white?: string; black?: string;
  eloW?: string; eloB?: string; result?: string; eco?: string;
};

/** The columns the Master Database table shows. */
export function pgnHeaders(pgn: string): GameHeaders {
  const result = pgnTag(pgn, "Result");
  return {
    date: pgnTag(pgn, "Date")?.replace(/\?\?/g, "").replace(/\.+$/, ""),
    white: pgnTag(pgn, "White"),
    black: pgnTag(pgn, "Black"),
    eloW: pgnTag(pgn, "WhiteElo"),
    eloB: pgnTag(pgn, "BlackElo"),
    result: result === "*" ? undefined : result,
    eco: pgnTag(pgn, "ECO"),
  };
}
