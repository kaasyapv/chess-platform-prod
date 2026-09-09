"use client";

/* Classroom Settings — the shell knobs the reference exposes behind the gear:
 * layout (Classic vs Focus), board size, and sound-on-load. Board *appearance*
 * (theme / pieces / animation) is a separate modal (BoardSettingsModal). */

import { Modal } from "@/components/ui";
import { LayoutTemplate, Maximize2 } from "lucide-react";
import {
  BOARD_SCALE_MAX, BOARD_SCALE_MIN,
  type ClassroomPrefs,
} from "./use-classroom-prefs";

const LAYOUTS: { id: ClassroomPrefs["layout"]; label: string; blurb: string; Icon: typeof LayoutTemplate }[] = [
  { id: "classic", label: "Classic", blurb: "Sidebar on the right. Meeting inside the sidebar.", Icon: LayoutTemplate },
  { id: "focus", label: "Focus", blurb: "Toolbar & meeting float free. Larger chess board.", Icon: Maximize2 },
];

export function ClassroomSettingsModal({
  open, onClose, prefs, onChange,
}: {
  open: boolean;
  onClose: () => void;
  prefs: ClassroomPrefs;
  onChange: (patch: Partial<ClassroomPrefs>) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Classroom Settings">
      <div className="flex flex-col gap-6">
        <section>
          <p className="text-sm font-semibold mb-2">Classroom Layout</p>
          <div className="grid grid-cols-2 gap-3">
            {LAYOUTS.map(({ id, label, blurb, Icon }) => {
              const selected = prefs.layout === id;
              return (
                <button
                  key={id}
                  onClick={() => onChange({ layout: id })}
                  className={`flex flex-col gap-2 rounded-card border p-3 text-left transition-colors ${
                    selected ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "border-border hover:border-primary/60"
                  }`}
                >
                  <span className={`flex h-9 w-9 items-center justify-center rounded-btn ${selected ? "bg-primary text-primary-foreground" : "bg-surface-2"}`}>
                    <Icon size={18} />
                  </span>
                  <span className="font-medium">{label}</span>
                  <span className="text-xs text-muted-foreground">{blurb}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Layout preference is saved automatically on this device.</p>
          <p className="mt-1 text-xs text-warning">Focus mode suits larger screens; it can feel congested on smaller laptops.</p>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Chessboard Size</p>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums">
              {Math.round(prefs.boardScale * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={BOARD_SCALE_MIN} max={BOARD_SCALE_MAX} step={0.05}
            value={prefs.boardScale}
            onChange={(e) => onChange({ boardScale: Number(e.target.value) })}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Compact ({Math.round(BOARD_SCALE_MIN * 100)}%)</span>
            <span>Default (100%)</span>
            <span>Large ({Math.round(BOARD_SCALE_MAX * 100)}%)</span>
          </div>
        </section>

        <section className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Play Sound on Game Load</p>
            <p className="text-xs text-muted-foreground">A soft cue when a new position lands on the board.</p>
          </div>
          <button
            role="switch"
            aria-checked={prefs.soundOnLoad}
            onClick={() => onChange({ soundOnLoad: !prefs.soundOnLoad })}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${prefs.soundOnLoad ? "bg-primary" : "bg-surface-3"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${prefs.soundOnLoad ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </section>
      </div>
    </Modal>
  );
}
