"use client";

/* Sandbox: the full gamified-board pipeline, wired exactly like the classroom
 * but with local state and a visible "broadcast" log in place of the realtime
 * channel. Exercises every functional requirement end to end:
 *
 *   1. shelf icon click → active tool          (inside CustomizePosition)
 *   2. click a setup square → icon placed      (inside CustomizePosition)
 *   3. Load Fen → square→icon map + FEN out    (onApply)
 *   4. icons render over the real chessground  (ChessBoard `icons` prop)
 *   5. survive a board flip                    (Flip button)
 *   6. what the realtime channel would carry   (log panel)
 *
 * The apply() below is the same decision the classroom's setPosition makes
 * after the fix: a position chess.js rejects (gamified setups usually have no
 * kings) still loads - rendered and broadcast in free-move mode - and only a
 * FEN that isn't even board-shaped is refused. */

import { useState } from "react";
import { Chess } from "chess.js";
import { ChessBoard } from "@/components/board/chess-board";
import { CustomizePosition } from "@/components/class/customize-position";
import { isRenderableFen } from "@/lib/chess-pure";
import { START_FEN } from "@/lib/pgn";
import { Button } from "@/components/ui";

export function GamifiedPipeline() {
  const [fen, setFen] = useState(START_FEN);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [free, setFree] = useState(false);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [open, setOpen] = useState(false);
  const [gamify, setGamify] = useState(true);
  const [log, setLog] = useState<string[]>([]);

  function apply(newFen: string, newIcons: Record<string, string>) {
    let legal = true;
    try { new Chess(newFen); } catch { legal = false; }
    if (!legal && !isRenderableFen(newFen)) {
      setLog((l) => [...l, "Refused: not board-shaped"]);
      return;
    }
    setFen(newFen);
    setIcons(newIcons);
    setFree(!legal);
    setLog((l) => [...l,
      `→ broadcast free=${!legal} icons={${Object.entries(newIcons).map(([sq, e]) => `${sq}:${e}`).join(" ")}} fen=${newFen}`,
    ]);
  }

  return (
    <div className="flex flex-col md:flex-row gap-6 items-start">
      <div style={{ width: 420, height: 420 }}>
        <ChessBoard fen={fen} icons={icons} orientation={orientation}
          movable free={free} coordinates />
      </div>

      <div className="flex flex-col gap-3 flex-1 min-w-0">
        <div className="flex gap-2">
          <Button onClick={() => setOpen(true)}>Setup Position</Button>
          <Button variant="secondary"
            onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}>
            Flip board ({orientation})
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Setup Position → Gamified Board tab → click an icon, click squares, Load Fen.
          The icons must land on the board above and stay on their squares when flipped.
        </p>
        <div className="text-xs font-mono bg-surface-1 rounded-btn p-3 max-h-64 overflow-auto flex flex-col gap-1">
          {log.length === 0 ? <span className="text-muted-foreground">broadcast log: empty</span>
            : log.map((line, i) => <span key={i} className="break-all">{line}</span>)}
        </div>
      </div>

      <CustomizePosition open={open} onClose={() => setOpen(false)}
        classroomId="sandbox" fen={fen}
        gamify={gamify} onGamify={setGamify}
        onApply={apply} />
    </div>
  );
}
