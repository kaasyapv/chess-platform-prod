"use client";

/* Per-user classroom presentation preferences — layout (Classic vs Focus),
 * board size, and whether a sound plays when a new position loads.
 *
 * ponytail: localStorage only. The reference persists these "automatically
 * across sessions" per browser; a profile-row sync is a follow-up, not a
 * blocker. Board *appearance* (theme, pieces, animation) already lives in
 * profiles.board_settings via useBoardSettings — this hook is only the
 * classroom shell's layout knobs. */

import { useCallback, useEffect, useState } from "react";

export type ClassroomLayout = "classic" | "focus";

export type ClassroomPrefs = {
  /** classic = right sidebar holds the meeting; focus = larger board, meeting
   *  and toolbar float free (drawer). */
  layout: ClassroomLayout;
  /** Board size multiplier, 0.5–1.25. Applied on top of the global board zoom. */
  boardScale: number;
  /** Play a soft cue when a game/position is loaded onto the board. */
  soundOnLoad: boolean;
};

export const DEFAULT_CLASSROOM_PREFS: ClassroomPrefs = {
  layout: "classic",
  boardScale: 1,
  soundOnLoad: true,
};

export const BOARD_SCALE_MIN = 0.5;
export const BOARD_SCALE_MAX = 1.25;

const LS_KEY = "classroom-prefs";

export function clampScale(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 1;
  return Math.min(BOARD_SCALE_MAX, Math.max(BOARD_SCALE_MIN, n));
}

/** Pure: coerce an untrusted stored blob into valid prefs. soundOnLoad defaults
 *  ON — only an explicit `false` turns it off. */
export function normalizePrefs(p: Partial<ClassroomPrefs> | null | undefined): ClassroomPrefs {
  if (!p || typeof p !== "object") return DEFAULT_CLASSROOM_PREFS;
  return {
    layout: p.layout === "focus" ? "focus" : "classic",
    boardScale: clampScale(p.boardScale),
    soundOnLoad: p.soundOnLoad !== false,
  };
}

function read(): ClassroomPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return normalizePrefs(JSON.parse(raw) as Partial<ClassroomPrefs>);
  } catch {
    /* SSR / private mode / corrupt — fall through to default */
  }
  return DEFAULT_CLASSROOM_PREFS;
}

export function useClassroomPrefs() {
  const [prefs, setPrefs] = useState<ClassroomPrefs>(DEFAULT_CLASSROOM_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setPrefs(read());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore — nothing we can do if storage is blocked */
    }
  }, [prefs, loaded]);

  const update = useCallback((patch: Partial<ClassroomPrefs>) => {
    setPrefs((prev) => ({
      ...prev,
      ...patch,
      ...(patch.boardScale !== undefined ? { boardScale: clampScale(patch.boardScale) } : null),
    }));
  }, []);

  return { prefs, update, loaded };
}
