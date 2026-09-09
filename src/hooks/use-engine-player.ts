"use client";

/* Stockfish opponent for Play vs Computer - 12 levels mapped to ELO
 * (playmate-board.md §Play Area: "Level slider 1-12 mapped to ELO",
 * level 1 = 500 ELO). WASM worker client-side (MASTER-REPORT §12.3). */

import { useEffect, useRef, useCallback } from "react";
import { levelToElo } from "@/lib/chess-pure";

export { levelToElo };

type BestMove = { from: string; to: string; promotion?: string };

export function useEnginePlayer(level: number, enabled: boolean) {
  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const resolveRef = useRef<((m: BestMove | null) => void) | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const worker = new Worker("/engine/stockfish.js");
    workerRef.current = worker;

    const elo = levelToElo(level);
    worker.onmessage = (ev: MessageEvent<string>) => {
      const line = ev.data;
      if (line === "uciok") {
        if (elo >= 1320) {
          // Stockfish UCI_Elo floor is 1320
          worker.postMessage("setoption name UCI_LimitStrength value true");
          worker.postMessage(`setoption name UCI_Elo value ${Math.min(elo, 2850)}`);
        } else {
          // Low levels: Skill Level 0-20 approximation
          const skill = Math.max(0, Math.round((elo - 500) / 120));
          worker.postMessage(`setoption name Skill Level value ${skill}`);
        }
        worker.postMessage("setoption name Threads value 1");
        worker.postMessage("isready");
      } else if (line === "readyok") {
        readyRef.current = true;
      } else if (line.startsWith("bestmove")) {
        const token = line.split(/\s+/)[1];
        const resolve = resolveRef.current;
        resolveRef.current = null;
        if (!resolve) return;
        if (!token || token === "(none)") { resolve(null); return; }
        resolve({
          from: token.slice(0, 2),
          to: token.slice(2, 4),
          promotion: token.length > 4 ? token[4] : undefined,
        });
      }
    };
    worker.postMessage("uci");

    return () => {
      worker.postMessage("quit");
      worker.terminate();
      workerRef.current = null;
      readyRef.current = false;
      resolveRef.current = null;
    };
  }, [level, enabled]);

  /** Ask the engine for its move in the given position. Waits for the WASM
   *  boot to finish first, so the opening move (playing as Black) can never
   *  race a worker that is still loading. */
  const getMove = useCallback(async (fen: string): Promise<BestMove | null> => {
    const t0 = Date.now();
    while (!readyRef.current) {
      if (!workerRef.current || Date.now() - t0 > 10_000) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
    const worker = workerRef.current;
    if (!worker) return null;
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      const movetime = 300 + level * 120; // snappier at low levels
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go movetime ${movetime}`);
    });
  }, [level]);

  return { getMove };
}
