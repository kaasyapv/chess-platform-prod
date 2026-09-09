/* Curated avatar set - 12 hand-drawn line-art busts (Notion doodle style:
 * ink outline, white fill, solid ink hair) on soft pastel discs.
 *
 * This REPLACES the old build-your-own rig. What survives is the contract:
 * profiles.avatar stores an id string, <AvatarArt id> draws it, anything
 * unparseable falls back to initials in components/ui Avatar.
 *
 * THE IDS ARE LOAD-BEARING - they're stored on profiles, so the ten original
 * ids stay exactly as they were (only the art changed), and legacy custom
 * ids ("c:…") deterministically map onto one of the twelve characters so
 * nobody's saved profile loses its face.
 *
 * Animation: a short "notice you" gesture - the head tilts, bobs and settles
 * (matching the motion reference) - played ONCE per `play` nonce, then still.
 * Bump the nonce to replay; 0 means never animate. */

import { motion, useReducedMotion } from "framer-motion";
import { parseCustomAvatar } from "./avatar-parts";

export { parseCustomAvatar } from "./avatar-parts";

const INK = "#26282e";

/** Line-art stroke defaults shared by every path in the set. */
const S = { fill: "none", stroke: INK, strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const FILL_W = { fill: "#fff", stroke: INK, strokeWidth: 2.4, strokeLinejoin: "round" } as const;

/* ── Shared bust anatomy (0 0 100 100) ──────────────────────────────────── */

/** Neck + plain tee shoulders. Characters with special clothes replace this. */
const BODY_TEE = (
  <g>
    <path d="M43 54 L43 69 Q50 73.5 57 69 L57 54" {...FILL_W} />
    <path d="M19 101 C19 81 32 72 50 72 C68 72 81 81 81 101 Z" {...FILL_W} />
    <path d="M40 74 Q50 80 60 74" {...S} strokeWidth={2} />
  </g>
);

/** Ears + bare head. Hair paints over this inside the head group. */
const HEAD_BASE = (
  <g>
    <ellipse cx="30.5" cy="41" rx="3.2" ry="4.4" {...FILL_W} />
    <ellipse cx="69.5" cy="41" rx="3.2" ry="4.4" {...FILL_W} />
    <ellipse cx="50" cy="38" rx="19" ry="21" {...FILL_W} />
  </g>
);

/** Brows, dot eyes, nose, smile - overridden by shades-wearers. */
const FACE_DEFAULT = (
  <g>
    <g {...S} strokeWidth={2}>
      <path d="M38.5 34.5 q4 -3 8 -0.8" />
      <path d="M53.5 33.7 q4 -2.2 8 0.8" />
      <path d="M50.5 41.5 q1.8 4 -0.8 6" />
      <path d="M44.5 53.5 q5.5 4.5 11 0" />
    </g>
    <circle cx="43" cy="39.5" r="1.9" fill={INK} />
    <circle cx="57" cy="39.5" r="1.9" fill={INK} />
  </g>
);

/* ── The cast ───────────────────────────────────────────────────────────── */

type AvatarDef = {
  id: string; label: string; bg: string;
  hair: React.ReactNode;          // solid-ink hair, painted over the bare head
  face?: React.ReactNode;         // replaces FACE_DEFAULT (e.g. sunglasses)
  extra?: React.ReactNode;        // glasses, earrings… painted over the face
  body?: React.ReactNode;         // replaces BODY_TEE (hoodie, jacket…)
};

export const AVATARS: AvatarDef[] = [
  { id: "knight", label: "Arlo", bg: "#e8e6f8", hair: (
    <path d="M31.5 34 C32 20.5 40 16.5 50 16.5 C61 16.5 68.5 22 68.5 34 C65.5 26.5 59 24.5 49.5 25.5 C39.5 26.5 34.5 28.5 31.5 34 Z" fill={INK} />
  ) },
  { id: "fox", label: "Mira", bg: "#f9e3e8", hair: (
    <path d="M27 56 C23 20 43.5 11.5 51.5 12 C68.5 13 77 29 73 56 L67 56 C68 44 67.5 32 61.5 26.5 C55 33 41 31.5 38.5 24.5 C32 29 32 44 33 56 Z" fill={INK} />
  ), extra: (
    <g>
      <circle cx="30.5" cy="48.5" r="1.6" fill={INK} />
      <circle cx="69.5" cy="48.5" r="1.6" fill={INK} />
    </g>
  ) },
  { id: "wizard", label: "Ravi", bg: "#dff1e6", hair: (
    <path d="M32 33 C33.5 21 41 17 50 17 C60 17 66.5 22 68 33 C64 27 58.5 25.5 50 26 C41 26.5 35.5 28 32 33 Z" fill={INK} />
  ), extra: (
    <g>
      <circle cx="42.5" cy="40" r="6.2" {...S} strokeWidth={2} />
      <circle cx="57.5" cy="40" r="6.2" {...S} strokeWidth={2} />
      <path d="M48.7 40 h2.6 M36.3 39 l-4 -1.2 M63.7 39 l4 -1.2" {...S} strokeWidth={2} />
      <path d="M43 48.5 q7 -3.5 14 0 q-3.5 3 -7 3 q-3.5 0 -7 -3 Z" fill={INK} />
    </g>
  ) },
  { id: "owl", label: "Zoe", bg: "#f7efda", hair: (
    <g fill={INK}>
      <circle cx="50" cy="12.5" r="6.5" />
      <path d="M30.5 40 C29 22.5 40 15.5 50 15.5 C60 15.5 71 22.5 69.5 40 C67 30 61 27 50 27.5 C39 28 33 30 30.5 40 Z" />
      <path d="M42 20 q8 -3 16 0" stroke="#fff" strokeWidth="1.4" fill="none" />
    </g>
  ) },
  { id: "panda", label: "Sam", bg: "#dfedf8", hair: (
    <path d="M34 30 C36.5 21 43 18 50 18 C57.5 18 64 21.5 66 30 C61 25.5 56 24.5 50 25 C44 25.5 38.5 26.5 34 30 Z" fill={INK} />
  ), extra: (
    <g>
      <circle cx="42.5" cy="40" r="5.8" {...S} strokeWidth={2} />
      <circle cx="57.5" cy="40" r="5.8" {...S} strokeWidth={2} />
      <path d="M48.3 40 h3.4" {...S} strokeWidth={2} />
    </g>
  ), body: (
    <g>
      <path d="M43 54 L43 69 Q50 73.5 57 69 L57 54" {...FILL_W} />
      <path d="M17 101 C17 80 31 70.5 50 70.5 C69 70.5 83 80 83 101 Z" {...FILL_W} />
      {/* hood bunched around the neck + drawstrings */}
      <path d="M33 76 C36 68 42 64.5 50 64.5 C58 64.5 64 68 67 76 Q58.5 71.5 50 71.5 Q41.5 71.5 33 76 Z" {...FILL_W} />
      <path d="M45.5 76 v7 M54.5 76 v7" {...S} strokeWidth={2} />
    </g>
  ) },
  { id: "robot", label: "Kai", bg: "#eae4f2", hair: (
    <path d="M31 31.5 L31.5 21.5 L68.5 21.5 L69 31.5 C63 26.5 57 25.5 50 25.5 C43 25.5 37 26.5 31 31.5 Z" fill={INK} />
  ), face: (
    <g>
      <g {...S} strokeWidth={2}>
        <path d="M50.5 42 q1.8 4 -0.8 6" />
        <path d="M45 54 q5 3.8 10 0" />
      </g>
      <rect x="34.5" y="34.5" width="13" height="9" rx="3.2" fill={INK} />
      <rect x="52.5" y="34.5" width="13" height="9" rx="3.2" fill={INK} />
      <path d="M47.5 38 h5 M34.5 37.5 l-3.5 -1 M65.5 37.5 l3.5 -1" {...S} strokeWidth={2} />
    </g>
  ) },
  { id: "dragon", label: "Rex", bg: "#e3f2e1", hair: (
    <g fill={INK}>
      <path d="M42 22 L46 13 L49 21 L53 12.5 L56 21 L60 14 L62 23 C58 20.5 55 20 50 20.2 C46.5 20.4 44.5 21 42 22 Z" />
      <path d="M41.5 22.5 C45 20.5 55 20.5 62.5 23 L63.5 30 C58 26.5 44 26.5 38.5 30 Z" />
      <circle cx="35" cy="30" r="0.9" /><circle cx="38.5" cy="26.5" r="0.9" />
      <circle cx="65" cy="30" r="0.9" /><circle cx="61.5" cy="26.5" r="0.9" />
    </g>
  ), body: (
    <g>
      <path d="M43 54 L43 69 Q50 73.5 57 69 L57 54" {...FILL_W} />
      <path d="M19 101 C19 81 32 72 50 72 C68 72 81 81 81 101 Z" fill={INK} stroke={INK} strokeWidth="2.4" />
      {/* lapels + zip */}
      <path d="M42 73 L50 82 L58 73" stroke="#fff" strokeWidth="2" fill="none" strokeLinejoin="round" />
      <path d="M50 82 v18" stroke="#fff" strokeWidth="1.6" />
      <path d="M60 88 l5 -4 l-2 7 z" fill="#fff" />
    </g>
  ) },
  { id: "cat", label: "Lila", bg: "#fae8dc", hair: (
    <path d="M28 74 C26 66 27.5 58 28.5 48 C29.5 24 40 14.5 51 14.5 C62.5 14.5 70.5 24 71.5 48 C72.5 58 74 66 72 74 L64 74 C66.5 62 66 40 61 29.5 C54.5 34.5 42 33.5 38.5 27 C34.5 36 33.5 62 36 74 Z" fill={INK} />
  ) },
  { id: "lion", label: "Leo", bg: "#f8f1d8", hair: (
    <g fill={INK}>
      <path d="M31.5 33 C32.5 20.5 41 16.5 50 16.5 C60 16.5 67.5 21.5 68.5 33 C64.5 26.5 58 25 49.5 25.5 C40.5 26 35 28 31.5 33 Z" />
      {/* full beard hugging the jaw */}
      <path d="M31.5 42 C32 54.5 39 61.5 50 61.5 C61 61.5 68 54.5 68.5 42 C68 52 64 57 57.5 58 L57 51.5 Q50 55.5 43 51.5 L42.5 58 C36 57 32 52 31.5 42 Z" />
    </g>
  ) },
  { id: "astronaut", label: "Nova", bg: "#e0eaf8", hair: (
    <g>
      <path d="M40 27 C44 25.8 56 25.8 60 27 L60 31 C55 29.5 45 29.5 40 31 Z" fill={INK} />
      <path d="M31 30 C32.5 19.5 41 15 50 15 C59.5 15 67.5 19.5 69 30 L74 32.5 Q75.5 35 73 35.5 L31.5 35.5 Q29 35 31 30 Z" {...FILL_W} />
      <path d="M50 15 L50 25" {...S} strokeWidth={2} />
    </g>
  ) },
  { id: "juno", label: "Juno", bg: "#f6e3f0", hair: (
    <g fill={INK}>
      <circle cx="36" cy="27" r="9.5" /><circle cx="50" cy="21" r="10.5" /><circle cx="64" cy="27" r="9.5" />
      <circle cx="29.5" cy="38" r="6.5" /><circle cx="70.5" cy="38" r="6.5" />
      <path d="M33 30 C38 24 62 24 67 30 L67 34 C60 29 40 29 33 34 Z" />
    </g>
  ) },
  { id: "remy", label: "Remy", bg: "#e6eee2", hair: (
    <g>
      <path d="M36 20 C38 14.5 44 12 50 12 C56 12 62 14.5 64 20 L64.5 26 L35.5 26 Z" {...FILL_W} />
      <path d="M30 26 L70 26 Q73.5 29.5 70.5 32.5 Q60 29.5 50 29.5 Q40 29.5 29.5 32.5 Q26.5 29.5 30 26 Z" {...FILL_W} />
      <path d="M35.5 21.5 q14.5 -3.5 29 0" {...S} strokeWidth={1.8} />
    </g>
  ) },
];

export const AVATAR_IDS = AVATARS.map((a) => a.id);

/** Legacy "c:…" builder ids → a stable pick from the curated cast, so every
 *  profile saved under the old system still renders a face, not initials. */
function legacyPick(id: string): AvatarDef | null {
  if (!parseCustomAvatar(id)) return null;
  let h = 0;
  for (let i = 2; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

/** One-shot greet gesture, from the motion reference: tilt away, tilt back
 *  past centre, settle. Plays once per `play` nonce (key remount), then rests. */
const GREET = {
  rotate: [0, -7, 5.5, -2.5, 0],
  y: [0, -2.6, -0.8, -0.2, 0],
};

/** Render one avatar by id - curated, legacy custom, or null when unknown.
 *  `play`: bump this nonce to run the greet animation once; 0 = static. */
export function AvatarArt({ id, size = 32, play = 0 }: { id: string; size?: number; play?: number }) {
  const reduceMotion = useReducedMotion();
  const def = AVATARS.find((a) => a.id === id) ?? legacyPick(id);
  if (!def) return null;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full shrink-0 overflow-hidden"
      style={{ width: size, height: size, background: def.bg }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
        {def.body ?? BODY_TEE}
        <motion.g
          key={play}
          initial={false}
          animate={play > 0 && !reduceMotion ? GREET : undefined}
          transition={{ duration: 0.9, ease: "easeInOut" }}
          style={{ transformBox: "fill-box", transformOrigin: "50% 85%" }}
        >
          {HEAD_BASE}
          {def.hair}
          {def.face ?? FACE_DEFAULT}
          {def.extra}
        </motion.g>
      </svg>
    </span>
  );
}
