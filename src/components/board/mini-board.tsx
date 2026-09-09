import { memo } from "react";
import { pieceUrl, type PieceKind } from "./piece-sets";

/** Static miniature board rendered from a FEN - a plain DOM grid of the
 *  in-repo piece SVGs. Zero chessground instances, zero listeners: the
 *  live-ops wall renders dozens of these and updates them by prop change
 *  from ONE realtime subscription (ARCHITECTURE_V2.md §3). */

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

function MiniBoardImpl({
  fen, className = "", pieceSet = "cburnett", dark, light,
}: {
  fen?: string | null; className?: string; pieceSet?: string;
  /** Square colours - pass the user's theme so previews match the live board. */
  dark?: string; light?: string;
}) {
  /* Only trust a board string that actually looks like a FEN placement field.
   *
   * Every character used to be treated as a piece, so anything else in
   * live_fen - a truncated write, a value from an older schema, a stray
   * string - rendered as a grid of broken <img> icons on the Live Ops wall,
   * which is the most visible surface in the product. A board we can't parse
   * degrades to the starting position instead. */
  const raw = (fen ?? START).split(" ")[0];
  const board = /^[prnbqkPRNBQK1-8/]+$/.test(raw) ? raw : START;
  const cells: { dark: boolean; piece?: { kind: string; color: "w" | "b" } }[] = [];
  let i = 0;
  for (const ch of board) {
    if (ch === "/") continue;
    if (/\d/.test(ch)) {
      for (let n = 0; n < Number(ch); n++, i++)
        cells.push({ dark: (Math.floor(i / 8) + i) % 2 === 1 });
    } else {
      cells.push({
        dark: (Math.floor(i / 8) + i) % 2 === 1,
        piece: { kind: ch.toLowerCase(), color: ch === ch.toUpperCase() ? "w" : "b" },
      });
      i++;
    }
  }
  return (
    /* grid-rows-8 + stretchy cells (no per-cell aspect-ratio): every track is
       an exact fraction of the container, so no sub-pixel sliver can show
       between the last row/column and the border. */
    <div aria-hidden className={`grid grid-cols-8 grid-rows-8 aspect-square rounded-btn overflow-hidden border border-border ${className}`}>
      {cells.slice(0, 64).map((c, idx) => (
        <div key={idx} className="relative"
          style={{ background: c.dark ? (dark ?? "var(--board-dark)") : (light ?? "var(--board-light)") }}>
          {c.piece && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pieceUrl(pieceSet, c.piece.kind as PieceKind, c.piece.color)} alt=""
              className="absolute inset-0 w-full h-full p-[3%]" />
          )}
        </div>
      ))}
    </div>
  );
}

/* Memoised because the Live Ops wall holds up to ninety of these and re-renders
 * the whole page every time any one coach's live_fen lands - which is once per
 * 1.5s per active class. Each board is 64 cells and up to 32 <img>, so without
 * this a single move on one board re-built every other board on screen. All
 * props are primitives, so the default shallow compare is exactly right. */
export const MiniBoard = memo(MiniBoardImpl);
