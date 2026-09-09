"use client";

/* Coach-side state for a simul: one live position per student.
 *
 * Transport note (the "sub-channel" refactor): each student's game is a
 * logical sub-channel `class:<id>:game:<studentId>`, but it is carried as a
 * `simul_game` broadcast event keyed by `studentId` on the one existing
 * `class:<id>` channel - not as a real per-student private channel. Real
 * per-student channels would each need a matching realtime.messages RLS
 * policy, and this repo ships those to prod by hand; a channel that lands
 * before its policy goes dead for everyone (see use-classroom-channel.ts).
 * One authorized channel, N student keys, zero new policy.
 *
 * This hook is just the reducer + a stale sweep so a student who dropped off
 * fades from the grid. Wire `ingest` into `useClassroomChannel({ onSimulGame })`.
 */

import { useCallback, useEffect, useState } from "react";
import type { SimulGameState } from "./use-classroom-channel";

export type SimulBoard = SimulGameState & { updatedAt: number };

/** A board with no update for this long is dimmed as "away". */
const STALE_MS = 45_000;

export function useSimulBoards() {
  const [boards, setBoards] = useState<Record<string, SimulBoard>>({});
  const [, force] = useState(0);

  const ingest = useCallback((g: SimulGameState) => {
    setBoards((cur) => ({ ...cur, [g.studentId]: { ...g, updatedAt: Date.now() } }));
  }, []);

  const remove = useCallback((studentId: string) => {
    setBoards((cur) => {
      if (!cur[studentId]) return cur;
      const next = { ...cur };
      delete next[studentId];
      return next;
    });
  }, []);

  const clear = useCallback(() => setBoards({}), []);

  // Re-render every 15s so the "away" dimming updates without a new event.
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const list = Object.values(boards).sort((a, b) => a.name.localeCompare(b.name));
  const now = Date.now();
  const withStatus = list.map((b) => ({ ...b, away: now - b.updatedAt > STALE_MS }));

  return { boards: withStatus, ingest, remove, clear };
}
