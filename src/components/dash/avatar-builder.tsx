"use client";

/* DiceBear avatar customiser - the "seed explorer" flow.
 *
 * Two axes and nothing else: pick a style, then shuffle seeds until you like
 * one. Seed is what makes it deterministic - the same style+seed always draws
 * the same face, so the choice can be stored as one short string
 * (`dicebear:style:seed`) and rebuilt anywhere without saving an image.
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui";
import { AVATAR_STYLES, encodeAvatar, parseAvatar, customAvatarUrl } from "@/lib/dicebear";

/** Short, pronounceable seeds - nicer to look at than a uuid when the seed is
 *  shown to the user, and there are plenty for shuffling. */
function randomSeed(): string {
  const a = ["swift", "brave", "calm", "bright", "clever", "bold", "quiet", "keen", "royal", "lucky"];
  const b = ["rook", "knight", "bishop", "pawn", "queen", "king", "castle", "gambit", "check", "mate"];
  return `${a[Math.floor(Math.random() * a.length)]}-${b[Math.floor(Math.random() * b.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
}

export function AvatarBuilder({
  value, fallbackSeed, onChange,
}: {
  /** Current stored avatar string, if any. */
  value: string | null;
  /** Used when the user has never customised - their profile id. */
  fallbackSeed: string;
  onChange: (next: string) => void;
}) {
  const parsed = parseAvatar(value);
  const [styleId, setStyleId] = useState<string>(parsed?.styleId ?? AVATAR_STYLES[0].id);
  const [seed, setSeed] = useState<string>(parsed?.seed ?? fallbackSeed);

  const current = useMemo(() => encodeAvatar(styleId, seed), [styleId, seed]);
  const preview = customAvatarUrl(current, 128);

  // A row of seeds to pick from, regenerated on shuffle.
  const [choices, setChoices] = useState<string[]>(() =>
    Array.from({ length: 6 }, () => randomSeed()));

  const apply = (nextStyle: string, nextSeed: string) => {
    setStyleId(nextStyle);
    setSeed(nextSeed);
    onChange(encodeAvatar(nextStyle, nextSeed));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <motion.img
          key={current}
          initial={{ scale: 0.92, opacity: 0.6 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 22 }}
          src={preview ?? ""}
          alt="Your avatar"
          className="w-24 h-24 rounded-full bg-surface-3"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium">Your avatar</p>
          <p className="text-xs text-muted-foreground break-all">
            {AVATAR_STYLES.find((s) => s.id === styleId)?.label} · seed <code>{seed}</code>
          </p>
        </div>
      </div>

      <div>
        <p className="text-sm text-muted-foreground mb-2">Style</p>
        <div className="flex flex-wrap gap-2">
          {AVATAR_STYLES.map((s) => {
            const url = customAvatarUrl(encodeAvatar(s.id, seed), 64);
            const active = s.id === styleId;
            return (
              <button
                key={s.id}
                onClick={() => apply(s.id, seed)}
                title={s.label}
                className={`rounded-full p-0.5 transition-opacity ${active ? "ring-2 ring-primary opacity-100" : "opacity-70 hover:opacity-100"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URI */}
                <img src={url ?? ""} alt={s.label} className="w-12 h-12 rounded-full bg-surface-3" />
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-muted-foreground">Pick a face</p>
          <Button variant="secondary" onClick={() => setChoices(Array.from({ length: 6 }, () => randomSeed()))}>
            ↻ Shuffle
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {choices.map((s) => {
            const url = customAvatarUrl(encodeAvatar(styleId, s), 64);
            const active = s === seed;
            return (
              <button
                key={s}
                onClick={() => apply(styleId, s)}
                title={s}
                className={`rounded-full p-0.5 transition-opacity ${active ? "ring-2 ring-primary opacity-100" : "opacity-70 hover:opacity-100"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URI */}
                <img src={url ?? ""} alt={s} className="w-12 h-12 rounded-full bg-surface-3" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
