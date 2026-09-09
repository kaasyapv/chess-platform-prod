"use client";

/* Board appearance settings - themes, piece sets, highlight colors, board
 * behaviour toggles, and one-click presets. Persisted per user in
 * profiles.board_settings (+ localStorage cache). */

import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";

export type LastMoveMode = "none" | "highlight" | "arrow";

export type BoardSettings = {
  boardTheme: string;
  pieceSet: string;
  lastMoves: LastMoveMode;
  legalMoves: "none" | "dots";
  sounds: boolean;
  premove: boolean;
  autoQueen: boolean;
  // Appearance / behaviour toggles
  autoFlip: boolean;
  coordinates: boolean;
  notation: boolean;         // show the move-list notation panel
  highlightChecks: boolean;
  pieceShadows: boolean;
  animation: boolean;        // piece move animation on/off
  smoothMoves: boolean;      // slow glide (150ms) vs snappy (60ms)
  dragAnimation: boolean;    // drag pieces (vs click-only)
  moveTrails: boolean;       // fading trail on the last move
  showCaptured: boolean;     // captured-pieces tray
  blindfold: boolean;        // hide the pieces, keep the move logic - play by memory
  boardZoom: number;         // 0.85 - 1.15
};

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  boardTheme: "academy-wood",
  pieceSet: "cburnett",
  lastMoves: "highlight",
  legalMoves: "dots",
  sounds: true,
  premove: true,
  autoQueen: false,
  autoFlip: false,
  coordinates: true,
  notation: true,
  highlightChecks: true,
  pieceShadows: false,
  animation: true,
  smoothMoves: true,
  dragAnimation: true,
  moveTrails: true,
  showCaptured: true,
  blindfold: false,
  boardZoom: 1,
};

/** Exact highlight colours (goal spec). Shared by board CSS and draw brushes. */
export const HIGHLIGHTS = {
  legal:        "#22C55E", // legal moves - green
  selected:     "#3B82F6", // selected square - blue
  lastMove:     "#FACC15", // last move - yellow
  check:        "#EF4444", // check - red
  engine:       "#06B6D4", // engine arrows - cyan
  coachArrow:   "#F97316", // coach arrows - orange
  studentArrow: "#A855F7", // student arrows - purple
  quiz:         "#FBBF24", // quiz - gold
} as const;

/** The wooden frame around the 8×8 grid is a fixed colour, not part of this
 *  list - see BOARD_FRAME_COLOR in components/board/chess-board.tsx. Only
 *  the square colours are theme-selectable. */
export const BOARD_THEMES: { id: string; label: string; dark: string; light: string }[] = [
  // Sampled pixel-for-pixel from the live reference classroom (computed square
  // background-color, 2026-09-08): light rgb(240,217,181), dark rgb(181,136,99).
  { id: "academy-wood", label: "Academy Wood", dark: "#B58863", light: "#F0D9B5" },
  { id: "classic-wood", label: "Classic Wood", dark: "#B58863", light: "#F0D9B5" },
  { id: "walnut",       label: "Walnut",       dark: "#8B5A2B", light: "#E7D2B8" },
  { id: "tournament",   label: "Tournament Green", dark: "#769656", light: "#EEEED2" },
  { id: "midnight",     label: "Midnight",     dark: "#1F2328", light: "#3E444D" },
  { id: "slate",        label: "Slate",        dark: "#4B5563", light: "#C8CDD5" },
  { id: "ocean",        label: "Ocean",        dark: "#4A90E2", light: "#D9EEF7" },
  { id: "royal-blue",   label: "Royal Blue",   dark: "#4062BB", light: "#DEE9FF" },
  { id: "purple-night", label: "Purple Night", dark: "#6D28D9", light: "#E9D8FD" },
  { id: "rose",         label: "Rose",         dark: "#E11D48", light: "#FFE4E6" },
  { id: "emerald",      label: "Emerald",      dark: "#15803D", light: "#DCFCE7" },
  { id: "sand",         label: "Sand",         dark: "#D4A373", light: "#FAF3DD" },
  { id: "carbon",       label: "Carbon Black", dark: "#121212", light: "#2A2A2A" },
];

/* 12 real piece sets, drawn with the artwork Lichess serves. The id is also the
 * folder name on the asset server (see components/board/piece-sets.ts).
 * Lichess has no set called "Staunton" - its classic set is named "Staunty". */
export const PIECE_SETS: { id: string; label: string }[] = [
  { id: "cburnett",   label: "cburnett" },
  { id: "merida",     label: "Merida" },
  { id: "alpha",      label: "Alpha" },
  { id: "staunty",    label: "Staunty" },
  { id: "california", label: "California" },
  { id: "leipzig",    label: "Leipzig" },
  { id: "maestro",    label: "Maestro" },
  { id: "fantasy",    label: "Fantasy" },
  { id: "cardinal",   label: "Cardinal" },
  { id: "gioco",      label: "Gioco" },
  { id: "governor",   label: "Governor" },
  { id: "horsey",     label: "Horsey" },
];

/** One-click presets (goal spec). Partial patches over current settings. */
export const PRESETS: { id: string; label: string; patch: Partial<BoardSettings> }[] = [
  { id: "tournament", label: "Tournament", patch: {
    boardTheme: "tournament", pieceSet: "cburnett", coordinates: true,
    animation: true, smoothMoves: false, moveTrails: false, pieceShadows: false } },
  { id: "academy", label: "Academy (Default)", patch: {
    boardTheme: "walnut", pieceSet: "merida", coordinates: true,
    animation: true, smoothMoves: true, moveTrails: true, showCaptured: true } },
  { id: "midnight", label: "Midnight", patch: {
    boardTheme: "carbon", pieceSet: "maestro", coordinates: true,
    animation: true, smoothMoves: true, pieceShadows: true } },
  { id: "kids", label: "Kids", patch: {
    boardTheme: "ocean", pieceSet: "horsey", coordinates: true,
    legalMoves: "dots", animation: true, smoothMoves: true, boardZoom: 1.1 } },
  { id: "premium", label: "Premium", patch: {
    boardTheme: "slate", pieceSet: "cardinal", coordinates: true,
    animation: true, smoothMoves: true, moveTrails: true, pieceShadows: true } },
];

/** The board look every demo classroom opens with (goal spec). */
export const CLASSROOM_DEMO_DEFAULT: Partial<BoardSettings> = {
  boardTheme: "academy-wood", pieceSet: "cburnett", animation: true, smoothMoves: true,
  coordinates: true, moveTrails: true, legalMoves: "dots", lastMoves: "highlight",
  showCaptured: true,
};

/** Themes students unlock with coins (staff always have everything). */
export const PREMIUM_THEMES = ["purple-night", "rose", "emerald", "carbon"];
export const THEME_COST = 30;

const LS_KEY = "board-settings";

/** Settings saved before the rebrand still name the old theme id. */
function migrate(s: Partial<BoardSettings>): Partial<BoardSettings> {
  return s.boardTheme === "chessbrainz" ? { ...s, boardTheme: "academy-wood" } : s;
}

function readLocal(): BoardSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_BOARD_SETTINGS, ...migrate(JSON.parse(raw)) };
  } catch { /* SSR / corrupt */ }
  return DEFAULT_BOARD_SETTINGS;
}

/** Load-once, save-everywhere hook. `update` is a pure synchronous state
 *  change, so toggles feel instant; persistence (localStorage + the profile
 *  row) runs in a debounced effect off the render path. */
export function useBoardSettings() {
  const [settings, setSettings] = useState<BoardSettings>(DEFAULT_BOARD_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSettings(readLocal());
    setLoaded(true);
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) return;
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase
        .from("profiles").select("board_settings").eq("id", user.id).single();
      if (data?.board_settings && Object.keys(data.board_settings).length) {
        setSettings((s) => ({ ...s, ...migrate(data.board_settings) }));
      }
    });
  }, []);

  // Persist off the click path: localStorage right away, the DB row debounced.
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith("http")) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return;
        supabase.from("profiles").update({ board_settings: settings }).eq("id", user.id)
          .then(({ error }) => { if (error) console.error("save board settings:", error.message); });
      });
    }, 500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [settings, loaded]);

  // Pure, instant state update - no I/O on the click.
  const update = useCallback((patch: Partial<BoardSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  return { settings, update, loaded };
}
