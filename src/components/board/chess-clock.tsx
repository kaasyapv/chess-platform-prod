"use client";

/* Dual chess clocks - WorldChess style (worldchess-board.md §Clock):
 * opponent top / self bottom, large bold near-mono numerals, M:SS switching
 * to tenths under 10s, active clock bright / inactive dim, low-time turns
 * orange #FF6136, increment added on move. Client clock is presentational;
 * the game controller owns time state (server-authoritative when networked -
 * MASTER-REPORT §12.4). */

import { useEffect, useRef, useState, useCallback } from "react";
import { formatClock } from "@/lib/chess-pure";

export { formatClock };

export type TimeControl = { initial: number; increment: number } | null; // seconds

export const TIME_CONTROLS: { label: string; tc: TimeControl }[] = [
  { label: "No Clock", tc: null },
  { label: "1+0 Bullet", tc: { initial: 60, increment: 0 } },
  { label: "3+2 Blitz", tc: { initial: 180, increment: 2 } },
  { label: "5+0 Blitz", tc: { initial: 300, increment: 0 } },
  { label: "10+0 Rapid", tc: { initial: 600, increment: 0 } },
  { label: "10+10 Rapid", tc: { initial: 600, increment: 10 } },
  { label: "15+10 Rapid", tc: { initial: 900, increment: 10 } },
  { label: "30+0 Classical", tc: { initial: 1800, increment: 0 } },
];

const LOW_TIME_MS = 10_000;

/** Countdown state machine for both sides. `running` side ticks; switchTo()
 *  applies increment to the side that just moved. */
export function useChessClock(tc: TimeControl, onFlag?: (side: "white" | "black") => void) {
  const [white, setWhite] = useState((tc?.initial ?? 0) * 1000);
  const [black, setBlack] = useState((tc?.initial ?? 0) * 1000);
  const [running, setRunning] = useState<"white" | "black" | null>(null);
  const lastTick = useRef(0);
  const onFlagRef = useRef(onFlag);
  onFlagRef.current = onFlag;
  const flagged = useRef(false);
  /* tc through a ref, so switchTo is STABLE. Callers keep it inside move
   * handlers memoised on other deps; a tc-dependent identity meant those
   * handlers held yesterday's closure - with tc=null on the first game, the
   * clock never switched sides and the starting side bled time on the
   * computer's whole turn. */
  const tcRef = useRef(tc);
  tcRef.current = tc;

  const reset = useCallback((newTc: TimeControl) => {
    setWhite((newTc?.initial ?? 0) * 1000);
    setBlack((newTc?.initial ?? 0) * 1000);
    setRunning(null);
    flagged.current = false;
  }, []);

  /** The mover's clock stops (+increment), the other side starts. */
  const switchTo = useCallback((side: "white" | "black") => {
    const t = tcRef.current;
    if (!t) return;
    const inc = t.increment * 1000;
    if (side === "black") setWhite((w) => w + inc);   // white just moved
    else setBlack((b) => b + inc);                     // black just moved
    setRunning(side);
    lastTick.current = performance.now();
  }, []);

  const start = useCallback((side: "white" | "black") => {
    setRunning(side);
    lastTick.current = performance.now();
  }, []);
  const stop = useCallback(() => setRunning(null), []);

  useEffect(() => {
    if (!running || !tc) return;
    lastTick.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - lastTick.current;
      lastTick.current = now;
      const setter = running === "white" ? setWhite : setBlack;
      setter((v) => {
        const next = v - dt;
        if (next <= 0 && !flagged.current) {
          flagged.current = true;
          setTimeout(() => onFlagRef.current?.(running), 0);
          return 0;
        }
        return Math.max(next, 0);
      });
    }, 100);
    return () => clearInterval(id);
  }, [running, tc]);

  return { white, black, running, switchTo, start, stop, reset };
}

export function ClockFace({
  ms, active, side,
}: { ms: number; active: boolean; side: "white" | "black" }) {
  const low = ms <= LOW_TIME_MS && ms > 0;
  return (
    <div
      className={`flex items-center gap-2 rounded-card px-4 py-2 border transition-colors ${
        active ? "bg-surface-3 border-border" : "bg-transparent border-transparent"
      }`}
    >
      <span className="text-lg" aria-hidden>{side === "white" ? "♙" : "♟"}</span>
      <span
        className="text-3xl font-bold tabular-nums tracking-tight transition-colors"
        style={{
          fontVariantNumeric: "tabular-nums",
          color: low && active ? "var(--clock-lowtime)" : active ? "var(--foreground)" : "var(--muted-foreground)",
        }}
      >
        {formatClock(ms)}
      </span>
    </div>
  );
}

/** Dual clock block: opponent on top, self at bottom (WorldChess layout). */
export function DualClocks({
  white, black, running, orientation = "white",
}: { white: number; black: number; running: "white" | "black" | null; orientation?: "white" | "black" }) {
  const top: "white" | "black" = orientation === "white" ? "black" : "white";
  const bottom: "white" | "black" = orientation === "white" ? "white" : "black";
  const value = (s: "white" | "black") => (s === "white" ? white : black);
  return (
    <div className="flex flex-col justify-between h-full py-1">
      <ClockFace ms={value(top)} active={running === top} side={top} />
      <ClockFace ms={value(bottom)} active={running === bottom} side={bottom} />
    </div>
  );
}
