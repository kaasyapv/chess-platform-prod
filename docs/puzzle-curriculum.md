# Puzzle curriculum (Lichess CC0)

The `puzzles` table is seeded from **`src/data/puzzles.json`** — a 10,500-puzzle
subset of the [Lichess open puzzle database](https://database.lichess.org/#puzzles),
released under **CC0** (public domain). Rating-ramped, 5 tactical topics, one row
per puzzle: `id, fen, moves (UCI line), rating, popularity, plays, themes`.

Load it with `node scripts/seed-puzzles.mjs` (idempotent upsert, service role).
Production was seeded 2026-09-04 via the Supabase Table Editor CSV import.

## Difficulty bands

The Puzzles trainer (`src/app/[role]/dashboard/[academyId]/puzzles/puzzles-client.tsx`)
pulls a random puzzle from the chosen band by `rating`:

| Band | Rating | Count |
|---|---|---|
| Beginner | `< 1200` | 3,935 |
| Intermediate | `1200–1599` | 2,431 |
| Advanced | `1600–1999` | 2,136 |
| Master | `≥ 2000` | 1,998 |

## Themes (for building a themed lesson track)

`themes` is a space-separated tag string — filter with
`themes ilike '%<tag>%'` or the `puzzles_themes` GIN index.

| Theme | Count | Teaching use |
|---|---|---|
| `mateIn1` | 1,581 | first checkmates |
| `mateIn2` | 1,469 | forcing sequences |
| `fork` | 1,359 | double attack |
| `backRankMate` | 370 | back-rank weakness |
| `pin` | 608 | pins |
| `discoveredAttack` | 527 | discovered / double check |
| `sacrifice` | 795 | material investment |
| `deflection` | 445 | overloaded pieces |
| `hangingPiece` | 413 | spotting undefended material |
| `rookEndgame` | 613 | rook endgames |
| `advancedPawn` | 639 | passed-pawn play |
| `defensiveMove` | 637 | finding the only defence |
| `quietMove` | 453 | non-forcing resources |
| `kingsideAttack` | 950 | attacking the castled king |

Endgame / middlegame / opening phase tags are also present
(`endgame` 5,274 · `middlegame` 4,717 · `opening` 509) and combine with the
above, e.g. `themes ilike '%fork%' and themes ilike '%endgame%'`.

## Suggested 8-week track

1. **Hanging pieces & one-movers** — `oneMove` + `hangingPiece`, rating < 1000
2. **Mate in 1** — `mateIn1`, < 1100
3. **The fork** — `fork`, 1000–1300
4. **Pins & skewers** — `pin`, 1100–1400
5. **Mate in 2** — `mateIn2`, 1200–1500
6. **Discovered attacks** — `discoveredAttack`, 1300–1600
7. **Sacrifice & deflection** — `sacrifice` + `deflection`, 1500–1800
8. **Rook endgames** — `rookEndgame`, 1400–1800

Each week: pull ~20 puzzles in the band, assign as homework, track via
`puzzle_attempts`.
