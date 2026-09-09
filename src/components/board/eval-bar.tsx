"use client";

/* Evaluation bar - the vertical strip beside the board. White fills from the
 * bottom, Black from the top, and the number sits on whichever side is winning.
 *
 * It is a sibling of the board, never a child: the board's own layout maths
 * (container queries, whole-pixel sizing) must not have to account for it, or
 * the square grid desyncs from the click map.
 */

import { evalBarFraction, toWhiteRelative } from "@/lib/analysis/classify";

export function EvalBar({
  score, mate, sideToMove, orientation = "white",
}: {
  /** Engine score in centipawns, positive = good for the side to move. */
  score: number;
  mate: number | null;
  sideToMove: "w" | "b";
  orientation?: "white" | "black";
}) {
  const whiteCp = toWhiteRelative(score, sideToMove);
  const whiteFrac = evalBarFraction(whiteCp, mate, sideToMove);

  // Flip the bar with the board, so "my side" is always the near end.
  const whitePct = (orientation === "white" ? whiteFrac : 1 - whiteFrac) * 100;

  const label = mate != null && mate !== 0
    ? `M${Math.abs(mate)}`
    : Math.abs(whiteCp / 100).toFixed(1);

  // The label goes at the winning end so it never sits on top of the fill seam.
  const whiteWinning = whiteCp >= 0;
  const labelAtBottom = orientation === "white" ? whiteWinning : !whiteWinning;

  return (
    <div
      className="relative w-6 shrink-0 rounded-btn overflow-hidden bg-neutral-900 border border-border select-none"
      title={`Evaluation: ${whiteCp >= 0 ? "+" : "-"}${Math.abs(whiteCp / 100).toFixed(2)} (White)`}
      aria-label={`Evaluation ${whiteCp / 100} for White`}
    >
      <div
        className="absolute inset-x-0 bottom-0 bg-neutral-100 transition-[height] duration-300 ease-out"
        style={{ height: `${whitePct}%` }}
      />
      <span
        className={`absolute inset-x-0 text-[10px] font-bold tabular-nums text-center ${
          labelAtBottom ? "bottom-1 text-neutral-900" : "top-1 text-neutral-100"
        }`}
      >
        {label}
      </span>
    </div>
  );
}
