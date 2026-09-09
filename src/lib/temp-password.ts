/* Temporary-password generation for the admin "Reset password" action.
 *
 * Pure, deterministic-given-RNG logic kept out of the route handler so it can
 * be unit-tested without a server (see tests/temp-password.test.mjs). The
 * handler pairs each generated password with `profiles.must_change_password =
 * true`, so this value is a one-time hand-off credential, never a permanent
 * password.
 *
 * Requirements it must satisfy:
 *  - >= Supabase Auth's default minimum (6) with margin -> 14 chars.
 *  - Contains at least one lower, one upper, one digit, one symbol (so it also
 *    passes a project configured with "lower/upper/digits/symbols" strength).
 *  - No ambiguous glyphs (0/O, 1/l/I) - it gets read aloud or copied by hand.
 *  - Grouped `xxxx-xxxx-xxxx` for legibility.
 */

const LOWER = "abcdefghijkmnpqrstuvwxyz"; // no l
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O
const DIGIT = "23456789"; // no 0, 1
const SYMBOL = "!@#$%&*+=?";
const ALL = LOWER + UPPER + DIGIT + SYMBOL;

const LEN = 14;

export type RandomBytes = (n: number) => Uint8Array;

/** Default RNG: Web Crypto (available in Node 19+, edge, and browsers). */
const defaultRng: RandomBytes = (n) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
};

/** Rejection-sampled index into `set` (no modulo bias). */
function pick(set: string, rng: RandomBytes): string {
  const max = 256 - (256 % set.length);
  // pull a few bytes at a time; overwhelmingly one iteration
  for (;;) {
    for (const b of rng(8)) if (b < max) return set[b % set.length];
  }
}

/** Fisher-Yates using rejection-sampled swaps. */
function shuffle(chars: string[], rng: RandomBytes): string[] {
  for (let i = chars.length - 1; i > 0; i--) {
    const bound = i + 1;
    const max = 256 - (256 % bound);
    let j = 0;
    outer: for (;;) {
      for (const b of rng(8)) if (b < max) { j = b % bound; break outer; }
    }
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

/**
 * Generate a temporary password. Injectable RNG for tests.
 * Returns e.g. `k7Rp-mN4x-qW9t` (14 chars incl. dashes count separately -> the
 * grouped form is 16 with dashes).
 */
export function generateTempPassword(rng: RandomBytes = defaultRng): string {
  const chars: string[] = [
    pick(LOWER, rng),
    pick(UPPER, rng),
    pick(DIGIT, rng),
    pick(SYMBOL, rng),
  ];
  while (chars.length < LEN) chars.push(pick(ALL, rng));
  const s = shuffle(chars, rng).join("");
  // group in 4s for readability: 14 -> "xxxx-xxxx-xxxx-xx"
  return s.replace(/(.{4})(?=.)/g, "$1-");
}

/** True if `pw` meets the strength contract above (used by the test + as a
 *  defensive check in the handler before it calls the Auth admin API). */
export function isStrongTempPassword(pw: string): boolean {
  const bare = pw.replace(/-/g, "");
  return (
    bare.length >= 12 &&
    /[a-z]/.test(bare) &&
    /[A-Z]/.test(bare) &&
    /[0-9]/.test(bare) &&
    /[^a-zA-Z0-9]/.test(bare) &&
    !/[0O1lI]/.test(bare)
  );
}
