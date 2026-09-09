/* Gamified Board obstacle geometry. Kept out of chess-board.tsx so it can be
 * unit-tested without pulling in chessground's CSS/DOM imports.
 *
 * Reference behaviour (7knights.chessplay.io): reward stickers are capturable
 * by normal chess rules; obstacle stickers (rock/wall/fence) block a sliding
 * piece's whole PATH — it may not land on the square OR pass through it. */

/** Every square strictly between `from` and `to` on a shared rank / file /
 *  diagonal. Empty for a knight hop or any non-aligned pair. */
export function squaresBetween(from: string, to: string): string[] {
  const fc = from.charCodeAt(0), fr = +from[1], tc = to.charCodeAt(0), tr = +to[1];
  const dc = Math.sign(tc - fc), dr = Math.sign(tr - fr);
  const aligned = fc === tc || fr === tr || Math.abs(tc - fc) === Math.abs(tr - fr);
  if (!aligned) return [];
  const out: string[] = [];
  let c = fc + dc, r = fr + dr;
  while (c !== tc || r !== tr) {
    out.push(String.fromCharCode(c) + r);
    c += dc; r += dr;
  }
  return out;
}

/** Drop any destination that lands on, or slides through, a blocked square. */
export function applyBlocked<K extends string>(dests: Map<K, K[]>, blocked: Set<string>): Map<K, K[]> {
  if (!blocked.size) return dests;
  const out = new Map<K, K[]>();
  for (const [from, tos] of dests) {
    const kept = tos.filter(
      (to) => !blocked.has(to) && !squaresBetween(from, to).some((s) => blocked.has(s)),
    );
    if (kept.length) out.set(from, kept);
  }
  return out;
}
