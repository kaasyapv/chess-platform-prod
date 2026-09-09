"use client";

/* Play Area - Play vs Computer + PvP (BETA) per playmate-board.md §Play Area:
 * New Game modal (color W/B/Random cards, level slider 1-12 → ELO, time
 * control), move-history table with ⏮◀▶⏭ nav, game save + View History.
 * Board: shared WorldChess-skinned ChessBoard + dual clocks + sounds +
 * premove + promotion picker + Board appearance settings. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { createClient } from "@/lib/supabase/client";
import { ChessBoard, type ChessBoardHandle } from "@/components/board/chess-board";
import { PromotionPicker } from "@/components/board/promotion-picker";
import { BoardSettingsModal } from "@/components/board/board-settings-modal";
import { DualClocks, useChessClock, TIME_CONTROLS, type TimeControl } from "@/components/board/chess-clock";
import { useBoardSettings } from "@/lib/board-settings";
import { useChessSounds, soundForMove } from "@/hooks/use-chess-sounds";
import { useEnginePlayer, levelToElo } from "@/hooks/use-engine-player";
import { Button, Modal, PageHeader, SegmentedTabs, Card, EmptyState, StatusPill } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

type GameRow = {
  id: string; player_color: string; engine_level: number | null;
  time_control: string | null; result: string | null; pgn: string; created_at: string;
};

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function PlayAreaClient({ profileId, academyId }: { profileId: string; academyId: string }) {
  const toast = useToast();
  const { settings, update } = useBoardSettings();
  const { play } = useChessSounds(settings.sounds);

  const [mode, setMode] = useState("Play With Computer");
  const [showNewGame, setShowNewGame] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [pastGames, setPastGames] = useState<GameRow[]>([]);

  // Game config
  const [colorChoice, setColorChoice] = useState<"white" | "black" | "random">("white");
  const [level, setLevel] = useState(4);
  const [tcLabel, setTcLabel] = useState("No Clock");

  // Game state
  const chessRef = useRef(new Chess());
  const boardRef = useRef<ChessBoardHandle>(null);
  const [fen, setFen] = useState(START_FEN);
  const [playing, setPlaying] = useState(false);
  const [playerColor, setPlayerColor] = useState<"white" | "black">("white");
  const [gameLevel, setGameLevel] = useState(4);
  const [history, setHistory] = useState<string[]>([]);
  const [viewPly, setViewPly] = useState(0);       // 0..history.length; < length = browsing
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | undefined>();
  const [status, setStatus] = useState("Not Started");
  const [result, setResult] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [tc, setTc] = useState<TimeControl>(null);

  const engine = useEnginePlayer(gameLevel, playing);

  const endGame = useCallback((res: string, reason: string) => {
    setPlaying(false);
    setResult(res);
    setStatus(reason);
    clock.stop();
    play("game-end");
    // Persist (best-effort - RLS scopes to own row)
    if (process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) {
      const supabase = createClient();
      supabase.from("games").insert({
        academy_id: academyId, player_id: profileId, opponent: "computer",
        player_color: playerColor, engine_level: gameLevel,
        time_control: tcLabel, pgn: chessRef.current.pgn(), result: res,
      }).then(({ error }) => { if (error) console.error("save game:", error.message); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academyId, profileId, playerColor, gameLevel, tcLabel, play]);

  const clock = useChessClock(tc, (side) => {
    endGame(side === "white" ? "0-1" : "1-0", `${side} flagged: time out`);
  });

  // Low-time tick sound
  const lowPlayed = useRef(false);
  useEffect(() => {
    if (!playing || !clock.running) return;
    const mine = playerColor === "white" ? clock.white : clock.black;
    if (mine <= 10_000 && mine > 0 && clock.running === playerColor && !lowPlayed.current) {
      lowPlayed.current = true;
      play("low-time");
      setTimeout(() => { lowPlayed.current = false; }, 3000);
    }
  }, [clock.white, clock.black, clock.running, playing, playerColor, play]);

  const checkGameOver = useCallback((): boolean => {
    const c = chessRef.current;
    if (!c.isGameOver()) return false;
    let res = "1/2-1/2", reason = "Draw";
    if (c.isCheckmate()) {
      res = c.turn() === "w" ? "0-1" : "1-0";
      reason = `Checkmate: ${c.turn() === "w" ? "Black" : "White"} wins`;
    } else if (c.isStalemate()) reason = "Stalemate";
    else if (c.isThreefoldRepetition()) reason = "Draw by repetition";
    else if (c.isInsufficientMaterial()) reason = "Draw by insufficient material";
    else if (c.isDrawByFiftyMoves?.()) reason = "Draw by the fifty-move rule";
    endGame(res, reason);
    return true;
  }, [endGame]);

  const applyMove = useCallback((from: string, to: string, promotion?: string): boolean => {
    const c = chessRef.current;
    let move;
    try {
      move = c.move({ from, to, promotion });
    } catch {
      play("illegal");
      setFen(c.fen());
      return false;
    }
    play(soundForMove(move, c.inCheck()));
    setFen(c.fen());
    setLastMove({ from: move.from, to: move.to });
    setHistory(c.history());
    setViewPly(c.history().length);
    if (!checkGameOver()) {
      const mover = move.color === "w" ? "white" : "black";
      clock.switchTo(mover === "white" ? "black" : "white");
      setStatus("In Progress");
    }
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, checkGameOver]);

  const engineTurn = useCallback(async () => {
    const c = chessRef.current;
    if (c.isGameOver()) return;
    const m = await engine.getMove(c.fen());
    if (!m) return;
    applyMove(m.from, m.to, m.promotion);
    // Player may have queued a premove during engine think
    setTimeout(() => boardRef.current?.playPremove(), 60);
  }, [engine, applyMove]);

  function isPromotion(from: string, to: string): boolean {
    const piece = chessRef.current.get(from as Parameters<Chess["get"]>[0]);
    return piece?.type === "p" && (to[1] === "8" || to[1] === "1");
  }

  const onUserMove = useCallback((from: string, to: string) => {
    if (!playing) { setFen(chessRef.current.fen()); return; }
    if (isPromotion(from, to)) {
      if (settings.autoQueen) {
        if (applyMove(from, to, "q")) void engineTurn();
      } else {
        setPromo({ from, to });
      }
      return;
    }
    if (applyMove(from, to)) void engineTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, settings.autoQueen, applyMove, engineTurn]);

  function startGame() {
    const color = colorChoice === "random" ? (Math.random() < 0.5 ? "white" : "black") : colorChoice;
    const chosenTc = TIME_CONTROLS.find((t) => t.label === tcLabel)?.tc ?? null;
    chessRef.current = new Chess();
    setFen(chessRef.current.fen());
    setPlayerColor(color);
    setGameLevel(level);
    setHistory([]);
    setViewPly(0);
    setLastMove(undefined);
    setResult(null);
    setTc(chosenTc);
    clock.reset(chosenTc);
    setPlaying(true);
    setStatus("In Progress");
    setShowNewGame(false);
    if (chosenTc) clock.start("white");
    if (color === "black") setTimeout(() => void engineTurn(), 350);
  }

  // Move-list navigation (⏮ ◀ ▶ ⏭) - browsing renders a past position
  const browsing = viewPly < history.length;

  // ← → page through the moves, exactly like Lichess.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (e.key === "ArrowLeft") setViewPly((p) => Math.max(0, p - 1));
      else if (e.key === "ArrowRight") setViewPly((p) => Math.min(history.length, p + 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history.length]);
  const viewFen = (() => {
    if (!browsing) return fen;
    const c = new Chess();
    for (let i = 0; i < viewPly; i++) c.move(history[i]);
    return c.fen();
  })();

  async function loadHistory() {
    setShowHistory(true);
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) return;
    const supabase = createClient();
    const { data } = await supabase.from("games").select("*")
      .eq("player_id", profileId).order("created_at", { ascending: false }).limit(50);
    setPastGames(data ?? []);
  }

  const movePairs: { n: number; w?: string; b?: string }[] = [];
  history.forEach((san, i) => {
    if (i % 2 === 0) movePairs.push({ n: i / 2 + 1, w: san });
    else movePairs[movePairs.length - 1].b = san;
  });

  return (
    <div>
      <PageHeader
        title="Play Area"
        subtitle="Play chess against the computer or other players"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowSettings(true)}>Board appearance</Button>
            <Button variant="secondary" onClick={loadHistory}>View History</Button>
            <Button onClick={() => setShowNewGame(true)}>New Game</Button>
          </div>
        }
      />

      <div className="mb-4">
        <SegmentedTabs
          tabs={["Play With Computer", "Player Vs Player (BETA)"]}
          active={mode}
          onChange={(m) => {
            setMode(m);
            if (m.startsWith("Player")) toast("Player vs Player is in beta, matchmaking coming soon", "info");
          }}
        />
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Board + clocks */}
        <div className="flex gap-4 items-stretch">
          {tc && (
            <div className="w-36 shrink-0 hidden sm:block">
              <DualClocks white={clock.white} black={clock.black} running={clock.running} orientation={playerColor} />
            </div>
          )}
          <div className="relative w-[min(88vw,600px)] aspect-square">
            <ChessBoard
              ref={boardRef}
              fen={viewFen}
              orientation={playerColor}
              movable={playing && !browsing ? playerColor : false}
              lastMove={browsing ? undefined : lastMove}
              lastMoveMode={settings.lastMoves}
              check={!browsing && chessRef.current.inCheck()}
              showLegal={settings.legalMoves === "dots"}
              premove={settings.premove}
              boardTheme={settings.boardTheme}
              pieceSet={settings.pieceSet}
              blindfold={settings.blindfold}
              onMove={onUserMove}
            />
            {promo && (
              <PromotionPicker
                color={playerColor === "white" ? "w" : "b"}
                pieceSet={settings.pieceSet}
                onPick={(p) => { setPromo(null); if (applyMove(promo.from, promo.to, p)) void engineTurn(); }}
                onCancel={() => { setPromo(null); setFen(chessRef.current.fen()); }}
              />
            )}
            {!playing && !result && (
              <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] flex flex-col items-center justify-center gap-3 rounded">
                <p className="text-xl font-semibold text-white">Ready to Play?</p>
                <Button onClick={() => setShowNewGame(true)}>Start New Game</Button>
              </div>
            )}
          </div>
        </div>

        {/* Move history panel */}
        <Card className="flex-1 min-w-64 max-w-md flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-medium">Move History</h2>
            <StatusPill status={result ? "completed" : playing ? "live" : "inactive"} />
          </div>
          <p className="text-sm text-muted-foreground mb-2">{status}{result ? ` · ${result}` : ""}</p>
          <div className="flex-1 overflow-y-auto max-h-80 border border-border rounded-btn">
            {movePairs.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4 text-center">No moves yet</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="px-3 py-1.5 w-10">#</th><th className="px-2 py-1.5">White</th><th className="px-2 py-1.5">Black</th>
                  </tr>
                </thead>
                <tbody>
                  {movePairs.map((p) => (
                    <tr key={p.n} className="border-t border-border">
                      <td className="px-3 py-1 text-muted-foreground">{p.n}</td>
                      <td className={`px-2 py-1 cursor-pointer ${viewPly === p.n * 2 - 1 ? "text-primary-hover font-semibold" : ""}`}
                          onClick={() => setViewPly(p.n * 2 - 1)}>{p.w}</td>
                      <td className={`px-2 py-1 cursor-pointer ${viewPly === p.n * 2 ? "text-primary-hover font-semibold" : ""}`}
                          onClick={() => p.b && setViewPly(p.n * 2)}>{p.b ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex justify-center gap-1 mt-3">
            <Button variant="ghost" onClick={() => setViewPly(0)} disabled={history.length === 0}>⏮</Button>
            <Button variant="ghost" onClick={() => setViewPly(Math.max(0, viewPly - 1))} disabled={viewPly === 0}>◀</Button>
            <Button variant="ghost" onClick={() => setViewPly(Math.min(history.length, viewPly + 1))} disabled={viewPly >= history.length}>▶</Button>
            <Button variant="ghost" onClick={() => setViewPly(history.length)} disabled={!browsing}>⏭</Button>
          </div>
        </Card>
      </div>

      {/* New Game modal - color cards, level 1-12 = ELO, time control */}
      <Modal open={showNewGame} onClose={() => setShowNewGame(false)} title="New Game">
        <div className="flex flex-col gap-5">
          <section>
            <p className="text-sm text-muted-foreground mb-2">Play as</p>
            <div className="grid grid-cols-3 gap-2">
              {(["white", "black", "random"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setColorChoice(c)}
                  className={`rounded-card border p-3 flex flex-col items-center gap-1 transition-colors ${
                    colorChoice === c ? "border-primary bg-primary/10" : "border-border hover:bg-surface-2"
                  }`}
                >
                  <span className="text-2xl">{c === "white" ? "♔" : c === "black" ? "♚" : "?"}</span>
                  <span className="text-sm capitalize">{c}</span>
                </button>
              ))}
            </div>
          </section>
          <section>
            <p className="text-sm text-muted-foreground mb-1">
              Level: <span className="text-foreground font-medium">{level}</span> · {levelToElo(level)} ELO
            </p>
            <input
              type="range" min={1} max={12} value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
              className="w-full accent-[var(--primary)]"
            />
          </section>
          <section>
            <p className="text-sm text-muted-foreground mb-2">Time Control</p>
            <select
              value={tcLabel} onChange={(e) => setTcLabel(e.target.value)}
              className="w-full bg-surface-2 border border-border rounded-btn px-3 py-2"
            >
              {TIME_CONTROLS.map((t) => <option key={t.label} value={t.label}>{t.label}</option>)}
            </select>
          </section>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowNewGame(false)}>Cancel</Button>
            <Button onClick={startGame}>Start Game</Button>
          </div>
        </div>
      </Modal>

      {/* Past games */}
      <Modal open={showHistory} onClose={() => setShowHistory(false)} title="Game History" wide>
        {pastGames.length === 0 ? (
          <EmptyState text="No games played yet." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="py-2">Date</th><th>Color</th><th>Level</th><th>Time</th><th>Result</th>
              </tr>
            </thead>
            <tbody>
              {pastGames.map((g) => (
                <tr key={g.id} className="border-t border-border">
                  <td className="py-2">{new Date(g.created_at).toLocaleString()}</td>
                  <td className="capitalize">{g.player_color}</td>
                  <td>{g.engine_level ?? ""}</td>
                  <td>{g.time_control ?? ""}</td>
                  <td>{g.result ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>

      <BoardSettingsModal open={showSettings} onClose={() => setShowSettings(false)} settings={settings} onChange={update} />
    </div>
  );
}
