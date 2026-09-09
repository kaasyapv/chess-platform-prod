"use client";

/* Board settings modal - one-click presets, 12 board themes, 12 piece sets,
 * highlight-colour preview, and every appearance / behaviour toggle. Persisted
 * per user via the parent's onChange. */

import { Lock } from "lucide-react";
import { Modal, SegmentedTabs } from "@/components/ui";
import {
  BOARD_THEMES, PIECE_SETS, PRESETS, HIGHLIGHTS,
  type BoardSettings, type LastMoveMode,
} from "@/lib/board-settings";
import { pieceUrl } from "./piece-sets";

export function BoardSettingsModal({
  open, onClose, settings, onChange, lockedThemes,
}: {
  open: boolean;
  onClose: () => void;
  settings: BoardSettings;
  onChange: (patch: Partial<BoardSettings>) => void;
  /** Theme ids this user hasn't unlocked yet (students earn them with coins). */
  lockedThemes?: string[];
}) {
  return (
    <Modal open={open} onClose={onClose} title="Board settings">
      <div className="flex flex-col gap-5 max-h-[70vh] overflow-y-auto pr-1">
        {/* Presets */}
        <section>
          <p className="text-sm text-muted-foreground mb-2">Presets</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => onChange(p.patch)}
                className="rounded-btn border border-border bg-surface-1 hover:bg-surface-3 hover:border-primary px-3 py-1.5 text-sm font-medium transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </section>

        {/* Board theme grid */}
        <section>
          <p className="text-sm text-muted-foreground mb-2">Board theme</p>
          <div className="grid grid-cols-4 gap-2">
            {BOARD_THEMES.map((t) => {
              const locked = lockedThemes?.includes(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => (locked ? undefined : onChange({ boardTheme: t.id }))}
                  title={locked ? "Unlock this theme with coins in your profile" : t.label}
                  className={`relative rounded-btn p-1.5 border transition-all text-left ${
                    settings.boardTheme === t.id ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/60"
                  } ${locked ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <Swatch dark={t.dark} light={t.light} />
                  <span className="flex items-center gap-1 text-[11px] mt-1 truncate">{locked && <Lock size={10} className="shrink-0" />}{t.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Piece set grid */}
        <section>
          <p className="text-sm text-muted-foreground mb-2">Piece set</p>
          <div className="grid grid-cols-4 gap-2">
            {PIECE_SETS.map((p) => (
              <button
                key={p.id}
                onClick={() => onChange({ pieceSet: p.id })}
                className={`rounded-btn p-1.5 border transition-all flex flex-col items-center gap-1 ${
                  settings.pieceSet === p.id ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/60"
                }`}
              >
                <span className="w-8 h-8 flex items-center justify-center">
                  {/* The real knight from this set, so each button looks different */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pieceUrl(p.id, "n", "w")} alt={`${p.label} knight`} className="w-8 h-8" />
                </span>
                <span className="block text-[11px] truncate w-full text-center">{p.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Segmented controls */}
        <section className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">Last move</p>
            <SegmentedTabs
              tabs={["None", "Highlight", "Arrow"]}
              active={cap(settings.lastMoves)}
              onChange={(t) => onChange({ lastMoves: t.toLowerCase() as LastMoveMode })}
            />
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-2">Legal moves</p>
            <SegmentedTabs
              tabs={["None", "Dots"]}
              active={cap(settings.legalMoves)}
              onChange={(t) => onChange({ legalMoves: t.toLowerCase() as "none" | "dots" })}
            />
          </div>
        </section>

        {/* Board zoom */}
        <section>
          <p className="text-sm text-muted-foreground mb-2">Board zoom: {Math.round(settings.boardZoom * 100)}%</p>
          <input
            type="range" min={0.85} max={1.15} step={0.05} value={settings.boardZoom}
            onChange={(e) => onChange({ boardZoom: Number(e.target.value) })}
            className="w-full accent-[color:var(--primary)]"
          />
        </section>

        {/* Toggles */}
        <section className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Toggle label="Auto flip" checked={settings.autoFlip} onChange={(v) => onChange({ autoFlip: v })} />
          <Toggle label="Coordinates" checked={settings.coordinates} onChange={(v) => onChange({ coordinates: v })} />
          <Toggle label="Notation panel" checked={settings.notation} onChange={(v) => onChange({ notation: v })} />
          <Toggle label="Legal move dots" checked={settings.legalMoves === "dots"} onChange={(v) => onChange({ legalMoves: v ? "dots" : "none" })} />
          <Toggle label="Move trails" checked={settings.moveTrails} onChange={(v) => onChange({ moveTrails: v })} />
          <Toggle label="Last move" checked={settings.lastMoves !== "none"} onChange={(v) => onChange({ lastMoves: v ? "highlight" : "none" })} />
          <Toggle label="Highlight checks" checked={settings.highlightChecks} onChange={(v) => onChange({ highlightChecks: v })} />
          <Toggle label="Piece shadows" checked={settings.pieceShadows} onChange={(v) => onChange({ pieceShadows: v })} />
          <Toggle label="Piece animation" checked={settings.animation} onChange={(v) => onChange({ animation: v })} />
          <Toggle label="Smooth moves" checked={settings.smoothMoves} onChange={(v) => onChange({ smoothMoves: v })} />
          <Toggle label="Drag animation" checked={settings.dragAnimation} onChange={(v) => onChange({ dragAnimation: v })} />
          <Toggle label="Premoves" checked={settings.premove} onChange={(v) => onChange({ premove: v })} />
          <Toggle label="Show captured pieces" checked={settings.showCaptured} onChange={(v) => onChange({ showCaptured: v })} />
          <Toggle label="Sounds" checked={settings.sounds} onChange={(v) => onChange({ sounds: v })} />
          <Toggle label="Auto-Queen" checked={settings.autoQueen} onChange={(v) => onChange({ autoQueen: v })} />
        </section>

        {/* Blindfold - its own row so it can carry a hint the grid toggles can't */}
        <section>
          <Toggle label="Blindfold" checked={settings.blindfold} onChange={(v) => onChange({ blindfold: v })} />
          <p className="text-xs text-muted-foreground mt-1">Hide the pieces — play by memory. Move logic stays on.</p>
        </section>

        {/* Highlight colour legend */}
        <section>
          <p className="text-sm text-muted-foreground mb-2">Highlight colours</p>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {Object.entries({
              "Legal": HIGHLIGHTS.legal, "Selected": HIGHLIGHTS.selected, "Last move": HIGHLIGHTS.lastMove,
              "Check": HIGHLIGHTS.check, "Engine": HIGHLIGHTS.engine, "Coach arrow": HIGHLIGHTS.coachArrow,
              "Student arrow": HIGHLIGHTS.studentArrow, "Quiz": HIGHLIGHTS.quiz,
            }).map(([label, color]) => (
              <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5">
                <span className="w-3 h-3 rounded-full" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function Swatch({ dark, light }: { dark: string; light: string }) {
  return (
    <span className="inline-grid grid-cols-4 rounded overflow-hidden w-full aspect-square border border-border/50">
      {Array.from({ length: 16 }, (_, i) => {
        const r = Math.floor(i / 4);
        return <span key={i} style={{ background: (r + i) % 2 ? dark : light, aspectRatio: "1" }} />;
      })}
    </span>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer gap-2">
      <span className="text-sm font-medium">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${checked ? "bg-primary" : "bg-surface-2 border border-border"}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}
