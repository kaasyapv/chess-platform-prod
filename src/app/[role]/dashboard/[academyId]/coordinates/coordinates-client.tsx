"use client";

/* Coordinate trainer - Lichess's /training/coordinate, option for option:
 *   · Find square (click the named square) / Name square (type the highlighted one)
 *   · untimed ∞ or 0:30 rounds
 *   · play as White / random / Black
 *   · Practice only some files & ranks (pick which)
 *   · Show coordinates (edge labels) · Coordinates on every square · Show pieces
 * Score + best score, green/red feedback, next target previewed. */

import { useEffect, useRef, useState } from "react";
import { pieceUrl, type PieceKind } from "@/components/board/piece-sets";
import { PageHeader, Button } from "@/components/ui";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["1", "2", "3", "4", "5", "6", "7", "8"];
const ROUND_SECONDS = 30;
const BEST_KEY = "coord-trainer-best";

/** Starting-position piece for a square name, or null. */
function startingPiece(sq: string): { kind: PieceKind; color: "w" | "b" } | null {
  const file = sq[0], rank = sq[1];
  const back: Record<string, PieceKind> = { a: "r", b: "n", c: "b", d: "q", e: "k", f: "b", g: "n", h: "r" };
  if (rank === "1") return { kind: back[file], color: "w" };
  if (rank === "2") return { kind: "p", color: "w" };
  if (rank === "7") return { kind: "p", color: "b" };
  if (rank === "8") return { kind: back[file], color: "b" };
  return null;
}

export function CoordinatesClient() {
  // ── Options (Lichess order) ──
  const [mode, setMode] = useState<"find" | "name">("find");
  const [timed, setTimed] = useState(true);
  const [side, setSide] = useState<"white" | "random" | "black">("white");
  const [limitFR, setLimitFR] = useState(false);
  const [files, setFiles] = useState<Set<string>>(new Set(FILES));
  const [ranks, setRanks] = useState<Set<string>>(new Set(RANKS));
  const [showCoords, setShowCoords] = useState(false);
  const [coordsEverySquare, setCoordsEverySquare] = useState(false);
  const [showPieces, setShowPieces] = useState(true);

  // ── Round state ──
  const [phase, setPhase] = useState<"idle" | "playing" | "done">("idle");
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [target, setTarget] = useState("");
  const [next, setNext] = useState("");
  const [typed, setTyped] = useState("");
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [flash, setFlash] = useState<{ sq: string; ok: boolean } | null>(null);
  const [best, setBest] = useState(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try { setBest(Number(localStorage.getItem(BEST_KEY)) || 0); } catch { /* ssr */ }
  }, []);

  const pool = () => {
    const fs = limitFR ? [...files] : FILES;
    const rs = limitFR ? [...ranks] : RANKS;
    return fs.length && rs.length ? { fs, rs } : { fs: FILES, rs: RANKS };
  };
  function randomSquare(not?: string): string {
    const { fs, rs } = pool();
    let sq = "";
    do {
      sq = fs[Math.floor(Math.random() * fs.length)] + rs[Math.floor(Math.random() * rs.length)];
    } while (sq === not && fs.length * rs.length > 1);
    return sq;
  }

  function start() {
    setOrientation(side === "random" ? (Math.random() < 0.5 ? "white" : "black") : side);
    const first = randomSquare();
    setTarget(first);
    setNext(randomSquare(first));
    setTyped("");
    setScore(0);
    setMisses(0);
    setTimeLeft(ROUND_SECONDS);
    setPhase("playing");
  }

  function finish(finalScore: number) {
    setPhase("done");
    setBest((b) => {
      const nb = Math.max(b, finalScore);
      try { localStorage.setItem(BEST_KEY, String(nb)); } catch { /* ignore */ }
      return nb;
    });
  }

  // Round clock (only when timed)
  useEffect(() => {
    if (phase !== "playing" || !timed) return;
    if (timeLeft <= 0) { finish(score); return; }
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, timed, timeLeft]);

  function advance(fromSq: string, ok: boolean) {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash({ sq: fromSq, ok });
    flashTimer.current = setTimeout(() => setFlash(null), 300);
    if (ok) {
      setScore((s) => s + 1);
      setTarget(next);
      setNext(randomSquare(next));
      setTyped("");
    } else {
      setMisses((m) => m + 1);
    }
  }

  function clickSquare(sq: string) {
    if (phase !== "playing" || mode !== "find") return;
    advance(sq, sq === target);
  }

  // Name-square mode: type the highlighted square's name (e.g. "e", then "4")
  useEffect(() => {
    if (phase !== "playing" || mode !== "name") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (typed === "" && FILES.includes(k)) { setTyped(k); e.preventDefault(); return; }
      if (typed !== "" && RANKS.includes(k)) {
        advance(target, typed + k === target);
        e.preventDefault();
        return;
      }
      if (k === "backspace") { setTyped(""); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mode, typed, target, next]);

  // Board squares in render order for the current orientation
  const squares: string[] = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const file = orientation === "white" ? f : 7 - f;
      const rank = orientation === "white" ? 8 - r : r + 1;
      squares.push(FILES[file] + rank);
    }
  }
  const edgeFiles = orientation === "white" ? FILES : [...FILES].reverse();
  const edgeRanks = orientation === "white" ? [...RANKS].reverse() : RANKS;

  const toggle = (v: boolean, set: (b: boolean) => void, label: string) => (
    <label key={label} className="flex items-center gap-2.5 cursor-pointer select-none">
      <button
        type="button" role="switch" aria-checked={v} onClick={() => set(!v)}
        className={`w-10 h-5.5 h-[22px] rounded-full transition-colors relative shrink-0 ${v ? "bg-success" : "bg-surface-2 border border-border"}`}
      >
        <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white transition-all ${v ? "left-[20px]" : "left-0.5"}`} />
      </button>
      <span className="text-sm">{label}</span>
    </label>
  );

  const seg = (on: boolean) =>
    `flex-1 px-4 py-2 text-sm font-medium transition-colors ${on ? "bg-primary text-primary-foreground" : "bg-surface-2 hover:bg-surface-3 text-muted-foreground"}`;

  return (
    <div>
      <PageHeader title="Coordinates" />
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Options rail (idle) / score rail (playing) - Lichess puts it left */}
        <div className="w-full lg:w-72 shrink-0 flex flex-col gap-4 order-2 lg:order-1">
          {phase === "playing" ? (
            <>
              <p className="text-7xl font-black tabular-nums pop" key={score}>{score}</p>
              <p className="text-sm text-muted-foreground">
                {misses > 0 && <>misses: {misses} · </>}as <b className="capitalize text-foreground">{orientation}</b>
                {!timed && <> · untimed</>}
              </p>
              {!timed && <Button variant="secondary" onClick={() => finish(score)}>End session</Button>}
            </>
          ) : (
            <>
              <div className="flex rounded-btn overflow-hidden border border-border">
                <button className={seg(mode === "find")} onClick={() => setMode("find")}>Find square</button>
                <button className={seg(mode === "name")} onClick={() => setMode("name")}>Name square</button>
              </div>
              <div className="flex rounded-btn overflow-hidden border border-border">
                <button className={seg(!timed)} onClick={() => setTimed(false)}>∞</button>
                <button className={seg(timed)} onClick={() => setTimed(true)}>0:30</button>
              </div>
              <div className="flex rounded-btn overflow-hidden border border-border">
                {(["white", "random", "black"] as const).map((sd) => (
                  <button key={sd} className={seg(side === sd)} onClick={() => setSide(sd)}
                    title={sd === "random" ? "Random side" : `Play as ${sd}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {sd === "random"
                      ? <span className="inline-flex justify-center gap-0.5"><img src={pieceUrl("cburnett", "k", "w")} alt="" className="w-5 h-5" /><img src={pieceUrl("cburnett", "k", "b")} alt="" className="w-5 h-5" /></span>
                      /* eslint-disable-next-line @next/next/no-img-element */
                      : <img src={pieceUrl("cburnett", "k", sd === "white" ? "w" : "b")} alt={sd} className="w-5 h-5 mx-auto" />}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-3">
                {toggle(limitFR, setLimitFR, "Practice only some files & ranks")}
                {limitFR && (
                  <div className="pl-1 flex flex-col gap-1.5">
                    <div className="flex gap-1">
                      {FILES.map((f) => (
                        <button key={f} onClick={() => setFiles((prev) => { const n = new Set(prev); if (n.has(f)) n.delete(f); else n.add(f); return n; })}
                          className={`w-7 h-7 rounded text-xs font-semibold transition-colors ${files.has(f) ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground hover:bg-surface-3"}`}>
                          {f}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      {RANKS.map((r) => (
                        <button key={r} onClick={() => setRanks((prev) => { const n = new Set(prev); if (n.has(r)) n.delete(r); else n.add(r); return n; })}
                          className={`w-7 h-7 rounded text-xs font-semibold transition-colors ${ranks.has(r) ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground hover:bg-surface-3"}`}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {toggle(showCoords, setShowCoords, "Show coordinates")}
                {toggle(coordsEverySquare, setCoordsEverySquare, "Coordinates on every square")}
                {toggle(showPieces, setShowPieces, "Show pieces")}
              </div>

              {phase === "done" && (
                <div className="rounded-card border border-border bg-surface-2 p-4 pop">
                  <p className="text-4xl font-black tabular-nums">{score}</p>
                  <p className="text-sm text-muted-foreground">
                    squares{timed && <> in {ROUND_SECONDS}s</>}{misses > 0 && <> · {misses} miss{misses === 1 ? "" : "es"}</>}
                  </p>
                </div>
              )}
              <Button className="w-full !py-3 text-lg" onClick={start}>
                {phase === "done" ? "Play again" : "Start training"}
              </Button>
              {best > 0 && <span className="text-sm text-muted-foreground tabular-nums">Best: {best}</span>}
            </>
          )}
        </div>

        {/* Board */}
        <div className="relative w-full max-w-xl order-1 lg:order-2">
          <div className="grid grid-cols-8 grid-rows-8 aspect-square rounded-card overflow-hidden border-4"
            style={{ borderColor: "var(--board-frame, #884515)" }}>
            {squares.map((sq, i) => {
              const dark = (Math.floor(i / 8) + i) % 2 === 1;
              const f = flash?.sq === sq ? flash : null;
              const isNameTarget = phase === "playing" && mode === "name" && sq === target;
              const piece = showPieces ? startingPiece(sq) : null;
              return (
                <button
                  key={sq}
                  onClick={() => clickSquare(sq)}
                  aria-label={`square ${sq}`}
                  className="relative transition-colors duration-150"
                  style={{
                    background: f ? (f.ok ? "#22C55E" : "#EF4444")
                      : isNameTarget ? "#FACC15"
                      : dark ? "var(--board-dark, #B58763)" : "var(--board-light, #EFDAB4)",
                  }}
                >
                  {piece && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pieceUrl("cburnett", piece.kind, piece.color)} alt=""
                      className="absolute inset-0 w-full h-full p-[6%] pointer-events-none" />
                  )}
                  {coordsEverySquare && (
                    <span className="absolute top-0.5 left-1 text-[10px] font-semibold opacity-60 pointer-events-none text-black/70">{sq}</span>
                  )}
                  {showCoords && sq[0] === edgeFiles[0] && (
                    <span className="absolute top-0.5 left-1 text-[11px] font-bold opacity-70 pointer-events-none text-black/70">{sq[1]}</span>
                  )}
                  {showCoords && sq[1] === (orientation === "white" ? "1" : "8") && (
                    <span className="absolute bottom-0.5 right-1 text-[11px] font-bold opacity-70 pointer-events-none text-black/70">{sq[0]}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Find-square: the target floats over the board like Lichess */}
          {phase === "playing" && mode === "find" && (
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center select-none">
              <span key={target} className="pop text-7xl font-black text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.7)]">{target}</span>
              <span className="text-2xl font-bold text-white/60 [text-shadow:0_1px_6px_rgba(0,0,0,0.7)]">{next}</span>
            </div>
          )}
          {/* Name-square: your typing shows under the board */}
          {phase === "playing" && mode === "name" && (
            <p className="mt-2 text-center text-2xl font-black tabular-nums h-8">
              {typed || <span className="text-muted-foreground text-base font-medium">type the highlighted square, e.g. e then 4</span>}
            </p>
          )}

          {phase === "playing" && timed && (
            <div className="mt-2 h-2 rounded-full bg-surface-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${timeLeft <= 10 ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${(timeLeft / ROUND_SECONDS) * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
