# Provisioning & running - from zero to a working deployment

New-developer path. Credentials themselves are catalogued in
[NEEDS.md](NEEDS.md); every env var is documented in [.env.example](../.env.example).

## 1. Prerequisites

- Node ≥ 22.6 (tests use native TypeScript type-stripping)
- A free [Supabase](https://supabase.com) project (hosted) - or Docker for the
 local stack (`npm run db:start`)

## 2. Configure environment

```bash
cp .env.local.example .env.local # fill in the two Supabase values
```

`GET /api/health` tells you at any point what is missing or disabled.

## 3. Database - apply migrations

Migrations are ordered and idempotent-from-scratch (run once, in order):
| File | Creates |
|---|---|
| `0001_tenancy.sql` | academies, profiles, invites, roles, audit log, RLS helpers (`my_academy()`, `my_role()`, `is_staff()`) |
| `0002_academy_domain.sql` | batches, classrooms, PGN library, homework, courses, tournaments, simuls, attendance, booking, calendar view, leaderboard, notifications, announcements, invoices |
| `0003_knowledge_engine.sql` | extraction jobs/items, lessons, assistant threads, **`sources` storage bucket + policies** |
| `0004_billing.sql` | billing customers, subscriptions, billing events, payment/renewal functions |
| `0005_demo_parity.sql` | coach↔student assignment, external meeting links, parent-shareable reports, classroom materials policy |
| `0006_enterprise.sql` | manager permission flags, leads CRM + events, demo sessions, live-ops board state (+realtime publication), webhook tokens, GST columns (docs/ARCHITECTURE_V2.md) |

**Demo accounts (local only, never run on hosted):** `supabase/seed.sql`
(applied automatically by `npm run db:start`/`db:reset`) creates
`admin@chessacademy.test` (CEO), `manager@chessacademy.test` (Class Manager),
`coach@chessacademy.test`, `student@chessacademy.test` - all password
`chesspass123`. That password is public (it's in this file), so running this
against a hosted/production project hands out a live CEO account. See
**§5 Seed data** - a hosted project should never run `seed.sql` at all; the
first real signup becomes CEO via `bootstrap_academy()`.

**Hosted (dashboard):** paste each numbered migration file into SQL Editor →
Run, in order. Do **not** paste `seed.sql` or `seed_factory.sql` - see above.

**Hosted (CLI):**
```bash
npx supabase login
npx supabase link --project-ref <ref>
npm run db:push
```

**Local stack:** `npm run db:start` (Docker; applies migrations automatically,
prints local URL + anon key for `.env.local`). `npm run db:reset` re-applies
from scratch.

`db:reset`/`db:start` only run `seed.sql` and `seed_factory.sql` - the ones
Postgres itself executes during the reset. The PGN library and puzzle bank are
seeded separately, from Node, because they read from the filesystem
(`Clone_reference/PGN_Library`, `Data/`) rather than being baked into SQL. Run
this once after every reset, before a demo:
```bash
npm run seed:content # puzzles + ~10,500 PGNs across every category
```

Storage buckets need no manual step - migration 0003 creates the private
`sources` bucket with academy-scoped policies. Realtime broadcast is on by
default; the live classroom uses it as-is.

## 4. Verify RLS

```bash
npm run db:verify-rls # needs DATABASE_URL + psql
```
…or paste `scripts/verify-rls.sql` into the SQL editor. It raises an error if
any public table lacks RLS or policies, then lists every policy.

## 5. Seed data

None required - by design. The first signup choosing **New academy** runs
`bootstrap_academy()` and becomes CEO; everyone else joins via invite codes
(Academy → Add Student). Auth users can't be safely seeded from SQL, so there
is deliberately no seed script.

## 6. Optional services
| Service | Enables | How |
|---|---|---|
| Anthropic key | PDF/image extraction, AI assistant | `ANTHROPIC_API_KEY` in `.env.local` |
| OpenAI instead | same (images only) | `AI_PROVIDER=openai` + `OPENAI_API_KEY` |
| Google OAuth | "Continue with Google" | Supabase Dashboard → Auth → Providers → Google |
| Custom SMTP | production auth email | Supabase Dashboard → Auth → SMTP |
| Jitsi self-host | classroom video domain | `NEXT_PUBLIC_JITSI_DOMAIN` |
| Subscription renewals on a schedule | auto-invoicing | `select cron.schedule('renewals','0 2 * * *', $$select public.renew_due_subscriptions()$$);` (or click "Run renewals" in Billing) |

Billing works out of the box with the mock gateway (`BILLING_PROVIDER=mock`) -
checkout, payment, webhook signature verification, event log. A real gateway
is one new module in `src/lib/billing/` plus `SUPABASE_SERVICE_ROLE_KEY` for
its webhooks.

## 7. Run

```bash
npm install
npm run dev # http://localhost:3000
npm test # pure-logic self-checks
npm run lint && npm run typecheck
npm run build # production build
```

## 8. Deploy (Vercel)

Import the repo, set the env vars from `.env.example` (at minimum the two
Supabase ones), deploy. Point an uptime monitor at `/api/health` (200 = env
complete + DB reachable, 503 otherwise). No other infrastructure: Stockfish
runs client-side (WASM), video is Jitsi, realtime is Supabase.
