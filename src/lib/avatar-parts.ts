/* The avatar part catalogue and its id codec - pure data and pure functions, no
 * JSX, so the self-check in tests/ can import it directly.
 *
 * An avatar is stored on profiles.avatar as one compact string:
 *
 *   c:<bg>:<skin>:<eyes>:<mouth>:<extra>:<hair>:<hat>:<bgStyle>
 *
 * ADDING PARTS IS APPEND-ONLY, AND THAT IS NOT A STYLE PREFERENCE.
 * Two things key off these array indices:
 *   1. every avatar already saved on a profile, and
 *   2. `unlocks.avatar_extras` / `unlocks.avatar_hats` - the indices a student
 *      has SPENT COINS on.
 * Renumbering a list would silently turn someone's purchased wizard hat into a
 * pair of sunglasses. So: new parts go on the END of a list, never in the
 * middle, and existing indices never move.
 *
 * Trailing fields are optional when parsing, so ids written before `hat` and
 * `bgStyle` existed still load - they simply come back with those layers unset.
 */

export const FACE_BGS = ["#6366f1", "#0ea5e9", "#22c55e", "#f97316", "#ec4899", "#eab308"];
export const FACE_SKINS = ["#FFD5B8", "#F2B98C", "#D9995F", "#A8703F", "#7C4A26", "#F5E4D0", "#5A3420"];

/* Expression = eyes + mouth. Both lists are append-only (see above). */
export const FACE_EYES = ["Round", "Happy", "Wink", "Star", "Sleepy", "Determined", "Lashes", "Hearts"] as const;
export const FACE_MOUTHS = ["Smile", "Grin", "Wow", "Smirk", "Sad", "Tongue out", "Lips", "Sweet smile"] as const;

export const FACE_HAIR = [
  "None", "Short", "Curly", "Spiky", "Long",
  "Ponytail", "Pigtails", "Bun", "Braids", "Bob",
] as const;

/* Accessories. Indices 1-8 are load-bearing: students have bought them.
 * (Crown / Wizard hat / Halo live here for historical reasons - they predate the
 * dedicated hat layer. They stay put rather than move to FACE_HATS, because
 * moving them would invalidate every purchase recorded against these indices.) */
export const FACE_EXTRAS = [
  "None", "Crown", "Glasses", "Bow", "Star",
  // Premium - unlocked with coins in the profile shop.
  "Wizard hat", "Headphones", "Shades", "Halo",
] as const;
/** FACE_EXTRAS[i] for i >= this index costs coins. */
export const PREMIUM_EXTRA_START = 5;

/* Headwear - its own layer, so a hat and an accessory can be worn together. */
export const FACE_HATS = [
  "None", "Cap", "Beanie", "Party hat", "Cowboy", "Top hat", "Tiara", "Flower crown",
  "Robot helmet", "Cat ears",
] as const;
/** FACE_HATS[i] for i >= this index costs coins. */
export const PREMIUM_HAT_START = 3;

/* Backgrounds - a pattern drawn behind the head, tinted with the chosen colour.
 * Free: they cost nothing to draw and give the face somewhere to live. */
export const FACE_BG_STYLES = ["Solid", "Rays", "Confetti", "Board", "Stars"] as const;

/* Outfits - what the full-body rig wears over the torso. Append-only like
 * everything else here. All free: outfits postdate the coin shop and nothing
 * is recorded against these indices yet. */
export const FACE_OUTFITS = [
  "Tee", "Hoodie", "Knight armor", "Wizard robe", "Hero cape",
  "Dress", "Tutu", "Sundress", "Gown",
] as const;

export const EXTRA_COST = 20;

export type CustomAvatar = {
  bg: number;
  skin: number;
  eyes: number;
  mouth: number;
  extra: number;
  hair: number;
  hat: number;
  bgStyle: number;
  outfit: number;
};

/** Every field, with the length of the list that bounds it. */
const BOUNDS: [keyof CustomAvatar, number][] = [
  ["bg", FACE_BGS.length],
  ["skin", FACE_SKINS.length],
  ["eyes", FACE_EYES.length],
  ["mouth", FACE_MOUTHS.length],
  ["extra", FACE_EXTRAS.length],
  ["hair", FACE_HAIR.length],
  ["hat", FACE_HATS.length],
  ["bgStyle", FACE_BG_STYLES.length],
  ["outfit", FACE_OUTFITS.length],
];

/**
 * Parse a stored avatar id. Returns null for anything that is not a well-formed
 * custom avatar, so a corrupt or hand-edited value renders as the fallback
 * (initials) instead of throwing somewhere deep in the navbar.
 *
 * Fields absent from an older, shorter id default to 0 (= the "None"/first
 * option), which is exactly how those avatars looked before the layer existed.
 */
export function parseCustomAvatar(id: string | null | undefined): CustomAvatar | null {
  if (!id?.startsWith("c:")) return null;

  const parts = id.slice(2).split(":");
  const out = {} as CustomAvatar;

  for (let i = 0; i < BOUNDS.length; i++) {
    const [field, max] = BOUNDS[i];
    // Missing trailing field on a legacy id -> unset layer.
    if (i >= parts.length) { out[field] = 0; continue; }

    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0 || n >= max) return null;
    out[field] = n;
  }

  return out;
}

export function customAvatarId(c: CustomAvatar): string {
  return `c:${c.bg}:${c.skin}:${c.eyes}:${c.mouth}:${c.extra}:${c.hair}:${c.hat}:${c.bgStyle}:${c.outfit}`;
}
