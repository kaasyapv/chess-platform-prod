# ChessAcademy

A multi-tenant chess-academy SaaS: multi-role dashboards, live classrooms
(Jitsi + Supabase Realtime board/chat sync), a shared WorldChess-style board,
play vs Stockfish, an AI knowledge engine (PDF/image → lessons/quizzes/
flashcards), PGN library, courses, tournaments, simuls, attendance, calendar,
leaderboard and provider-agnostic billing — one Next.js app, one shared board
component reused everywhere.

**Stack:** Next.js 16 (App Router) · Supabase (Auth, Postgres + RLS, Storage,
Realtime) · Jitsi (video) · Stockfish WASM (engine) · Tailwind 4 · Vercel.
All free-tier. Architecture: `enterprise_system_architecture.md`.

## Quick start

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase values - full guide: docs/SETUP.md
npm run dev     # http://localhost:3000
npm test        # pure-logic self-checks (clock, ELO map, sounds, billing, rate limit)
npm run lint && npm run typecheck
npm run build   # production build
```

Provisioning from scratch (migrations, storage, RLS verification, local
Supabase stack, deploy): **docs/SETUP.md**. Credential catalogue:
**docs/NEEDS.md**. Runtime config status: **GET /api/health**.

Sign up with **New academy** to become its CEO, then invite managers, coaches
and students (Academy → Add Student → share the invite code).

## What's inside

| Area | Where |
|---|---|
| Multi-tenant schema, RLS, audit log | `supabase/migrations/` |
| Shared WorldChess board (Club Green, Loco pieces, premove, arrows, sounds, clocks, settings modal) | `src/components/board/`, `src/lib/board-settings.ts`, `src/hooks/use-chess-sounds.ts` |
| Role dashboards `/{role}/dashboard/{academyId}/…` | `src/app/[role]/dashboard/[academyId]/` |
| Academy mgmt (users/batches, classrooms, PGN library, homework, courses, tournaments, simuls, attendance, self-booking, calendar, leaderboard, report, billing) | feature folders under the dashboard route |
| Live classroom (Jitsi + Supabase Realtime board/chat sync, coach tool palette) | `…/classrooms/[id]/` |
| Play vs Stockfish (12 levels), Analysis board (engine, FEN/PGN, share, PDF) | `…/play-area/`, `…/analysis-board/` |
| AI Knowledge Engine (upload → diagram/FEN extraction → lessons/quizzes/flashcards) | `…/knowledge/`, `src/app/api/knowledge/process/` |
| Content library + lesson player + PGN viewer | `…/library/` |
| Coach AI assistant | `…/assistant/`, `src/app/api/assistant/` |
| Pluggable AI provider (Anthropic default / OpenAI) with retry | `src/lib/ai/` |
| Provider-agnostic billing (subscriptions, checkout, webhooks, mock gateway) | `src/lib/billing/`, `src/app/api/billing/` |
| Health probe, env validation, rate limiting, security headers | `src/app/api/health/`, `src/lib/env.ts`, `src/lib/rate-limit.ts`, `next.config.ts` |
| Shared UI kit (Playmate design tokens) | `src/components/ui/`, `src/app/globals.css` |
| Public marketing site (hero, features, pricing, FAQ) + SEO (OG/robots/sitemap) | `src/components/marketing/`, `src/app/page.tsx`, `src/app/robots.ts`, `src/app/sitemap.ts` |

## Routing

- `/` - public marketing landing for visitors. Signed-in users are redirected
  to their role dashboard exactly as before (the dashboard never lived at `/`;
  no deep links changed).
- `/{role}/dashboard/{academyId}/…` - the SaaS app, session-gated (unchanged).
- Public paths (`src/proxy.ts`): `/`, `/login`, `/signup`, `/onboarding`,
  `/share/*`, `/auth/*`, `/api/health`, `/api/billing/webhook`, `/robots.txt`,
  `/sitemap.xml`. Everything else requires a session.
- Landing pricing CTAs link to `/signup?plan=free|pro|academy`; billing itself
  (invoices/subscriptions, mock gateway) lives in-app post-signup.

## Notes

- The board is **one component** (`ChessBoard`) reused by classroom, play,
  analysis, lessons and viewers - the WorldChess re-skin applied everywhere at
  once (the research pack's core thesis).
- Piece art and sounds are **original** (drawn/synthesized in-repo); no
  proprietary WorldChess/Lichess assets are shipped.
- External credentials and how to wire them: `docs/NEEDS.md`.
