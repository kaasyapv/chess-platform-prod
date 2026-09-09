/* Real chess piece artwork, served from the Lichess asset server.
 *
 *   https://lichess1.org/assets/piece/<set>/<colour><PIECE>.svg
 *   e.g. .../piece/merida/wN.svg  -> a white merida knight
 *
 * Every set id below is a folder that exists on that server, so the pieces are
 * the genuine designs, not drawings we made up.
 *
 * Note: these files are loaded straight from Lichess at run time. The board
 * needs a working internet connection to draw its pieces, and it puts our
 * traffic on someone else's server. To take both problems away, copy the SVGs
 * into public/piece/<set>/ and point CDN_BASE at "/piece".
 */

export type PieceKind = "p" | "n" | "b" | "r" | "q" | "k";
export type PieceColor = "w" | "b";

const CDN_BASE = "https://lichess1.org/assets/piece";

/** Lichess names a file by colour then piece letter: wN.svg, bQ.svg … */
export function pieceUrl(set: string, kind: PieceKind, color: PieceColor): string {
  return `${CDN_BASE}/${resolvePieceSet(set)}/${color}${kind.toUpperCase()}.svg`;
}

/** CSS url(...) form - use in a background-image. */
export function pieceCssUrl(set: string, kind: PieceKind, color: PieceColor): string {
  return `url('${pieceUrl(set, kind, color)}')`;
}

/** The class names chessground puts on a <piece> element. */
const KIND_CLASS: Record<PieceKind, string> = {
  p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king",
};

/** Point every chessground piece at the chosen set. Scoped to one board. */
export function pieceSetCss(scope: string, set: string): string {
  const rules: string[] = [];
  (Object.keys(KIND_CLASS) as PieceKind[]).forEach((kind) => {
    (["w", "b"] as const).forEach((color) => {
      const cls = `${KIND_CLASS[kind]}.${color === "w" ? "white" : "black"}`;
      rules.push(`${scope} piece.${cls} { background-image: ${pieceCssUrl(set, kind, color)} !important; }`);
    });
  });
  return rules.join("\n");
}

/** Ids of the sets we offer. Each one is a real folder on the Lichess server. */
export const PIECE_SET_IDS = [
  "cburnett", "merida", "alpha", "staunty", "california", "leipzig",
  "maestro", "fantasy", "cardinal", "gioco", "governor", "horsey",
] as const;

/** Old saved settings may name a set we no longer offer. Fall back to cburnett
 *  rather than asking the server for a folder that is not there. */
export function resolvePieceSet(set: string | undefined): string {
  return set && (PIECE_SET_IDS as readonly string[]).includes(set) ? set : "cburnett";
}
