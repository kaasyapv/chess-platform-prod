"use client";

/* Chess Games Library - the classroom's PGN browser, rebuilt against the
 * reference platform: a breadcrumb, folder cards, and finally a grid of
 * POSITION CARDS. Every card previews its own board (in the coach's own theme
 * and piece set), steps through the game with ⏮ ◀ ▶ ⏭, and offers:
 *   Load - push this game onto the live board
 *   Ask  - start a quiz from the shown position WITHOUT touching the board
 * Cards are multi-selectable (shift-click for a range) for a bulk Ask. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import {
  ChevronLeft, ChevronRight, CircleHelp, Folder, House, Play, Search,
  SkipBack, SkipForward,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { MiniBoard } from "@/components/board/mini-board";
import { loadPgnLenient } from "@/lib/pgn-load";
import { normalizeGameText, pgnInitialFen } from "@/lib/pgn";
import { BOARD_THEMES, useBoardSettings } from "@/lib/board-settings";
import { Button } from "@/components/ui";

type Node = { id: string; name: string };
export type Game = { id: string; title: string; content: string };
type Crumb = { id: string | null; name: string };

export function GamesLibrary({
  academyId, onLoad, onAsk, onGamesChange,
}: {
  academyId: string;
  onLoad: (content: string, title: string) => void;
  /** Start a quiz from these positions - the live board is left alone. */
  onAsk: (fens: string[], title: string) => void;
  /** The folder's games, so the live board's Next button can walk them. */
  onGamesChange?: (games: Game[]) => void;
}) {
  const { settings } = useBoardSettings();
  const theme = BOARD_THEMES.find((t) => t.id === settings.boardTheme) ?? BOARD_THEMES[0];

  const [trail, setTrail] = useState<Crumb[]>([{ id: null, name: "Games" }]);
  const [folders, setFolders] = useState<Node[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [busy, setBusy] = useState(true);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Game[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<number | null>(null);

  const here = trail[trail.length - 1].id;

  useEffect(() => {
    setBusy(true);
    const supabase = createClient();
    const fq = supabase.from("pgn_folders").select("id, name").eq("academy_id", academyId).order("position");
    Promise.all([
      here === null ? fq.is("parent_id", null) : fq.eq("parent_id", here),
      here === null
        ? Promise.resolve({ data: [] as Game[] })
        : supabase.from("pgns").select("id, title, content").eq("folder_id", here).order("position"),
    ]).then(([f, g]) => {
      setFolders((f.data ?? []) as Node[]);
      setGames((g.data ?? []) as Game[]);
      setSelected(new Set());
      setBusy(false);
    });
  }, [here, academyId]);

  // Search runs across the whole library and lands straight on the cards.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setHits(null); return; }
    const t = setTimeout(() => {
      createClient().from("pgns")
        .select("id, title, content").eq("academy_id", academyId)
        .ilike("title", `%${q}%`).limit(60)
        .then(({ data }) => setHits((data ?? []) as Game[]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, academyId]);

  const shown = useMemo(() => hits ?? games, [hits, games]);

  // Hand the visible games up, so the board's Next button can walk them.
  useEffect(() => { onGamesChange?.(shown); }, [shown, onGamesChange]);

  function pick(i: number, g: Game, shift: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastClicked !== null) {
        const [a, b] = [Math.min(lastClicked, i), Math.max(lastClicked, i)];
        for (let k = a; k <= b; k++) next.add(shown[k].id);
      } else if (next.has(g.id)) next.delete(g.id);
      else next.add(g.id);
      return next;
    });
    setLastClicked(i);
  }

  function askSelected() {
    const picked = shown.filter((g) => selected.has(g.id));
    if (!picked.length) return;
    onAsk(
      picked.map((g) => pgnInitialFen(normalizeGameText(g.content))),
      picked.length === 1 ? picked[0].title : `${picked.length} positions`,
    );
  }

  return (
    <div className="flex flex-col gap-3 min-h-0 h-full">
      <nav className="flex items-center gap-1 flex-wrap text-sm shrink-0">
        {trail.map((c, i) => (
          <span key={`${c.id}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={13} className="text-muted-foreground" />}
            <button
              onClick={() => { setTrail(trail.slice(0, i + 1)); setQuery(""); }}
              className={`flex items-center gap-1.5 rounded-btn px-1.5 py-0.5 transition-colors ${
                i === trail.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {i === 0 && <House size={14} />}
              {c.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="relative shrink-0">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search games, folders…"
          className="w-full bg-surface-2 border border-border rounded-btn pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {shown.length > 0 && (
        <div className="flex items-center gap-3 text-sm shrink-0">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="accent-[var(--primary)]"
              checked={selected.size === shown.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((g) => g.id)) : new Set())}
            />
            Select all
          </label>
          <span className="text-muted-foreground">
            Selected: <b className="text-primary-hover">{selected.size}</b>
          </span>
          <Button className="ml-auto !py-1 !px-3 text-sm" disabled={selected.size === 0} onClick={askSelected}>
            <CircleHelp size={14} className="inline mr-1.5 -mt-0.5" /> Ask
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        {busy ? (
          <div className="grid grid-cols-1 gap-3">
            {[0, 1, 2].map((i) => <div key={i} className="h-72 rounded-card bg-surface-2 animate-pulse" />)}
          </div>
        ) : (
          <>
            {!hits && folders.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                {folders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setTrail([...trail, { id: f.id, name: f.name }])}
                    className="flex items-center gap-2.5 rounded-card border border-border bg-surface-2 px-4 py-3.5 text-sm text-left transition-all hover:border-primary/60 hover:bg-surface-3 hover:-translate-y-0.5"
                  >
                    <Folder size={17} className="shrink-0 text-primary/80" />
                    <span className="truncate font-medium">{f.name}</span>
                  </button>
                ))}
              </div>
            )}

            {shown.length > 0 && (
              <div className="grid grid-cols-1 gap-3">
                {shown.map((g, i) => (
                  <GameCard
                    key={g.id}
                    game={g}
                    picked={selected.has(g.id)}
                    pieceSet={settings.pieceSet}
                    dark={theme.dark}
                    light={theme.light}
                    onPick={(shift) => pick(i, g, shift)}
                    onLoad={() => onLoad(g.content, g.title)}
                    onAsk={(fen) => onAsk([fen], g.title)}
                  />
                ))}
              </div>
            )}

            {folders.length === 0 && shown.length === 0 && (
              <div className="rounded-card border border-dashed border-border bg-surface-2 px-4 py-10 text-center">
                <p className="text-sm font-medium">
                  {query ? `No games match “${query}”.` : "This folder is empty."}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** One position card: preview board, move stepper, Load and Ask. */
function GameCard({
  game, picked, pieceSet, dark, light, onPick, onLoad, onAsk,
}: {
  game: Game; picked: boolean; pieceSet: string; dark: string; light: string;
  onPick: (shift: boolean) => void;
  onLoad: () => void;
  onAsk: (fen: string) => void;
}) {
  // Every position the game passes through - the stepper walks these.
  const fens = useMemo(() => {
    const loaded = loadPgnLenient(game.content);
    if (!loaded) return [pgnInitialFen(normalizeGameText(game.content))];
    const start = loaded.chess.getHeaders().FEN || undefined;
    let c: Chess;
    try { c = new Chess(start); } catch { return [pgnInitialFen(normalizeGameText(game.content))]; }
    const out = [c.fen()];
    for (const san of loaded.chess.history()) {
      try { c.move(san); out.push(c.fen()); } catch { break; }
    }
    return out;
  }, [game.content]);

  const [ply, setPly] = useState(0);
  const at = Math.min(ply, fens.length - 1);
  const last = fens.length - 1;
  const step = useCallback(
    (n: number) => setPly((p) => Math.max(0, Math.min(last, p + n))),
    [last],
  );

  return (
    <div
      className={`rounded-card border p-3 transition-all ${
        picked ? "border-warning ring-1 ring-warning/50 bg-warning/5" : "border-border bg-surface-2 hover:border-primary/50"
      }`}
    >
      <button
        onClick={(e) => onPick(e.shiftKey)}
        className="block w-full text-sm font-semibold text-center truncate mb-2 hover:text-primary-hover"
        title="Click to select (shift-click for a range)"
      >
        {game.title}
      </button>

      <MiniBoard fen={fens[at]} pieceSet={pieceSet} dark={dark} light={light} className="w-44 mx-auto" />

      <div className="flex items-center justify-center gap-1 mt-2 text-muted-foreground">
        <StepBtn onClick={() => setPly(0)} disabled={at === 0} label="Start"><SkipBack size={14} /></StepBtn>
        <StepBtn onClick={() => step(-1)} disabled={at === 0} label="Previous"><ChevronLeft size={14} /></StepBtn>
        <span className="text-[11px] tabular-nums w-12 text-center">{at}/{last}</span>
        <StepBtn onClick={() => step(1)} disabled={at >= last} label="Next"><ChevronRight size={14} /></StepBtn>
        <StepBtn onClick={() => setPly(last)} disabled={at >= last} label="End"><SkipForward size={14} /></StepBtn>
      </div>

      <div className="flex gap-2 mt-2">
        <Button variant="secondary" className="flex-1 !py-1.5 text-sm" onClick={onLoad}>
          <Play size={13} className="inline mr-1.5 -mt-0.5" /> Load
        </Button>
        <Button
          className="flex-1 !py-1.5 text-sm"
          onClick={() => onAsk(fens[at])}
          title="Ask a quiz from the position shown: the live board is left alone"
        >
          <CircleHelp size={13} className="inline mr-1.5 -mt-0.5" /> Ask
        </Button>
      </div>
    </div>
  );
}

function StepBtn({
  onClick, disabled, label, children,
}: { onClick: () => void; disabled: boolean; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-7 h-7 rounded-btn border border-border bg-surface-1 hover:bg-surface-3 flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}
