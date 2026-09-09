"use client";

/* "Customize Position" - the full board/FEN editor behind the classroom
 * toolbar's grid icon (Clone_reference/Classroom_Report.docx, Figure 12).
 *
 * Layout confirmed against the live reference (playmate.chessbrainz.in coach
 * classroom → grid icon): a black piece rail directly ABOVE the board, a white
 * piece rail directly BELOW it - not flanking rails either side. "Preloaded
 * Positions" is not a canned list: on the reference it is an empty state
 * ("No saved positions yet. Save a position from the setup board"), i.e. the
 * Save button on General pushes the current position onto a per-coach saved
 * list, and this tab lists it back. There is no backing table for that yet, so
 * it lives in localStorage, keyed per classroom.
 *
 * The Gamified Board tab reuses the exact same board + piece rails as General
 * (extracted into <SetupBoard>) with one addition: a per-square icon overlay
 * (food / toys / animals / rewards / emoji stickers, or an obstacle block),
 * armed from the right column and placed with the same click-a-tool,
 * click-a-square flow as pieces. Icons aren't part of a FEN, so they live in
 * their own square-indexed map and are cleared independently of the pieces. */

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { pieceUrl, type PieceKind } from "@/components/board/piece-sets";
import { START_FEN } from "@/lib/pgn";
import { Button, Input, Modal } from "@/components/ui";
import { GAMIFIED_CATEGORIES, BLOCKS_ITEMS, GamifiedIcon } from "@/lib/gamified-icons";

type Cell = string | null; // a FEN piece letter: P N B R Q K / p n b r q k
type PieceTool = { kind: string; color: "w" | "b" };
/** `id` is a gamified-icons.tsx key (e.g. "burger", "brick") - it used to be
 *  the emoji character itself; the on-board/FEN-adjacent pipeline only ever
 *  cared that it's a stable string, so swapping the glyph for an SVG icon
 *  didn't need to touch the square-indexed map's shape. */
type IconTool = { kind: "icon" | "block"; id: string };
type Tool = PieceTool | IconTool | "erase" | null;
type SavedPosition = { id: string; fen: string; savedAt: number };

const KINDS = ["p", "n", "b", "r", "q", "k"] as const;
const EMPTY: Cell[] = Array(64).fill(null);
const TABS = ["General", "Gamified Board", "Preloaded Positions"] as const;

const savedKey = (classroomId: string) => `setup-positions:${classroomId}`;

function loadSavedPositions(classroomId: string): SavedPosition[] {
  try { return JSON.parse(localStorage.getItem(savedKey(classroomId)) ?? "[]"); }
  catch { return []; }
}

/** A short human label from the position itself - piece count + side to move -
 *  since these aren't user-named, just captured off the board. */
function describePosition(fen: string): string {
  const pieces = fen.split(" ")[0].replace(/[^a-zA-Z]/g, "").length;
  const side = fen.split(" ")[1] === "b" ? "Black" : "White";
  return `${pieces}-piece position, ${side} to move`;
}

// ── FEN ⇄ board array ────────────────────────────────────────────────────────

function fenToCells(fen: string): Cell[] {
  const cells: Cell[] = [];
  for (const ch of fen.split(" ")[0]) {
    if (ch === "/") continue;
    if (/\d/.test(ch)) cells.push(...Array(Number(ch)).fill(null));
    else cells.push(ch);
  }
  return cells.length === 64 ? cells : [...EMPTY];
}

function cellsToFen(cells: Cell[], turn: "w" | "b", castling: Record<string, boolean>): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let row = "", gap = 0;
    for (let f = 0; f < 8; f++) {
      const c = cells[r * 8 + f];
      if (c) { if (gap) { row += gap; gap = 0; } row += c; }
      else gap++;
    }
    if (gap) row += gap;
    rows.push(row);
  }
  const rights = ["K", "Q", "k", "q"].filter((k) => castling[k]).join("") || "-";
  return `${rows.join("/")} ${turn} ${rights} - 0 1`;
}

/** Square index (0-63, rank-major from a8) -> algebraic notation, e.g. 0 -> "a8". */
function indexToSquare(i: number): string {
  return `${"abcdefgh"[i % 8]}${8 - Math.floor(i / 8)}`;
}

/** Castling rights are only real if the king and the matching rook are home. */
function legalCastling(cells: Cell[], want: Record<string, boolean>): Record<string, boolean> {
  const at = (sq: string) => {
    const f = "abcdefgh".indexOf(sq[0]);
    const r = 8 - Number(sq[1]);
    return cells[r * 8 + f];
  };
  return {
    K: want.K && at("e1") === "K" && at("h1") === "R",
    Q: want.Q && at("e1") === "K" && at("a1") === "R",
    k: want.k && at("e8") === "k" && at("h8") === "r",
    q: want.q && at("e8") === "k" && at("a8") === "r",
  };
}

function isIconTool(t: Tool): t is IconTool {
  return !!t && typeof t === "object" && (t.kind === "icon" || t.kind === "block");
}

function pieceChar(t: PieceTool): string {
  return t.color === "w" ? t.kind.toUpperCase() : t.kind;
}

// ── component ────────────────────────────────────────────────────────────────

export function CustomizePosition({
  open, onClose, classroomId, fen, gamify, onGamify, onApply,
}: {
  open: boolean; onClose: () => void; classroomId: string; fen: string;
  gamify: boolean; onGamify: (on: boolean) => void;
  onApply: (fen: string, icons: Record<string, string>) => void;
}) {
  const [tab, setTab] = useState<string>(TABS[0]);
  const [cells, setCells] = useState<Cell[]>(EMPTY);
  const [icons, setIcons] = useState<Record<number, string>>({});
  const [iconCategory, setIconCategory] = useState<string>(GAMIFIED_CATEGORIES[0].id);
  const [turn, setTurn] = useState<"w" | "b">("w");
  const [castling, setCastling] = useState({ K: true, Q: true, k: true, q: true });
  const [tool, setTool] = useState<Tool>(null);
  const [fenInput, setFenInput] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState<SavedPosition[]>([]);

  // Re-seed from the live board every time the editor opens.
  useEffect(() => {
    if (!open) return;
    setCells(fenToCells(fen));
    setIcons({});
    setTurn(fen.split(" ")[1] === "b" ? "b" : "w");
    const rights = fen.split(" ")[2] ?? "-";
    setCastling({ K: rights.includes("K"), Q: rights.includes("Q"), k: rights.includes("k"), q: rights.includes("q") });
    setFenInput(fen);
    setTool(null);
    setInvalid(false);
    setTab(TABS[0]);
    setSaved(loadSavedPositions(classroomId));
  }, [open, fen, classroomId]);

  function savePosition(f: string) {
    const next = [{ id: crypto.randomUUID(), fen: f, savedAt: Date.now() }, ...saved].slice(0, 30);
    setSaved(next);
    try { localStorage.setItem(savedKey(classroomId), JSON.stringify(next)); } catch { /* private mode */ }
  }

  function deleteSaved(id: string) {
    const next = saved.filter((p) => p.id !== id);
    setSaved(next);
    try { localStorage.setItem(savedKey(classroomId), JSON.stringify(next)); } catch { /* private mode */ }
  }

  const current = cellsToFen(cells, turn, legalCastling(cells, castling));
  // Square-keyed for the boundary out to onApply - SetupBoard's own rendering
  // stays index-keyed.
  const squareIcons = Object.fromEntries(
    Object.entries(icons).map(([i, e]) => [indexToSquare(Number(i)), e]),
  );

  function paint(i: number) {
    if (!tool) return;
    if (tool === "erase") {
      setCells((c) => c.map((v, idx) => (idx === i ? null : v)));
      return;
    }
    if (isIconTool(tool)) {
      setIcons((prev) => {
        const next = { ...prev };
        if (next[i] === tool.id) delete next[i]; else next[i] = tool.id;
        return next;
      });
      return;
    }
    setCells((c) => c.map((v, idx) => (idx === i ? pieceChar(tool) : v)));
  }

  /** Drag a piece (from the rail, or an already-placed square) onto square i.
   *  `from` is the origin square index when dragging off the board, or null
   *  when dragging fresh off a rail - only then does the origin get cleared. */
  function dropPiece(i: number, piece: string, from: number | null) {
    if (piece === "erase") { setCells((cs) => cs.map((v, k) => (k === i ? null : v))); return; }
    if (!piece) return;
    setCells((cs) => cs.map((v, k) => (k === i ? piece : (from !== null && k === from ? null : v))));
  }

  function loadFen(text: string) {
    const cs = fenToCells(text.trim());
    if (cs.every((c) => c === null) && !/8\/8\/8\/8\/8\/8\/8\/8/.test(text)) { setInvalid(true); return; }
    setInvalid(false);
    setCells(cs);
    setTurn(text.split(" ")[1] === "b" ? "b" : "w");
    const rights = text.split(" ")[2] ?? "-";
    setCastling({ K: rights.includes("K"), Q: rights.includes("Q"), k: rights.includes("k"), q: rights.includes("q") });
  }

  return (
    <Modal open={open} onClose={onClose} title="Setup Position" wide>
      <div className="flex gap-1 mb-4">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-btn text-sm font-medium transition-colors ${
              t === tab ? "bg-surface-1 text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "General" && (
        <div className="flex flex-col md:flex-row gap-6">
          <SetupBoard cells={cells} tool={tool} onPick={setTool} onPaint={paint} onDropPiece={dropPiece} />

          {/* RIGHT: Controls */}
          <div className="flex flex-col gap-4 flex-1 min-w-0">
            <div className="flex gap-2">
              <Input className="flex-1 font-mono text-xs" placeholder="Enter FEN position (e.g., 8/8/8/…)"
                value={fenInput} onChange={(e) => { setFenInput(e.target.value); setInvalid(false); }}
                onKeyDown={(e) => e.key === "Enter" && loadFen(fenInput)} />
              <Button onClick={() => loadFen(fenInput)}>Load</Button>
            </div>
            {invalid && <p className="text-xs text-destructive -mt-2">That is not a valid FEN.</p>}

            <TurnToggle turn={turn} setTurn={setTurn} />

            {(["White", "Black"] as const).map((side) => {
              const [ks, qs] = side === "White" ? (["K", "Q"] as const) : (["k", "q"] as const);
              return (
                <div key={side}>
                  <p className="text-sm mb-1">{side}:</p>
                  <div className="flex gap-4">
                    {[ks, qs].map((k) => (
                      <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={castling[k]} className="accent-[var(--primary)]"
                          onChange={(e) => setCastling((c) => ({ ...c, [k]: e.target.checked }))} />
                        {k.toLowerCase() === "k" ? "O-O" : "O-O-O"}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => loadFen(START_FEN)}>↺ Reset</Button>
              <Button variant="secondary" onClick={() => setCells([...EMPTY])}>⊘ Clear board</Button>
            </div>

            <p className="text-xs text-muted-foreground font-mono break-all">{current}</p>

            <div className="flex justify-end gap-2 mt-auto">
              <Button variant="secondary" onClick={() => savePosition(current)}>Save</Button>
              <Button onClick={() => { onApply(current, squareIcons); onClose(); }}>Load Fen</Button>
            </div>
          </div>
        </div>
      )}

      {tab === "Gamified Board" && (
        <div className="flex flex-col md:flex-row gap-6">
          <SetupBoard cells={cells} icons={icons} tool={tool} onPick={setTool} onPaint={paint} onDropPiece={dropPiece} />

          {/* RIGHT: gamified controls */}
          <div className="flex flex-col gap-4 flex-1 min-w-0">
            <TurnToggle turn={turn} setTurn={setTurn} />

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={gamify} className="accent-[var(--primary)]"
                onChange={(e) => onGamify(e.target.checked)} />
              Turn on gamified board for everyone in this class
            </label>

            <div>
              <p className="text-sm mb-1.5">Gamified Icons</p>
              <div className="flex gap-1 mb-2">
                {GAMIFIED_CATEGORIES.map((cat) => (
                  <button key={cat.id} onClick={() => setIconCategory(cat.id)}
                    title={cat.label}
                    className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-btn text-xs font-medium transition-colors ${
                      iconCategory === cat.id ? "bg-surface-1 text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}>
                    <span className="w-5 h-5"><GamifiedIcon id={cat.icon} /></span>
                    {cat.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap">
                {GAMIFIED_CATEGORIES.find((c) => c.id === iconCategory)!.items.map((item) => (
                  <button key={item.id} onClick={() => setTool({ kind: "icon", id: item.id })}
                    title={item.label}
                    className={`w-11 h-11 rounded-btn border flex items-center justify-center p-2 transition-transform hover:scale-110 active:scale-95 ${
                      isIconTool(tool) && tool.kind === "icon" && tool.id === item.id
                        ? "border-primary bg-primary/15" : "border-border bg-surface-1 hover:bg-surface-3"
                    }`}>
                    <GamifiedIcon id={item.id} />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm mb-1.5">Blocks Icons</p>
              <div className="flex gap-2 flex-wrap">
                {BLOCKS_ITEMS.map((item) => (
                  <button key={item.id} onClick={() => setTool({ kind: "block", id: item.id })}
                    title={item.label}
                    className={`w-11 h-11 rounded-btn border flex items-center justify-center p-2 transition-transform hover:scale-110 active:scale-95 ${
                      isIconTool(tool) && tool.kind === "block" && tool.id === item.id
                        ? "border-primary bg-primary/15" : "border-border bg-surface-1 hover:bg-surface-3"
                    }`}>
                    <GamifiedIcon id={item.id} />
                  </button>
                ))}
              </div>
            </div>

            <Button variant="secondary" className="self-start" onClick={() => setIcons({})}>⊘ Clear board</Button>

            <div className="flex justify-end gap-2 mt-auto">
              <Button variant="secondary" onClick={() => savePosition(current)}>Save</Button>
              <Button onClick={() => { onApply(current, squareIcons); onClose(); }}>Load Fen</Button>
            </div>
          </div>
        </div>
      )}

      {tab === "Preloaded Positions" && (
        <div className="flex flex-col">
          {saved.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No saved positions yet. Save a position from the setup board.
            </p>
          ) : (
            saved.map((p) => (
              <div key={p.id}
                className="flex items-center gap-2 px-3 py-2.5 rounded-btn hover:bg-surface-2 border-b border-border last:border-0">
                <button onClick={() => { onApply(p.fen, {}); onClose(); }} className="text-left flex-1 min-w-0">
                  <p className="text-sm font-medium">{describePosition(p.fen)}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">{p.fen}</p>
                </button>
                <button onClick={() => deleteSaved(p.id)} title="Delete this saved position"
                  className="shrink-0 p-1.5 rounded-btn text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </Modal>
  );
}

function TurnToggle({ turn, setTurn }: { turn: "w" | "b"; setTurn: (t: "w" | "b") => void }) {
  return (
    <div>
      <p className="text-sm mb-1.5">White/Black to move:</p>
      <div className="flex gap-2">
        {(["w", "b"] as const).map((t) => (
          <button key={t} onClick={() => setTurn(t)}
            className={`px-4 py-1.5 rounded-btn text-sm font-medium border transition-colors ${
              turn === t ? "bg-primary border-primary text-primary-foreground" : "border-border hover:bg-surface-2"
            }`}>
            {t === "w" ? "White" : "Black"}
          </button>
        ))}
      </div>
    </div>
  );
}

/* LEFT column: the setup board. A horizontal Black piece rail sits directly
 * ABOVE the board, a horizontal White rail directly BELOW it - each ending in
 * the erase tool (confirmed against the live reference's Customize Position
 * modal). Click a piece to arm it and click squares to place, or drag
 * straight from the rail onto a square. Drag a piece off the board to remove
 * it. Shared by General and Gamified Board so both tabs edit the same board;
 * Gamified Board additionally passes `icons` to render the sticker/obstacle
 * overlay armed from its right-column palette. */
function SetupBoard({
  cells, icons, tool, onPick, onPaint, onDropPiece,
}: {
  cells: Cell[]; icons?: Record<number, string>;
  tool: Tool; onPick: (t: Tool) => void; onPaint: (i: number) => void;
  onDropPiece: (i: number, piece: string, from: number | null) => void;
}) {
  return (
    <div className="shrink-0 flex flex-col items-center gap-2 mx-auto">
      <Palette color="b" tool={tool} onPick={onPick} />
      <div
        className="grid grid-cols-8 grid-rows-8 w-[min(60vw,18rem)] aspect-square rounded-btn overflow-hidden border-4"
        style={{ borderColor: "var(--board-frame)" }}
        onDragOver={(e) => e.preventDefault()}
      >
        {cells.map((c, i) => {
          const dark = (Math.floor(i / 8) + i) % 2 === 1;
          return (
            <button
              key={i}
              onClick={() => onPaint(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const piece = e.dataTransfer.getData("text/piece");
                const fromRaw = e.dataTransfer.getData("text/from");
                onDropPiece(i, piece, fromRaw === "" ? null : Number(fromRaw));
              }}
              draggable={!!c}
              onDragStart={(e) => {
                if (!c) return;
                e.dataTransfer.setData("text/piece", c);
                e.dataTransfer.setData("text/from", String(i));
              }}
              onDragEnd={(e) => {
                // Dropped outside the board: the piece is gone.
                if (e.dataTransfer.dropEffect === "none") onDropPiece(i, "erase", null);
              }}
              className="relative transition-[filter] hover:brightness-110"
              style={{ background: dark ? "var(--board-dark)" : "var(--board-light)" }}
            >
              {c && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pieceUrl("cburnett", c.toLowerCase() as PieceKind, c === c.toUpperCase() ? "w" : "b")}
                  alt="" draggable={false} className="absolute inset-0 w-full h-full p-[4%] pointer-events-none" />
              )}
              {icons?.[i] && (
                <span className="absolute bottom-0.5 right-0.5 w-[38%] h-[38%] pointer-events-none drop-shadow">
                  <GamifiedIcon id={icons[i]} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <Palette color="w" tool={tool} onPick={onPick} />
      <p className="text-xs text-muted-foreground">Click to place · drag a piece on or off the board</p>
    </div>
  );
}

function Palette({
  color, tool, onPick,
}: { color: "w" | "b"; tool: Tool; onPick: (t: Tool) => void }) {
  const picked = (kind: string) => !!tool && typeof tool === "object" && "color" in tool && tool.color === color && tool.kind === kind;
  return (
    <div className="flex gap-1">
      {KINDS.map((kind) => (
        <button key={kind} onClick={() => onPick({ kind, color })}
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/piece", color === "w" ? kind.toUpperCase() : kind)}
          title={`Place a ${color === "w" ? "white" : "black"} ${kind}: click, or drag onto a square`}
          className={`w-11 h-11 rounded-btn border flex items-center justify-center transition-transform hover:scale-110 active:scale-95 cursor-grab ${
            picked(kind) ? "border-primary bg-primary/15" : "border-border bg-surface-1 hover:bg-surface-3"
          }`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pieceUrl("cburnett", kind, color)} alt={kind} draggable={false} className="w-9 h-9 pointer-events-none" />
        </button>
      ))}
      <button onClick={() => onPick("erase")}
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/piece", "erase")}
        title="Erase a square: click, or drag onto a piece"
        className={`w-11 h-11 rounded-btn border flex items-center justify-center transition-transform hover:scale-110 active:scale-95 cursor-grab ${
          tool === "erase" ? "border-primary bg-primary/15 text-primary-hover" : "border-border bg-surface-1 hover:bg-surface-3"
        }`}>
        <Trash2 size={18} />
      </button>
    </div>
  );
}
