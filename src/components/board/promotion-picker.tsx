"use client";

/* Promotion picker - shown when Auto-Queen is OFF (worldchess-board.md
 * §Interactions). Renders the four candidate pieces in the active set. */

import { pieceUrl } from "./piece-sets";

const CHOICES = [
  { p: "q", glyph: { w: "♕", b: "♛" }, label: "Queen" },
  { p: "r", glyph: { w: "♖", b: "♜" }, label: "Rook" },
  { p: "b", glyph: { w: "♗", b: "♝" }, label: "Bishop" },
  { p: "n", glyph: { w: "♘", b: "♞" }, label: "Knight" },
] as const;

export function PromotionPicker({
  color, pieceSet = "loco", onPick, onCancel,
}: {
  color: "w" | "b";
  pieceSet?: string;
  onPick: (piece: "q" | "r" | "b" | "n") => void;
  onCancel: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 bg-black/50 flex items-center justify-center" onClick={onCancel}>
      <div
        className="bg-surface-3 border border-border rounded-card p-3 flex gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {CHOICES.map((c) => (
          <button
            key={c.p}
            title={c.label}
            onClick={() => onPick(c.p)}
            className="w-16 h-16 rounded-btn hover:bg-surface-2 flex items-center justify-center"
          >
            {/* Real artwork from the coach's chosen set */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pieceUrl(pieceSet, c.p, color)} alt={c.label} className="w-14 h-14" />
          </button>
        ))}
      </div>
    </div>
  );
}
