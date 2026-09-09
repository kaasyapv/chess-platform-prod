/* DiceBear avatars, generated from a stable per-user seed.
 *
 * Generated locally rather than fetched from api.dicebear.com: hundreds of
 * avatars render on a student list, and a network round-trip each (that can
 * fail, rate-limit, or leak who our users are to a third party) is the wrong
 * trade for an SVG we can compute ourselves.
 *
 * Deterministic by construction - the seed is the user's id (or name when no
 * id is to hand), so the same person always gets the same face, across
 * reloads, devices and roles. Nothing random is involved anywhere.
 */

import { createAvatar } from "@dicebear/core";
import {
  adventurerNeutral, notionists, thumbs, bottts, funEmoji, lorelei, micah, pixelArt,
} from "@dicebear/collection";

/** One palette across all styles so a class list reads as one system. */
const BG = ["b6e3f4", "c0aede", "d1d4f9", "ffd5dc", "ffdfbf", "c8e6c9"];

/* Role picks the style: the two adult-facing roles get the illustrated
 * notionists set, students get friendlier faces, and anything unknown falls
 * back to thumbs. Same seed + same role always resolves to the same avatar. */
const STYLE_FOR_ROLE = {
  ceo: notionists,
  manager: notionists,
  coach: adventurerNeutral,
  student: adventurerNeutral,
  default: thumbs,
} as const;

export type AvatarRole = keyof typeof STYLE_FOR_ROLE;

/** Cache keyed by seed+role+size - the same faces re-render constantly as
 *  lists paginate, and regenerating identical SVGs is pure waste. */
const cache = new Map<string, string>();
const CACHE_LIMIT = 600;

/* ── User-chosen avatars ─────────────────────────────────────────────────────
 * A customised avatar is stored on profiles.avatar as `dicebear:<style>:<seed>`
 * - a string, in the column that already exists, so no migration and no second
 * source of truth. Anything else in that column is a legacy hand-drawn avatar
 * id and still wins (see components/ui Avatar).                              */

/** Styles offered in the customiser. Kept deliberately short: a wall of 30
 *  styles is a worse experience than eight good ones. */
export const AVATAR_STYLES = [
  { id: "adventurerNeutral", label: "Adventurer", style: adventurerNeutral },
  { id: "notionists", label: "Notionist", style: notionists },
  { id: "thumbs", label: "Thumbs", style: thumbs },
  { id: "bottts", label: "Robot", style: bottts },
  { id: "funEmoji", label: "Emoji", style: funEmoji },
  { id: "lorelei", label: "Lorelei", style: lorelei },
  { id: "micah", label: "Micah", style: micah },
  { id: "pixelArt", label: "Pixel", style: pixelArt },
] as const;

export type AvatarStyleId = (typeof AVATAR_STYLES)[number]["id"];

const STYLE_BY_ID = Object.fromEntries(AVATAR_STYLES.map((s) => [s.id, s.style]));

export const DICEBEAR_PREFIX = "dicebear:";

export function encodeAvatar(styleId: string, seed: string): string {
  // ':' separates the parts, so it can't appear inside the seed.
  return `${DICEBEAR_PREFIX}${styleId}:${seed.replace(/:/g, "-")}`;
}

export function parseAvatar(value?: string | null): { styleId: string; seed: string } | null {
  if (!value?.startsWith(DICEBEAR_PREFIX)) return null;
  const rest = value.slice(DICEBEAR_PREFIX.length);
  const i = rest.indexOf(":");
  if (i < 1) return null;
  const styleId = rest.slice(0, i);
  const seed = rest.slice(i + 1);
  if (!seed || !(styleId in STYLE_BY_ID)) return null;
  return { styleId, seed };
}

/** Render a stored `dicebear:style:seed` value. */
export function customAvatarUrl(value: string, size = 96): string | null {
  const parsed = parseAvatar(value);
  if (!parsed) return null;
  const key = `custom|${value}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const svg = createAvatar(STYLE_BY_ID[parsed.styleId] as Parameters<typeof createAvatar>[0], {
    seed: parsed.seed, size, backgroundColor: BG, radius: 50,
  }).toString();
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, uri);
  return uri;
}

/**
 * A `data:` URI for this user's avatar, safe to drop straight into `<img src>`.
 * `seed` should be the profile id; pass the display name only when that's all
 * you have (it's stable enough, but two people with the same name would share
 * a face, which ids avoid).
 */
export function dicebearUrl(seed: string, role: string = "default", size = 64): string {
  const key = `${seed}|${role}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // Each DiceBear style declares its own Options type (different eye/hair
  // variants), so a lookup table of styles has no single satisfying type.
  // The options we pass are the ones common to every style.
  const style = (STYLE_FOR_ROLE[role as AvatarRole] ?? STYLE_FOR_ROLE.default) as Parameters<typeof createAvatar>[0];
  const svg = createAvatar(style, {
    seed,
    size,
    backgroundColor: BG,
    radius: 50,
  }).toString();

  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  if (cache.size >= CACHE_LIMIT) cache.clear(); // crude but bounded; these are cheap to rebuild
  cache.set(key, uri);
  return uri;
}
