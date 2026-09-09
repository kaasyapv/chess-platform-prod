"use client";

/* Client-side engine evaluation.
 *
 * The engine is the prebuilt single-threaded Stockfish 17.1 WASM at
 * `/engine/stockfish.js` (see src/lib/engine/README.md). Single-threaded is a
 * deliberate choice: the multi-threaded build needs SharedArrayBuffer, which
 * needs `Cross-Origin-Opener-Policy: same-origin` +
 * `Cross-Origin-Embedder-Policy: require-corp` on every document - and those
 * headers break the mesh-video iframe embeds and third-party avatars. One
 * thread is plenty for a teaching eval bar and costs zero server.
 *
 * `stockfish.js` IS the worker entry (emscripten emits a script that runs as a
 * dedicated worker and speaks UCI over postMessage), so there is no separate
 * `.worker.ts` to bundle - `new Worker(path)` on the public asset is all it
 * takes, and Turbopack leaves the string path alone.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { parseInfoLine, type EngineLine } from "@/lib/engine/uci";

export type { EngineLine };
export type EngineState = "idle" | "thinking" | "ready";

export type UseEngine = {
  lines: EngineLine[];
  state: EngineState;
  depth: number;
  /** Best line's score in centipawns, side-to-move relative (undefined until
   *  the first info line). Convenience for an eval bar. */
  best: EngineLine | undefined;
};

export function useEngine(
  fen: string,
  enabled: boolean,
  opts?: { depth?: number; multipv?: number },
): UseEngine {
  const targetDepth = opts?.depth ?? 16;
  const multipv = opts?.multipv ?? 3;

  const workerRef = useRef<Worker | null>(null);
  const fenRef = useRef(fen);
  fenRef.current = fen;

  const [lines, setLines] = useState<EngineLine[]>([]);
  const [state, setState] = useState<EngineState>("idle");
  const [depth, setDepth] = useState(0);
  const pendingRef = useRef<Map<number, EngineLine>>(new Map());

  const send = useCallback((cmd: string) => {
    workerRef.current?.postMessage(cmd);
  }, []);

  // Debounced so rapid move-list navigation doesn't thrash the engine.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyse = useCallback((f: string) => {
    if (!workerRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      pendingRef.current.clear();
      setState("thinking");
      setLines([]);
      setDepth(0);
      send("stop");
      send(`position fen ${f}`);
      send(`go depth ${targetDepth} multipv ${multipv}`);
    }, 120);
  }, [send, targetDepth, multipv]);

  useEffect(() => {
    if (!enabled) return;

    const worker = new Worker("/engine/stockfish.js");
    workerRef.current = worker;
    let ready = false;

    worker.onmessage = (ev: MessageEvent<string>) => {
      const line = ev.data;

      if (line === "uciok") {
        worker.postMessage(`setoption name MultiPV value ${multipv}`);
        worker.postMessage("setoption name Threads value 1");
        worker.postMessage("isready");
        return;
      }
      if (line === "readyok") {
        ready = true;
        setState("ready");
        analyse(fenRef.current);
        return;
      }
      if (ready && line.startsWith("info")) {
        const parsed = parseInfoLine(line);
        if (parsed && parsed.depth >= 5) {
          pendingRef.current.set(parsed.multipv, parsed);
          setDepth(parsed.depth);
          setLines(
            Array.from(pendingRef.current.values()).sort((a, b) => a.multipv - b.multipv),
          );
        }
        return;
      }
      if (line.startsWith("bestmove")) setState("ready");
    };

    worker.postMessage("uci");

    return () => {
      worker.postMessage("quit");
      worker.terminate();
      workerRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    if (!enabled || state === "idle") return;
    analyse(fen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, enabled]);

  return { lines, state, depth, best: lines[0] };
}
