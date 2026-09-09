"use client";

/* Simul grid - the coach's "one vs many" view. Fills the centre board zone
 * with a CSS-grid of miniature boards, one per student, each fed from the
 * `simul_game` sub-channel (see use-simul-boards.ts). No chessground instances:
 * MiniBoard is a static FEN grid, so thirty of them cost about what one live
 * board does (same trick the Live Ops wall uses).
 *
 * Click a board to focus that student - the classroom then swaps its shared
 * board to that game so the coach can make a move in it.
 */

import { motion } from "framer-motion";
import { MiniBoard } from "@/components/board/mini-board";
import { formatClock } from "@/lib/chess-pure";
import type { SimulBoard } from "@/hooks/use-simul-boards";

export function SimulGrid({
  boards, focusedId, onFocus, pieceSet,
}: {
  boards: (SimulBoard & { away: boolean })[];
  focusedId: string | null;
  onFocus: (studentId: string | null) => void;
  pieceSet?: string;
}) {
  if (boards.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium">No student games yet</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Boards appear here as students join the simul and start playing. Each
          one updates live over its own sub-channel.
        </p>
      </div>
    );
  }

  // Square-ish grid: ceil(sqrt(n)) columns, capped so tiles stay legible.
  const cols = Math.min(6, Math.max(2, Math.ceil(Math.sqrt(boards.length))));

  return (
    <div
      className="grid h-full w-full content-start gap-3 overflow-y-auto p-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {boards.map((b) => {
        const focused = b.studentId === focusedId;
        return (
          <motion.button
            key={b.studentId}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: b.away ? 0.55 : 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            onClick={() => onFocus(focused ? null : b.studentId)}
            title={`Focus ${b.name}'s game`}
            className={`group flex flex-col gap-1.5 rounded-card border bg-surface-1 p-2 text-left shadow-sm transition-colors ${
              focused
                ? "border-primary ring-2 ring-primary/40"
                : "border-border hover:border-primary/50"
            }`}
          >
            <div className="relative">
              <MiniBoard fen={b.fen} pieceSet={pieceSet} />
              {b.result && (
                <span className="absolute inset-0 grid place-items-center rounded-btn bg-scrim/70 text-sm font-bold text-white">
                  {b.result}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 px-0.5">
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${b.away ? "bg-warning" : "bg-live"}`}
              />
              <span className="truncate text-xs font-medium">{b.name}</span>
              {typeof b.clockMs === "number" ? (
                <span className={`ml-auto shrink-0 tabular-nums text-[10px] font-semibold ${b.clockMs <= 30_000 ? "text-destructive" : "text-muted-foreground"}`}>
                  {formatClock(b.clockMs)}
                </span>
              ) : b.lastMove && (
                <span className="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground">
                  {b.lastMove.from}
                  {b.lastMove.to}
                </span>
              )}
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
