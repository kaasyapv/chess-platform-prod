"use client";

/* Analysis Board - playmate-board.md §Analysis Board:
 * "Analyze positions, create annotations, save and share your analyses."
 * Tabs Moves/Engine/PDF · Flip, Reset, FEN, PGN, Setup board, Start Engine,
 * Save · move history · game description · PDF export. Board = shared
 * WorldChess-skinned ChessBoard; engine = Stockfish WASM multipv. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { createClient } from "@/lib/supabase/client";
import { ChessBoard, type Arrow, type Highlight } from "@/components/board/chess-board";
import { BoardSettingsModal } from "@/components/board/board-settings-modal";
import { useBoardSettings } from "@/lib/board-settings";
import { useChessSounds, soundForMove } from "@/hooks/use-chess-sounds";
import { normalizeGameText } from "@/lib/pgn";
import { useStockfish } from "@/hooks/use-stockfish";
import { EvalBar } from "@/components/board/eval-bar";
import { GameAnalyser, type GameReport } from "@/lib/analysis/analyze-game";
import { TIER_META } from "@/lib/analysis/classify";
import { Button, Card, Input, Modal, PageHeader, SegmentedTabs } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function AnalysisClient({ profileId, academyId, allowEngine }: { profileId: string; academyId: string; allowEngine: boolean }) {
  const toast = useToast();
  const { settings, update } = useBoardSettings();
  const { play } = useChessSounds(settings.sounds);

  const chessRef = useRef(new Chess());
  const [fen, setFen] = useState(START_FEN);
  const [history, setHistory] = useState<string[]>([]);
  const [viewPly, setViewPly] = useState(0);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | undefined>();
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [tab, setTab] = useState("Moves");
  const [engineOn, setEngineOn] = useState(false);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState("Analysis");
  const [showSettings, setShowSettings] = useState(false);
  const [showFen, setShowFen] = useState(false);
  const [showPgn, setShowPgn] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [fenInput, setFenInput] = useState("");
  const [pgnInput, setPgnInput] = useState("");
  const [freeMode, setFreeMode] = useState(false);
  const [report, setReport] = useState<GameReport | null>(null);
  const [reviewPct, setReviewPct] = useState<number | null>(null); // null = not running

  const browsing = viewPly < history.length;

  // ← → traverse the game, exactly like Lichess's analysis board.
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
    const c = new Chess(startFenOf(chessRef.current));
    for (let i = 0; i < viewPly; i++) c.move(history[i]);
    return c.fen();
  })();

  const { lines, depth } = useStockfish(viewFen, engineOn && allowEngine);

  function startFenOf(c: Chess): string {
    const h = c.header();
    return h.FEN ?? START_FEN;
  }

  const onMove = useCallback((from: string, to: string) => {
    const c = chessRef.current;
    let move;
    try {
      const piece = c.get(from as Parameters<Chess["get"]>[0]);
      const needsPromo = piece?.type === "p" && (to[1] === "8" || to[1] === "1");
      move = c.move({ from, to, promotion: needsPromo ? "q" : undefined });
    } catch {
      play("illegal");
      setFen(c.fen());
      return;
    }
    play(soundForMove(move, c.inCheck()));
    setFen(c.fen());
    setHistory(c.history());
    setViewPly(c.history().length);
    setLastMove({ from: move.from, to: move.to });
  }, [play]);

  const onFreeMove = useCallback((boardFen: string) => {
    // Setup mode: accept any arrangement; rebuild game from the raw position
    const full = `${boardFen} w KQkq - 0 1`;
    try {
      chessRef.current = new Chess(full);
      setFen(full);
      setHistory([]);
      setViewPly(0);
      setLastMove(undefined);
    } catch {
      toast("Invalid position", "error");
    }
  }, [toast]);

  function reset() {
    chessRef.current = new Chess();
    setFen(START_FEN);
    setHistory([]);
    setViewPly(0);
    setLastMove(undefined);
    setArrows([]);
    setHighlights([]);
    setFreeMode(false);
  }

  function flip() { setOrientation((o) => (o === "white" ? "black" : "white")); }

  function importFen() {
    try {
      chessRef.current = new Chess(fenInput.trim());
      setFen(chessRef.current.fen());
      setHistory([]);
      setViewPly(0);
      setLastMove(undefined);
      setShowFen(false);
      toast("Position loaded", "success");
    } catch {
      toast("Invalid FEN", "error");
    }
  }

  function importPgn() {
    try {
      const c = new Chess();
      c.loadPgn(normalizeGameText(pgnInput));
      chessRef.current = c;
      setFen(c.fen());
      setHistory(c.history());
      setViewPly(c.history().length);
      setShowPgn(false);
      toast("Game loaded", "success");
    } catch {
      toast("Invalid PGN", "error");
    }
  }

  // Game handed off from external tracking ("Analyze game" - demo §13:30)
  useEffect(() => {
    const pgn = sessionStorage.getItem("analysis-import-pgn");
    if (!pgn) return;
    sessionStorage.removeItem("analysis-import-pgn");
    try {
      const c = new Chess();
      c.loadPgn(normalizeGameText(pgn));
      chessRef.current = c;
      setFen(c.fen());
      setHistory(c.history());
      setViewPly(c.history().length);
      setTitle("Imported game");
      toast("Game loaded from external tracking", "success");
    } catch {
      toast("Could not load the imported game", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) {
      toast("Supabase not configured, cannot save", "error");
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase.from("analyses").insert({
      academy_id: academyId, owner_id: profileId, title, description,
      pgn: chessRef.current.pgn(),
      annotations: { arrows, highlights, fen },
    }).select("share_slug").single();
    if (error) { toast(error.message, "error"); return; }
    const url = `${location.origin}/share/analysis/${data.share_slug}`;
    await navigator.clipboard.writeText(url).catch(() => {});
    toast("Saved, share link copied to clipboard", "success");
  }

  const movePairs: { n: number; w?: string; b?: string }[] = [];
  history.forEach((san, i) => {
    if (i % 2 === 0) movePairs.push({ n: i / 2 + 1, w: san });
    else movePairs[movePairs.length - 1].b = san;
  });

  const evalLine = lines[0];
  const evalText = evalLine
    ? evalLine.mate != null
      ? `M${Math.abs(evalLine.mate)}`
      : `${evalLine.score >= 0 ? "+" : ""}${(evalLine.score / 100).toFixed(2)}`
    : "";

  const turn = viewFen.split(" ")[1] === "b" ? "Black" : "White";
  const sideToMove: "w" | "b" = viewFen.split(" ")[1] === "b" ? "b" : "w";

  /* Engine's best move, drawn straight onto the board. The engine speaks UCI
   * ("e2e4"), which is already the {from,to} the board wants. */
  const bestArrow: Arrow[] = engineOn && evalLine?.move?.length >= 4
    ? [{ from: evalLine.move.slice(0, 2), to: evalLine.move.slice(2, 4), color: "engine" }]
    : [];

  /* Whole-game review: one worker, one pass, judged per move. Runs entirely in
   * the browser, so it costs nothing but the user's own CPU. */
  const runReview = useCallback(async () => {
    if (history.length === 0) { toast("Play or load a game first", "error"); return; }
    setReviewPct(0);
    const analyser = new GameAnalyser(12);
    try {
      const result = await analyser.analyseGame(
        { startFen: startFenOf(chessRef.current), sanMoves: history },
        (done, total) => setReviewPct(Math.round((done / total) * 100)),
      );
      setReport(result);
      toast(`Review complete: White ${result.accuracyWhite}%, Black ${result.accuracyBlack}%`, "success");
    } catch {
      toast("Engine review failed", "error");
    } finally {
      analyser.destroy();
      setReviewPct(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, toast]);

  /* A move's tier badge, once the game has been reviewed. */
  const tierOfPly = (ply: number) => report?.moves.find((m) => m.ply === ply)?.tier;

  return (
    <div>
      <PageHeader
        title="Analysis Board"
        subtitle="Analyze positions, create annotations, save and share your analyses"
        action={
          <div className="flex gap-2 no-print">
            <Button variant="secondary" onClick={() => setShowSettings(true)}>Board appearance</Button>
            <Button variant="secondary" onClick={() => window.print()}>PDF</Button>
            <Button onClick={save}>Save</Button>
          </div>
        }
      />

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex flex-col gap-3">
          {/* Eval bar sits BESIDE the board, never inside it: the board owns its
              own square-to-pixel maths and must not share a box with anything. */}
          <div className="flex gap-2 items-stretch">
            {engineOn && allowEngine && evalLine && (
              <EvalBar
                score={evalLine.score}
                mate={evalLine.mate}
                sideToMove={sideToMove}
                orientation={orientation}
              />
            )}
            <div className="relative w-[min(88vw,600px)] aspect-square">
            <ChessBoard
              fen={viewFen}
              orientation={orientation}
              movable={!browsing}
              free={freeMode}
              arrows={arrows}
              highlights={highlights}
              autoArrows={bestArrow}
              lastMove={browsing ? undefined : lastMove}
              lastMoveMode={settings.lastMoves}
              check={!browsing && !freeMode && chessRef.current.inCheck()}
              showLegal={settings.legalMoves === "dots"}
              boardTheme={settings.boardTheme}
              pieceSet={settings.pieceSet}
              blindfold={settings.blindfold}
              onMove={onMove}
              onFreeMove={onFreeMove}
              onAnnotate={(a, h) => { setArrows(a); setHighlights(h); }}
            />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 no-print">
            <Button variant="secondary" onClick={flip}>Flip</Button>
            <Button variant="secondary" onClick={reset}>Reset</Button>
            <Button variant="secondary" onClick={() => { setFenInput(viewFen); setShowFen(true); }}>FEN</Button>
            <Button variant="secondary" onClick={() => { setPgnInput(chessRef.current.pgn()); setShowPgn(true); }}>PGN</Button>
            <Button variant="secondary" onClick={() => setShowSetup(true)}>Setup board</Button>
            {allowEngine && (
              <Button variant={engineOn ? "primary" : "secondary"} onClick={() => setEngineOn(!engineOn)}>
                {engineOn ? "Stop Engine" : "Start Engine"}
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Turn: <span className="text-foreground">{turn}</span> · Orientation:{" "}
            <span className="text-foreground capitalize">{orientation}</span>
            {freeMode && <span className="text-warning"> · Setup mode</span>}
          </p>
        </div>

        <Card className="flex-1 min-w-72 max-w-lg">
          <SegmentedTabs tabs={allowEngine ? ["Moves", "Engine", "Review", "PDF"] : ["Moves", "PDF"]} active={tab} onChange={setTab} />

          {tab === "Moves" && (
            <div className="mt-4">
              <div className="max-h-72 overflow-y-auto border border-border rounded-btn">
                {movePairs.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4 text-center">No moves yet, play on the board or load a PGN</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {movePairs.map((p) => (
                        <tr key={p.n} className="border-t border-border first:border-0">
                          <td className="px-3 py-1 text-muted-foreground w-10">{p.n}</td>
                          <td className={`px-2 py-1 cursor-pointer ${viewPly === p.n * 2 - 1 ? "text-primary-hover font-semibold" : ""}`}
                              onClick={() => setViewPly(p.n * 2 - 1)}>
                            {p.w} <TierBadge tier={tierOfPly(p.n * 2 - 2)} />
                          </td>
                          <td className={`px-2 py-1 cursor-pointer ${viewPly === p.n * 2 ? "text-primary-hover font-semibold" : ""}`}
                              onClick={() => p.b && setViewPly(p.n * 2)}>
                            {p.b ?? ""} {p.b && <TierBadge tier={tierOfPly(p.n * 2 - 1)} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="flex justify-center gap-1 mt-3 no-print">
                <Button variant="ghost" onClick={() => setViewPly(0)} disabled={history.length === 0}>⏮</Button>
                <Button variant="ghost" onClick={() => setViewPly(Math.max(0, viewPly - 1))} disabled={viewPly === 0}>◀</Button>
                <Button variant="ghost" onClick={() => setViewPly(Math.min(history.length, viewPly + 1))} disabled={viewPly >= history.length}>▶</Button>
                <Button variant="ghost" onClick={() => setViewPly(history.length)} disabled={!browsing}>⏭</Button>
              </div>
            </div>
          )}

          {tab === "Engine" && allowEngine && (
            <div className="mt-4">
              {!engineOn ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-3">Engine is off</p>
                  <Button onClick={() => setEngineOn(true)}>Start Engine</Button>
                </div>
              ) : (
                <div>
                  <div className="flex items-baseline gap-3 mb-3">
                    <span className="text-2xl font-bold tabular-nums">{evalText}</span>
                    <span className="text-sm text-muted-foreground">depth {depth}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {lines.map((l) => (
                      <div key={l.multipv} className="text-sm border border-border rounded-btn px-3 py-2">
                        <span className="font-semibold tabular-nums mr-2">
                          {l.mate != null ? `M${Math.abs(l.mate)}` : (l.score / 100).toFixed(2)}
                        </span>
                        <span className="text-muted-foreground break-all">{l.pv.slice(0, 10).join(" ")}</span>
                      </div>
                    ))}
                    {lines.length === 0 && <p className="text-sm text-muted-foreground">Thinking…</p>}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "Review" && allowEngine && (
            <div className="mt-4">
              {reviewPct !== null ? (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground mb-3">Reviewing the game… {reviewPct}%</p>
                  <div className="h-2 w-full bg-surface-2 rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${reviewPct}%` }} />
                  </div>
                </div>
              ) : !report ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-3">
                    Run every move through Stockfish and grade it. Runs in your browser.
                  </p>
                  <Button onClick={runReview} disabled={history.length === 0}>Review game</Button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex gap-4">
                    {(["White", "Black"] as const).map((side) => (
                      <div key={side} className="flex-1 border border-border rounded-btn p-3 text-center">
                        <p className="text-xs text-muted-foreground">{side} accuracy</p>
                        <p className="text-2xl font-bold tabular-nums">
                          {side === "White" ? report.accuracyWhite : report.accuracyBlack}%
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Tier tally - how many of each kind of move each side played. */}
                  <div className="flex flex-col gap-1">
                    {(Object.keys(TIER_META) as (keyof typeof TIER_META)[]).map((tier) => {
                      const count = report.moves.filter((m) => m.tier === tier).length;
                      if (count === 0) return null;
                      const meta = TIER_META[tier];
                      return (
                        <div key={tier} className="flex items-center gap-2 text-sm">
                          <span className="w-6 text-center font-bold" style={{ color: meta.color }}>{meta.glyph}</span>
                          <span className="flex-1">{meta.label}</span>
                          <span className="tabular-nums text-muted-foreground">{count}</span>
                        </div>
                      );
                    })}
                  </div>

                  <Button variant="secondary" onClick={runReview}>Review again</Button>
                </div>
              )}
            </div>
          )}

          {tab === "PDF" && (
            <div className="mt-4 text-sm text-muted-foreground flex flex-col gap-3">
              <p>Export this analysis (board, moves and description) as a PDF via the browser print dialog.</p>
              <Button onClick={() => window.print()}>Export PDF</Button>
            </div>
          )}

          <div className="mt-5 border-t border-border pt-4">
            <Input
              className="w-full mb-2"
              placeholder="Analysis title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="w-full bg-surface-2 border border-border rounded-btn px-3 py-2 outline-none focus:ring-2 focus:ring-ring text-sm min-h-20"
              placeholder="Add game description…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </Card>
      </div>

      {/* FEN import/export */}
      <Modal open={showFen} onClose={() => setShowFen(false)} title="FEN">
        <div className="flex flex-col gap-3">
          <Input value={fenInput} onChange={(e) => setFenInput(e.target.value)} className="font-mono text-xs" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(fenInput); toast("FEN copied", "success"); }}>Copy</Button>
            <Button onClick={importFen}>Load</Button>
          </div>
        </div>
      </Modal>

      {/* PGN import/export */}
      <Modal open={showPgn} onClose={() => setShowPgn(false)} title="PGN" wide>
        <div className="flex flex-col gap-3">
          <textarea
            className="w-full bg-surface-2 border border-border rounded-btn px-3 py-2 font-mono text-xs min-h-40"
            value={pgnInput}
            onChange={(e) => setPgnInput(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(pgnInput); toast("PGN copied", "success"); }}>Copy</Button>
            <Button onClick={importPgn}>Load</Button>
          </div>
        </div>
      </Modal>

      {/* Setup board */}
      <Modal open={showSetup} onClose={() => setShowSetup(false)} title="Setup board">
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Setup mode lets you drag pieces anywhere (legality off). Combine with
            the FEN dialog to paste an exact position.
          </p>
          <div className="flex gap-2">
            <Button
              variant={freeMode ? "primary" : "secondary"}
              onClick={() => { setFreeMode(!freeMode); setShowSetup(false); }}
            >
              {freeMode ? "Exit setup mode" : "Enter setup mode"}
            </Button>
            <Button variant="secondary" onClick={() => { reset(); setShowSetup(false); }}>Start position</Button>
            <Button
              variant="secondary"
              onClick={() => {
                chessRef.current.clear();
                setFen(chessRef.current.fen());
                setHistory([]); setViewPly(0);
                setShowSetup(false);
                setFreeMode(true);
              }}
            >
              Clear board
            </Button>
          </div>
        </div>
      </Modal>

      <BoardSettingsModal open={showSettings} onClose={() => setShowSettings(false)} settings={settings} onChange={update} />
    </div>
  );
}

/** The move-quality glyph shown next to a move once the game has been reviewed.
 *  Renders nothing until a review has actually run. */
function TierBadge({ tier }: { tier?: keyof typeof TIER_META }) {
  if (!tier) return null;
  const meta = TIER_META[tier];
  return (
    <span className="font-bold" style={{ color: meta.color }} title={meta.label}>
      {meta.glyph}
    </span>
  );
}
